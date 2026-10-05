import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { readLibraryFile } from '../../src/core/library'
import {
  buildTwoPartDiagram,
  getProject,
  launchApp,
  makeTempDir,
  makeUserDataDir,
  seedLibrary,
  seedSupplies,
  stubDialogs
} from './launch'

async function commit(input: Locator, value: string) {
  await input.fill(value)
  await input.press('Enter')
}

test('부속 부품: 부품함에 등록 → 전선 종류·수축 튜브 → BOM에 넣을지 묻기 → 수량 고치기 → .opblib 내보내기', async () => {
  const userData = makeUserDataDir()
  const out = makeTempDir('opb-sup-')
  seedLibrary(userData) // 커넥터 J1 = "JST-XH 2P"
  seedSupplies(userData, [
    { id: 'tube3', kind: 'tube', name: '수축 튜브 Ø3', diameter: 3, pack: '1 m 롤', unitPrice: 2000 },
    { id: 'red22', kind: 'wire', name: 'UL1007 22 빨강', awg: 22, color: '#e53935', pack: '10 m 릴', unitPrice: 5000 }
  ])
  const { app, win } = await launchApp(userData)
  try {
    // 1. 부속 부품 탭에서 단자·하우징을 만든다
    await win.getByRole('tab', { name: '부속 부품' }).click()
    const list = win.getByTestId('supply-list')
    await expect(list).toContainText('수축 튜브 Ø3')
    await win.getByRole('button', { name: '＋ 새 부속 부품' }).click()
    let dialog = win.getByRole('dialog', { name: '부속 부품 편집' })
    await dialog.getByLabel('종류', { exact: true }).selectOption({ label: '단자' })
    await dialog.getByLabel('이름', { exact: true }).fill('SXH 단자')
    await dialog.getByLabel('단가', { exact: true }).fill('30')
    await dialog.getByRole('button', { name: '저장' }).click()
    await expect(dialog).toBeHidden()

    await win.getByRole('button', { name: '＋ 새 부속 부품' }).click()
    dialog = win.getByRole('dialog', { name: '부속 부품 편집' })
    await expect(dialog.getByRole('button', { name: '저장' })).toBeDisabled() // 이름 없음
    await dialog.getByLabel('종류', { exact: true }).selectOption({ label: '하우징' })
    await dialog.getByLabel('이름', { exact: true }).fill('XHP-2 하우징')
    await dialog.getByLabel('짝 커넥터 종류').fill('JST-XH 2P')
    await dialog.getByLabel('쓰는 단자').selectOption({ label: 'SXH 단자' })
    await dialog.getByLabel('단가', { exact: true }).fill('100')
    await win.screenshot({ path: 'test-results/supply-editor.png' })
    await dialog.getByRole('button', { name: '저장' }).click()
    await expect(list.locator('.supply-item')).toHaveCount(4)
    await win.getByRole('group', { name: '부속 부품 종류' }).getByRole('button', { name: '하우징' }).click()
    await expect(list.locator('.supply-item')).toHaveCount(1)
    await expect(list).toContainText('JST-XH 2P 짝')
    await win.screenshot({ path: 'test-results/supply-list.png' })
    await win.getByRole('tab', { name: '부품', exact: true }).click()

    // 2. 배선도: 전선 하나(U1.J1.2 ↔ U2.J1.1). 전선 종류를 고르면 색·AWG가 따라온다
    await buildTwoPartDiagram(win)
    const [w] = (await getProject(win)).wires
    const path = (await win.evaluate((id) => window.__opbCanvas!.wirePathClient(id), w.id))!
    await win.mouse.click((path[0].x + path[1].x) / 2, (path[0].y + path[1].y) / 2)
    const props = win.getByTestId('props-wire')
    await props.getByLabel('전선 종류').selectOption({ label: 'UL1007 22 빨강 · AWG22 · 10 m 릴' })
    await props.getByLabel('끝 튜브').selectOption({ label: '수축 튜브 Ø3 · Ø3 · 1 m 롤' })
    let p = await getProject(win)
    expect(p.wires[0]).toMatchObject({ supplyId: 'red22', color: '#e53935', awg: 22, tubes: { ends: 'tube3' } })
    expect(Object.keys(p.supplies ?? {}).sort()).toEqual(['red22', 'tube3'])
    await win.screenshot({ path: 'test-results/supply-wire.png' })

    // 3. BOM: 넣을지 묻는다 (하우징 2 = 커넥터 2개, 단자 2 = 연결된 핀 2개, 튜브·전선 1묶음)
    await win.getByRole('button', { name: /^BOM/ }).click()
    const bom = win.getByRole('region', { name: 'BOM' })
    const questions = bom.getByTestId('supply-questions')
    await expect(questions).toContainText('BOM에 넣을까요?')
    const q = (name: string) => questions.locator('li', { hasText: name })
    await expect(q('XHP-2 하우징')).toContainText('제안 2개')
    await expect(q('XHP-2 하우징')).toContainText('U1.J1, U2.J1')
    await expect(q('SXH 단자')).toContainText('연결된 핀 2개')
    await expect(q('수축 튜브 Ø3')).toContainText('양 끝 2 · 중간 0조각')
    await expect(q('수축 튜브 Ø3')).toContainText('제안 1묶음 · 1 m 롤')
    await win.screenshot({ path: 'test-results/supply-questions.png' })

    await q('XHP-2 하우징').getByRole('button', { name: '넣기' }).click()
    await q('SXH 단자').getByRole('button', { name: '넣기' }).click()
    await q('수축 튜브 Ø3').getByRole('button', { name: '빼기' }).click()
    await q('UL1007 22 빨강').getByRole('button', { name: '넣기' }).click()
    await expect(questions.locator('.callout')).toHaveCount(0) // 더 물을 것 없음
    await expect(questions).toContainText('뺀 부속 부품 1개')

    const row = (name: string) => bom.locator('tr[data-supply]', { hasText: name })
    await expect(row('XHP-2 하우징').getByTestId('amount')).toHaveText('200원')
    await expect(row('SXH 단자').getByTestId('amount')).toHaveText('60원')
    await expect(row('UL1007 22 빨강').getByTestId('amount')).toHaveText('5,000원')
    // 전선 묶음 수를 3으로 → 15,000원 (부품 2개는 단가 없음)
    await commit(row('UL1007 22 빨강').getByLabel('수량'), '3')
    await expect(row('UL1007 22 빨강').getByTestId('amount')).toHaveText('15,000원')
    await expect(bom.getByTestId('bom-total')).toHaveText('15,260원')
    await win.screenshot({ path: 'test-results/supply-bom.png' })
    await win.keyboard.press('Control+z')
    await expect(bom.getByTestId('bom-total')).toHaveText('5,260원')

    // 뺀 것을 다시 넣기
    await questions.locator('summary').click()
    await questions.locator('.supply-excluded li', { hasText: '수축 튜브 Ø3' }).getByRole('button', { name: '다시 넣기' }).click()
    await expect(row('수축 튜브 Ø3').getByTestId('amount')).toHaveText('2,000원')
    p = await getProject(win)
    expect(Object.keys(p.bom?.supplies ?? {}).length).toBe(4)

    // 4. 결선표에 전선 종류·튜브
    await win.getByRole('button', { name: /^결선표/ }).click()
    const net = win.getByRole('region', { name: '결선표' })
    await expect(net.locator('tbody tr').first()).toContainText('UL1007 22 빨강')
    await expect(net.locator('tbody tr').first()).toContainText('수축 튜브 Ø3')

    // 5. 부품함 내보내기(.opblib)에 부속 부품도 들어간다
    const exported = join(out, 'bin')
    await stubDialogs(app, { save: exported })
    await win.getByRole('button', { name: '⤒ 내보내기' }).click()
    await expect(win.getByRole('status')).toContainText('부속 부품 4개')
    const back = readLibraryFile(readFileSync(`${exported}.opblib`, 'utf8'))
    expect(back.supplies?.map((s) => s.name).sort()).toEqual(['SXH 단자', 'UL1007 22 빨강', 'XHP-2 하우징', '수축 튜브 Ø3'])
    const housing = back.supplies!.find((s) => s.kind === 'housing')!
    expect(housing.terminalId).toBe(back.supplies!.find((s) => s.kind === 'terminal')!.id)

    // 6. 부품 편집기: 커넥터 종류 옆에 짝 하우징
    await win.getByTestId('part-list').locator('.part-item').filter({ hasText: '테스트 MCU' }).getByRole('button', { name: '편집' }).click()
    const editor = win.getByRole('dialog', { name: '부품 편집' })
    await expect(editor.getByTestId('connector-mate')).toHaveText('짝: XHP-2 하우징')
    await editor.getByLabel('커넥터 종류').fill('Molex 2P')
    await expect(editor.getByTestId('connector-mate')).toHaveText('짝 하우징 미지정')
    // 커넥터 색: 누를 수 있는 크기여야 한다 (표의 input 너비 100% 규칙에 눌려 4px가 된 적이 있다) → 고르면 ↺, 누르면 기본 색
    const color = editor.getByLabel('커넥터 색')
    expect((await color.boundingBox())!.width).toBeGreaterThanOrEqual(20)
    await color.fill('#00ff00')
    await editor.getByRole('button', { name: '기본 색으로' }).click()
    await expect(color).toHaveValue('#e53935')
    await editor.getByRole('button', { name: '취소' }).click()
  } finally {
    await app.close()
  }
})
