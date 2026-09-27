import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { buildTwoPartDiagram, getProject, launchApp, makeTempDir, makeUserDataDir, nextFrame, seedLibrary, stubDialogs } from './launch'

/** 자동 저장 간격을 줄여서 실행 (기본 1분) */
const FAST = { env: { OPB_AUTOSAVE_MS: '300' } }
const recoveryFiles = (userData: string) => {
  const dir = join(userData, 'recovery')
  return existsSync(dir) ? readdirSync(dir).sort() : []
}
/** 강제 종료 (정전·충돌처럼 창 닫기 과정 없이). 화면·GPU 프로세스까지 모두 */
async function kill(app: ElectronApplication) {
  const proc = app.process()
  const exited = new Promise((r) => proc.once('exit', r))
  execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'])
  await exited
}

test('자동 저장: 강제 종료 → 다시 실행하면 복구 → 원래 파일에 저장, 정상 종료면 묻지 않음', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  const out = makeTempDir('opb-recovery-')
  const file = join(out, 'board.opb')

  // 1. 저장한 뒤 더 고치고, 자동 저장 사본이 생기면 강제 종료
  let { app, win } = await launchApp(userData, FAST)
  await buildTwoPartDiagram(win)
  await stubDialogs(app, { save: file })
  await win.keyboard.press('Control+s')
  await expect(win.getByRole('status')).toContainText('저장했습니다: board')
  const savedText = readFileSync(file, 'utf8')
  await win.keyboard.press('Control+a')
  await win.keyboard.press('r') // 모두 회전 → 저장 안 된 변경
  await expect(win.getByTestId('doc-name')).toContainText('*')
  const edited = await getProject(win)
  await expect.poll(() => recoveryFiles(userData).length).toBe(2) // .opb + .json
  expect(readFileSync(file, 'utf8')).toBe(savedText) // 원래 파일은 그대로
  await kill(app)

  // 2. 다시 실행 → 복구 대화상자 → 복구: 고친 상태, 저장 안 됨, 원래 경로
  ;({ app, win } = await launchApp(userData, FAST))
  try {
    const dialog = win.getByRole('dialog', { name: '작업 복구' })
    await expect(dialog).toContainText('board')
    await expect(dialog).toContainText(file)
    await win.screenshot({ path: 'test-results/recovery-dialog.png' })
    await dialog.getByRole('button', { name: '복구', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(win.getByTestId('doc-name')).toHaveText('board *')
    expect((await getProject(win)).instances).toEqual(edited.instances)
    // 옛 사본은 이번 실행의 사본으로 옮겨졌다
    await expect.poll(() => recoveryFiles(userData).length).toBe(2)

    // Ctrl+S는 대화상자 없이 원래 파일에 저장 (다른 경로를 고르게 해 둬도 쓰이지 않음)
    const other = join(out, 'other.opb')
    await stubDialogs(app, { save: other })
    await win.keyboard.press('Control+s')
    await expect(win.getByRole('status')).toContainText('저장했습니다: board')
    expect(existsSync(other)).toBe(false)
    expect(JSON.parse(readFileSync(file, 'utf8')).instances).toEqual(edited.instances)
    await expect.poll(() => recoveryFiles(userData)).toEqual([]) // 저장하면 사본은 지운다

    // 3. 다시 고친 뒤 "저장 안 함"으로 정상 종료 → 사본 지움
    await win.keyboard.press('Control+a')
    await win.keyboard.press('r')
    await expect.poll(() => recoveryFiles(userData).length).toBe(2)
  } finally {
    await app.close() // 닫기 확인은 "저장 안 함"으로 응답
  }
  expect(recoveryFiles(userData)).toEqual([])
  ;({ app, win } = await launchApp(userData, FAST))
  try {
    await expect(win.getByText('테스트 MCU').first()).toBeVisible()
    await nextFrame(win)
    await expect(win.getByRole('dialog', { name: '작업 복구' })).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('새 배선도 복구 → 버리기', async () => {
  const userData = makeUserDataDir()
  seedLibrary(userData)
  let { app, win } = await launchApp(userData, FAST)
  await buildTwoPartDiagram(win)
  await expect.poll(() => recoveryFiles(userData).length).toBe(2)
  await kill(app)
  ;({ app, win } = await launchApp(userData, FAST))
  try {
    const dialog = win.getByRole('dialog', { name: '작업 복구' })
    await expect(dialog).toContainText('저장한 적 없는 새 배선도')
    await dialog.getByRole('button', { name: '버리기' }).click()
    await expect(dialog).toHaveCount(0)
    expect(recoveryFiles(userData)).toEqual([])
    expect((await getProject(win)).instances).toHaveLength(0)
  } finally {
    await app.close()
  }
})
