import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { serializeProject } from '../../src/core/serialize'
import { contentBounds } from '../../src/core/zoom'
import { synthProject } from '../perf/synth'
import { getProject, launchApp, makeTempDir, makeUserDataDir, nextFrame, stubDialogs } from './launch'

/** 지금 캔버스에 실제로 만들어진 전선 도형 수 (화면 밖은 그리지 않는다) */
const drawnWires = (win: Page) =>
  win.evaluate(() => (window as unknown as { Konva: { stages: { find: (s: string) => unknown[] }[] } }).Konva.stages[0].find('.wire').length)

test('큰 배선도: 화면 밖은 그리지 않지만 PNG에는 전부, 배선 정리는 진행 창·취소·한 번에 실행 취소', async () => {
  const dir = makeTempDir('opb-large-')
  const file = join(dir, 'large.opb')
  const project = synthProject({ wires: 300, imageBytes: 100 })
  writeFileSync(file, serializeProject(project))
  const { app, win } = await launchApp(makeUserDataDir())
  try {
    await expect(win.getByText('부품함이 비어 있습니다.')).toBeVisible()
    await stubDialogs(app, { open: file })
    await win.keyboard.press('Control+o')
    await win.getByRole('dialog', { name: '부품 가져오기' }).getByRole('button', { name: '취소' }).click()
    await expect(win.getByTestId('doc-name')).toHaveText('large')

    // 1. 100%에서는 화면 안의 전선만 만든다. 전체 보기에서는 전부
    await win.keyboard.press('Control+0')
    await nextFrame(win)
    const at100 = await drawnWires(win)
    expect(at100).toBeGreaterThan(0)
    expect(at100).toBeLessThan(project.wires.length)
    await win.keyboard.press('Home')
    await nextFrame(win)
    expect(await drawnWires(win)).toBe(project.wires.length)

    // 2. 100%에서 PNG로 내보내도 화면 밖까지 전부 들어간다 (월드 1단위 = 2px)
    await win.keyboard.press('Control+0')
    await nextFrame(win)
    const before = await drawnWires(win)
    expect(before).toBeLessThan(project.wires.length)
    const png = join(dir, 'large.png')
    await stubDialogs(app, { save: png })
    await win.getByText('내보내기 ▾').click()
    await win.getByRole('menuitem', { name: '배선도 이미지 (PNG)' }).click()
    await expect.poll(() => existsSync(png)).toBe(true)
    const bounds = contentBounds(project)!
    expect(readFileSync(png).readUInt32BE(16)).toBeGreaterThan(bounds.width * 2)
    await nextFrame(win)
    expect(await drawnWires(win)).toBe(before) // 내보낸 뒤에는 다시 화면 안만

    // 결선표: 행이 많으면 보이는 행만 만들고, 끝까지 내리면 마지막 행이 보인다
    await win.getByRole('button', { name: /^결선표 \(/ }).click()
    const table = win.getByRole('region', { name: '결선표' })
    await expect(table.locator('tbody tr:not(.spacer-row)').first()).toBeVisible()
    expect(await table.locator('tbody tr:not(.spacer-row)').count()).toBeLessThan(project.wires.length)
    await win.locator('.report-overlay').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(table.locator('tbody tr:not(.spacer-row) td.num').last()).toHaveText(String(project.wires.length))
    await win.getByRole('button', { name: /^배선도$/ }).click()

    // 3. 배선 정리(전체): 진행 창 → 취소하면 그대로
    const overlay = win.getByRole('dialog', { name: '배선 정리 중' })
    await win.locator('header').getByRole('button', { name: '⌁ 배선 정리' }).click()
    await expect(overlay).toBeVisible()
    await expect(overlay.getByRole('progressbar')).toBeVisible()
    await overlay.getByRole('button', { name: '취소' }).click()
    await expect(win.getByRole('status')).toContainText('배선 정리를 취소했습니다')
    await expect(overlay).toHaveCount(0)
    expect((await getProject(win)).wires).toEqual(project.wires)

    // 4. 다시 → 끝나면 한 번에 들어가고, 실행 취소 한 번으로 되돌아간다
    await win.locator('header').getByRole('button', { name: '⌁ 배선 정리' }).click()
    await expect(win.getByRole('status')).toContainText('전선 300개를 정리했습니다', { timeout: 60_000 })
    await expect(overlay).toHaveCount(0)
    const routed = (await getProject(win)).wires
    expect(routed.every((w) => w.orthogonal)).toBe(true)
    expect(routed).not.toEqual(project.wires)
    await win.keyboard.press('Control+z')
    await expect.poll(async () => (await getProject(win)).wires).toEqual(project.wires)
  } finally {
    await app.close()
  }
})
