// 문서 세션: 자동 저장 복구 사본, 최근 파일, 파일 연결(.opb 더블클릭)로 열기, 앱 설정 값.
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain } from 'electron'
import { grant, isGranted } from './grants'
import { mt } from './locale'
import { recentFile, recoveryDir } from './paths'
import { addRecent, clearRecent, isRecent, listRecent, removeRecent } from './repositories/recent'
import { BUNDLE_EXT, PROJECT_EXT, readProjectFile, type ProjectContent } from './repositories/project'
import { clearRecovery, clearRecoverySync, listRecovery, readRecovery, RECOVERY_ID, writeRecovery } from './repositories/recovery'

/** 이번 실행의 복구 사본 id */
const SESSION_ID = randomUUID().replace(/-/g, '')
/** 기본 자동 저장 간격. E2E는 OPB_AUTOSAVE_MS로 줄인다 */
const AUTOSAVE_MS = Number(process.env['OPB_AUTOSAVE_MS']) || 60_000

export type OpenFilePayload = { path: string; content: ProjectContent } | { path: string; error: string }

function assertString(v: unknown, name: string): asserts v is string {
  if (typeof v !== 'string') throw new Error(`${name}: 문자열이어야 합니다`)
}

/**
 * 명령줄 인자 중 배선도 파일 (파일 연결로 실행하면 경로가 인자로 온다).
 * Linux 파일 관리자는 바탕화면 항목의 %U로 file:// 주소를 넘기기도 하므로 경로로 바꾼다
 */
export function projectArg(argv: readonly string[]): string | undefined {
  const arg = [...argv].reverse().find((a) => !a.startsWith('-') && [PROJECT_EXT, BUNDLE_EXT].some((ext) => a.toLowerCase().endsWith(ext)))
  if (!arg?.startsWith('file://')) return arg
  try {
    return fileURLToPath(arg)
  } catch {
    return undefined
  }
}

/** 사용자가 파일 연결·최근 파일로 연 경로: 권한을 주고 읽는다 */
async function openPath(path: string): Promise<OpenFilePayload> {
  try {
    const content = await readProjectFile(path)
    grant(path)
    await addRecent(recentFile(), path)
    return { path, content }
  } catch (e) {
    return { path, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 앱 시작 인자로 받은 파일. 렌더러가 준비되면 가져간다 */
let pendingOpen: string | undefined

export function setPendingOpen(path: string | undefined): void {
  pendingOpen = path
}

/** 이미 실행 중일 때 다시 더블클릭한 파일 → 그 창에 보낸다 */
export async function openInWindow(win: BrowserWindow, path: string): Promise<void> {
  if (win.isMinimized()) win.restore()
  win.focus()
  win.webContents.send('app:open-file', await openPath(path))
}

export function registerDocumentIpc(): void {
  ipcMain.handle('app:config', () => ({ version: app.getVersion(), autosaveMs: AUTOSAVE_MS }))

  ipcMain.handle('app:take-open-file', async () => {
    const path = pendingOpen
    pendingOpen = undefined
    return path ? openPath(path) : null
  })

  // ---- 최근 파일
  ipcMain.handle('recent:list', () => listRecent(recentFile()))
  ipcMain.handle('recent:open', async (_e, path: unknown) => {
    assertString(path, 'path')
    // 목록에 있는 경로만 (렌더러가 임의 파일을 읽지 못하게)
    if (!(await isRecent(recentFile(), path))) throw new Error(mt('최근 파일 목록에 없는 파일입니다'))
    return openPath(path)
  })
  ipcMain.handle('recent:remove', (_e, path: unknown) => {
    assertString(path, 'path')
    return removeRecent(recentFile(), path).then(() => undefined)
  })
  ipcMain.handle('recent:clear', () => clearRecent(recentFile()))

  // ---- 복구 사본
  ipcMain.handle('recovery:write', (_e, content: unknown, filePath: unknown, name: unknown) => {
    assertString(content, 'content')
    assertString(name, 'name')
    if (filePath !== null) assertString(filePath, 'filePath')
    // 원래 경로는 이번 실행에서 사용자가 연 경로일 때만 남긴다 (복구할 때 그 경로에 저장 권한을 주므로)
    const original = filePath !== null && isGranted(filePath) ? filePath : null
    return writeRecovery(recoveryDir(), SESSION_ID, content, { filePath: original, name, savedAt: Date.now() })
  })
  ipcMain.handle('recovery:clear', () => clearRecovery(recoveryDir(), SESSION_ID))
  ipcMain.handle('recovery:list', () => listRecovery(recoveryDir(), SESSION_ID))
  ipcMain.handle('recovery:take', async (_e, id: unknown) => {
    assertString(id, 'id')
    if (!RECOVERY_ID.test(id) || id === SESSION_ID) throw new Error('recovery id')
    const r = await readRecovery(recoveryDir(), id)
    if (r.meta.filePath) grant(r.meta.filePath)
    return r
  })
  ipcMain.handle('recovery:discard', (_e, id: unknown) => {
    assertString(id, 'id')
    if (id === SESSION_ID) throw new Error('recovery id')
    return clearRecovery(recoveryDir(), id)
  })
}

/**
 * 창이 정상적으로 닫히면(저장했든 "저장 안 함"이든) 이번 실행의 사본을 지운다.
 * 화면(렌더러)이 죽은 뒤에 닫힌 경우는 남겨 두어 다음 실행에서 복구할 수 있게 한다.
 */
export function installRecoveryCleanup(win: BrowserWindow): void {
  let crashed = false
  win.webContents.on('render-process-gone', () => {
    crashed = true
  })
  win.on('closed', () => {
    if (!crashed) clearRecoverySync(recoveryDir(), SESSION_ID)
  })
}
