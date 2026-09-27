import { expect, test } from '@playwright/test'
import { dropPart, getProject, launchApp, makeUserDataDir, seedLibrary } from './launch'

test('배율 입력칸과 단축키: 입력·단계·100%·전체 보기(Home), 화면 전체는 확대되지 않음', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const zoom = win.getByTestId('zoom-input')
    await expect(zoom).toHaveValue('100%')

    // 1. 입력칸: 250 Enter → 250%, % 붙여도 됨
    await zoom.click()
    await zoom.fill('250')
    await zoom.press('Enter')
    await expect(zoom).toHaveValue('250%')
    await zoom.click()
    await zoom.fill('75%')
    await zoom.press('Enter')
    await expect(zoom).toHaveValue('75%')

    // 2. 잘못된 값은 알림 후 되돌림, 범위 밖은 맞춤
    await zoom.click()
    await zoom.fill('abc')
    await zoom.press('Enter')
    await expect(win.getByRole('status')).toContainText('배율은 숫자로 입력하세요')
    await expect(zoom).toHaveValue('75%')
    await zoom.click()
    await zoom.fill('5000')
    await zoom.press('Enter')
    await expect(win.getByRole('status')).toContainText('배율은 10~800%입니다')
    await expect(zoom).toHaveValue('800%')

    // 3. 단축키: Ctrl+0 = 100%, Ctrl+= 두 번 = 150%, Ctrl+- = 125%
    await win.keyboard.press('Control+0')
    await expect(zoom).toHaveValue('100%')
    await win.keyboard.press('Control+=')
    await win.keyboard.press('Control+=')
    await expect(zoom).toHaveValue('150%')
    await win.keyboard.press('Control+-')
    await expect(zoom).toHaveValue('125%')
    // 앱 화면 전체(글자·툴바)는 확대되지 않는다 (Electron 기본 메뉴 단축키를 뺐다)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBe(1)

    // 4. Ctrl+L(옛 배율 입력 단축키)은 없어졌다
    await win.keyboard.press('Control+l')
    await expect(zoom).not.toBeFocused()

    // 5. Home = 전체 보기: 멀리 떨어진 부품 둘이 모두 캔버스 안에
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + 40, box.y + 40)
    await dropPart(win, '테스트 MCU', box.x + box.width - 40, box.y + box.height - 40)
    const inside = async () => {
      const ids = (await getProject(win)).instances.map((i) => i.id)
      for (const id of ids) {
        const c = (await win.evaluate((i) => window.__opbCanvas!.instanceClientPosition(i), id))!
        if (c.x < box.x || c.x > box.x + box.width || c.y < box.y || c.y > box.y + box.height) return false
      }
      return true
    }
    await win.keyboard.press('Control+=')
    await win.keyboard.press('Control+=')
    await win.keyboard.press('Control+=')
    expect(await inside()).toBe(false) // 확대하면 일부가 화면 밖
    await win.keyboard.press('Home')
    await expect.poll(inside).toBe(true)
    const zoomValue = async () => Number((await zoom.inputValue()).replace('%', ''))
    await expect.poll(zoomValue).toBeLessThan(100) // 두 부품이 들어오도록 축소됨
    const fitted = await zoomValue()
    await win.screenshot({ path: 'test-results/zoom-fit.png' })

    // 6. BOM 탭에서는 배율 단축키가 동작하지 않는다
    await win.getByRole('button', { name: 'BOM (2)' }).click()
    await win.keyboard.press('Control+0')
    await win.getByRole('button', { name: '배선도', exact: true }).click()
    await expect(zoom).toHaveValue(`${fitted}%`)
  } finally {
    await app.close()
  }
})
