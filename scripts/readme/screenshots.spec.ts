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
    ? { netlist: /^Netlist \(/, diagram: /^Diagram$/, edit: 'Edit', cancel: 'Cancel' }
    : { netlist: /^결선표 \(/, diagram: /^배선도$/, edit: '편집', cancel: '취소' }
  const { app, win } = await openDemo(lang)
  try {
    // 1. 대표 화면: 전체 보기 + 제어 보드 선택(오른쪽에 스펙)
    await selectBoard(win)
    await shot(win, `main${suffix}`)

    // 2. 전선 선택: 규격·길이
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
    await win.getByRole('button', { name: ui.diagram }).click()

    // 5. 부품 편집기: 사진 위에 핀 찍기
    await win.getByTestId('part-list').locator('.part-item').filter({ hasText: 'MD-2A' }).getByRole('button', { name: ui.edit }).click()
    await expect(win.getByRole('dialog')).toBeVisible()
    await shot(win, `part-editor${suffix}`)
    await win.getByRole('dialog').getByRole('button', { name: ui.cancel }).click()
  } finally {
    await app.close()
  }
}

test('README 스크린샷 (한국어)', () => shootAll('ko'))
test('README 스크린샷 (영어)', () => shootAll('en'))
