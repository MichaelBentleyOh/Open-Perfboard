import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { parseProject } from '../../src/core/serialize'
import { dropPart, getProject, launchApp, makeTempDir, seedLibrary, stubDialogs } from './launch'

/** 칸에 값을 넣고 Enter (CommitInput은 Enter 때 반영) */
async function commit(input: Locator, value: string) {
  await input.fill(value)
  await input.press('Enter')
}

test('BOM 편집: 단가 입력 → 금액·총액 자동 계산 → 항목 추가·수정·삭제 → 실행 취소 → CSV·엑셀·저장', async () => {
  const userData = makeTempDir()
  const out = makeTempDir('opb-bom-')
  seedLibrary(userData, { unitPrice: 5000 }) // 라이브러리 기본 단가
  const { app, win } = await launchApp(userData)
  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.3, box.y + box.height / 2)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.7, box.y + box.height / 2)

    await win.getByRole('button', { name: 'BOM (2)' }).click()
    const bom = win.getByRole('region', { name: 'BOM' })
    const total = bom.getByTestId('bom-total')
    const partRow = bom.locator('tr[data-part]')

    // 1. 부품 기본 단가 5,000 × 2 = 10,000
    await expect(partRow.getByTestId('amount')).toHaveText('10,000원')
    await expect(total).toHaveText('10,000원')

    // 2. 이 배선도에서만 단가 12,500으로 → 25,000
    await commit(partRow.getByLabel('예상 단가'), '12,500')
    await expect(partRow.getByTestId('amount')).toHaveText('25,000원')
    await expect(total).toHaveText('25,000원')
    await commit(partRow.getByLabel('비고'), '2개 묶음 구매')

    // 3. 직접 항목 추가: 열수축 튜브 3 × 300 = 900 → 총액 25,900
    await bom.getByRole('button', { name: '＋ 항목 추가' }).click()
    const item = bom.locator('tr[data-item]').first()
    await commit(item.getByLabel('품명'), '열수축 튜브')
    await commit(item.getByLabel('수량'), '3')
    await commit(item.getByLabel('예상 단가'), '300')
    await expect(item.getByTestId('amount')).toHaveText('900원')
    await expect(total).toHaveText('25,900원')
    await expect(win.getByRole('button', { name: 'BOM (3)' })).toBeVisible()

    // 4. 단가 없는 항목 → 총액에서 빠지고 안내
    await bom.getByRole('button', { name: '＋ 항목 추가' }).click()
    const screws = bom.locator('tr[data-item]').nth(1)
    await commit(screws.getByLabel('품명'), '나사 M3')
    await commit(screws.getByLabel('수량'), '10')
    await expect(bom.locator('tfoot')).toContainText('단가 미입력 1건')
    await expect(total).toHaveText('25,900원')

    // 5. 수량 수정 3 → 5 : 1,500 → 26,500. 잘못된 값은 거부
    await commit(item.getByLabel('수량'), '5')
    await expect(total).toHaveText('26,500원')
    await commit(item.getByLabel('예상 단가'), '-100')
    await expect(win.getByRole('status')).toContainText('0 이상의 숫자')
    await expect(item.getByLabel('예상 단가')).toHaveValue('300') // 거부된 값은 이전 값으로
    await expect(total).toHaveText('26,500원')
    await win.screenshot({ path: 'test-results/bom-edit.png' })

    // 6. 실행 취소: 수량 5 → 3
    await win.keyboard.press('Control+z')
    await expect(total).toHaveText('25,900원')

    // 7. 삭제
    await screws.getByRole('button', { name: '항목 삭제' }).click()
    await expect(bom.locator('tfoot')).not.toContainText('단가 미입력')

    // 8. CSV: 단가·금액·합계 행
    const csvPath = join(out, 'bom.csv')
    await stubDialogs(app, { save: csvPath })
    await bom.getByRole('button', { name: 'CSV 내보내기' }).click()
    await expect(win.getByRole('status')).toContainText('내보냈습니다')
    const csv = readFileSync(csvPath, 'utf8')
    expect(csv).toContain('1,부품,테스트 MCU,"TM-01 · U1, U2",2,12500,25000,,,2개 묶음 구매\r\n')
    expect(csv).toContain('2,직접 추가,열수축 튜브,,3,300,900,,,\r\n')
    expect(csv.endsWith('합계,,,,5,,25900,,,\r\n')).toBe(true)

    // 8-2. 엑셀: 금액은 수식(수량×단가), 합계는 SUM. 확장자는 자동으로 .xlsx
    const xlsxPath = join(out, 'bom')
    await stubDialogs(app, { save: xlsxPath })
    await bom.getByRole('button', { name: '엑셀 내보내기' }).click()
    await expect(win.getByRole('status')).toContainText('내보냈습니다: bom.xlsx')
    const sheet = strFromU8(unzipSync(readFileSync(`${xlsxPath}.xlsx`))['xl/worksheets/sheet1.xml'])
    expect(sheet).toContain('<f>E2*F2</f><v>25000</v>')
    expect(sheet).toContain('열수축 튜브')
    expect(sheet).toContain('<f>E3*F3</f><v>900</v>')
    expect(sheet).toContain('<f>SUM(G2:G3)</f><v>25900</v>')

    // 9. 저장 → 파일에 BOM 편집 내용이 들어 있다
    const opb = join(out, 'bom-test')
    await stubDialogs(app, { save: opb })
    await win.keyboard.press('Control+s')
    await expect(win.getByTestId('doc-name')).toHaveText('bom-test')
    const saved = parseProject(readFileSync(`${opb}.opb`, 'utf8'))
    expect(saved.ok && saved.value.bom?.overrides?.['test-mcu']).toEqual({ unitPrice: 12500, memo: '2개 묶음 구매' })
    expect(saved.ok && saved.value.bom?.items?.map((i) => [i.name, i.quantity, i.unitPrice])).toEqual([['열수축 튜브', 3, 300]])
    expect((await getProject(win)).bom).toBeDefined()
  } finally {
    await app.close()
  }
})
