import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { appCommand, buildTwoPartDiagram, getProject, launchApp, makeTempDir, makeUserDataDir, seedLibrary, stubDialogs } from './launch'

/** 파일 메뉴의 최근 파일 목록 */
async function recentMenu(win: Page) {
  await win.getByText('파일 ▾').click()
  return win.getByRole('group', { name: '최근 파일' })
}

test('최근 파일: 저장·열기 순서, 없어진 파일은 표시 후 빼기, 목록 지우기', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const out = makeTempDir('opb-recent-')
  const a = join(out, 'alpha.opb')
  const b = join(out, 'beta.opb')
  const { app, win } = await launchApp(userData)
  try {
    let menu = await recentMenu(win)
    await expect(menu).toContainText('없음')
    await win.keyboard.press('Escape')
    await win.getByText('파일 ▾').click() // 메뉴 닫기

    await buildTwoPartDiagram(win)
    await stubDialogs(app, { save: a })
    await win.keyboard.press('Control+s')
    await expect(win.getByRole('status')).toContainText('저장했습니다: alpha')
    await stubDialogs(app, { save: b })
    await win.keyboard.press('Control+Shift+s')
    await expect(win.getByRole('status')).toContainText('저장했습니다: beta')

    // 최근 것부터, 폴더도 보인다
    menu = await recentMenu(win)
    await expect(menu.getByRole('menuitem')).toHaveText([/^beta/, /^alpha/, '목록 지우기'])
    await expect(menu.getByRole('menuitem').first()).toContainText(out)

    // 새로 만들기 → 최근 파일 alpha 열기
    await win.getByRole('menuitem', { name: '새로 만들기' }).click()
    expect((await getProject(win)).instances).toHaveLength(0)
    menu = await recentMenu(win)
    await menu.getByRole('menuitem', { name: /^alpha/ }).click()
    await expect(win.getByTestId('doc-name')).toHaveText('alpha')
    expect((await getProject(win)).instances).toHaveLength(2)
    menu = await recentMenu(win)
    await expect(menu.getByRole('menuitem')).toHaveText([/^alpha/, /^beta/, '목록 지우기'])
    // 항목마다 ✕(목록에서 빼기)
    await expect(win.getByRole('button', { name: '목록에서 빼기: beta' })).toBeAttached()

    // 지워진 파일: 흐리게 표시 → 누르면 알림과 함께 목록에서 빠짐
    rmSync(b)
    await win.getByText('파일 ▾').click()
    menu = await recentMenu(win)
    await expect(menu.getByRole('menuitem', { name: /^beta/ })).toHaveClass(/missing/)
    await win.screenshot({ path: 'test-results/recent-menu.png' })
    await menu.getByRole('menuitem', { name: /^beta/ }).click()
    await expect(win.getByRole('status')).toContainText('최근 목록에서 뺐습니다: beta')
    await expect(win.getByTestId('doc-name')).toHaveText('alpha')

    menu = await recentMenu(win)
    await menu.getByRole('menuitem', { name: '목록 지우기' }).click()
    menu = await recentMenu(win)
    await expect(menu).toContainText('없음')
  } finally {
    await app.close()
  }
})

test('파일 연결: .opb로 실행하면 그 파일이 열리고, 실행 중에 다른 파일을 열면 같은 창에서 연다', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const out = makeTempDir('opb-assoc-')
  const one = join(out, 'one.opb')
  const two = join(out, 'two.opb')
  // 파일 두 개 준비
  {
    const { app, win } = await launchApp(userData)
    await buildTwoPartDiagram(win)
    await stubDialogs(app, { save: one })
    await win.keyboard.press('Control+s')
    await expect(win.getByRole('status')).toContainText('저장했습니다: one')
    await stubDialogs(app, { save: two })
    await win.keyboard.press('Control+Shift+s')
    await expect(win.getByRole('status')).toContainText('저장했습니다: two')
    await app.close()
  }

  const { app, win } = await launchApp(userData, { args: [one] })
  try {
    await expect(win.getByTestId('doc-name')).toHaveText('one')
    expect((await getProject(win)).instances).toHaveLength(2)

    // 두 번째 실행(더블클릭)은 창을 새로 띄우지 않고 끝나며, 첫 창이 그 파일을 연다
    const cmd = appCommand([two])
    const second = spawn(cmd.command, cmd.args, { env: { ...process.env, OPB_USER_DATA: userData } })
    const code = await new Promise<number | null>((r) => second.once('exit', r))
    expect(code).toBe(0)
    await expect(win.getByTestId('doc-name')).toHaveText('two')
    expect(app.windows()).toHaveLength(1)
    // 파일 연결로 연 파일도 최근 파일에 들어간다
    const menu = await recentMenu(win)
    await expect(menu.getByRole('menuitem').first()).toContainText('two')
  } finally {
    await app.close()
  }
})
