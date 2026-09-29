// README 스크린샷 만들기: npm run screenshots → images/*.png (동작 GIF는 demo.spec.ts)
// 예시 부품 그림(scripts/readme/parts/*.svg, 직접 그림)으로 작은 로봇 배선도를 만들고, 실제 앱을 띄워 찍는다.
// 화면이 바뀌면 다시 돌리면 된다.
import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { OUT, openDemo, selectBoard, shot, type Lang } from './common'

/** 두 언어 모두 같은 장면을 찍는다. 파일 이름은 영어만 -en이 붙는다 */
async function shootAll(lang: Lang) {
  mkdirSync(OUT, { recursive: true })
  const suffix = lang === 'en' ? '-en' : ''
  const ui = lang === 'en'
    ? {
        netlist: /^Netlist \(/, diagram: /^Diagram$/, edit: 'Edit', cancel: 'Cancel', netlistView: 'Netlist view', labels: 'Connection labels', table: 'Table', collapseLeft: 'Collapse parts bin', expandLeft: 'Expand parts bin',
        views: 'View', schematic: 'Schematic', home: 'Home', makePart: /Make a Part/, partEdit: 'Edit part', draw: '✏ Drawing', symbol: '⎍ Symbol'
      }
    : {
        netlist: /^결선표 \(/, diagram: /^배선도$/, edit: '편집', cancel: '취소', netlistView: '결선표 보기', labels: '연결 라벨', table: '표', collapseLeft: '부품함 접기', expandLeft: '부품함 펼치기',
        views: '보기', schematic: '회로도', home: '홈', makePart: /부품 만들기/, partEdit: '부품 편집', draw: '✏ 그림', symbol: '⎍ 기호'
      }
  const { app, win } = await openDemo(lang)
  try {
    // 1. 대표 화면: 전체 보기 + 제어 보드 선택(오른쪽에 스펙)
    await selectBoard(win)
    await shot(win, `main${suffix}`)

    // 2. 전선 선택: 규격·메모
    await win.keyboard.press('Escape')
    const path = (await win.evaluate(() => window.__opbCanvas!.wirePathClient('w1')))!
    const [a, b] = [path[0], path[1]]
    await win.mouse.click((a.x + b.x) / 2, (a.y + b.y) / 2)
    await shot(win, `wire${suffix}`)
    await win.keyboard.press('Escape')

    // 3. BOM, 4. 결선표
    await win.getByRole('button', { name: /^BOM \(/ }).click()
    await shot(win, `bom${suffix}`)
    await win.getByRole('button', { name: ui.netlist }).click()
    await shot(win, `netlist${suffix}`)
    // 4-1. 결선표 연결 라벨: 제어 보드 IO4 → 드라이버 IN1 라벨을 골라 짝 라벨과 오른쪽 전선 정보를 보인다
    await win.getByRole('group', { name: ui.netlistView }).getByRole('button', { name: ui.labels }).click()
    // 부품함을 접어 넓힌 화면(카드 두 개씩)으로
    await win.getByRole('button', { name: ui.collapseLeft }).click()
    await win.getByTestId('connection-labels').locator('.conn-flag').filter({ hasText: 'IO4' }).first().click()
    await win.waitForTimeout(600) // 짝 카드로 부드럽게 옮겨 가는 스크롤이 끝난 뒤 맨 위로
    await win.evaluate(() => document.querySelector('.report-overlay')!.scrollTo(0, 0))
    await shot(win, `labels${suffix}`)
    // 4-2. 연결 간이 창: 제어 보드(왼쪽)와 이어진 모터 드라이버(오른쪽)
    await win.keyboard.press('Escape')
    await win.getByTestId('connection-labels').locator('[data-card="mcu"] .conn-photo img').click()
    await win.locator('.conn-popup-pane.right .conn-thumb').filter({ hasText: 'MD-2A' }).click()
    await shot(win, `labels-popup${suffix}`)
    await win.keyboard.press('Escape')
    await win.getByRole('button', { name: ui.expandLeft }).click()
    await win.getByRole('group', { name: ui.netlistView }).getByRole('button', { name: ui.table, exact: true }).click()
    await win.keyboard.press('Escape')
    await win.getByRole('button', { name: ui.diagram }).click()

    // 5. 부품 편집기: 사진 위에 핀 찍기
    await win.getByTestId('part-list').locator('.part-item').filter({ hasText: 'MD-2A' }).getByRole('button', { name: ui.edit }).click()
    await expect(win.getByRole('dialog')).toBeVisible()
    await shot(win, `part-editor${suffix}`)
    await win.getByRole('dialog').getByRole('button', { name: ui.cancel }).click()

    // 6. 회로도 (039): 같은 부품·연결을 기호로
    await win.getByRole('navigation', { name: ui.views }).getByRole('button', { name: ui.schematic, exact: true }).click()
    await expect(win.getByTestId('schematic-canvas')).toBeVisible()
    await win.keyboard.press('Home')
    await shot(win, `schematic${suffix}`)
    await win.getByRole('navigation', { name: ui.views }).getByRole('button', { name: ui.diagram }).click()

    // 7. 홈 (036), 8. 부품 작업실 (037): 그림판·회로도 기호
    await win.getByRole('button', { name: ui.home, exact: true }).click()
    await expect(win.locator('.home')).toBeVisible()
    // 최근 목록의 폴더는 이 PC의 임시 폴더(사용자 이름 포함) → 예시 경로로 보이게
    await win.evaluate(() => document.querySelectorAll('.home-recent .menu-path').forEach((e) => (e.textContent = 'D:\\Projects\\Robot')))
    await shot(win, `home${suffix}`)
    await win.locator('.home').getByRole('button', { name: ui.makePart }).click()
    await win.getByTestId('studio-part-list').getByText('MD-2A').first().click()
    const editor = win.getByRole('region', { name: ui.partEdit })
    await editor.getByRole('tab', { name: ui.draw }).click()
    await shot(win, `studio${suffix}`)
    await editor.getByRole('tab', { name: ui.symbol }).click()
    await shot(win, `symbol${suffix}`)
  } finally {
    await app.close()
  }
}

test('README 스크린샷 (한국어)', () => shootAll('ko'))
test('README 스크린샷 (영어)', () => shootAll('en'))
