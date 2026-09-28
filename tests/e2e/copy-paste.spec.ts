import { expect, test, type Page } from '@playwright/test'
import { buildTwoPartDiagram, getProject, launchApp, makeUserDataDir, seedLibrary } from './launch'

const selection = (win: Page) => win.evaluate(() => window.__opbCanvas!.getSelection())
const center = async (win: Page, id: string) =>
  (await win.evaluate(([i]) => window.__opbCanvas!.instanceClientPosition(i), [id]))!

test('복사·붙여넣기(마우스 위치)·연속 붙여넣기·잘라내기·복제·다른 배선도에 붙여넣기', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    const { u1 } = await buildTwoPartDiagram(win) // U1.J1.2 → U2.J1.1
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!

    // 1. 전체 선택 → Ctrl+C
    await win.keyboard.press('Control+a')
    await win.keyboard.press('Control+c')
    await expect(win.getByRole('status')).toContainText('부품 2개, 전선 1개를 복사했습니다')

    // 2. 마우스를 캔버스 아래쪽 빈 곳에 두고 Ctrl+V → 그 위치에 U3, U4 + 전선
    const target = { x: box.x + box.width / 2, y: box.y + box.height - 120 }
    await win.mouse.move(target.x, target.y)
    await win.keyboard.press('Control+v')
    let p = await getProject(win)
    expect(p.instances.map((i) => i.refDes)).toEqual(['U1', 'U2', 'U3', 'U4'])
    expect(p.wires).toHaveLength(2)
    const [u3, u4] = p.instances.slice(2).map((i) => i.id)
    expect(await selection(win)).toEqual({ instances: [u3, u4], wires: [p.wires[1].id], junctions: [], notes: [] }) // 붙여넣은 것이 선택됨
    // 새 전선은 새 부품끼리 연결
    expect([(p.wires[1].from as { instanceId: string }).instanceId, (p.wires[1].to as { instanceId: string }).instanceId].sort()).toEqual([u3, u4].sort())
    // 붙여넣은 묶음의 가운데가 마우스 위치
    const c3 = await center(win, u3)
    const c4 = await center(win, u4)
    expect((c3.x + c4.x) / 2).toBeCloseTo(target.x, 0)
    expect((c3.y + c4.y) / 2).toBeCloseTo(target.y, 0)
    await win.screenshot({ path: 'test-results/paste.png' })

    // 3. 실행 취소 한 번에 붙여넣기 전체가 사라진다
    await win.keyboard.press('Control+z')
    expect((await getProject(win)).instances).toHaveLength(2)

    // 4. 마우스가 캔버스 밖이면 비켜서, 다시 붙이면 더 비켜서
    await win.mouse.move(box.x - 100, box.y + 50) // 왼쪽 라이브러리 패널 위
    await win.keyboard.press('Control+v')
    await win.keyboard.press('Control+v')
    p = await getProject(win)
    const byRef = (r: string) => p.instances.find((i) => i.refDes === r)!
    expect(p.instances).toHaveLength(6)
    const orig = byRef('U1')
    expect([byRef('U3').x - orig.x, byRef('U3').y - orig.y]).toEqual([30, 30])
    expect([byRef('U5').x - orig.x, byRef('U5').y - orig.y]).toEqual([60, 60])

    // 5. 잘라내기: 선택(U5, U6) 삭제 후 붙여넣기로 되살리기
    await win.keyboard.press('Control+x')
    expect((await getProject(win)).instances).toHaveLength(4)
    await win.keyboard.press('Control+v')
    expect((await getProject(win)).instances).toHaveLength(6)

    // 6. Ctrl+D(복제)는 없앴다: 복사 → 붙여넣기와 같은 일이라 하나로 (아무 일도 일어나지 않음)
    const c1 = await center(win, u1)
    await win.mouse.click(c1.x, c1.y + 50)
    await win.keyboard.press('Control+d')
    p = await getProject(win)
    expect(p.instances).toHaveLength(6)

    // 7. 입력칸에서의 Ctrl+C/V는 글자 복사 → 배선도는 그대로
    await win.getByPlaceholder('이름·품번으로 찾기').fill('MCU')
    await win.getByPlaceholder('이름·품번으로 찾기').press('Control+a')
    await win.getByPlaceholder('이름·품번으로 찾기').press('Control+c')
    await win.getByPlaceholder('이름·품번으로 찾기').press('End')
    await win.getByPlaceholder('이름·품번으로 찾기').press('Control+v')
    await expect(win.getByPlaceholder('이름·품번으로 찾기')).toHaveValue('MCUMCU')
    expect((await getProject(win)).instances).toHaveLength(6)
    await win.getByPlaceholder('이름·품번으로 찾기').fill('')

    // 8. 새 배선도(Ctrl+N)에도 붙여넣기 — 부품 정의가 함께 온다
    await win.getByTestId('diagram-canvas').click({ position: { x: 20, y: 20 } })
    await win.keyboard.press('Control+n')
    expect((await getProject(win)).instances).toHaveLength(0)
    await win.mouse.move(target.x, target.y)
    await win.keyboard.press('Control+v')
    p = await getProject(win)
    expect(p.instances.map((i) => i.refDes)).toEqual(['U1', 'U2'])
    expect(Object.keys(p.parts)).toEqual(['test-mcu'])
    expect(p.wires).toHaveLength(1)
  } finally {
    await app.close()
  }
})
