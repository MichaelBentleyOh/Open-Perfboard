import { expect, test } from '@playwright/test'
import { buildTwoPartDiagram, getProject, launchApp, makeUserDataDir, nextFrame, seedLibrary, setMode } from './launch'

test('전선 사용자 색: HEX·R/G/B 입력, 스펙트럼 끌기, 적용할 때마다 실행 취소 1회', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await buildTwoPartDiagram(win)
    await nextFrame(win)
    const [w] = (await getProject(win)).wires
    // 전선을 눌러 고른다
    const path = (await win.evaluate((id) => window.__opbCanvas!.wirePathClient(id), w.id))!
    await win.mouse.click((path[0].x + path[1].x) / 2, (path[0].y + path[1].y) / 2)
    const props = win.getByTestId('props-wire')
    await expect(props).toBeVisible()
    const color = async () => (await getProject(win)).wires[0].color
    const before = await color()

    // 1. HEX로 입력
    await props.getByRole('radio', { name: '사용자 색' }).click()
    const spectrum = props.getByTestId('color-spectrum')
    await expect(spectrum).toBeVisible()
    await spectrum.getByLabel('HEX').fill('#123456')
    await spectrum.getByLabel('HEX').press('Enter')
    await expect.poll(color).toBe('#123456')
    await expect(spectrum.getByLabel('R')).toHaveValue('18')
    // 팔레트에 없는 색 → 사용자 색 단추가 켜진다
    await expect(props.getByRole('radio', { name: '사용자 색' })).toHaveAttribute('aria-checked', 'true')

    // 2. R/G/B 숫자 (B만 바꾸고 Enter)
    await spectrum.getByLabel('B').fill('200')
    await spectrum.getByLabel('B').press('Enter')
    await expect.poll(color).toBe('#1234c8')
    await spectrum.getByLabel('G').fill('999') // 범위 밖은 무시
    await spectrum.getByLabel('G').press('Enter')
    await expect.poll(color).toBe('#1234c8')

    // 3. 스펙트럼 판 끌기: 놓을 때 한 번만 적용
    const area = (await spectrum.getByTestId('spectrum-area').boundingBox())!
    await win.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.2)
    await win.mouse.down()
    await win.mouse.move(area.x + area.width * 0.9, area.y + area.height * 0.1, { steps: 6 })
    await win.mouse.up()
    await expect.poll(color).not.toBe('#1234c8')
    const dragged = await color()

    // 4. 실행 취소: 끌기 → B 입력 → HEX 순으로 한 번씩
    await spectrum.press('Escape')
    await expect(spectrum).toHaveCount(0)
    await win.keyboard.press('Control+z')
    await expect.poll(color).toBe('#1234c8')
    await win.keyboard.press('Control+z')
    await expect.poll(color).toBe('#123456')
    await win.keyboard.press('Control+z')
    await expect.poll(color).toBe(before)
    expect(dragged).toMatch(/^#[0-9a-f]{6}$/)

    // 5. 툴바의 새 전선 색(배선 모드에서 보임)에도 같은 단추가 있다
    await setMode(win, 'wire')
    await win.locator('header.toolbar').getByRole('radio', { name: '사용자 색' }).click()
    await expect(win.locator('header.toolbar').getByTestId('color-spectrum')).toBeVisible()
    await win.locator('header.toolbar').getByTestId('color-spectrum').getByLabel('HEX').fill('00ff00')
    await win.locator('header.toolbar').getByTestId('color-spectrum').getByLabel('HEX').press('Enter')
    await expect(win.locator('header.toolbar').getByRole('radio', { name: '사용자 색' })).toHaveAttribute('aria-checked', 'true')
    await win.screenshot({ path: 'test-results/color-spectrum.png' })
  } finally {
    await app.close()
  }
})
