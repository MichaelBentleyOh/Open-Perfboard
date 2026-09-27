import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator } from '@playwright/test'
import { buildTwoPartDiagram, getProject, launchApp, makeTempDir, makeUserDataDir, nextFrame, seedLibrary, setMode, stubDialogs } from './launch'

async function commit(input: Locator, value: string) {
  await input.fill(value)
  await input.press('Enter')
}

test('속성 창에서 부품 스펙·전선 규격/길이 편집 → BOM·결선표 반영, 라이브러리 반영, 실행 취소', async () => {
  const userData = makeUserDataDir()
  const out = makeTempDir('opb-spec-')
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    // 0. "?" 버튼이 "저장" 앞에, 선택이 없을 때 속성 창에는 설명 없음
    const header = win.locator('header')
    const helpBox = (await header.getByRole('button', { name: '단축키 도움말' }).boundingBox())!
    const saveBox = (await header.getByRole('button', { name: '저장', exact: true }).boundingBox())!
    expect(helpBox.x).toBeLessThan(saveBox.x)
    const panel = win.locator('.panel.right')
    await expect(panel).toContainText('캔버스에서 부품이나 전선을 누르면')
    await expect(panel).not.toContainText('왼쪽 목록에서')

    // 1. 부품 선택 → 스펙 편집 (이 배선도의 U1·U2 모두에 적용)
    await buildTwoPartDiagram(win)
    const p0 = await getProject(win)
    const u1 = p0.instances[0]
    await win.keyboard.press('Escape')
    await nextFrame(win)
    const c = (await win.evaluate((i) => window.__opbCanvas!.instanceClientPosition(i), u1.id))!
    await win.mouse.click(c.x, c.y + 50)
    const props = win.getByTestId('props-instance')
    await expect(props).toContainText('U1, U2')
    await commit(props.getByLabel('이름', { exact: true }), '메인 보드')
    await commit(props.getByLabel('품번'), 'MB-02')
    await commit(props.getByLabel('기본 단가'), '12,000')
    let part = (await getProject(win)).parts[u1.partId]
    expect(part).toMatchObject({ name: '메인 보드', partNumber: 'MB-02', unitPrice: 12000 })
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU') // 라이브러리는 그대로
    await expect(props.getByTestId('library-differs')).toBeVisible()
    await win.screenshot({ path: 'test-results/spec-part.png' })

    // 잘못된 구매 링크는 되돌림
    await commit(props.getByLabel('구매 링크'), 'shop.example')
    await expect(win.getByRole('status')).toContainText('http:// 또는 https://')
    await expect(props.getByLabel('구매 링크')).toHaveValue('')

    // 2. BOM에 반영: 2개 × 12,000
    await win.getByRole('button', { name: 'BOM (2)' }).click()
    const bom = win.getByRole('region', { name: 'BOM' })
    await expect(bom).toContainText('메인 보드')
    await expect(bom.getByTestId('bom-total')).toHaveText('24,000원')
    await win.getByRole('button', { name: '배선도', exact: true }).click()

    // 3. 실행 취소: 단가 → 품번 순으로 되돌아간다
    await win.keyboard.press('Control+z')
    part = (await getProject(win)).parts[u1.partId]
    expect(part.unitPrice).toBeUndefined()
    await win.keyboard.press('Control+y')

    // 4. 라이브러리에도 저장 → 라이브러리 목록 이름이 바뀌고 "다름" 표시가 사라짐
    await props.getByRole('button', { name: '부품함에도 저장' }).click()
    await expect(win.getByRole('status')).toContainText('부품함에 저장했습니다')
    await expect(win.getByTestId('part-list')).toContainText('메인 보드')
    await expect(props.getByTestId('library-differs')).toHaveCount(0)

    // 5. 전선 선택 → 규격 22 AWG, 길이 350 mm → 결선표·CSV
    await setMode(win, 'select')
    const wire = (await getProject(win)).wires[0]
    const path = (await win.evaluate((id) => window.__opbCanvas!.wirePathClient(id), wire.id))!
    await win.mouse.click((path[0].x + path[1].x) / 2, (path[0].y + path[1].y) / 2)
    const wp = win.getByTestId('props-wire')
    await wp.getByLabel('규격(AWG)').selectOption('22')
    await commit(wp.getByLabel('길이(mm)'), '350')
    expect((await getProject(win)).wires[0]).toMatchObject({ awg: 22, length: 350 })
    await win.screenshot({ path: 'test-results/spec-wire.png' })
    await win.getByRole('button', { name: /^결선표/ }).click()
    const net = win.getByRole('region', { name: '결선표' })
    await expect(net.getByRole('columnheader', { name: '규격(AWG)' })).toBeVisible()
    await expect(net.locator('tbody tr').first()).toContainText('22')
    await expect(net.locator('tbody tr').first()).toContainText('350')
    const csvPath = join(out, 'net.csv')
    await stubDialogs(app, { save: csvPath })
    await net.getByRole('button', { name: 'CSV 내보내기' }).click()
    await expect(win.getByRole('status')).toContainText('내보냈습니다')
    expect(readFileSync(csvPath, 'utf8')).toContain(',22,350,')
  } finally {
    await app.close()
  }
})
