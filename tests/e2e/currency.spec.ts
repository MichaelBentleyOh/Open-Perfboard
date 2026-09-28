import { expect, test } from '@playwright/test'
import { dropPart, getProject, launchApp, makeUserDataDir, seedLibrary } from './launch'

test('BOM 통화: 환율이 숫자가 아니면 저장 못 함 → 달러로 바꾸면 단가 환산 → 실행 취소 1회', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData, { unitPrice: 13000 })
  const { app, win } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.3, box.y + box.height / 2)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.7, box.y + box.height / 2)
    await win.getByRole('button', { name: 'BOM (2)' }).click()
    const bom = win.getByRole('region', { name: 'BOM' })
    const total = bom.getByTestId('bom-total')
    await expect(total).toHaveText('26,000원')

    // 1. 통화 설정 창: 환율이 비었거나 숫자가 아니면 저장 단추가 꺼진다
    await bom.getByTestId('currency-button').click()
    const dialog = win.getByRole('dialog', { name: '통화 설정' })
    const save = dialog.getByRole('button', { name: '저장' })
    await dialog.getByLabel('달러 ($)').check()
    await expect(save).toBeDisabled()
    await expect(dialog).toContainText('환율은 0보다 큰 숫자로 입력하세요')
    for (const bad of ['abc', '0', '-3', '12a']) {
      await dialog.getByLabel('환율').fill(bad)
      await expect(save).toBeDisabled()
    }

    // 2. 1 USD = 1,300원 → 13,000원 = $10.00
    await dialog.getByLabel('환율').fill('1,300')
    await expect(save).toBeEnabled()
    await win.screenshot({ path: 'test-results/currency-dialog.png' })
    await save.click()
    await expect(dialog).toBeHidden()
    await expect(total).toHaveText('$20.00')
    await expect(bom.locator('tr[data-part]').getByTestId('amount')).toHaveText('$20.00')
    await expect(bom.getByTestId('currency-button')).toContainText('$')
    const p = await getProject(win)
    expect(p.bom).toMatchObject({ currency: 'USD', exchangeRate: 1300 })
    expect(p.parts['test-mcu']).toMatchObject({ unitPrice: 10, currency: 'USD' })
    await win.screenshot({ path: 'test-results/currency-bom.png' })

    // 3. 실행 취소 한 번이면 원래 통화·단가
    await win.keyboard.press('Control+z')
    await expect(total).toHaveText('26,000원')
    expect((await getProject(win)).bom).toBeUndefined()
  } finally {
    await app.close()
  }
})
