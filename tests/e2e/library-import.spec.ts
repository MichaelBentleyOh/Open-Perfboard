import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { readLibraryFile, serializeLibrary } from '../../src/core/library'
import { parsePart } from '../../src/core/serialize'
import { launchApp, makeTempDir, seedLibrary, stubDialogs } from './launch'

test('부품 가져오기(묶음·배선도) → 충돌 선택 → 내보내기', async () => {
  const userData = makeTempDir()
  const out = makeTempDir('opb-lib-')
  seedLibrary(userData) // 내 라이브러리: 테스트 MCU (id test-mcu)
  const mine = parsePart(readFileSync(join(userData, 'library', 'test-mcu.json'), 'utf8'))
  if (!mine.ok) throw new Error('seed')

  // 가져올 묶음: 같은 id인데 이름이 다른 부품 + 새 부품 + 망가진 부품
  const libFile = join(out, '친구 라이브러리.opblib')
  const bundle = JSON.parse(
    serializeLibrary([
      { ...mine.value, name: '테스트 MCU v2' },
      { ...mine.value, id: 'relay-5v', name: '릴레이 5V' },
      { ...mine.value, id: 'broken', name: '망가진 부품' }
    ])
  )
  bundle.parts[2].image = 'no image'
  writeFileSync(libFile, JSON.stringify(bundle))

  const { app, win } = await launchApp(userData)
  const list = win.getByTestId('part-list')
  try {
    await expect(list).toContainText('테스트 MCU')

    // 1. 묶음 가져오기: 새 1, 내용 다름 1, 읽지 못함 1 → 사본으로 추가(기본)
    await stubDialogs(app, { open: libFile })
    await win.getByRole('button', { name: '⤓ 가져오기' }).click()
    const dialog = win.getByRole('dialog', { name: '부품 가져오기' })
    const summary = dialog.getByTestId('import-summary')
    await expect(summary).toContainText('새 부품 1')
    await expect(summary).toContainText('내용 다름 1')
    await expect(summary).toContainText('읽지 못함 1')
    await expect(dialog).toContainText('망가진 부품')
    await win.screenshot({ path: 'test-results/library-import.png' })
    await dialog.getByRole('button', { name: '가져오기 (2개)' }).click()
    await expect(dialog).toBeHidden()
    await expect(win.getByRole('status')).toContainText('부품 2개를 가져왔습니다')
    await expect(list.locator('.part-item')).toHaveCount(3)
    await expect(list).toContainText('테스트 MCU v2 (가져옴)')
    await expect(list).toContainText('릴레이 5V')

    // 2. 같은 파일을 다시: 릴레이는 이미 같음, MCU는 내용 다름 → 건너뛰기 → 가져올 것 없음
    await win.getByRole('button', { name: '⤓ 가져오기' }).click()
    await expect(summary).toContainText('이미 있음 1')
    await dialog.getByLabel('건너뛰기 (내 것 유지)').check()
    await expect(dialog.getByRole('button', { name: /^가져오기/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: '닫기' }).click()
    await expect(list.locator('.part-item')).toHaveCount(3)

    // 3. 덮어쓰기
    await win.getByRole('button', { name: '⤓ 가져오기' }).click()
    await dialog.getByLabel('덮어쓰기 (가져온 것으로 바꿈)').check()
    await dialog.getByRole('button', { name: '가져오기 (1개)' }).click()
    await expect(dialog).toBeHidden()
    await expect(list.locator('.part-item')).toHaveCount(3)
    await expect(list.locator('.part-item').filter({ hasText: /^테스트 MCU v2TM/ })).toHaveCount(1)

    // 4. 배선도(.opb)에서 부품 가져오기 → 제어 보드, 전원 커넥터
    await stubDialogs(app, { open: join(__dirname, '../fixtures/sample-project.opb') })
    await win.getByRole('button', { name: '⤓ 가져오기' }).click()
    await expect(summary).toContainText('새 부품 2')
    await dialog.getByRole('button', { name: '가져오기 (2개)' }).click()
    await expect(list.locator('.part-item')).toHaveCount(5)
    await expect(list).toContainText('제어 보드 CB-100')

    // 5. 내보내기 → 5개가 든 .opblib
    const exported = join(out, 'backup')
    await stubDialogs(app, { save: exported })
    await win.getByRole('button', { name: '⤒ 내보내기' }).click()
    await expect(win.getByRole('status')).toContainText('부품 5개를 내보냈습니다')
    const back = readLibraryFile(readFileSync(`${exported}.opblib`, 'utf8'))
    expect(back.problems).toEqual([])
    expect(back.parts.map((p) => p.name).sort()).toEqual(
      ['제어 보드 CB-100', '릴레이 5V', '전원 커넥터 PWR-2P', '테스트 MCU v2', '테스트 MCU v2 (가져옴)'].sort()
    )
  } finally {
    await app.close()
  }
  // 라이브러리 폴더에 실제 파일로 저장됐다
  expect(readdirSync(join(userData, 'library')).filter((f) => f.endsWith('.json'))).toHaveLength(5)
})
