import { expect, test } from '@playwright/test'
import { endPosition } from '../../src/core/ends'
import { instanceBounds, type Point, type Rect } from '../../src/core/geometry'
import type { Project } from '../../src/core/model'
import { wirePath } from '../../src/core/wire'
import { clickPin, dropPart, getProject, launchApp, makeUserDataDir, nextFrame, seedLibrary } from './launch'

const pathOf = (p: Project, i = 0): Point[] => {
  const w = p.wires[i]
  return wirePath(endPosition(p, w.from)!, w.points, endPosition(p, w.to)!, w.orthogonal)
}
/** 경로가 사각형 안쪽을 지나는지 */
const crosses = (path: Point[], r: Rect) =>
  path.slice(1).some((q, i) => {
    const p = path[i]
    return Math.max(p.x, q.x) > r.x && Math.min(p.x, q.x) < r.x + r.width && Math.max(p.y, q.y) > r.y && Math.min(p.y, q.y) < r.y + r.height
  })

test('선택/배선 모드 전환 → 잇는 순간 가운데 부품을 피해 가기 → 배선 정리도 피해 감 → 실행 취소', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const modes = win.getByRole('group', { name: '모드' })
    const selectBtn = modes.getByRole('button', { name: '↖ 선택' })
    const wireBtn = modes.getByRole('button', { name: '✎ 배선' })

    // 1. 기본은 선택 모드, W = 배선 모드(안내 표시), V = 선택 모드
    await expect(selectBtn).toHaveAttribute('aria-pressed', 'true')
    await win.getByTestId('diagram-canvas').click({ position: { x: 5, y: 5 } })
    await win.keyboard.press('w')
    await expect(wireBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(win.getByRole('status')).toContainText('배선 모드')
    await win.keyboard.press('v')
    await expect(selectBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(win.getByRole('status')).toHaveCount(0)

    // 2. 왼쪽 U1, 오른쪽 U2, 가운데 U3. U1 → U2를 이으면 일직선은 U3를 가로지르므로 잇는 순간 돌아간다 (022)
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.15, box.y + box.height * 0.5)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.85, box.y + box.height * 0.5)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.5, box.y + box.height * 0.5)
    const [u1, u2] = (await getProject(win)).instances.map((i) => i.id)
    await clickPin(win, u1, 'b')
    await clickPin(win, u2, 'a')
    let p = await getProject(win)
    const u3 = p.instances[2]
    const u3Box = instanceBounds(u3, p.parts[u3.partId])
    expect(crosses(pathOf(p), u3Box)).toBe(false)
    expect(p.wires[0].points?.length ?? 0).toBeGreaterThan(0)
    const before = p.wires[0]
    await win.screenshot({ path: 'test-results/route-before.png' })

    // 3. Esc(선택 모드, 선택 해제) → 툴바 "배선 정리" = 전체 정리 → 여전히 U3를 피해 간다
    await win.keyboard.press('Escape')
    await expect(selectBtn).toHaveAttribute('aria-pressed', 'true')
    await win.locator('header').getByRole('button', { name: '⌁ 배선 정리' }).click()
    const status = win.getByRole('status')
    await expect(status).toContainText(/전선 1개를 정리했습니다|이미 정리된 배선입니다/)
    const tidied = (await status.textContent())!.includes('정리했습니다')
    p = await getProject(win)
    expect(p.wires[0].orthogonal).toBe(true)
    expect(crosses(pathOf(p), u3Box)).toBe(false)
    await nextFrame(win)
    await win.screenshot({ path: 'test-results/route-after.png' })

    // 4. 정리로 바뀌었으면 실행 취소 한 번에 원래대로
    if (tidied) {
      await win.keyboard.press('Control+z')
      expect((await getProject(win)).wires[0]).toEqual(before)
    } else expect(p.wires[0]).toEqual(before)
  } finally {
    await app.close()
  }
})
