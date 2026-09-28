import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { parseProject } from '../../src/core/serialize'
import { buildTwoPartDiagram, getProject, launchApp, makeTempDir, seedLibrary, stubDialogs } from './launch'

test('저장 → 새로 만들기 → 열기 → BOM·결선표 → 내보내기 → 변경 후 닫기', async () => {
  const userData = makeTempDir()
  const out = makeTempDir('opb-out-')
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  const docName = win.getByTestId('doc-name')
  try {
    // 1. 새 문서는 깨끗한 상태, 편집하면 * 표시
    await expect(docName).toHaveText('새 배선도')
    await buildTwoPartDiagram(win)
    await expect(docName).toHaveText('새 배선도 *')
    await expect(win).toHaveTitle('* 새 배선도 — Open Perfboard')

    // 2. Ctrl+S → 저장 대화상자(확장자 없이 입력) → .opb로 저장, * 사라짐
    const opb = join(out, '로봇 하네스.opb')
    await stubDialogs(app, { save: join(out, '로봇 하네스') })
    await win.keyboard.press('Control+s')
    await expect(docName).toHaveText('로봇 하네스')
    const saved = parseProject(readFileSync(opb, 'utf8'))
    expect(saved.ok && saved.value.name).toBe('로봇 하네스')
    expect(saved.ok && saved.value.instances.map((i) => i.refDes)).toEqual(['U1', 'U2'])

    // 3. 실행 취소 → 변경 상태, 다시 실행 → 저장 시점과 같아져서 깨끗한 상태
    await win.keyboard.press('Control+z')
    await expect(docName).toHaveText('로봇 하네스 *')
    await win.keyboard.press('Control+y')
    await expect(docName).toHaveText('로봇 하네스')

    // 4. 새로 만들기 → 빈 문서
    await win.keyboard.press('Control+n')
    await expect(docName).toHaveText('새 배선도')
    expect((await getProject(win)).instances).toHaveLength(0)

    // 5. 열기 → 복원
    await stubDialogs(app, { open: opb })
    await win.keyboard.press('Control+o')
    await expect(docName).toHaveText('로봇 하네스')
    const opened = await getProject(win)
    expect(opened.instances.map((i) => i.refDes)).toEqual(['U1', 'U2'])
    expect(opened.wires).toHaveLength(1)

    // 6. BOM 탭
    await win.getByRole('button', { name: 'BOM (2)' }).click()
    const bom = win.getByRole('region', { name: 'BOM' })
    await expect(bom).toContainText('1종 · 2개')
    await expect(bom.locator('tbody tr')).toHaveCount(1)
    await expect(bom.locator('tbody tr').first()).toContainText('U1, U2')
    await expect(bom.locator('tbody tr').first()).toContainText('TM-01')
    await win.screenshot({ path: 'test-results/report-bom.png' })

    // 7. BOM CSV 내보내기
    const bomCsv = join(out, 'bom.csv')
    await stubDialogs(app, { save: bomCsv })
    await bom.getByRole('button', { name: 'CSV 내보내기' }).click()
    await expect(win.getByRole('status')).toContainText('내보냈습니다')
    expect(readFileSync(bomCsv, 'utf8')).toBe(
      '﻿참조명,이름,품번,제조사,수량,단가,금액,구매 링크,비고\r\n' +
        '"U1, U2",테스트 MCU,TM-01,,2,,,,\r\n' +
        '합계,,,,2,,0,,단가 미입력 1건\r\n'
    )

    // 8. 결선표 탭 + CSV
    await win.getByRole('button', { name: '결선표 (1)' }).click()
    const netlist = win.getByRole('region', { name: '결선표' })
    await expect(netlist.locator('tbody tr').first()).toContainText('U1.J1.2')
    await expect(netlist.locator('tbody tr').first()).toContainText('U2.J1.1')
    await expect(netlist.locator('tbody tr').first()).toContainText('빨강')
    await win.screenshot({ path: 'test-results/report-netlist.png' })
    const netCsv = join(out, 'net')
    await stubDialogs(app, { save: netCsv })
    await netlist.getByRole('button', { name: 'CSV 내보내기' }).click()
    await expect.poll(() => existsSync(`${netCsv}.csv`)).toBe(true)
    expect(readFileSync(`${netCsv}.csv`, 'utf8')).toContain('U1.J1.2,GND,↔,U2.J1.1,VCC,#e53935,')

    // 9. PNG 내보내기 (결선표 탭에 있어도 동작)
    const png = join(out, 'diagram.png')
    await stubDialogs(app, { save: png })
    await win.getByText('내보내기 ▾').click()
    await win.getByRole('menuitem', { name: '배선도 이미지 (PNG)' }).click()
    await expect.poll(() => existsSync(png)).toBe(true)
    const bytes = readFileSync(png)
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]) // PNG 시그니처
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    expect(width).toBeGreaterThan(height) // 좌우로 놓인 두 부품
    expect(width).toBeGreaterThan(800) // 2배 해상도

    // 10. 변경 후 닫기 → 확인 대화상자에서 "저장" → 저장 후 닫힘
    await win.getByRole('button', { name: '배선도', exact: true }).click()
    const id = (await getProject(win)).instances[0].id
    const a = (await win.evaluate(([i]) => window.__opbCanvas!.pinClientPosition(i, 'a'), [id]))!
    const b = (await win.evaluate(([i]) => window.__opbCanvas!.pinClientPosition(i, 'b'), [id]))!
    await win.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2 + 30)
    await win.keyboard.press('r')
    await expect(docName).toHaveText('로봇 하네스 *')
    await stubDialogs(app, { messageBox: 0 })
    const closed = app.waitForEvent('close')
    // 사용자가 창의 X를 누른 것과 같은 경로
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await closed
  } catch (e) {
    await app.close()
    throw e
  }

  // 닫기 전에 저장됐는지 확인
  const final = parseProject(readFileSync(join(out, '로봇 하네스.opb'), 'utf8'))
  expect(final.ok && final.value.instances[0].rotation).toBe(90)
})
