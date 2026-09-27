import { expect, test } from '@playwright/test'
import { clickPin, dropPart, getProject as project, launchApp, makeUserDataDir, seedLibrary, setMode } from './launch'

test('부품 배치 → 전선 연결 → 편집 → 회전 → 삭제 → 실행 취소', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!

    // 1. 부품 두 개 배치 → U1, U2
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.3, box.y + box.height / 2)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.7, box.y + box.height / 2)
    let p = await project(win)
    expect(p.instances.map((i) => i.refDes)).toEqual(['U1', 'U2'])
    const [u1, u2] = p.instances.map((i) => i.id)

    // 2. U1의 2번 핀 → U2의 1번 핀
    await clickPin(win, u1, 'b')
    await expect(win.getByRole('status')).toContainText('연결할 핀을 클릭하세요')
    await clickPin(win, u2, 'a')
    p = await project(win)
    expect(p.wires).toHaveLength(1)
    const props = win.getByTestId('props-wire')
    await expect(props).toContainText('U1.J1.2')
    await expect(props).toContainText('U2.J1.1')

    // 3. 전선 색과 라벨 편집
    await props.getByRole('radio', { name: '파랑' }).click()
    await props.getByLabel('전선 라벨').fill('PWR')
    await props.getByLabel('전선 라벨').press('Enter')
    p = await project(win)
    expect(p.wires[0]).toMatchObject({ color: '#1e88e5', label: 'PWR' })

    // 4. 같은 연결을 반대 방향으로 다시 → 거부
    await clickPin(win, u2, 'a')
    await clickPin(win, u1, 'b')
    await expect(win.getByRole('status')).toContainText('이미 연결되어 있습니다')
    expect((await project(win)).wires).toHaveLength(1)
    await win.screenshot({ path: 'test-results/canvas-wired.png' })

    // 5. 선택 모드에서 U1 선택 → R로 회전 → Delete로 삭제 (전선도 함께)
    await setMode(win, 'select')
    await expect(win.getByRole('status')).toHaveCount(0) // 배선 안내가 사라진다
    const a = (await win.evaluate(([i]) => window.__opbCanvas!.pinClientPosition(i, 'a'), [u1]))!
    const b = (await win.evaluate(([i]) => window.__opbCanvas!.pinClientPosition(i, 'b'), [u1]))!
    // 선택 모드에서 핀을 누르면 배선이 아니라 부품 선택
    await win.mouse.click(a.x, a.y)
    await expect(win.getByTestId('props-instance')).toBeVisible()
    await expect(win.getByRole('status')).toHaveCount(0)
    await win.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2 + 30) // 부품 사진 위 빈 곳
    await expect(win.getByTestId('props-instance')).toBeVisible()
    await win.keyboard.press('r')
    expect((await project(win)).instances[0].rotation).toBe(90)
    await win.keyboard.press('Delete')
    p = await project(win)
    expect(p.instances.map((i) => i.refDes)).toEqual(['U2'])
    expect(p.wires).toHaveLength(0)

    // 6. 실행 취소 두 번: 삭제 취소(전선 복원) → 회전 취소
    await win.keyboard.press('Control+z')
    p = await project(win)
    expect(p.instances.map((i) => i.refDes)).toEqual(['U1', 'U2'])
    expect(p.wires).toHaveLength(1)
    await win.keyboard.press('Control+z')
    expect((await project(win)).instances[0].rotation).toBe(0)

    // 7. 다시 실행
    await win.keyboard.press('Control+y')
    expect((await project(win)).instances[0].rotation).toBe(90)
  } finally {
    await app.close()
  }
})
