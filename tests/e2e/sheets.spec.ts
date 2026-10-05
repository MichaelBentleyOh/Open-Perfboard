import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import { buildTwoPartDiagram, dropPart, getProject, launchApp, makeTempDir, makeUserDataDir, seedLibrary, stubDialogs } from './launch'

test('여러 배선도: ＋로 추가 → 각자 실행 취소 → 이름 바꾸기 → BOM 범위 → .zip 저장·열기 → 삭제', async () => {
  const userData = makeUserDataDir()
  const out = makeTempDir('opb-sheets-')
  seedLibrary(userData, { unitPrice: 1000 })
  const { app, win } = await launchApp(userData)
  try {
    const tabs = win.getByTestId('sheet-tabs')
    const tab = (name: string) => tabs.getByRole('tab', { name })
    await expect(tab('배선도 1')).toHaveAttribute('aria-selected', 'true')

    // 1. 배선도 1: 부품 2개 + 전선
    await buildTwoPartDiagram(win)

    // 2. ＋ → 배선도 2 (빈 배선도), 부품 하나
    await tabs.getByRole('button', { name: '새 배선도 추가' }).click()
    await expect(tab('배선도 2')).toHaveAttribute('aria-selected', 'true')
    expect((await getProject(win)).instances).toHaveLength(0)
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + box.width / 2, box.y + box.height / 2)
    expect((await getProject(win)).instances).toHaveLength(1)

    // 3. 실행 취소는 배선도마다: 배선도 2에서 Ctrl+Z → 부품이 빠지고, 배선도 1은 그대로
    await win.keyboard.press('Control+z')
    expect((await getProject(win)).instances).toHaveLength(0)
    await win.keyboard.press('Control+y')
    await tab('배선도 1').click()
    let p = await getProject(win)
    expect([p.instances.length, p.wires.length]).toEqual([2, 1])
    await win.keyboard.press('Control+z') // 배선도 1의 마지막 작업 = 전선
    expect((await getProject(win)).wires).toHaveLength(0)
    await win.keyboard.press('Control+y')
    expect((await getProject(win)).wires).toHaveLength(1)
    await tab('배선도 2').click()
    expect((await getProject(win)).instances).toHaveLength(1) // 다시 실행한 부품이 남아 있다

    // 4. 이름 바꾸기 (두 번 누르기)
    await tab('배선도 2').dblclick()
    await tabs.getByLabel('배선도 이름').fill('모터부')
    await tabs.getByLabel('배선도 이름').press('Enter')
    await expect(tab('모터부')).toBeVisible()
    expect((await getProject(win)).name).toBe('모터부')
    await win.screenshot({ path: 'test-results/sheets-tabs.png' })

    // 5. BOM: 두 배선도를 합쳐 테스트 MCU 3개, 범위에서 배선도 1을 빼면 1개
    await win.getByRole('button', { name: /^BOM/ }).click()
    const bom = win.getByRole('region', { name: 'BOM' })
    const row = bom.locator('tr[data-part]')
    await expect(row.locator('td').nth(4)).toHaveText('3')
    await expect(row).toContainText('배선도 1: U1')
    await expect(bom.getByTestId('bom-total')).toHaveText('3,000원')
    await bom.getByRole('button', { name: '포함할 배선도' }).click()
    const list = bom.getByRole('listbox', { name: '포함할 배선도' })
    await expect(list.locator('label').first()).toHaveText('모두 선택')
    await win.screenshot({ path: 'test-results/sheets-scope.png' })
    await list.getByLabel('배선도 1').uncheck()
    // 배선도 하나면 수량을 고칠 수 있는 칸이 된다
    await expect(row.getByLabel('수량')).toHaveValue('1')
    await expect(bom.getByRole('button', { name: '포함할 배선도' })).toContainText('모터부')
    await win.keyboard.press('Escape') // 목록 닫기
    await expect(list).toBeHidden()
    // 한 배선도에서 단가를 고치면 그 배선도에만
    await row.getByLabel('예상 단가').fill('1500')
    await row.getByLabel('예상 단가').press('Enter')
    await bom.getByRole('button', { name: '포함할 배선도' }).click()
    await list.getByLabel('모두 선택').check()
    // 합친 행: 단가가 배선도마다 다르면 '여러 값', 금액은 1,000 × 2 + 1,500 × 1
    await expect(bom.getByTestId('bom-total')).toHaveText('3,500원')
    await expect(row.getByLabel('예상 단가')).toHaveAttribute('placeholder', '여러 값')
    await win.keyboard.press('Escape')

    // 6. 결선표: 배선도가 둘이면 배선도 칸
    await win.getByRole('button', { name: /^결선표/ }).click()
    const net = win.getByRole('region', { name: '결선표' })
    await expect(net.getByRole('columnheader', { name: '배선도' })).toBeVisible()
    await expect(net.locator('tbody tr').first()).toContainText('배선도 1')
    await win.getByRole('button', { name: '배선도', exact: true }).click()

    // 7. 저장 → 배선도가 둘이라 .zip
    const zipPath = join(out, '로봇')
    await stubDialogs(app, { save: zipPath })
    await win.keyboard.press('Control+s')
    await expect(win.getByTestId('doc-name')).toHaveText('로봇')
    expect(existsSync(`${zipPath}.zip`)).toBe(true)
    const files = unzipSync(readFileSync(`${zipPath}.zip`))
    expect(Object.keys(files).sort()).toEqual(['01-배선도 1.opb', '02-모터부.opb', 'library.opblib', 'manifest.json'])
    expect(JSON.parse(strFromU8(files['manifest.json']))).toMatchObject({ format: 'open-perfboard-workspace', active: 1 })

    // 8. 새로 만들기 → 탭 하나, 다시 열기 → 두 배선도
    await win.keyboard.press('Control+n')
    await expect(tabs.getByRole('tab')).toHaveCount(1)
    await stubDialogs(app, { open: `${zipPath}.zip` })
    await win.keyboard.press('Control+o')
    await expect(tabs.getByRole('tab')).toHaveCount(2)
    await expect(tab('모터부')).toHaveAttribute('aria-selected', 'true')
    expect((await getProject(win)).bom?.overrides?.['test-mcu']?.unitPrice).toBe(1500)
    await tab('배선도 1').click()
    expect((await getProject(win)).wires).toHaveLength(1)
    await expect(win.getByTestId('doc-name')).toHaveText('로봇')

    // 9. 삭제 (확인 창은 자동으로 "확인")
    await tab('모터부').hover() // ✕는 마우스를 올린 탭·지금 탭에만 보인다
    await tabs.getByRole('button', { name: '모터부 지우기' }).click()
    await expect(tabs.getByRole('tab')).toHaveCount(1)
    await expect(win.getByTestId('doc-name')).toHaveText('로봇 *')
  } finally {
    await app.close()
  }
})
