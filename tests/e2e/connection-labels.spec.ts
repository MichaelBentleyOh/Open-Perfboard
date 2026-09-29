import { expect, test } from '@playwright/test'
import { buildTwoPartDiagram, clickPin, dropPart, getProject, launchApp, makeUserDataDir, nextFrame, seedLibrary, setMode } from './launch'

test('결선표 연결 라벨: 방향은 결선표에서만, Goto/From 깃발, 짝 강조와 전선 정보, 한 부품에 집중, 영어', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    // 1. 부품 편집기에는 방향 칸이 없다 (부품 정의는 건드리지 않는다)
    const item = win.getByTestId('part-list').locator('.part-item').filter({ hasText: '테스트 MCU' })
    await item.getByRole('button', { name: '편집' }).click()
    const dialog = win.getByRole('dialog')
    await expect(dialog.getByTestId('pin-table')).toBeVisible()
    // 핀마다 커넥터·전기 종류(038)만 있고, 신호 방향 칸은 없다
    await expect(dialog.getByTestId('pin-table').getByLabel('전기 종류')).toHaveCount(2)
    await expect(dialog.getByTestId('pin-table').locator('select')).toHaveCount(4)
    await expect(dialog.getByTestId('pin-table').getByLabel('방향')).toHaveCount(0)
    await dialog.getByRole('button', { name: '취소' }).click()

    // 2. U1.핀2 → U2.핀1, 그리고 U2.핀2 → U3.핀1 (U3는 U1과 이어지지 않음)
    const { u2 } = await buildTwoPartDiagram(win)
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.5, box.y + box.height * 0.85)
    await nextFrame(win)
    const u3 = (await getProject(win)).instances[2].id
    await clickPin(win, u2, 'b')
    await clickPin(win, u3, 'a')
    await setMode(win, 'select')
    await win.keyboard.press('Escape')
    const [w1] = (await getProject(win)).wires

    // 3. 결선표 표에서 방향을 바꾼다 → 전선에 저장, 실행 취소 1회
    await win.getByRole('button', { name: /^결선표 \(/ }).click()
    const arrow = win.getByLabel('신호 방향 U1.J1.2 → U2.J1.1')
    await expect(arrow).toHaveValue('<->')
    await arrow.selectOption('->')
    expect((await getProject(win)).wires.find((w) => w.id === w1.id)!.direction).toBe('forward')
    await win.keyboard.press('Control+z')
    await expect(arrow).toHaveValue('<->')
    await arrow.selectOption('->')
    await expect(arrow).toHaveValue('->')
    const parts = (await getProject(win)).parts
    expect(Object.values(parts).every((p) => p.pins.every((pin) => !('direction' in pin)))).toBe(true)

    // 4. 연결 라벨: 양쪽 카드에 같은 이름, 보내는 U1 쪽은 Goto, 받는 U2 쪽은 From
    await win.getByRole('group', { name: '결선표 보기' }).getByRole('button', { name: '연결 라벨' }).click()
    const name = '테스트 MCU (U1) -> 테스트 MCU (U2) : GND'
    const c1 = win.getByTestId('conn-card-U1')
    const c2 = win.getByTestId('conn-card-U2')
    // 두 깃발 모두 전체 이름(접근성 이름)이 같고, 보이는 글자는 상대 부품만: U1 쪽 "-> 테스트 MCU (U2) : GND", U2 쪽 "<- 테스트 MCU (U1) : GND"
    await expect(c1.getByRole('button', { name })).toBeVisible()
    await expect(c2.getByRole('button', { name })).toBeVisible()
    await expect(c1.getByRole('button', { name })).toContainText('-> 테스트 MCU (U2) : GND')
    await expect(c2.getByRole('button', { name })).toContainText('<- 테스트 MCU (U1) : GND')
    await expect(c1.locator('.conn-flag.goto')).toHaveCount(1)
    await expect(c2.locator('.conn-flag.from')).toHaveCount(1)
    await expect(win.getByTestId('connection-labels').locator('img')).toHaveCount(3)

    // 5. 깃발을 누르면 짝 강조, 오른쪽 전선 정보, 위에 방향 막대
    await c1.getByRole('button', { name }).click()
    await expect(c1.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
    await expect(c2.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
    await expect(c2.locator('.conn-dot.on')).toHaveCount(1)
    await expect(win.getByTestId('wire-connection')).toHaveText(name)
    await win.screenshot({ path: 'test-results/connection-labels.png' })

    // 방향 막대에서 반대로 → 이제 U2가 보내는 쪽이라 U2가 앞, 신호는 U2 핀(VCC)
    const bar = win.getByTestId('direction-bar')
    await expect(bar.getByRole('button', { pressed: true })).toContainText('->')
    await bar.getByRole('button', { name: '테스트 MCU (U1) <- 테스트 MCU (U2)' }).click()
    expect((await getProject(win)).wires.find((w) => w.id === w1.id)!.direction).toBe('reverse')
    const reversed = '테스트 MCU (U2) -> 테스트 MCU (U1) : VCC'
    await expect(c1.getByRole('button', { name: reversed })).toBeVisible()
    await expect(c1.getByRole('button', { name: reversed })).toContainText('<- 테스트 MCU (U2) : VCC')
    await expect(c1.locator('.conn-flag.from')).toHaveCount(1)
    await expect(win.getByTestId('wire-connection')).toHaveText(reversed)

    // 6. 부품 사진을 누르면 간이 창: 왼쪽 U2, 오른쪽 이어진 부품 U1·U3
    await c2.locator('.conn-photo img').click()
    const popup = win.getByRole('dialog', { name: 'U2 테스트 MCU 연결' })
    await expect(popup).toBeVisible()
    const leftPane = popup.locator('.conn-popup-pane.left')
    const rightPane = popup.locator('.conn-popup-pane.right')
    await expect(leftPane.locator('.conn-flag')).toHaveCount(2)
    await expect(rightPane.locator('.conn-thumb')).toHaveCount(2)
    await expect(rightPane.locator('.conn-thumb').first()).toContainText('U1')

    // 오른쪽에서 U3을 고르면 크게, 왼쪽은 U3과 잇는 깃발만 진하게
    await rightPane.getByTestId('conn-thumb-U3').click()
    await expect(rightPane.getByTestId('conn-card-U3')).toBeVisible()
    await expect(rightPane.locator('.conn-flag')).toHaveCount(1)
    await expect(leftPane.locator('.conn-flag.dim')).toHaveCount(1)
    await expect(popup.getByText('2 / 2')).toBeVisible()
    await win.screenshot({ path: 'test-results/connection-popup.png' })

    // 넘기기: ▶ 는 끝에서 처음으로, → 키로도
    await popup.getByRole('button', { name: '다음 부품' }).click()
    await expect(rightPane.getByTestId('conn-card-U1')).toBeVisible()
    await win.keyboard.press('ArrowRight')
    await expect(rightPane.getByTestId('conn-card-U3')).toBeVisible()
    await win.keyboard.press('ArrowLeft')
    await expect(rightPane.getByTestId('conn-card-U1')).toBeVisible()
    // 목록에서 바로 가기, "모두 보기"로 되돌리기
    await popup.getByLabel('이어진 부품 목록').selectOption({ label: 'U3 테스트 MCU · 전선 1' })
    await expect(rightPane.getByTestId('conn-card-U3')).toBeVisible()
    await popup.getByLabel('이어진 부품 목록').selectOption('')
    await expect(rightPane.locator('.conn-thumb')).toHaveCount(2)

    // 간이 창 안에서도 깃발을 누르면 전선 선택 + 방향 막대
    await leftPane.locator('.conn-flag').first().click()
    await expect(popup.getByTestId('direction-bar')).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)

    // 위쪽 목록으로도 연다
    await win.getByLabel('부품 연결 보기').selectOption(u3)
    await expect(win.getByRole('dialog', { name: 'U3 테스트 MCU 연결' })).toBeVisible()
    await win.getByRole('dialog').getByRole('button', { name: '닫기' }).click()
    await expect(win.getByRole('dialog')).toHaveCount(0)

    // 7. 영어
    await win.getByRole('button', { name: 'EN', exact: true }).click()
    await expect(win.getByRole('group', { name: 'Netlist view' }).getByRole('button', { name: 'Connection labels' })).toHaveAttribute('aria-pressed', 'true')
    await expect(win.getByRole('region', { name: 'Connection labels' })).toContainText('Wires: 2 · parts: 3')
    await expect(win.getByTestId('conn-card-U1').getByRole('button', { name: 'Connections' })).toBeVisible()
  } finally {
    await app.close()
  }
})
