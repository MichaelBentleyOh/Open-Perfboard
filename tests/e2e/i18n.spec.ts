import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { dropPart, getProject, launchApp, makeTempDir, makeUserDataDir, nextFrame, seedLibrary, stubDialogs } from './launch'

const clickPinAt = async (win: Page, instanceId: string, pinId: string) => {
  const p = (await win.evaluate(([i, p]) => window.__opbCanvas!.pinClientPosition(i, p), [instanceId, pinId]))!
  await win.mouse.click(p.x, p.y)
}

test('한국어 ↔ 영어 전환: 화면·내보내기·대화상자, 다시 켜도 유지', async () => {
  const userData = makeUserDataDir()
  const out = makeTempDir('opb-i18n-')
  seedLibrary(userData)
  let { app, win } = await launchApp(userData)
  try {
    // 1. 기본은 한국어
    await expect(win.locator('header').getByRole('button', { name: '저장', exact: true })).toBeVisible()
    await expect(win.getByRole('button', { name: '한' })).toHaveAttribute('aria-pressed', 'true')

    // 2. EN → 툴바·패널·도움말이 영어로
    await win.getByRole('button', { name: 'EN' }).click()
    const header = win.locator('header')
    await expect(header.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await expect(header.getByRole('group', { name: 'Mode' }).getByRole('button', { name: '↖ Select' })).toBeVisible()
    await expect(win.getByRole('heading', { name: 'Parts bin' })).toBeVisible()
    await expect(win.getByRole('heading', { name: 'Selection' })).toBeVisible()
    await expect(win.getByPlaceholder('Find by name or part no.')).toBeVisible()

    // 3. 부품 두 개를 놓고 배선 모드(W)로 잇기 → 안내·알림도 영어
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU') // 사용자가 입력한 이름은 그대로
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.3, box.y + box.height / 2)
    await dropPart(win, '테스트 MCU', box.x + box.width * 0.7, box.y + box.height / 2)
    const [u1, u2] = (await getProject(win)).instances.map((i) => i.id)
    await win.keyboard.press('w')
    await expect(win.getByRole('status')).toContainText('Wire mode')
    await nextFrame(win)
    await clickPinAt(win, u1, 'b')
    await expect(win.getByRole('status')).toContainText('Click a pin to connect')
    await clickPinAt(win, u2, 'a')
    expect((await getProject(win)).wires).toHaveLength(1)
    await expect(win.getByTestId('props-wire').getByRole('heading', { name: 'Wire' })).toBeVisible()
    await win.screenshot({ path: 'test-results/i18n-en.png' })

    // 4. BOM 표와 CSV 머리글, 금액 단위
    await win.getByRole('button', { name: 'BOM (2)' }).click()
    const bom = win.getByRole('region', { name: 'BOM' })
    await expect(bom.getByRole('columnheader', { name: 'Unit price' })).toBeVisible()
    await expect(bom.getByTestId('bom-total')).toHaveText('₩0')
    const csvPath = join(out, 'bom.csv')
    await stubDialogs(app, { save: csvPath })
    await bom.getByRole('button', { name: 'Export CSV' }).click()
    await expect(win.getByRole('status')).toContainText('Exported: bom.csv')
    const csv = readFileSync(csvPath, 'utf8')
    expect(csv.startsWith('﻿No.,Category,Item,Details,Qty,Est. unit price,Est. total,Supplier,Purchase site,Notes\r\n')).toBe(true)
    expect(csv).toContain('Total,')

    // 5. 결선표 탭
    await win.getByRole('button', { name: 'Netlist (1)' }).click()
    await expect(win.getByRole('region', { name: 'Netlist' }).getByRole('columnheader', { name: 'From', exact: true })).toBeVisible()
    await win.getByRole('button', { name: 'Diagram', exact: true }).click()

    // 6. main의 저장 대화상자 제목도 영어
    await app.evaluate(({ dialog }) => {
      const g = globalThis as { lastSaveTitle?: string }
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const opts = args.find((a): a is { title?: string } => !!a && typeof a === 'object' && 'filters' in a)
        g.lastSaveTitle = opts?.title
        return { canceled: true, filePath: '' }
      }) as typeof dialog.showSaveDialog
    })
    await win.keyboard.press('Control+s')
    await expect.poll(() => app.evaluate(() => (globalThis as { lastSaveTitle?: string }).lastSaveTitle)).toBe('Save diagram')
  } finally {
    await app.close()
  }

  // 7. 다시 켜도 영어 → 한으로 돌리면 한국어
  ;({ app, win } = await launchApp(userData))
  try {
    await expect(win.locator('header').getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    await expect(win.getByTestId('doc-name')).toHaveText('Untitled diagram')
    await win.getByRole('button', { name: '한' }).click()
    await expect(win.locator('header').getByRole('button', { name: '저장', exact: true })).toBeVisible()
    await expect(win.getByTestId('doc-name')).toHaveText('새 배선도')
  } finally {
    await app.close()
  }
})
