// 렌더러 요청 처리. 채널 이름은 preload/index.ts와 짝을 이룬다.
// 렌더러는 신뢰하지 않는다: 인자 타입을 확인하고, 파일 형식(필터·확장자)은 main이 정한다.
import { BrowserWindow, dialog, ipcMain, shell, type FileFilter, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { basename } from 'node:path'
import { registerCloseGuardIpc } from './closeGuard'
import { libraryDir, recentFile, suppliesDir } from './paths'
import { grant, isGranted } from './grants'
import { addRecent } from './repositories/recent'
import { listParts, removePart, savePart } from './repositories/library'
import { BUNDLE_EXT, PROJECT_EXT, readProjectFile, writeExportFile, writeProjectFile } from './repositories/project'
import { renderPdf } from './pdf'
import { mt, registerLocaleIpc } from './locale'

/**
 * OS 대화상자가 닫힌 뒤 페이지에 키보드 포커스를 돌려준다. Windows에서 창은 앞에 있는데 입력칸에 글이 안 써지는 일이 있다
 * (창을 다른 데 눌렀다 오면 풀림 → 그것을 대신 한다). 사용자가 그새 다른 프로그램으로 갔으면 건드리지 않는다
 */
function refocus(win: BrowserWindow): void {
  if (win.isDestroyed() || !win.isFocused()) return
  win.blur()
  win.focus()
  win.webContents.focus()
}

function assertString(v: unknown, name: string): asserts v is string {
  if (typeof v !== 'string') throw new Error(`${name}: 문자열이어야 합니다`)
}

const projectFilter = () => ({ name: mt('Open Perfboard 배선도'), extensions: [PROJECT_EXT.slice(1)] })
/** 여러 배선도 묶음 (.zip, 030) */
const bundleFilter = () => ({ name: mt('Open Perfboard 배선도 묶음'), extensions: [BUNDLE_EXT.slice(1)] })
/** 열기: .opb와 .zip 둘 다 */
const openFilter = () => ({ name: mt('Open Perfboard 배선도 (.opb, .zip)'), extensions: [PROJECT_EXT.slice(1), BUNDLE_EXT.slice(1)] })

type ExportKind = 'csv' | 'xlsx' | 'png' | 'opblib' | 'kicad_sch'
/** 필터 이름은 원문(한국어), 대화상자를 띄울 때 번역 */
const EXPORT_KINDS: Record<ExportKind, { ext: string; filter: FileFilter }> = {
  csv: { ext: '.csv', filter: { name: 'CSV (Excel)', extensions: ['csv'] } },
  xlsx: { ext: '.xlsx', filter: { name: 'Excel 통합 문서', extensions: ['xlsx'] } },
  png: { ext: '.png', filter: { name: 'PNG 이미지', extensions: ['png'] } },
  opblib: { ext: '.opblib', filter: { name: 'Open Perfboard 부품 라이브러리', extensions: ['opblib'] } },
  kicad_sch: { ext: '.kicad_sch', filter: { name: 'KiCad 회로도', extensions: ['kicad_sch'] } }
}

const windowOf = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender) ?? undefined

/** 파일 이름으로 쓸 수 없는 문자를 바꾼다 */
const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || mt('배선도')

export function registerIpc(): void {
  // ---- 부품 라이브러리
  ipcMain.handle('library:list', () => listParts(libraryDir()))

  ipcMain.handle('library:save', (_e, id: unknown, content: unknown) => {
    assertString(id, 'id')
    assertString(content, 'content')
    return savePart(libraryDir(), id, content)
  })

  ipcMain.handle('library:remove', (_e, id: unknown) => {
    assertString(id, 'id')
    return removePart(libraryDir(), id)
  })

  // ---- 부속 부품 (027): 부품과 같은 저장 규칙, 폴더만 다르다
  ipcMain.handle('supplies:list', () => listParts(suppliesDir()))

  ipcMain.handle('supplies:save', (_e, id: unknown, content: unknown) => {
    assertString(id, 'id')
    assertString(content, 'content')
    return savePart(suppliesDir(), id, content)
  })

  ipcMain.handle('supplies:remove', (_e, id: unknown) => {
    assertString(id, 'id')
    return removePart(suppliesDir(), id)
  })

  /** 부품 가져오기: 여러 파일을 골라 내용을 돌려준다 (해석·검증은 렌더러의 core) */
  ipcMain.handle('library:pick-files', async (e) => {
    const win = windowOf(e)
    const opts = {
      title: mt('부품 가져오기'),
      filters: [
        { name: mt('부품함, 부품, 배선도'), extensions: ['opblib', 'json', PROJECT_EXT.slice(1)] },
        { name: mt('모든 파일'), extensions: ['*'] }
      ],
      properties: ['openFile' as const, 'multiSelections' as const]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled) return []
    return Promise.all(
      r.filePaths.map(async (p) => {
        const content = await readProjectFile(p)
        // 부품 가져오기는 글자 파일만 (묶음 .zip은 배선도 열기로)
        return { name: basename(p), content: typeof content === 'string' ? content : '' }
      })
    )
  })

  // ---- 프로젝트 파일
  ipcMain.handle('project:open', async (e) => {
    const win = windowOf(e)
    const opts = { title: mt('배선도 열기'), filters: [openFilter(), projectFilter(), bundleFilter()], properties: ['openFile' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const path = grant(r.filePaths[0])
    const content = await readProjectFile(path)
    await addRecent(recentFile(), path)
    return { path, content }
  })

  /** path가 null이면 "다른 이름으로 저장" 대화상자를 띄운다. 취소하면 null */
  /** content: 문자열 = .opb (배선도 하나), 바이트 = .zip (여러 배선도 묶음) */
  ipcMain.handle('project:save', async (e, path: unknown, content: unknown, suggestedName: unknown) => {
    if (typeof content !== 'string' && !(content instanceof Uint8Array)) throw new Error('content: 문자열 또는 바이트')
    const bundle = typeof content !== 'string'
    let target: string
    if (path === null) {
      assertString(suggestedName, 'suggestedName')
      const win = windowOf(e)
      const opts = {
        title: mt('배선도 저장'),
        defaultPath: `${safeFileName(suggestedName)}${bundle ? BUNDLE_EXT : PROJECT_EXT}`,
        filters: [bundle ? bundleFilter() : projectFilter()]
      }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return null
      target = r.filePath
    } else {
      assertString(path, 'path')
      if (!isGranted(path)) throw new Error('대화상자에서 고르지 않은 경로에는 저장할 수 없습니다')
      target = path
    }
    const saved = grant(await writeProjectFile(target, content))
    await addRecent(recentFile(), saved)
    return saved
  })

  // ---- 부품함 파일 (.opblib)을 문서처럼 열고 저장 (037a 부품 작업실)
  ipcMain.handle('libfile:open', async (e) => {
    const win = windowOf(e)
    const opts = {
      title: mt('부품함 파일 열기'),
      filters: [
        { name: mt('부품함, 부품, 배선도'), extensions: ['opblib', 'json', PROJECT_EXT.slice(1)] },
        { name: mt('모든 파일'), extensions: ['*'] }
      ],
      properties: ['openFile' as const]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const path = r.filePaths[0]
    const content = await readProjectFile(path)
    if (typeof content !== 'string') throw new Error(mt('부품함 파일이 아닙니다'))
    // 다시 저장할 수 있는 것은 .opblib뿐 (.json·.opb는 다른 이름으로 저장)
    if (path.toLowerCase().endsWith('.opblib')) grant(path)
    return { path, content }
  })

  /** path가 null이거나 허락받지 않은 경로면 저장 대화상자. 저장된 경로, 취소하면 null */
  ipcMain.handle('libfile:save', async (e, path: unknown, content: unknown, suggestedName: unknown) => {
    assertString(content, 'content')
    let target: string
    if (typeof path === 'string' && isGranted(path)) target = path
    else {
      assertString(suggestedName, 'suggestedName')
      const { ext, filter } = EXPORT_KINDS.opblib
      const win = windowOf(e)
      const opts = { title: mt('부품함 파일 저장'), defaultPath: `${safeFileName(suggestedName)}${ext}`, filters: [{ ...filter, name: mt(filter.name) }] }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return null
      target = r.filePath
    }
    return grant(await writeExportFile(target, content, EXPORT_KINDS.opblib.ext))
  })

  // ---- 내보내기
  ipcMain.handle('export:save', async (e, kind: unknown, suggestedName: unknown, data: unknown) => {
    if (typeof kind !== 'string' || !Object.hasOwn(EXPORT_KINDS, kind)) throw new Error('kind: csv, xlsx, png, opblib, kicad_sch')
    assertString(suggestedName, 'suggestedName')
    if (typeof data !== 'string' && !(data instanceof Uint8Array)) throw new Error('data: 문자열 또는 바이트')
    const { ext, filter } = EXPORT_KINDS[kind as ExportKind]
    const win = windowOf(e)
    const opts = { title: mt('내보내기'), defaultPath: `${safeFileName(suggestedName)}${ext}`, filters: [{ ...filter, name: mt(filter.name) }] }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    return writeExportFile(r.filePath, data, ext)
  })

  /** 보고서 HTML → PDF. 저장 위치를 먼저 묻고(취소하면 생성하지 않음) 숨은 창에서 인쇄한다 */
  ipcMain.handle('export:pdf', async (e, html: unknown, opts: unknown, suggestedName: unknown) => {
    assertString(html, 'html')
    assertString(suggestedName, 'suggestedName')
    const o = opts as { pageSize?: unknown; landscape?: unknown } | null
    if (!o || (o.pageSize !== 'A4' && o.pageSize !== 'A3') || typeof o.landscape !== 'boolean') {
      throw new Error('opts: { pageSize: A4|A3, landscape: boolean }')
    }
    const win = windowOf(e)
    const dlg = { title: mt('PDF 내보내기'), defaultPath: `${safeFileName(suggestedName)}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
    const r = win ? await dialog.showSaveDialog(win, dlg) : await dialog.showSaveDialog(dlg)
    if (r.canceled || !r.filePath) return null
    const pdf = await renderPdf(html, { pageSize: o.pageSize, landscape: o.landscape })
    return writeExportFile(r.filePath, pdf, '.pdf')
  })

  // ---- 외부 링크 (구매 링크). http/https만 기본 브라우저로 연다
  ipcMain.handle('shell:open-external', async (_e, url: unknown) => {
    assertString(url, 'url')
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('http/https 주소만 열 수 있습니다')
    await shell.openExternal(u.toString())
  })

  // ---- 확인·알림 창 (렌더러의 window.confirm/alert 대신, main.tsx에서 바꿔 끼운다)
  // Windows에서 렌더러의 confirm/alert가 닫힌 뒤 입력칸에 글이 안 써지는 일이 있다 (창을 다른 데 눌렀다 오기 전까지).
  // main의 메시지 상자로 띄우고, 닫히면 페이지에 포커스를 돌려준다. 렌더러가 답을 기다리도록 sendSync
  const messageBox = async (e: IpcMainEvent, message: unknown, confirm: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = {
      type: confirm ? ('question' as const) : ('info' as const),
      buttons: confirm ? [mt('확인'), mt('취소')] : [mt('확인')],
      defaultId: 0,
      cancelId: confirm ? 1 : 0,
      noLink: true,
      title: 'Open Perfboard',
      message: typeof message === 'string' ? message : String(message)
    }
    try {
      const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      e.returnValue = confirm ? response === 0 : undefined
    } catch {
      e.returnValue = confirm ? false : undefined
    } finally {
      if (win) refocus(win)
    }
  }
  ipcMain.on('dialog:confirm', (e, message: unknown) => void messageBox(e, message, true))
  ipcMain.on('dialog:alert', (e, message: unknown) => void messageBox(e, message, false))
  // 렌더러가 연 OS 대화상자(파일 고르기·색 고르기)가 닫힌 뒤: 같은 이유로 페이지에 포커스를 돌려준다
  ipcMain.on('window:refocus', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) refocus(win)
  })

  registerCloseGuardIpc()
  registerLocaleIpc()
}
