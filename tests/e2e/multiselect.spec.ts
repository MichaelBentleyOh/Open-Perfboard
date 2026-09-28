import { expect, test, type Page } from '@playwright/test'
import { clickPin, dropPart, getProject, launchApp, makeUserDataDir, seedLibrary } from './launch'

const center = async (win: Page, id: string) =>
  (await win.evaluate(([i]) => window.__opbCanvas!.instanceClientPosition(i), [id]))!
const selection = (win: Page) => win.evaluate(() => window.__opbCanvas!.getSelection())

/** 부품 사진 위 빈 곳 (핀은 세로 가운데에 있으므로 아래쪽) */
const body = async (win: Page, id: string) => {
  const c = await center(win, id)
  return { x: c.x, y: c.y + 50 }
}

test('선택 사각형 → 함께 이동 → 실행 취소 → Ctrl+클릭 → 화면 이동 → 삭제 시 BOM·결선표 동기화', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    for (const fx of [0.2, 0.5, 0.8]) await dropPart(win, '테스트 MCU', box.x + box.width * fx, box.y + box.height / 2)
    const [u1, u2, u3] = (await getProject(win)).instances.map((i) => i.id)
    await clickPin(win, u1, 'b')
    await clickPin(win, u2, 'a')
    const wireId = (await getProject(win)).wires[0].id

    // 배선 모드에서는 부품이 움직이지 않는다
    const u1Before = (await getProject(win)).instances[0]
    const b0 = await body(win, u1)
    await win.mouse.move(b0.x, b0.y)
    await win.mouse.down()
    await win.mouse.move(b0.x + 60, b0.y + 30, { steps: 5 })
    await win.mouse.up()
    expect((await getProject(win)).instances[0]).toEqual(u1Before)
    await win.keyboard.press('Escape') // 선택 모드로

    // 1. 빈 곳에서 드래그 → U1, U2와 그 사이 전선만 선택 (U3 제외)
    const c1 = await center(win, u1)
    const c2 = await center(win, u2)
    await win.mouse.move(c1.x - 130, c1.y - 130)
    await win.mouse.down()
    await win.mouse.move(c2.x + 130, c2.y + 130, { steps: 8 })
    await win.screenshot({ path: 'test-results/multiselect-band.png' })
    await win.mouse.up()
    expect(await selection(win)).toEqual({ instances: [u1, u2], wires: [wireId], junctions: [], notes: [] })
    await expect(win.getByTestId('props-multi')).toContainText('부품 2개 · 전선 1개')

    // 2. 선택된 U1을 끌면 U2도 함께 이동, U3는 그대로
    const before = (await getProject(win)).instances
    const start = await body(win, u1)
    await win.mouse.move(start.x, start.y)
    await win.mouse.down()
    await win.mouse.move(start.x + 60, start.y + 30, { steps: 6 })
    await win.mouse.up()
    let after = (await getProject(win)).instances
    for (const i of [0, 1]) {
      expect(after[i].x - before[i].x).toBeCloseTo(60, 0)
      expect(after[i].y - before[i].y).toBeCloseTo(30, 0)
    }
    expect(after[2]).toEqual(before[2])
    expect(await selection(win)).toEqual({ instances: [u1, u2], wires: [wireId], junctions: [], notes: [] }) // 끌어도 선택 유지

    // 3. 실행 취소 한 번에 둘 다 제자리
    await win.keyboard.press('Control+z')
    after = (await getProject(win)).instances
    expect(after.map((i) => [i.x, i.y])).toEqual(before.map((i) => [i.x, i.y]))

    // 4. Ctrl+클릭으로 U3 추가, 다시 Ctrl+클릭으로 제외
    const b3 = await body(win, u3)
    await win.keyboard.down('Control')
    await win.mouse.click(b3.x, b3.y)
    await win.keyboard.up('Control')
    expect((await selection(win)).instances).toEqual([u1, u2, u3])
    await win.keyboard.down('Control')
    await win.mouse.click(b3.x, b3.y)
    await win.keyboard.up('Control')
    expect((await selection(win)).instances).toEqual([u1, u2])

    // 5. 빈 곳 클릭 → 선택 해제
    await win.mouse.click(box.x + 20, box.y + 20)
    expect(await selection(win)).toEqual({ instances: [], wires: [], junctions: [], notes: [] })

    // 6. 휠 버튼 드래그 / Space+드래그 → 화면만 이동 (문서는 그대로)
    const doc = await getProject(win)
    let p0 = await center(win, u1)
    await win.mouse.move(box.x + 30, box.y + 30)
    await win.mouse.down({ button: 'middle' })
    await win.mouse.move(box.x + 130, box.y + 70, { steps: 5 })
    await win.mouse.up({ button: 'middle' })
    let p1 = await center(win, u1)
    expect(p1.x - p0.x).toBeCloseTo(100, 0)
    expect(p1.y - p0.y).toBeCloseTo(40, 0)

    p0 = p1
    await win.keyboard.down('Space')
    const b1 = await body(win, u1) // 부품 위에서 시작해도 부품이 아니라 화면이 움직여야 한다
    await win.mouse.move(b1.x, b1.y)
    await win.mouse.down()
    await win.mouse.move(b1.x - 50, b1.y + 20, { steps: 5 })
    await win.mouse.up()
    await win.keyboard.up('Space')
    p1 = await center(win, u1)
    expect(p1.x - p0.x).toBeCloseTo(-50, 0)
    expect(p1.y - p0.y).toBeCloseTo(20, 0)
    expect(await getProject(win)).toEqual(doc)

    // 7. 보고서 동기화: U1 삭제 → BOM은 U2, U3 / 결선표는 비어 있음
    const bu1 = await body(win, u1)
    await win.mouse.click(bu1.x, bu1.y)
    await win.keyboard.press('Delete')
    await expect(win.getByRole('button', { name: 'BOM (2)' })).toBeVisible()
    await expect(win.getByRole('button', { name: '결선표 (0)' })).toBeVisible()
    await win.getByRole('button', { name: 'BOM (2)' }).click()
    const bom = win.getByRole('region', { name: 'BOM' })
    await expect(bom.locator('tbody tr')).toHaveCount(1)
    await expect(bom.locator('tbody tr').first()).toContainText('U2, U3')
    await win.getByRole('button', { name: '결선표 (0)' }).click()
    await expect(win.getByText('연결된 전선이 없습니다.', { exact: false })).toBeVisible()

    // 8. Ctrl+A → Delete → 두 표 모두 비어 있음
    await win.getByRole('button', { name: '배선도', exact: true }).click()
    await win.keyboard.press('Control+a')
    await win.keyboard.press('Delete')
    await win.getByRole('button', { name: 'BOM (0)' }).click()
    await expect(win.getByText('배치된 부품이 없습니다.', { exact: false })).toBeVisible()
    await win.getByRole('button', { name: '결선표 (0)' }).click()
    await expect(win.getByText('연결된 전선이 없습니다.', { exact: false })).toBeVisible()

    // 9. 실행 취소 → 표도 복원
    await win.keyboard.press('Control+z')
    await expect(win.getByRole('button', { name: 'BOM (2)' })).toBeVisible()
  } finally {
    await app.close()
  }
})
