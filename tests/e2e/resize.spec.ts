import { expect, test, type Page } from '@playwright/test'
import { instanceBounds } from '../../src/core/geometry'
import { buildTwoPartDiagram, getProject, launchApp, makeUserDataDir, nextFrame, seedLibrary, setMode } from './launch'

const toClient = (win: Page, p: { x: number; y: number }) => win.evaluate((q) => window.__opbCanvas!.worldToClient(q), p)

async function drag(win: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps: 10 })
  await win.mouse.up()
}

test('크기 바꾸기: 모서리 손잡이 → 부품 배율·글 상자 크기, ]·[ 키, 선택 항목 버튼, 실행 취소', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await buildTwoPartDiagram(win)
    await setMode(win, 'select')

    // 1. 부품을 고르면 모서리 손잡이 → 오른쪽 아래를 바깥으로 끌면 커진다 (중심은 그대로)
    let p = await getProject(win)
    const u1 = p.instances[0]
    const b = instanceBounds(u1, p.parts[u1.partId])
    const center = await toClient(win, { x: u1.x, y: u1.y })
    await win.mouse.click(center.x, center.y)
    await expect.poll(() => win.evaluate(() => window.__opbCanvas!.getSelection().instances)).toEqual([u1.id])
    await nextFrame(win)
    const corner = { x: b.x + b.width + 4, y: b.y + b.height + 4 }
    const from = await toClient(win, corner)
    const to = await toClient(win, { x: u1.x + (corner.x - u1.x) * 1.5, y: u1.y + (corner.y - u1.y) * 1.5 })
    await drag(win, from, to)
    p = await getProject(win)
    expect(p.instances[0].scale / u1.scale).toBeCloseTo(1.5, 1)
    expect([p.instances[0].x, p.instances[0].y]).toEqual([u1.x, u1.y])
    await expect(win.getByLabel('배율 (%)')).toHaveValue(String(Math.round(p.instances[0].scale * 1000) / 10))
    await win.screenshot({ path: 'test-results/resize.png' })

    // 2. 실행 취소 1번 = 원래 크기
    await win.keyboard.press('Control+z')
    expect((await getProject(win)).instances[0].scale).toBe(u1.scale)

    // 3. ] / [ 키, 선택 항목의 +/− 버튼, 배율 칸
    await win.keyboard.press(']')
    expect((await getProject(win)).instances[0].scale).toBeCloseTo(u1.scale * 1.1)
    await win.keyboard.press('[')
    expect((await getProject(win)).instances[0].scale).toBeCloseTo(u1.scale)
    const size = win.getByRole('group', { name: '크기' })
    await size.getByRole('button', { name: '크게' }).click()
    expect((await getProject(win)).instances[0].scale).toBeCloseTo(u1.scale * 1.1)
    await win.getByLabel('배율 (%)').fill('50')
    await win.getByLabel('배율 (%)').press('Enter')
    expect((await getProject(win)).instances[0].scale).toBe(0.5)

    // 4. 글 상자: 오른쪽 아래 손잡이 → 너비·글자 크기가 함께 커진다
    await win.getByRole('button', { name: 'T 글 상자' }).click()
    const editor = win.getByLabel('글 상자 글').first()
    await editor.fill('크기 바꾸기')
    await editor.press('Control+Enter')
    const n0 = (await getProject(win)).notes![0]
    await nextFrame(win)
    const h = await win.evaluate(() => {
      const stage = (window as unknown as { Konva: { stages: { find: (s: string) => { getClientRect: () => { x: number; y: number; width: number; height: number } }[] }[] } }).Konva.stages[0]
      const r = stage.find('.resize-handle')[0].getClientRect()
      const box = document.querySelector('[data-testid="diagram-canvas"] canvas')!.getBoundingClientRect()
      return { x: box.x + r.x + r.width / 2, y: box.y + r.y + r.height / 2 }
    })
    await drag(win, h, { x: h.x + (h.x - (await toClient(win, n0)).x), y: h.y + (h.y - (await toClient(win, n0)).y) })
    const n1 = (await getProject(win)).notes![0]
    expect(n1.width / n0.width).toBeCloseTo(2, 1)
    expect(n1.fontSize).toBe(32)
    expect([n1.x, n1.y]).toEqual([n0.x, n0.y])
    await expect(win.getByTestId('props-note').getByLabel('글자 크기')).toHaveValue('32')
    await win.screenshot({ path: 'test-results/resize-note.png' })
    await win.keyboard.press('[')
    expect((await getProject(win)).notes![0].fontSize).toBe(29)
  } finally {
    await app.close()
  }
})
