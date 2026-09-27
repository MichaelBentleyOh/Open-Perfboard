import { expect, test, type Page } from '@playwright/test'
import { findCrossings } from '../../src/core/crossing'
import { endPosition } from '../../src/core/ends'
import type { Project } from '../../src/core/model'
import { wirePath } from '../../src/core/wire'
import { clickPin, dropPart, getProject, launchApp, makeUserDataDir, nextFrame, seedLibrary, setMode } from './launch'

const pathOf = (win: Page, id: string) => win.evaluate((i) => window.__opbCanvas!.wirePathClient(i), id)
const selection = (win: Page) => win.evaluate(() => window.__opbCanvas!.getSelection())
const toClient = (win: Page, p: { x: number; y: number }) => win.evaluate((p) => window.__opbCanvas!.worldToClient(p), p)

/** 프로젝트의 전선 경로로 교차 점프 계산 (화면과 같은 core 함수) */
function hopsOf(p: Project) {
  return findCrossings(
    p.wires.map((w) => ({ id: w.id, path: wirePath(endPosition(p, w.from)!, w.points, endPosition(p, w.to)!, w.orthogonal) }))
  )
}

test('전선 중간을 끌어 핀 위에서 놓으면 바로 분기 연결', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.2, box.y + box.height * 0.35)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.8, box.y + box.height * 0.35)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.5, box.y + box.height * 0.8)
    const [u1, u2, u3] = (await getProject(win)).instances.map((i) => i.id)
    await clickPin(win, u1, 'b')
    await clickPin(win, u2, 'a') // 배선 모드 유지
    const wireA = (await getProject(win)).wires[0].id

    await nextFrame(win)
    const a = (await pathOf(win, wireA))!
    const grab = { x: a[0].x + (a[1].x - a[0].x) * 0.4, y: a[0].y }
    const pin = (await win.evaluate(([i]) => window.__opbCanvas!.pinClientPosition(i, 'a'), [u3]))!
    await win.mouse.move(grab.x - 5, grab.y)
    await win.mouse.move(grab.x, grab.y)
    await nextFrame(win)
    await win.screenshot({ path: 'test-results/branch-hover.png' })
    await win.mouse.down()
    await win.mouse.move(pin.x, pin.y, { steps: 10 })
    await win.mouse.up()

    const p = await getProject(win)
    expect(p.junctions?.map((j) => j.label)).toEqual(['SP1'])
    expect(p.wires).toHaveLength(3)
    // 연결이 끝나 새 가지 전선이 선택되어 있다 (U3.1 ↔ SP1)
    const [sel] = (await selection(win)).wires
    const branch = p.wires.find((w) => w.id === sel)!
    expect([branch.from, branch.to].some((e) => 'instanceId' in e && e.instanceId === u3)).toBe(true)
    // 한 번 취소하면 원래 전선 하나로
    await win.keyboard.press('Control+z')
    expect((await getProject(win)).wires.map((w) => w.id)).toEqual([wireA])

    // 배선 모드에서는 전선을 그냥 클릭해도 거기서 분기 시작 → 핀 클릭으로 연결
    await nextFrame(win)
    await win.mouse.click(grab.x, grab.y)
    await expect(win.getByRole('status')).toContainText('연결할 핀을 클릭하세요')
    await clickPin(win, u3, 'b')
    expect((await getProject(win)).junctions?.map((j) => j.label)).toEqual(['SP1'])
  } finally {
    await app.close()
  }
})

test('교차 점프 + 전선 중간에서 끌어 분기(접속점) → 연결 → 이동·취소·삭제 시 합쳐짐', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    const at = (fx: number, fy: number) => dropPart(win, '테스트 MCU', box.x + box.width * fx, box.y + box.height * fy)
    await at(0.2, 0.5) // U1 왼쪽
    await at(0.8, 0.5) // U2 오른쪽
    await at(0.5, 0.85) // U3 아래
    await at(0.5, 0.15) // U4 위
    const [u1, u2, u3, u4] = (await getProject(win)).instances.map((i) => i.id)

    // 1. 가로 전선 A: U1.2 → U2.1
    await clickPin(win, u1, 'b')
    await clickPin(win, u2, 'a')
    const wireA = (await getProject(win)).wires[0].id

    // 2. 세로 전선 B: U4.1 → U3.1 — A를 가로지른다 → A(가로선)가 점프
    await clickPin(win, u4, 'a')
    await clickPin(win, u3, 'a')
    let p = await getProject(win)
    const hops = hopsOf(p)
    expect(Object.keys(hops)).toEqual([wireA])
    expect(hops[wireA]).toHaveLength(1)
    await win.screenshot({ path: 'test-results/crossing-hop.png' })

    // 3. A의 왼쪽 부분을 누른 채 아래로 끌기 → 분기 시작 (아직 접속점은 없음), Esc로 취소
    await nextFrame(win)
    const a = (await pathOf(win, wireA))!
    const grab = { x: a[0].x + (a[1].x - a[0].x) * 0.25, y: a[0].y }
    await win.mouse.move(grab.x, grab.y)
    await win.mouse.down()
    await win.mouse.move(grab.x, grab.y + 60, { steps: 5 })
    await win.mouse.up()
    await expect(win.getByRole('status')).toContainText('연결할 핀을 클릭하세요')
    expect((await getProject(win)).junctions).toBeUndefined()
    await win.keyboard.press('Escape')
    expect((await getProject(win)).junctions).toBeUndefined()

    // 4. 다시 끌어서 분기 → U3의 2번 핀 클릭 → 접속점 SP1, 전선 A가 둘로 나뉘고 가지 전선 추가
    await win.mouse.move(grab.x, grab.y)
    await win.mouse.down()
    await win.mouse.move(grab.x, grab.y + 60, { steps: 5 })
    await win.mouse.up()
    await win.screenshot({ path: 'test-results/branch-drawing.png' })
    await clickPin(win, u3, 'b')
    p = await getProject(win)
    expect(p.junctions?.map((j) => j.label)).toEqual(['SP1'])
    expect(p.wires).toHaveLength(4) // A 앞쪽, A 뒤쪽, B, 가지
    const branch = (await selection(win)).wires[0]
    await win.screenshot({ path: 'test-results/branch-done.png' })

    // 5. 결선표에 접속점이 나온다
    await win.getByRole('button', { name: /^결선표/ }).click()
    const net = win.getByRole('region', { name: '결선표' })
    await expect(net).toContainText('SP1')
    await expect(net.locator('tbody tr')).toHaveCount(4)
    await win.getByRole('button', { name: '배선도', exact: true }).click()

    // 6. 실행 취소 한 번에 분기 전체가 사라지고 원래 전선 A로
    await win.keyboard.press('Control+z')
    p = await getProject(win)
    expect(p.junctions).toBeUndefined()
    expect(p.wires.map((w) => w.id).sort()).toEqual([wireA, p.wires.find((w) => w.id !== wireA)!.id].sort())
    await win.keyboard.press('Control+y')
    p = await getProject(win)
    const sp1 = p.junctions![0]

    // 7. 선택 모드에서 접속점 끌기 → 이동, 전선은 따라온다
    await setMode(win, 'select')
    await nextFrame(win)
    const j = await toClient(win, sp1)
    await win.mouse.move(j.x, j.y)
    await win.mouse.down()
    await win.mouse.move(j.x, j.y + 40, { steps: 5 })
    await win.mouse.up()
    p = await getProject(win)
    expect(p.junctions![0].y).toBeGreaterThan(sp1.y + 30)
    expect(p.wires).toHaveLength(4)

    // 8. 배선 중 다른 전선(B)을 클릭하면 거기서 분기하며 연결 → SP2
    await clickPin(win, u4, 'b')
    await nextFrame(win)
    const bPath = (await pathOf(win, p.wires.find((w) => w.id !== branch && [w.from, w.to].every((e) => 'instanceId' in e) && w.id !== wireA)!.id))!
    const onB = { x: bPath[bPath.length - 1].x, y: (bPath[0].y + bPath[bPath.length - 1].y) / 2 + 60 }
    await win.mouse.click(onB.x, onB.y)
    p = await getProject(win)
    expect(p.junctions?.map((x) => x.label)).toEqual(['SP1', 'SP2'])

    // 9. 가지 전선을 지우면 SP1이 사라지고 A가 다시 하나로 합쳐진다 (Esc = 선택 모드)
    await win.keyboard.press('Escape')
    await nextFrame(win)
    const branchPath = (await pathOf(win, branch))!
    const mid = branchPath[Math.floor(branchPath.length / 2)]
    const prev = branchPath[Math.floor(branchPath.length / 2) - 1]
    await win.mouse.click((mid.x + prev.x) / 2, (mid.y + prev.y) / 2)
    expect((await selection(win)).wires).toEqual([branch])
    await win.keyboard.press('Delete')
    p = await getProject(win)
    expect(p.junctions?.map((x) => x.label)).toEqual(['SP2'])
    expect(p.wires.some((w) => w.id === wireA && 'instanceId' in w.from && 'instanceId' in w.to)).toBe(true)
  } finally {
    await app.close()
  }
})
