import { expect, test } from '@playwright/test'
import { dropPart, getProject, launchApp, makeUserDataDir, seedLibrary } from './launch'

const DEVICEMART = 'https://www.devicemart.co.kr/goods/view?no=12345'
const ELEPARTS = 'https://www.eleparts.co.kr/goods/view?no=999'

test('구매 링크: BOM 표에서 열기 → 라이브러리에서 수정 → 배선도에 갱신 → 실행 취소', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData, { purchaseUrl: DEVICEMART })
  const { app, win } = await launchApp(userData)
  // 기본 브라우저를 여는 대신 기록만 한다
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] }
    g.opened = []
    shell.openExternal = (async (url: string) => {
      g.opened.push(url)
    }) as typeof shell.openExternal
  })
  const opened = () => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)

  try {
    await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
    const box = (await win.getByTestId('diagram-canvas').boundingBox())!
    await dropPart(win, '테스트 MCU', box.x + box.width / 2, box.y + box.height / 2)

    // 1. BOM 표에 도메인이 보이고, 누르면 브라우저로 연다
    await win.getByRole('button', { name: 'BOM (1)' }).click()
    const bom = win.getByRole('region', { name: 'BOM' })
    const link = bom.getByRole('link', { name: /devicemart\.co\.kr/ })
    await expect(link).toBeVisible()
    await link.click()
    expect(await opened()).toEqual([DEVICEMART])
    await win.screenshot({ path: 'test-results/bom-purchase-link.png' })

    // 2. 부품 에디터: 형식이 틀리면 저장 불가, 올바른 링크로 수정해 저장
    await win.getByTestId('part-list').getByRole('button', { name: '편집' }).click()
    const dialog = win.getByRole('dialog', { name: '부품 편집' })
    const input = dialog.getByPlaceholder('https://...')
    await expect(input).toHaveValue(DEVICEMART)
    await input.fill('eleparts.co.kr')
    await expect(dialog.getByText('구매 링크는 http:// 또는 https://로 시작해야 합니다')).toBeVisible()
    await expect(dialog.getByRole('button', { name: '저장' })).toBeDisabled()
    await input.fill(ELEPARTS)
    await dialog.getByRole('button', { name: '저장' }).click()
    await expect(dialog).toBeHidden()

    // 3. 배선도의 부품은 사본이라 그대로 → 속성 패널에서 갱신
    expect(Object.values((await getProject(win)).parts)[0].purchaseUrl).toBe(DEVICEMART)
    await win.getByRole('button', { name: '배선도', exact: true }).click()
    const id = (await getProject(win)).instances[0].id
    const c = (await win.evaluate(([i]) => window.__opbCanvas!.instanceClientPosition(i), [id]))!
    await win.mouse.click(c.x, c.y + 50)
    const props = win.getByTestId('props-instance')
    await expect(props.getByTestId('library-differs')).toContainText('부품함과 다릅니다')
    await props.getByRole('button', { name: '부품함 값으로 되돌리기' }).click()
    await expect(props.getByTestId('library-differs')).toHaveCount(0)
    await expect(props.getByRole('link', { name: /eleparts\.co\.kr/ })).toBeVisible()
    expect(Object.values((await getProject(win)).parts)[0].purchaseUrl).toBe(ELEPARTS)

    // 4. 갱신도 실행 취소할 수 있다
    await win.keyboard.press('Control+z')
    expect(Object.values((await getProject(win)).parts)[0].purchaseUrl).toBe(DEVICEMART)
  } finally {
    await app.close()
  }
})
