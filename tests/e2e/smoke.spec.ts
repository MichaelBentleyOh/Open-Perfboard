import { expect, test } from '@playwright/test'
import { launchApp, makeUserDataDir } from './launch'

test('앱이 뜨고 기본 레이아웃이 보인다', async () => {
  const { app, win } = await launchApp(makeUserDataDir())
  try {
    await expect(win).toHaveTitle(/Open Perfboard/)
    await expect(win.getByRole('heading', { name: '부품함' })).toBeVisible()
    await expect(win.getByRole('heading', { name: '선택 항목' })).toBeVisible()
    await expect(win.locator('.canvas canvas').first()).toBeVisible()
    await win.screenshot({ path: 'test-results/smoke.png' })
  } finally {
    await app.close()
  }
})
