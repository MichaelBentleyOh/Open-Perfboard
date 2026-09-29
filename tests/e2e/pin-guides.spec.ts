import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, makeUserDataDir, seedLibrary } from './launch'

interface SavedPin {
  id: string
  x: number
  y: number
}

/** 편집기 캔버스에서 사진(256×256, 여백 24px로 가운데 맞춤)의 0~1 좌표 → 화면 좌표 */
async function photoMapper(canvas: Locator) {
  const box = (await canvas.boundingBox())!
  const scale = Math.min((box.width - 48) / 256, (box.height - 48) / 256)
  const size = 256 * scale
  const ox = box.x + (box.width - size) / 2
  const oy = box.y + (box.height - size) / 2
  return { size, at: (x: number, y: number) => ({ x: ox + x * size, y: oy + y * size }) }
}

async function drag(win: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps: 8 })
  await win.mouse.up()
}

test('부품 편집기 보조선: 긋기 → 핀 N개 고르게, 가까이 찍으면 선 위로, 간격 맞추기, 붙이기 끄면 자유', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData) // 테스트 MCU: 핀 2개 (y = 0.5)
  const { app, win } = await launchApp(userData)
  try {
    await win.getByTestId('part-list').locator('.part-item').filter({ hasText: '테스트 MCU' }).getByRole('button', { name: '편집' }).click()
    const dialog = win.getByRole('dialog', { name: '부품 편집' })
    const canvas = dialog.getByTestId('pin-canvas')
    // 사진을 다 읽은 뒤에 찍는다 (읽기 전에는 사진 도형이 없어 클릭이 핀이 되지 않는다)
    await expect(canvas).toHaveAttribute('data-ready', 'true')
    await expect(canvas.locator('canvas').first()).toBeVisible()
    const photo = await photoMapper(canvas)
    const numbers = dialog.getByLabel('핀 번호')
    await expect(numbers).toHaveCount(2)

    // 1. 보조선 긋기: 조금 비스듬히 끌어도 수평으로 맞춰진다
    await dialog.getByRole('button', { name: '╱ 보조선 긋기' }).click()
    await drag(win, photo.at(0.2, 0.3), photo.at(0.8, 0.31))
    await expect(dialog.getByLabel('보조선 고르기')).toBeVisible()
    await expect(dialog.getByRole('group', { name: '보조선 작업' })).toBeVisible()

    // 2. 핀 4개를 고르게
    await dialog.getByLabel('핀 개수').fill('4')
    await dialog.getByRole('button', { name: '개 고르게 놓기' }).click()
    await expect(numbers).toHaveCount(6)
    await expect(dialog.getByRole('button', { name: /선 위 핀 간격 맞추기 \(4\)/ })).toBeEnabled()

    // 3. 핀 찍기: 보조선에서 5px 떨어진 곳을 찍어도 선 위로
    await dialog.getByRole('button', { name: '● 핀 찍기' }).click()
    const near = (await photoMapper(canvas)).at(0.5, 0.3)
    await win.mouse.click(near.x, near.y + 5)
    await expect(numbers).toHaveCount(7)

    // 4. 선 위 핀 간격 맞추기 → 첫 핀 ~ 끝 핀 사이 5개가 같은 간격
    await dialog.getByLabel('보조선 고르기').selectOption({ label: '보조선 1' })
    await dialog.getByRole('button', { name: /선 위 핀 간격 맞추기 \(5\)/ }).click()

    // 5. 붙이기를 끄면 자유롭게 (선에서 20px 아래)
    await dialog.getByRole('button', { name: '● 핀 찍기' }).click()
    await dialog.getByLabel('보조선에 붙이기').uncheck()
    const free = (await photoMapper(canvas)).at(0.5, 0.3)
    await win.mouse.click(free.x, free.y + 20)
    await expect(numbers).toHaveCount(8)
    await win.screenshot({ path: 'test-results/pin-guides.png' })

    await dialog.getByRole('button', { name: '저장' }).click()
    await expect(dialog).toBeHidden()
  } finally {
    await app.close()
  }

  // 저장된 핀: 새 핀 6개 중 선 위 5개는 y = 0.3, x 간격이 같다. 마지막 하나는 선 아래
  const saved = JSON.parse(readFileSync(join(userData, 'library', 'test-mcu.json'), 'utf8')) as { pins: SavedPin[] }
  const added = saved.pins.slice(2)
  expect(added).toHaveLength(6)
  const onLine = added.slice(0, 5).sort((a, b) => a.x - b.x)
  for (const p of onLine) expect(p.y).toBeCloseTo(onLine[0].y, 6)
  expect(onLine[0].y).toBeCloseTo(0.3, 2)
  const gaps = onLine.slice(1).map((p, i) => p.x - onLine[i].x)
  for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6)
  expect(onLine[0].x).toBeCloseTo(0.2, 2)
  expect(onLine[4].x).toBeCloseTo(0.8, 2)
  expect(added[5].y).toBeGreaterThan(0.3 + 0.03)
  // 보조선은 부품 파일에 저장하지 않는다
  expect(JSON.stringify(saved)).not.toContain('guide')
})
