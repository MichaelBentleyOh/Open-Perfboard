import { expect, test, type Page } from '@playwright/test'
import { buildTwoPartDiagram, launchApp, makeUserDataDir, seedLibrary } from './launch'

/** 표의 오른쪽 끝이 흰 카드 안에 있는지 (px, 카드 오른쪽 - 표 오른쪽) */
const room = (win: Page, name: string) =>
  win.evaluate((label) => {
    const card = document.querySelector(`section.report[aria-label="${label}"]`)!
    const table = card.querySelector('table')!
    return card.getBoundingClientRect().right - table.getBoundingClientRect().right
  }, name)

test('BOM·결선표: 양옆 창을 연 좁은 화면에서도 표가 카드 밖으로 나가지 않는다 (가로 스크롤)', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await buildTwoPartDiagram(win)
    // 창을 가장 좁게 (부품함·선택 항목 창은 열린 채)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1000, 700))
    await expect(win.locator('.panel.left')).toBeVisible()
    await expect(win.locator('.panel.right')).toBeVisible()

    await win.getByRole('button', { name: /^BOM \(/ }).click()
    await expect(win.locator('section.report[aria-label="BOM"] table')).toBeVisible()
    expect(await room(win, 'BOM')).toBeGreaterThanOrEqual(0)
    // 표 위 버튼(CSV 내보내기)은 가로로 스크롤하지 않아도 보이고, 머리줄은 표와 같은 왼쪽 줄에서 시작한다
    await expect(win.getByRole('button', { name: 'CSV 내보내기' })).toBeInViewport({ ratio: 1 })
    const lefts = await win.evaluate(() => {
      const card = document.querySelector('section.report[aria-label="BOM"]')!
      return [card.querySelector('.report-header')!, card.querySelector('table')!].map((e) => Math.round(e.getBoundingClientRect().left))
    })
    expect(Math.abs(lefts[0]! - lefts[1]!)).toBeLessThanOrEqual(1)
    // 넘치는 만큼은 보기 영역이 가로로 스크롤된다
    const overlay = win.locator('.report-overlay')
    const scroll = await overlay.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    if (scroll.sw > scroll.cw) {
      await overlay.evaluate((el) => el.scrollTo(el.scrollWidth, 0))
      await expect(win.locator('section.report[aria-label="BOM"] th').last()).toBeInViewport()
    }
    await win.screenshot({ path: 'test-results/report-layout-bom.png' })

    await win.getByRole('button', { name: /^결선표 \(/ }).click()
    const netlist = win.locator('section.report').first()
    await expect(netlist.locator('table')).toBeVisible()
    const label = await netlist.getAttribute('aria-label')
    expect(await room(win, label!)).toBeGreaterThanOrEqual(0)

    // 앱 전체도 가로로 넘치지 않는다 (좁으면 도구 막대가 두 줄로), 영어는 글이 더 길다
    const pageOverflow = () => win.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(await pageOverflow()).toBeLessThanOrEqual(0)
    await win.getByRole('button', { name: 'EN', exact: true }).click()
    await expect(win.getByRole('button', { name: /^Netlist \(/ })).toBeVisible()
    expect(await pageOverflow()).toBeLessThanOrEqual(0)
    await win.screenshot({ path: 'test-results/report-layout-en.png' })
    await win.getByRole('button', { name: '한', exact: true }).click()

    // 부품 작업실도 (도구 막대가 길다)
    await win.getByRole('button', { name: '홈', exact: true }).click()
    await win.locator('.home').getByRole('button', { name: /부품 만들기/ }).click()
    await expect(win.getByTestId('studio-target')).toBeVisible()
    expect(await pageOverflow()).toBeLessThanOrEqual(0)
  } finally {
    await app.close()
  }
})
