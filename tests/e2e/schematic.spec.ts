import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { Project } from '../../src/core/model'
import { buildTwoPartDiagram, getProject, launchApp, makeTempDir, makeUserDataDir, nextFrame, seedLibrary, stubDialogs } from './launch'

const counts = (win: Page) => win.evaluate(() => window.__opbSchematic!.counts())
const pinAt = async (win: Page, instanceId: string, pinId: string) =>
  (await win.evaluate(([i, p]) => window.__opbSchematic!.pinClientPosition(i!, p!), [instanceId, pinId]))!

test('회로도: 배선도 부품이 기호로 → 끌기(격자)·회전·실행 취소 → 회로도에서 이으면 배선도에도 → 넷 라벨 → 저장·PNG', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const out = makeTempDir('opb-sch-')
  const { app, win } = await launchApp(userData)
  try {
    const { u1, u2 } = await buildTwoPartDiagram(win)
    const view = win.getByRole('navigation', { name: '보기' })
    await view.getByRole('button', { name: '회로도' }).click()
    await expect(win.getByTestId('schematic-canvas')).toBeVisible()
    await expect.poll(() => counts(win)).toEqual({ symbols: 2, wires: 1, labels: 0 })
    await nextFrame(win)
    await win.screenshot({ path: 'test-results/schematic.png' })

    // 기호 끌기 → 자리가 격자(10) 위에 저장, 배선도의 부품 자리는 그대로
    const before = await getProject(win)
    const c = (await win.evaluate((id) => window.__opbSchematic!.symbolClientCenter(id), u1))!
    await win.mouse.move(c.x, c.y)
    await win.mouse.down()
    await win.mouse.move(c.x + 30, c.y + 20)
    await win.mouse.move(c.x + 60, c.y + 45)
    await win.mouse.up()
    await expect.poll(async () => (await getProject(win)).schematic?.symbols?.[u1]).toBeTruthy()
    const moved = (await getProject(win)).schematic!.symbols![u1]!
    expect(Math.abs(moved.x % 10)).toBe(0)
    expect(Math.abs(moved.y % 10)).toBe(0)
    expect((await getProject(win)).instances).toEqual(before.instances)

    // R = 기호 회전 (배선도 부품은 안 돈다), Ctrl+Z = 되돌리기
    await win.keyboard.press('r')
    await expect.poll(async () => (await getProject(win)).schematic!.symbols![u1]!.rotation).toBe(90)
    expect((await getProject(win)).instances.find((i) => i.id === u1)!.rotation).toBe(0)
    await win.getByRole('toolbar', { name: '회로도 도구' }).getByRole('button', { name: '⇋ 반전' }).click()
    await expect.poll(async () => (await getProject(win)).schematic!.symbols![u1]!.mirror).toBe(true)
    await win.keyboard.press('Control+z')
    await win.keyboard.press('Control+z')
    await expect.poll(async () => (await getProject(win)).schematic!.symbols![u1]!.rotation).toBeUndefined()

    // 배선 모드: 회로도에서 U1.VCC → U2.GND 잇기 → 배선도에도 전선
    await win.keyboard.press('w')
    await nextFrame(win)
    const a = await pinAt(win, u1, 'a')
    await win.mouse.click(a.x, a.y)
    const b = await pinAt(win, u2, 'b')
    await win.mouse.click(b.x, b.y)
    await expect.poll(async () => (await getProject(win)).wires.length).toBe(2)
    await expect.poll(() => counts(win)).toMatchObject({ wires: 2 })
    await win.keyboard.press('Escape')

    // 넷 라벨: 전부 고르고 → 선 대신 이름표
    await win.keyboard.press('Control+a')
    await win.getByRole('toolbar', { name: '회로도 도구' }).getByRole('button', { name: '🏷 넷 라벨' }).click()
    await expect.poll(() => counts(win)).toMatchObject({ wires: 0, labels: 4 })
    await nextFrame(win)
    await win.screenshot({ path: 'test-results/schematic-labels.png' })

    // 배선도 탭에는 전선 2개가 그대로
    await view.getByRole('button', { name: '배선도' }).click()
    await expect(win.getByTestId('schematic-canvas')).toHaveCount(0)
    expect((await getProject(win)).wires).toHaveLength(2)

    // 저장한 파일에 회로도
    const file = join(out, 'sch')
    await stubDialogs(app, { save: file })
    await win.keyboard.press('Control+s')
    await expect(win.getByRole('status')).toContainText('저장했습니다')
    const saved: Project = JSON.parse(readFileSync(`${file}.opb`, 'utf8'))
    expect(saved.version).toBe(10)
    expect(Object.keys(saved.schematic!.symbols!).sort()).toEqual([u1, u2].sort())
    expect(saved.schematic!.labeled).toHaveLength(2)

    // 회로도 PNG (회로도 탭을 열지 않아도)
    const png = join(out, 'schematic.png')
    await stubDialogs(app, { save: png })
    await win.getByText('내보내기 ▾').click()
    await win.getByRole('menuitem', { name: '회로도 이미지 (PNG)' }).click()
    await expect.poll(() => existsSync(png)).toBe(true)
    expect([...readFileSync(png).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  } finally {
    await app.close()
  }
})
