import { expect, test, type Page } from '@playwright/test'
import { buildTwoPartDiagram, getProject, launchApp, makeUserDataDir, nextFrame, seedLibrary } from './launch'

const toClient = (win: Page, p: { x: number; y: number }) => win.evaluate((q) => window.__opbCanvas!.worldToClient(q), p)

async function drag(win: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(from.x + dx, from.y + dy, { steps: 8 })
  await win.mouse.up()
}

test('글 상자·격자 맞춤·찾기: 만들기 → 고치기 → 옮기기 → 격자 → 다른 배선도에서 찾아가기 → 비우면 삭제', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const { app, win } = await launchApp(userData)
  try {
    await buildTwoPartDiagram(win)

    // 1. 글 상자: 화면 가운데에 생기고 바로 입력
    await win.getByRole('button', { name: 'T 글 상자' }).click()
    const editor = win.getByLabel('글 상자 글').first()
    await expect(editor).toBeFocused()
    await editor.fill('전원을 먼저 연결\n그다음 신호선')
    await editor.press('Control+Enter')
    let p = await getProject(win)
    expect(p.notes).toHaveLength(1)
    expect(p.notes![0].text).toBe('전원을 먼저 연결\n그다음 신호선')
    const props = win.getByTestId('props-note')
    await expect(props).toBeVisible()
    await props.getByLabel('글자 크기').selectOption('20')
    expect((await getProject(win)).notes![0].fontSize).toBe(20)

    // 2. 끌어 옮기기 (격자 맞춤 꺼짐 → 끈 만큼)
    const n0 = (await getProject(win)).notes![0]
    await nextFrame(win)
    await drag(win, await toClient(win, { x: n0.x + 20, y: n0.y + 12 }), 73, 41)
    p = await getProject(win)
    expect(p.notes![0].x - n0.x).toBeCloseTo(73, 0)
    await win.screenshot({ path: 'test-results/notes.png' })

    // 3. 격자 맞춤 켜기 (간격 20) → 부품을 끌면 중심이 격자점에
    await win.getByRole('group', { name: '격자 맞춤' }).getByRole('button').click()
    await expect(win.getByLabel('격자 간격')).toHaveValue('20')
    const u1 = p.instances[0]
    await drag(win, await toClient(win, { x: u1.x, y: u1.y + 60 }), 37, 23)
    p = await getProject(win)
    expect(Math.abs(p.instances[0].x % 20)).toBe(0)
    expect(Math.abs(p.instances[0].y % 20)).toBe(0)
    expect(p.instances[0].x).not.toBe(u1.x)
    await win.keyboard.press('Control+z')
    expect((await getProject(win)).instances[0].x).toBe(u1.x)

    // 4. 찾기: 다른 배선도에 있어도 그 배선도로 가서 고른다
    await win.getByTestId('sheet-tabs').getByRole('button', { name: '새 배선도 추가' }).click()
    expect((await getProject(win)).instances).toHaveLength(0)
    await win.keyboard.press('Control+f')
    const search = win.getByRole('search')
    await search.getByLabel('찾기').fill('gnd')
    const results = search.getByRole('option')
    await expect(results.first()).toContainText('U1.J1.2 GND')
    await expect(results.first()).toContainText('배선도 1')
    await win.screenshot({ path: 'test-results/search.png' })
    await search.getByLabel('찾기').press('Enter')
    await expect(search).toBeHidden()
    await expect(win.getByTestId('sheet-tabs').getByRole('tab', { name: '배선도 1' })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => win.evaluate(() => window.__opbCanvas!.getSelection().instances.length)).toBe(1)
    await win.keyboard.press('Control+f')
    await search.getByLabel('찾기').fill('먼저')
    await expect(results.first()).toContainText('전원을 먼저 연결')
    await search.getByLabel('찾기').press('Escape')
    await expect(search).toBeHidden()

    // 5. 두 번 눌러 고치기 → 글을 다 지우면 글 상자도 지운다
    const n1 = (await getProject(win)).notes![0]
    await win.getByRole('group', { name: '격자 맞춤' }).getByRole('button').click() // 격자 끄기
    const at = await toClient(win, { x: n1.x + 20, y: n1.y + 12 })
    await win.mouse.dblclick(at.x, at.y)
    await expect(editor).toBeFocused()
    await editor.fill('')
    await editor.press('Control+Enter')
    expect((await getProject(win)).notes).toBeUndefined()
    await win.keyboard.press('Control+z')
    expect((await getProject(win)).notes).toHaveLength(1)
  } finally {
    await app.close()
  }
})
