import { expect, test, type Page } from '@playwright/test'
import { clickPin, dropPart, getProject, launchApp, makeUserDataDir, nextFrame, seedLibrary, setMode } from './launch'

const toClient = (win: Page, p: { x: number; y: number }) => win.evaluate((p) => window.__opbCanvas!.worldToClient(p), p)
const pinAt = async (win: Page, i: string, p: string) =>
  (await win.evaluate(([i, p]) => window.__opbCanvas!.pinClientPosition(i, p), [i, p]))!

test('꺾어서 배선: 빈 곳 클릭으로 꺾기 → 직각/직선 → 손잡이 이동·삭제 → 더블클릭 추가 → 함께 이동', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    // U2를 오른쪽 아래에 놓아 비스듬한 연결을 만든다
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.28, box.y + box.height * 0.35)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.72, box.y + box.height * 0.7)
    const [u1, u2] = (await getProject(win)).instances.map((i) => i.id)
    const b1 = await pinAt(win, u1, 'b')
    const a2 = await pinAt(win, u2, 'a')
    const midX = (b1.x + a2.x) / 2

    // 1. 그리는 중 빈 곳 클릭 = 꺾임점, Backspace = 되돌리기, Esc = 전체 취소
    await clickPin(win, u1, 'b')
    await win.mouse.click(midX, b1.y - 90)
    await expect(win.getByRole('status')).toContainText('꺾기 (1)')
    await win.keyboard.press('Backspace')
    await expect(win.getByRole('status')).not.toContainText('(1)')
    await win.mouse.click(midX, b1.y - 90)
    await win.keyboard.press('Escape')
    expect((await getProject(win)).wires).toHaveLength(0)

    // 2. 핀 → 빈 곳 → 핀 : 꺾임점 1개, 직각(기본)
    await clickPin(win, u1, 'b')
    await win.mouse.move(midX, b1.y - 60, { steps: 3 })
    await win.mouse.click(midX, b1.y - 90)
    await win.mouse.move(a2.x - 20, a2.y, { steps: 3 })
    await win.screenshot({ path: 'test-results/bent-drawing.png' })
    await clickPin(win, u2, 'a')
    let wire = (await getProject(win)).wires[0]
    expect(wire.orthogonal).toBe(true)
    expect(wire.points).toHaveLength(1)
    expect(wire.points![0].x % 10).toBe(0) // 격자에 맞춤
    const props = win.getByTestId('props-wire')
    await expect(props.getByTestId('bend-count')).toHaveText('1개')
    await win.screenshot({ path: 'test-results/bent-wire.png' })

    // 3. 직선 ↔ 직각 전환
    await props.getByRole('button', { name: '╱ 직선' }).click()
    expect((await getProject(win)).wires[0].orthogonal).toBeUndefined()
    await props.getByRole('button', { name: '┐ 직각' }).click()
    expect((await getProject(win)).wires[0].orthogonal).toBe(true)

    // 4. (선택 모드) 손잡이 끌기 → 꺾임점 이동 (격자에 맞춤), 실행 취소
    await setMode(win, 'select')
    await nextFrame(win)
    const bend = wire.points![0]
    const h = await toClient(win, bend)
    await win.mouse.move(h.x, h.y)
    await win.mouse.down()
    await win.mouse.move(h.x + 43, h.y + 18, { steps: 5 })
    await win.mouse.up()
    wire = (await getProject(win)).wires[0]
    expect(wire.points![0]).toEqual({ x: bend.x + 40, y: bend.y + 20 })
    await win.keyboard.press('Control+z')
    expect((await getProject(win)).wires[0].points![0]).toEqual(bend)

    // 5. 선 더블클릭 = 꺾임점 추가 (첫 구간: 핀 b에서 꺾임점 x까지 가로선 위)
    const b1Now = await pinAt(win, u1, 'b')
    await win.mouse.dblclick((b1Now.x + h.x) / 2, b1Now.y)
    wire = (await getProject(win)).wires[0]
    expect(wire.points).toHaveLength(2)
    expect(wire.points![1]).toEqual(bend) // 새 점은 앞에 들어간다
    await expect(props.getByTestId('bend-count')).toHaveText('2개')

    // 6. 손잡이 더블클릭 = 삭제, "모두 지우기"
    const h0 = await toClient(win, wire.points![0])
    await win.mouse.dblclick(h0.x, h0.y)
    expect((await getProject(win)).wires[0].points).toEqual([bend])
    await props.getByRole('button', { name: '모두 지우기' }).click()
    expect((await getProject(win)).wires[0].points).toBeUndefined()
    await win.keyboard.press('Control+z')
    expect((await getProject(win)).wires[0].points).toEqual([bend])

    // 7. 전체 선택 후 함께 이동 → 꺾임점도 같이 이동
    await win.keyboard.press('Control+a')
    const c1 = (await win.evaluate(([i]) => window.__opbCanvas!.instanceClientPosition(i), [u1]))!
    await win.mouse.move(c1.x, c1.y + 50)
    await win.mouse.down()
    await win.mouse.move(c1.x + 30, c1.y + 50 + 40, { steps: 5 })
    await win.mouse.up()
    const moved = (await getProject(win)).wires[0].points![0]
    expect(moved.x - bend.x).toBeCloseTo(30, 0)
    expect(moved.y - bend.y).toBeCloseTo(40, 0)
  } finally {
    await app.close()
  }
})
