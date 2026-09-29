import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { buildTwoPartDiagram, enterDiagram, launchApp, makeTempDir, makeUserDataDir, seedLibrary, stubDialogs } from './launch'

test('시작 화면: 홈 두 버튼 → 배선도 → 홈으로 → 최근 배선도 열기 → 부품 작업실 → 영어', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const file = join(makeTempDir('opb-start-'), 'board.opb')
  const { app, win } = await launchApp(userData, { home: true })
  try {
    const home = win.locator('.home')
    await expect(home.getByRole('button', { name: /부품 만들기/ })).toBeVisible()
    await expect(home.getByRole('button', { name: /배선도 만들기/ })).toBeVisible()
    await expect(home.getByText('최근에 연 배선도가 없습니다')).toBeVisible()
    await expect(home.locator('.home-version')).toContainText('v')
    await win.screenshot({ path: 'test-results/home.png' })

    // 배선도 만들기 → 그리고 저장 → 툴바 로고로 홈
    await enterDiagram(win)
    await buildTwoPartDiagram(win)
    await stubDialogs(app, { save: file })
    await win.keyboard.press('Control+s')
    await expect(win.getByRole('status')).toContainText('저장했습니다: board')
    await win.getByRole('button', { name: '홈', exact: true }).click()
    await expect(home.getByRole('button', { name: /배선도 만들기/ })).toContainText('이어서: board')
    const recent = home.getByRole('region', { name: '최근 배선도' })
    await expect(recent.getByRole('button', { name: /^board/ })).toBeVisible()

    // 최근 배선도를 누르면 그 배선도 화면으로 (하던 작업 그대로)
    await recent.getByRole('button', { name: /^board/ }).click()
    await expect(win.getByTestId('doc-name')).toHaveText('board')
    await expect(win.getByText('테스트 MCU').first()).toBeVisible()

    // 부품 만들기 → 부품 작업실, 로고로 홈
    await win.getByRole('button', { name: '홈', exact: true }).click()
    await home.getByRole('button', { name: /부품 만들기/ }).click()
    await expect(win.getByTestId('studio-target')).toHaveText('내 부품함')
    await win.getByRole('button', { name: '홈', exact: true }).click()
    await expect(home).toBeVisible()

    // 영어
    await home.getByRole('button', { name: 'EN' }).click()
    await expect(home.getByRole('button', { name: /Make a Part/ })).toBeVisible()
    await expect(home.getByRole('button', { name: /Make a Diagram/ })).toContainText('Continue: board')
    await expect(home.getByRole('region', { name: 'Recent diagrams' })).toBeVisible()
    await win.screenshot({ path: 'test-results/home-en.png' })
    await home.getByRole('button', { name: '한' }).click()
  } finally {
    await app.close()
  }

  // .opb를 인자로 켜면(파일 더블클릭) 홈을 건너뛰고 바로 그 배선도
  const second = await launchApp(userData, { args: [file], home: true })
  try {
    const win = second.win
    await expect(win.getByTestId('doc-name')).toHaveText('board')
    await expect(win.locator('.home')).toHaveCount(0)

    // 다른 이름으로 저장 → 최근 목록 2개 → 하나 빼기(파일은 그대로) → 목록 지우기
    const file2 = join(makeTempDir('opb-start-'), 'board2.opb')
    await stubDialogs(second.app, { save: file2 })
    await win.keyboard.press('Control+Shift+s')
    await expect(win.getByTestId('doc-name')).toHaveText('board2')
    // 파일 메뉴의 최근 파일에도 ✕
    await win.getByText('파일 ▾').click()
    await expect(win.getByRole('button', { name: '목록에서 빼기: board2' })).toBeAttached()
    await win.getByText('파일 ▾').click()
    await win.getByRole('button', { name: '홈', exact: true }).click()
    const recent = win.locator('.home').getByRole('region', { name: '최근 배선도' })
    await expect(recent.getByRole('listitem')).toHaveCount(2)
    await recent.getByRole('button', { name: '목록에서 빼기: board', exact: true }).click()
    await expect(recent.getByRole('listitem')).toHaveCount(1)
    await expect(recent.getByRole('button', { name: /^board2/ })).toBeVisible()
    expect(existsSync(file)).toBe(true)
    await recent.getByRole('button', { name: '목록 지우기' }).click()
    await expect(recent.getByText('최근에 연 배선도가 없습니다')).toBeVisible()
    expect(existsSync(file2)).toBe(true)
  } finally {
    await second.app.close()
  }
})
