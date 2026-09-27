import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { buildTwoPartDiagram, getProject, launchApp, makeUserDataDir, seedLibrary, stubDialogs } from './launch'

const pin = async (win: Page, i: string, p: string) =>
  (await win.evaluate(([i, p]) => window.__opbCanvas!.pinClientPosition(i, p), [i, p]))!

test('부품 좌우·상하 반전 → 실행 취소 → PDF 내보내기(3쪽, 작성자·비고 저장)', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData, { purchaseUrl: 'https://www.devicemart.co.kr/goods/view?no=12345' })
  const { app, win } = await launchApp(userData)
  try {
    const { u1 } = await buildTwoPartDiagram(win) // U1.J1.2(오른쪽 핀 b) → U2.J1.1

    // 1. U1 선택 → F: 좌우 반전. 오른쪽에 있던 핀 b가 핀 a보다 왼쪽으로, 전선은 유지
    const c = (await win.evaluate(([i]) => window.__opbCanvas!.instanceClientPosition(i), [u1]))!
    await win.mouse.click(c.x, c.y + 50)
    const a0 = await pin(win, u1, 'a')
    const b0 = await pin(win, u1, 'b')
    expect(b0.x).toBeGreaterThan(a0.x)
    await win.keyboard.press('f')
    let inst = (await getProject(win)).instances[0]
    expect(inst).toMatchObject({ flipped: true, rotation: 0 })
    const b1 = await pin(win, u1, 'b')
    expect(b1.x).toBeCloseTo(a0.x, 0) // 중심 기준 거울상: b가 a 자리로
    expect((await getProject(win)).wires).toHaveLength(1)
    await expect(win.getByTestId('props-instance')).toContainText('0° · 반전')
    await win.screenshot({ path: 'test-results/flip-horizontal.png' })

    // 2. Shift+F: 상하 반전 (좌우 반전 + 180°) → 반전이 풀리고 180°
    await win.keyboard.press('Shift+F')
    inst = (await getProject(win)).instances[0]
    expect(inst.rotation).toBe(180)
    expect(inst.flipped).toBeUndefined()

    // 3. 실행 취소 두 번 → 원래대로
    await win.keyboard.press('Control+z')
    await win.keyboard.press('Control+z')
    inst = (await getProject(win)).instances[0]
    expect(inst.rotation).toBe(0)
    expect(inst.flipped).toBeUndefined()

    // 4. 속성 패널 버튼으로 좌우 반전
    await win.getByTestId('props-instance').getByRole('button', { name: '⇋ 좌우 반전' }).click()
    expect((await getProject(win)).instances[0].flipped).toBe(true)

    // 5. Ctrl+P → PDF 대화상자
    await win.keyboard.press('Control+p')
    const dialog = win.getByRole('dialog', { name: 'PDF 내보내기' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('작성자').fill('테스터')
    await dialog.getByLabel('비고').fill('배터리는 마지막에 연결\n퓨즈 5A')
    await win.screenshot({ path: 'test-results/pdf-dialog.png' })

    const outDir = resolve('test-results')
    mkdirSync(outDir, { recursive: true })
    const pdfPath = join(outDir, 'report.pdf')
    rmSync(pdfPath, { force: true })
    await stubDialogs(app, { save: join(outDir, 'report') })
    await dialog.getByRole('button', { name: 'PDF 내보내기' }).click()
    await expect(dialog).toBeHidden({ timeout: 15_000 })
    await expect(win.getByRole('status')).toContainText('PDF로 내보냈습니다')

    // 6. PDF 파일: 시그니처, 쪽 수(배선도·BOM·결선표 = 3)
    expect(existsSync(pdfPath)).toBe(true)
    const pdf = readFileSync(pdfPath)
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []
    expect(pages).toHaveLength(3)

    // 7. 작성자·비고는 문서에 저장 (저장 안 된 변경 표시)
    expect((await getProject(win)).meta).toEqual({ author: '테스터', notes: '배터리는 마지막에 연결\n퓨즈 5A' })
    await expect(win.getByTestId('doc-name')).toContainText('*')
  } finally {
    await app.close()
  }
})
