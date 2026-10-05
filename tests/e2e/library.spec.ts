import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, makeUserDataDir } from './launch'

const PHOTO = join(__dirname, '../fixtures/part-photo.png')

test('부품 추가 → 핀 찍기 → 번호 수정 → 저장 → 재시작 후 유지 → 삭제', async () => {
  const userData = makeUserDataDir()
  const libDir = join(userData, 'library')

  // 1. 부품 추가
  let { app, win } = await launchApp(userData)
  try {
    await win.getByRole('button', { name: '＋ 새 부품' }).click()
    const dialog = win.getByRole('dialog', { name: '부품 편집' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: '저장' })).toBeDisabled()

    await dialog.getByTestId('photo-input').setInputFiles(PHOTO)
    const canvas = dialog.getByTestId('pin-canvas')
    // 사진을 다 읽은 뒤에 찍는다 (읽기 전에는 사진 도형이 없어 클릭이 핀이 되지 않는다)
    await expect(canvas).toHaveAttribute('data-ready', 'true')
    await expect(canvas.locator('canvas').first()).toBeVisible()

    // 사진 가운데 근처를 두 번 클릭 → 핀 1, 2 자동 번호
    const box = (await canvas.boundingBox())!
    await win.mouse.click(box.x + box.width / 2 - 40, box.y + box.height / 2)
    await win.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2)
    const numbers = dialog.getByLabel('핀 번호')
    await expect(numbers).toHaveCount(2)
    await expect(numbers.nth(0)).toHaveValue('1')
    await expect(numbers.nth(1)).toHaveValue('2')

    // 자동 번호를 사용자가 수정
    await numbers.nth(0).fill('VCC')
    await dialog.getByLabel('신호').nth(1).fill('SDA')

    await dialog.getByPlaceholder('제어 보드 CB-100').fill('테스트 보드')

    // 배경 지우기 (크로마키): 키 색 = 사진 가장자리 색 → 완료
    await dialog.getByRole('button', { name: '배경 지우기' }).click()
    const bg = dialog.getByRole('group', { name: '배경 지우기' })
    await expect(bg.getByLabel('배경색')).toHaveValue('#ffffff')
    await expect(bg.getByRole('button', { name: '완료' })).toBeEnabled()
    await bg.getByRole('button', { name: '완료' }).click()
    await win.screenshot({ path: 'test-results/part-editor.png' })
    await dialog.getByRole('button', { name: '저장' }).click()
    await expect(dialog).toBeHidden()

    const list = win.getByTestId('part-list')
    await expect(list).toContainText('테스트 보드')
    await expect(list).toContainText('핀 2')
    // 저장된 사진은 배경(모서리)이 투명한 PNG
    const corner = await list.locator('img').first().evaluate(async (img: HTMLImageElement) => {
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')!
      g.drawImage(img, 0, 0)
      return [img.src.slice(0, 15), g.getImageData(1, 1, 1, 1).data[3]]
    })
    expect(corner).toEqual(['data:image/png;', 0])
    await win.screenshot({ path: 'test-results/library-added.png' })
  } finally {
    await app.close()
  }

  // 파일로 저장됐는지 확인
  const files = readdirSync(libDir).filter((f) => f.endsWith('.json'))
  expect(files).toHaveLength(1)
  const saved = JSON.parse(readFileSync(join(libDir, files[0]), 'utf8'))
  expect(saved.name).toBe('테스트 보드')
  expect(saved.pins.map((p: { number: string }) => p.number)).toEqual(['VCC', '2'])
  expect(saved.pins[1].signal).toBe('SDA')

  // 2. 재시작해도 남아 있고, 삭제할 수 있다
  ;({ app, win } = await launchApp(userData))
  try {
    const list = win.getByTestId('part-list')
    await expect(list).toContainText('테스트 보드')
    // 삭제 확인은 main의 메시지 상자로 묻는다 (렌더러 confirm은 닫힌 뒤 입력이 막히는 일이 있다)
    await app.evaluate(({ dialog }) => {
      const g = globalThis as { asked?: string[] }
      g.asked = []
      const orig = dialog.showMessageBox
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const opts = args.find((a): a is { message: string } => !!a && typeof a === 'object' && 'message' in a)
        if (opts) g.asked!.push(opts.message)
        return (orig as (...a: unknown[]) => ReturnType<typeof dialog.showMessageBox>)(...args)
      }) as typeof dialog.showMessageBox
    })
    await list.getByRole('button', { name: '삭제' }).click()
    await expect(list).not.toContainText('테스트 보드')
    await expect(win.getByText('부품함이 비어 있습니다.')).toBeVisible()
    expect(await app.evaluate(() => (globalThis as { asked?: string[] }).asked)).toEqual([expect.stringContaining('테스트 보드')])
    // 확인 창이 닫힌 뒤 바로 글을 칠 수 있다
    const search = win.getByPlaceholder('이름·품번으로 찾기')
    await search.click()
    await win.keyboard.type('abc')
    await expect(search).toHaveValue('abc')
  } finally {
    await app.close()
  }
  expect(existsSync(join(libDir, files[0]))).toBe(false)
})
