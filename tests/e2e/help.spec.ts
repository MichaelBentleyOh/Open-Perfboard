import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, makeUserDataDir, seedLibrary } from './launch'

test('? 버튼·?·F1로 단축키 도움말, 목록은 실제 단축키와 같고 영어로도 나온다', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    const dialog = win.getByRole('dialog', { name: '단축키 도움말' })

    // 1. "저장" 옆 ? 버튼 → 도움말: 새 키(V, W, F, Shift+F, Home)와 마우스 조작
    const header = win.locator('header')
    await header.getByRole('button', { name: '단축키 도움말' }).click()
    await expect(dialog).toBeVisible()
    for (const k of ['V', 'W', 'F', 'Shift+F', 'Home', 'Ctrl+Shift+S', 'Num +']) {
      await expect(dialog.locator('kbd', { hasText: new RegExp(`^${k.replaceAll('+', '\\+')}$`) }).first()).toBeVisible()
    }
    await expect(dialog).toContainText('좌우 반전')
    await expect(dialog).toContainText('전체 보기')
    await expect(dialog).toContainText('Space+드래그')
    // 앱 버전 (package.json)
    const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { version: string }
    await expect(dialog).toContainText(`Open Perfboard v${version}`)
    // 옛 키는 보이지 않는다
    await expect(dialog.locator('kbd', { hasText: /^Ctrl\+9$/ })).toHaveCount(0)
    await win.screenshot({ path: 'test-results/help-ko.png' })

    // 2. Esc로 닫고, 도움말이 열려 있는 동안 캔버스 단축키는 동작하지 않는다
    await win.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // 3. ? 키 / F1 키로 열고 닫기
    await win.getByTestId('diagram-canvas').click({ position: { x: 5, y: 5 } })
    await win.keyboard.press('Shift+?')
    await expect(dialog).toBeVisible()
    await win.keyboard.press('w') // 열려 있는 동안은 무시
    await win.keyboard.press('F1')
    await expect(dialog).toHaveCount(0)
    const modes = win.getByRole('group', { name: '모드' })
    await expect(modes.getByRole('button', { name: '↖ 선택' })).toHaveAttribute('aria-pressed', 'true')
    await win.keyboard.press('F1')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '닫기' }).click()
    await expect(dialog).toHaveCount(0)

    // 4. 새 모드 키: W = 배선, V = 선택
    await win.keyboard.press('w')
    await expect(modes.getByRole('button', { name: '✎ 배선' })).toHaveAttribute('aria-pressed', 'true')
    await win.keyboard.press('w') // 토글이 아니라 배선 모드 유지
    await expect(modes.getByRole('button', { name: '✎ 배선' })).toHaveAttribute('aria-pressed', 'true')
    await win.keyboard.press('v')
    await expect(modes.getByRole('button', { name: '↖ 선택' })).toHaveAttribute('aria-pressed', 'true')

    // 5. 영어 모드에서는 영어로
    await win.getByRole('button', { name: 'EN' }).click()
    await header.getByRole('button', { name: 'Keyboard shortcuts' }).click()
    const en = win.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(en).toContainText('Flip horizontally')
    await expect(en).toContainText('Fit all')
    await expect(en).toContainText('Middle-button drag')
    await win.screenshot({ path: 'test-results/help-en.png' })
    await win.keyboard.press('Escape')
    await win.getByRole('button', { name: '한' }).click()
  } finally {
    await app.close()
  }
})
