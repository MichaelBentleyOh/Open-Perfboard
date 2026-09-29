import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, makeTempDir, makeUserDataDir, seedLibrary, stubDialogs } from './launch'

const PHOTO = join(__dirname, '../fixtures/part-photo.png')

test('부품 작업실: 내 부품함에 부품·부속 부품 만들기 → 새 부품함 파일 → 저장 → 열어 고치기 → 내 부품함에 넣기', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const out = makeTempDir('opb-studio-')
  const libFile = join(out, 'motors.opblib')
  const { app, win } = await launchApp(userData, { home: true })
  try {
    const libCount = () => readdirSync(join(userData, 'library')).filter((n) => n.endsWith('.json')).length
    const supplyDir = join(userData, 'library', 'supplies')
    const supplyCount = () => (existsSync(supplyDir) ? readdirSync(supplyDir).length : 0)
    const before = libCount()
    await win.locator('.home').getByRole('button', { name: /부품 만들기/ }).click()
    const target = win.getByTestId('studio-target')
    await expect(target).toHaveText('내 부품함')
    const partList = win.getByTestId('studio-part-list')
    await expect(partList.getByText('테스트 MCU')).toBeVisible()

    // 1. 내 부품함에 새 부품: 사진 + 핀 → 저장하면 목록과 부품함 폴더에
    await win.getByRole('button', { name: '＋ 새 부품' }).click()
    const editor = win.getByRole('region', { name: '부품 편집' })
    await editor.getByTestId('photo-input').setInputFiles(PHOTO)
    const canvas = editor.getByTestId('pin-canvas')
    // 사진을 다 읽은 뒤에 찍는다 (읽기 전에는 사진 도형이 없어 클릭이 핀이 되지 않는다)
    await expect(canvas).toHaveAttribute('data-ready', 'true')
    await expect(canvas.locator('canvas').first()).toBeVisible()
    const box = (await canvas.boundingBox())!
    await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(editor.getByLabel('핀 번호')).toHaveCount(1)
    await editor.getByPlaceholder('제어 보드 CB-100').fill('스텝 모터')
    await editor.getByRole('button', { name: '저장' }).click()
    await expect(partList.locator('.part-item.selected')).toContainText('스텝 모터')
    await expect.poll(libCount).toBe(before + 1)
    await win.screenshot({ path: 'test-results/studio.png' })

    // 고른 부품 복제 → "사본"
    await partList.getByRole('button', { name: '복제: 스텝 모터' }).click()
    await expect(partList.getByText('스텝 모터 사본')).toBeVisible()

    // 2. 부속 부품: 하우징
    await win.getByRole('tab', { name: /부속 부품/ }).click()
    await win.getByRole('button', { name: '＋ 새 부속 부품' }).click()
    const supplyEditor = win.getByRole('region', { name: '부속 부품 편집' })
    await supplyEditor.getByPlaceholder('예: XH 4P 하우징').fill('XH 2P 하우징')
    await supplyEditor.getByLabel('짝 커넥터 종류').fill('JST-XH 2P')
    await supplyEditor.getByRole('button', { name: '저장' }).click()
    await expect(win.getByTestId('studio-supply-list')).toContainText('XH 2P 하우징')
    await expect.poll(() => supplyCount()).toBe(1)

    // 3. 새 부품함 파일: 비어 있음 → 부속 부품 하나 → * → 다른 이름으로 저장
    await win.getByRole('button', { name: '새 부품함 파일' }).click()
    await expect(target).toHaveText('새 부품함')
    await expect(win.getByTestId('studio-supply-list').locator('.part-item')).toHaveCount(0)
    await win.getByRole('button', { name: '＋ 새 부속 부품' }).click()
    await supplyEditor.getByPlaceholder('예: XH 4P 하우징').fill('수축 튜브 3mm')
    await supplyEditor.getByLabel('종류', { exact: true }).selectOption('tube')
    await supplyEditor.getByRole('button', { name: '저장' }).click()
    await expect(target).toHaveText('새 부품함 *')
    // 내 부품함은 그대로
    expect(supplyCount()).toBe(1)
    await stubDialogs(app, { save: libFile })
    await win.getByRole('button', { name: '다른 이름으로 저장…' }).click()
    await expect(target).toHaveText('motors')
    const saved = JSON.parse(readFileSync(libFile, 'utf8'))
    expect(saved.format).toBeTruthy()
    expect(saved.supplies.map((s: { name: string }) => s.name)).toEqual(['수축 튜브 3mm'])

    // 4. 내 부품함으로 돌아갔다가 파일 열기 → 고치고 저장(같은 파일)
    await win.getByRole('button', { name: '내 부품함', exact: true }).click()
    await expect(target).toHaveText('내 부품함')
    await stubDialogs(app, { open: libFile })
    await win.getByRole('button', { name: '열기…' }).click()
    await expect(target).toHaveText('motors')
    await win.getByTestId('studio-supply-list').getByText('수축 튜브 3mm').click()
    await supplyEditor.getByPlaceholder('예: XH 4P 하우징').fill('수축 튜브 5mm')
    await supplyEditor.getByRole('button', { name: '저장' }).click()
    await expect(target).toHaveText('motors *')
    await win.getByRole('group', { name: '부품함 파일' }).getByRole('button', { name: '저장', exact: true }).click()
    await expect(target).toHaveText('motors')
    expect(JSON.parse(readFileSync(libFile, 'utf8')).supplies[0].name).toBe('수축 튜브 5mm')

    // 5. 모두 내 부품함에 넣기 → 가져오기 대화상자 → 내 부품함에 생김
    await win.getByRole('button', { name: '⤓ 모두 내 부품함에 넣기' }).click()
    const dialog = win.getByRole('dialog', { name: '부품 가져오기' })
    await dialog.getByRole('button', { name: /가져오기 \(/ }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => supplyCount()).toBe(2)
    await win.getByRole('button', { name: '내 부품함', exact: true }).click()
    await expect(win.getByTestId('studio-supply-list')).toContainText('수축 튜브 5mm')

    // 6. 배선도로 → 부품함 창에 작업실에서 만든 부품이 있다
    await win.getByRole('button', { name: '배선도로 →' }).click()
    await expect(win.getByTestId('part-list')).toContainText('스텝 모터')
    expect(existsSync(libFile)).toBe(true)
  } finally {
    await app.close()
  }
})
