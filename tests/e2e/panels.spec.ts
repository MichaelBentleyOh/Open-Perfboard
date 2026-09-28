import { expect, test } from '@playwright/test'
import { launchApp, makeUserDataDir, seedLibrary } from './launch'

test('부품함·선택 항목 창 접기: 접은 만큼 배선도가 넓어지고, 다시 켜도 기억한다', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  let { app, win } = await launchApp(userData)
  const canvasWidth = async () => (await win.getByTestId('diagram-canvas').boundingBox())!.width
  try {
    const full = await canvasWidth()

    await win.getByRole('button', { name: '부품함 접기' }).click()
    await expect(win.getByTestId('part-list')).toHaveCount(0)
    await expect.poll(canvasWidth).toBeGreaterThan(full + 180)
    const withoutLeft = await canvasWidth()

    await win.getByRole('button', { name: '선택 항목 접기' }).click()
    await expect.poll(canvasWidth).toBeGreaterThan(withoutLeft + 200)
  } finally {
    await app.close()
  }

  // 다시 켜도 접힌 채로, 펼치면 원래대로
  ;({ app, win } = await launchApp(userData))
  try {
    await expect(win.getByRole('button', { name: '부품함 펼치기' })).toBeVisible()
    await expect(win.getByRole('button', { name: '선택 항목 펼치기' })).toBeVisible()
    const collapsed = await canvasWidth()
    await win.getByRole('button', { name: '부품함 펼치기' }).click()
    await win.getByRole('button', { name: '선택 항목 펼치기' }).click()
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    await expect.poll(canvasWidth).toBeLessThan(collapsed - 380)
  } finally {
    await app.close()
  }
})
