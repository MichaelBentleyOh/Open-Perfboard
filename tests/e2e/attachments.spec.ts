import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { dropPart, getProject, launchApp, makeTempDir, makeUserDataDir, nextFrame, seedLibrary, stubDialogs } from './launch'

const FIXTURES = join(__dirname, '../fixtures')

/** 열기 대화상자가 여러 파일을 고른 것처럼 */
async function stubOpenMany(app: ElectronApplication, files: string[]) {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog
  }, files)
}

const windowTitles = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()))

async function selectFirstPart(win: Page) {
  await win.keyboard.press('Escape')
  await nextFrame(win)
  const id = (await getProject(win)).instances[0].id
  const c = (await win.evaluate((i) => window.__opbCanvas!.instanceClientPosition(i), id))!
  await win.mouse.click(c.x, c.y + 50)
  return win.getByTestId('props-instance')
}

test('부품 첨부: 편집기에서 PDF·그림 첨부 → 속성 창 썸네일 → 별도 창으로 열기 → .opblib·.opb로 다른 PC와 공유', async () => {
  const out = makeTempDir('opb-att-')
  const bad = join(out, 'notes.pdf')
  writeFileSync(bad, 'not really a pdf') // 확장자만 PDF
  const pcA = makeUserDataDir()
  seedLibrary(pcA)
  let { app, win } = await launchApp(pcA)
  try {
    // 1. 부품 편집기: PDF + PNG + 가짜 PDF 첨부 → 둘만 들어오고 가짜는 이유와 함께 거부
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    await win.getByTestId('part-list').getByRole('button', { name: '편집' }).click()
    const editor = win.getByRole('dialog', { name: '부품 편집' })
    await stubOpenMany(app, [join(FIXTURES, 'datasheet.pdf'), join(FIXTURES, 'part-photo.png'), bad])
    await editor.getByRole('button', { name: '＋ 파일 첨부' }).click()
    const list = editor.getByTestId('attachment-list')
    await expect(list.locator('li')).toHaveCount(2)
    await expect(editor).toContainText('notes.pdf: PDF, PNG, JPG, WEBP 파일만 첨부할 수 있습니다')
    await list.getByLabel('첨부 제목').first().fill('ESP 데이터시트')
    await list.getByLabel('첨부 제목').first().press('Enter')
    await win.screenshot({ path: 'test-results/attach-editor.png' })
    await editor.getByRole('button', { name: '저장', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect(win.getByTestId('part-list')).toContainText('📎 2')

    // 2. 배치 → 속성 창에 첨부, 그림 썸네일이 실제로 보임
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + box.width / 2, box.y + box.height / 2)
    const props = await selectFirstPart(win)
    const plist = props.getByTestId('attachment-list')
    await expect(plist.locator('li')).toHaveCount(2)
    await expect(plist).toContainText('ESP 데이터시트')
    await expect(plist).not.toContainText('파일 없음')
    const thumb = plist.locator('img').first()
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
    await win.screenshot({ path: 'test-results/attach-props.png' })

    // 3. 누르면 별도 창(제목 = 첨부 제목). 다시 누르면 새 창을 만들지 않고 그 창을 앞으로
    const viewer = app.waitForEvent('window')
    await plist.getByRole('button', { name: 'ESP 데이터시트', exact: true }).click()
    const page = await viewer
    await expect.poll(() => windowTitles(app)).toContain('ESP 데이터시트')
    await page.waitForTimeout(800)
    await page.screenshot({ path: 'test-results/attach-viewer.png' })
    const count = (await windowTitles(app)).length
    await plist.getByRole('button', { name: 'ESP 데이터시트', exact: true }).click()
    await win.waitForTimeout(300)
    expect((await windowTitles(app)).length).toBe(count)

    // 4. 라이브러리 내보내기(.opblib)에는 첨부 본문이 들어간다
    const lib = join(out, 'mylib')
    await stubDialogs(app, { save: lib })
    await win.getByRole('button', { name: '⤒ 내보내기' }).click()
    await expect(win.getByRole('status')).toContainText('내보냈습니다')
    expect(Object.keys(JSON.parse(readFileSync(`${lib}.opblib`, 'utf8')).attachmentData)).toHaveLength(2)

    // 5. 배선도 저장: 기본은 목록만 → "첨부 포함"을 켜면 본문까지
    const plain = join(out, 'plain.opb')
    await stubDialogs(app, { save: plain })
    await win.keyboard.press('Control+Shift+s')
    await expect(win.getByRole('status')).toContainText('저장했습니다')
    const plainRaw = JSON.parse(readFileSync(plain, 'utf8'))
    expect(plainRaw.version).toBe(5)
    expect(Object.values(plainRaw.parts as Record<string, { attachments: unknown[] }>)[0].attachments).toHaveLength(2)
    expect(plainRaw.attachmentData).toBeUndefined()
    await win.getByText('파일 ▾').click()
    await win.getByLabel('저장할 때 첨부 파일 포함').check()
    const full = join(out, 'full.opb')
    await stubDialogs(app, { save: full })
    await win.keyboard.press('Control+Shift+s')
    await expect(win.getByRole('status')).toContainText('저장했습니다: full')
    expect(Object.keys(JSON.parse(readFileSync(full, 'utf8')).attachmentData)).toHaveLength(2)
  } finally {
    await app.close()
  }

  // 6. 다른 PC(빈 라이브러리): 목록만 있는 배선도 → "파일 없음", 본문이 든 배선도를 열면 볼 수 있음
  const pcB = makeUserDataDir()
  ;({ app, win } = await launchApp(pcB))
  try {
    await expect(win.getByText('부품함이 비어 있습니다.')).toBeVisible() // 화면이 다 뜬 뒤에 단축키
    await stubDialogs(app, { open: join(out, 'plain.opb') })
    await win.keyboard.press('Control+o')
    const dialog = win.getByRole('dialog', { name: '부품 가져오기' })
    await dialog.getByRole('button', { name: '가져오기 (1개)' }).click()
    await expect(win.getByTestId('part-list')).toContainText('📎 2')
    let props = await selectFirstPart(win)
    await expect(props.getByTestId('attachment-list')).toContainText('파일 없음')
    await expect(props.getByRole('button', { name: 'ESP 데이터시트', exact: true })).toBeDisabled()

    await stubDialogs(app, { open: join(out, 'full.opb') })
    await win.keyboard.press('Control+o')
    await expect(win.getByTestId('doc-name')).toHaveText('full')
    props = await selectFirstPart(win)
    await expect(props.getByTestId('attachment-list').locator('li')).toHaveCount(2)
    await expect(props.getByTestId('attachment-list')).not.toContainText('파일 없음')
    await expect(props.getByRole('button', { name: 'ESP 데이터시트', exact: true })).toBeEnabled()
  } finally {
    await app.close()
  }
})
