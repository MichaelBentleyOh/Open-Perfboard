import { expect, test, type Page } from '@playwright/test'
import type { Project, Wire } from '../../src/core/model'
import { endPosition } from '../../src/core/ends'
import { wirePath } from '../../src/core/wire'
import { clickPin, dropPart, getProject, launchApp, makeUserDataDir, nextFrame, seedLibrary, setMode } from './launch'

const pinAt = async (win: Page, i: string, p: string) =>
  (await win.evaluate(([i, p]) => window.__opbCanvas!.pinClientPosition(i, p), [i, p]))!
const toClient = (win: Page, p: { x: number; y: number }) => win.evaluate((p) => window.__opbCanvas!.worldToClient(p), p)

/** 실제로 그려지는 경로에서 꺾이는 점 수 */
function bendCount(project: Project, w: Wire): number {
  const ends = [w.from, w.to].map((r) => endPosition(project, r)!)
  const path = wirePath(ends[0], w.points, ends[1], w.orthogonal)
  let n = 0
  for (let i = 1; i < path.length - 1; i++) {
    const [p, q, r] = [path[i - 1], path[i], path[i + 1]]
    if (!((p.x === q.x && q.x === r.x) || (p.y === q.y && q.y === r.y))) n++
  }
  return n
}

test('경로 자동 정리: 잔 계단으로 그린 전선 → 연결 즉시 정리, 작은 흔들림 → 정리, 실행 취소', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.28, box.y + box.height * 0.3)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.72, box.y + box.height * 0.72)
    const [u1, u2] = (await getProject(win)).instances.map((i) => i.id)

    // 1. 오른쪽 아래로 20px짜리 잔 계단 4단을 찍고 연결
    const b1 = await pinAt(win, u1, 'b')
    await clickPin(win, u1, 'b')
    for (let k = 1; k <= 4; k++) await win.mouse.click(b1.x + 30 + 20 * k, b1.y + 20 * k)
    await expect(win.getByRole('status')).toContainText('꺾기 (4)') // 4개를 정말 찍었는지
    await clickPin(win, u2, 'a')
    let p = await getProject(win)
    const wire = p.wires[0]
    // 4개를 찍었지만 계단이 정리되어 꺾임은 ㄱ/ㄴ자 수준만 남는다
    expect(wire.points?.length ?? 0).toBeLessThan(4)
    expect(bendCount(p, wire)).toBeLessThanOrEqual(2)
    await win.screenshot({ path: 'test-results/tidy-after-connect.png' })

    // 2. (선택 모드) 비교용: 크게 돌아가는 꺾임점을 넣어 우회로를 만든다 (정리되지 않아야 함)
    await setMode(win, 'select')
    const b1Now = await pinAt(win, u1, 'b')
    const detour = { x: b1Now.x + 60, y: b1Now.y - 120 }
    // 선 위(첫 가로 구간)를 더블클릭해 점 추가 → 그 점을 위로 크게 끌기
    const beforeAdd = (await getProject(win)).wires[0].points ?? []
    await nextFrame(win) // 방금 바뀐 전선이 클릭 판정에 반영된 뒤에 더블클릭
    await win.mouse.dblclick(b1Now.x + 20, b1Now.y)
    p = await getProject(win)
    const added = p.wires[0].points!.find((pt) => !beforeAdd.some((q) => q.x === pt.x && q.y === pt.y))!
    expect(added).toBeDefined()
    const h = await toClient(win, added)
    await win.mouse.move(h.x, h.y)
    await win.mouse.down()
    await win.mouse.move(detour.x, detour.y, { steps: 6 })
    await win.mouse.up()
    p = await getProject(win)
    const withDetour = p.wires[0]
    const detourBends = bendCount(p, withDetour)
    expect(detourBends).toBeGreaterThanOrEqual(3) // 큰 우회로는 남는다

    // 3. 우회로 꼭대기 점을 아주 조금(10) 흔들어 계단을 만들면 → 자동 정리로 우회로 모양은 그대로, 계단은 없음
    const top = withDetour.points!.reduce((a, b) => (b.y < a.y ? b : a))
    const ht = await toClient(win, top)
    await win.mouse.move(ht.x, ht.y)
    await win.mouse.down()
    await win.mouse.move(ht.x + 3, ht.y + 12, { steps: 4 })
    await win.mouse.up()
    p = await getProject(win)
    expect(bendCount(p, p.wires[0])).toBeLessThanOrEqual(detourBends)

    // 4. "배선 정리" 버튼: 쓸데없는 우회로가 없어지고 부품을 피하는 짧은 직각 경로로
    const afterJiggle = (await getProject(win)).wires[0].points
    const props = win.getByTestId('props-wire')
    await props.getByRole('button', { name: '⌁ 배선 정리' }).click()
    await expect(win.getByRole('status')).toContainText('전선 1개를 정리했습니다')
    p = await getProject(win)
    expect(bendCount(p, p.wires[0])).toBeLessThan(detourBends)
    await win.screenshot({ path: 'test-results/tidy-routed.png' })
    // 다시 누르면 이미 정리됨
    await props.getByRole('button', { name: '⌁ 배선 정리' }).click()
    await expect(win.getByRole('status')).toContainText('이미 정리된 배선입니다')

    // 5. 실행 취소: 배선 정리 → (끌기 + 자동 정리)가 한 번씩 되돌아간다
    await win.keyboard.press('Control+z')
    expect((await getProject(win)).wires[0].points).toEqual(afterJiggle)
    await win.keyboard.press('Control+z')
    expect((await getProject(win)).wires[0].points).toEqual(withDetour.points)
    await win.screenshot({ path: 'test-results/tidy-detour.png' })
  } finally {
    await app.close()
  }
})
