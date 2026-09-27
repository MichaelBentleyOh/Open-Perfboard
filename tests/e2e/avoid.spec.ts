import { expect, test, type Page } from '@playwright/test'
import { pathCrossesParts } from '../../src/core/avoid'
import { endPosition } from '../../src/core/ends'
import { instanceBounds } from '../../src/core/geometry'
import type { Project } from '../../src/core/model'
import { wirePath } from '../../src/core/wire'
import { clickPin, dropPart, getProject, launchApp, makeUserDataDir, nextFrame, seedLibrary, setMode } from './launch'

/** 전선이 자기 부품이 아닌 부품 사진을 가로지르는지 */
function crosses(p: Project, wireId: string): boolean {
  const w = p.wires.find((x) => x.id === wireId)!
  const path = wirePath(endPosition(p, w.from)!, w.points, endPosition(p, w.to)!, w.orthogonal)
  const boxes = p.instances.map((i) => ({ id: i.id, rect: instanceBounds(i, p.parts[i.partId]) }))
  const own = new Set([w.from, w.to].flatMap((e) => ('instanceId' in e ? [e.instanceId] : [])))
  return pathCrossesParts(path, boxes, own)
}

/** 부품 사진을 끌어 옮긴다 (핀이 없는 위쪽을 잡는다) */
async function dragPart(win: Page, id: string, dx: number, dy: number) {
  const c = (await win.evaluate((i) => window.__opbCanvas!.instanceClientPosition(i), id))!
  await win.mouse.move(c.x, c.y - 60)
  await win.mouse.down()
  await win.mouse.move(c.x + dx, c.y - 60 + dy, { steps: 6 })
  await win.mouse.up()
  await nextFrame(win)
}

test('전선은 부품을 가로지르지 않는다: 잇는 순간 돌아가고, 부품을 전선 위로 옮기면 비킨다 → 실행 취소 1회', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { win, app } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    for (const fx of [0.15, 0.5, 0.85]) await dropPart(win, '테스트 MCU', box.x + box.width * fx, box.y + box.height * 0.55)
    const [u1, u2, u3] = (await getProject(win)).instances.map((i) => i.id)

    // 1. U1 오른쪽 핀 → U3 왼쪽 핀: 일직선이면 U2를 가로지른다 → 잇는 순간 돌아간다
    await clickPin(win, u1, 'b')
    await clickPin(win, u3, 'a')
    let p = await getProject(win)
    expect(p.wires).toHaveLength(1)
    const wireId = p.wires[0].id
    expect(crosses(p, wireId)).toBe(false)
    expect(p.wires[0].points?.length ?? 0).toBeGreaterThan(0) // 곧게 가지 않고 꺾어 돌아감
    await win.screenshot({ path: 'test-results/avoid-connect.png' })

    // 2. U2를 멀리 치우고, 전선을 곧게 다시 정리 → U2를 다시 전선 위로 끌어오면 전선이 비킨다
    await setMode(win, 'select')
    await dragPart(win, u2, 0, 250)
    expect((await getProject(win)).instances[1].y).toBeGreaterThan(200) // 정말 옮겨졌는지
    await win.getByTestId('diagram-canvas').click({ position: { x: 5, y: 5 } }) // 선택 해제
    await win.locator('header').getByRole('button', { name: '⌁ 배선 정리' }).click()
    await expect(win.getByRole('status')).toContainText('전선 1개를 정리했습니다')
    p = await getProject(win)
    expect(p.wires[0].points ?? []).toEqual([]) // 막는 것이 없으니 일직선
    const straight = p.wires[0]
    await dragPart(win, u2, 0, -250)
    p = await getProject(win)
    expect(p.instances[1].y).toBeLessThan(100)
    expect(crosses(p, wireId)).toBe(false)
    expect(p.wires[0].points?.length ?? 0).toBeGreaterThan(0)
    await win.screenshot({ path: 'test-results/avoid-move.png' })

    // 3. 실행 취소 한 번 = 부품 이동과 전선 비키기가 함께 되돌아간다
    await win.keyboard.press('Control+z')
    await expect.poll(async () => (await getProject(win)).wires[0]).toEqual(straight)
  } finally {
    await app.close()
  }
})
