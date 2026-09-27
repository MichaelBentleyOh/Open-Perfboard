// 렌더러 요청 처리. 채널 이름은 preload/index.ts와 짝을 이룬다.
// 렌더러는 신뢰하지 않는다: 인자 타입을 확인하고, 파일 형식(필터·확장자)은 main이 정한다.
import { BrowserWindow, dialog, ipcMain, shell, type FileFilter, type IpcMainInvokeEvent } from 'electron'
import { basename } from 'node:path'
import { registerCloseGuardIpc } from './closeGuard'
import { libraryDir, recentFile } from './paths'
import { grant, isGranted } from './grants'
import { addRecent } from './repositories/recent'
import { listParts, removePart, savePart } from './repositories/library'
import { PROJECT_EXT, readProjectFile, writeExportFile, writeProjectFile } from './repositories/project'
import { renderPdf } from './pdf'
import { mt, registerLocaleIpc } from './locale'

function assertString(v: unknown, name: string): asserts v is string {
  if (typeof v !== 'string') throw new Error(`${name}: 문자열이어야 합니다`)
}

const projectFilter = () => ({ name: mt('Open Perfboard 배선도'), extensions: [PROJECT_EXT.slice(1)] })

type ExportKind = 'csv' | 'xlsx' | 'png' | 'opblib'
/** 필터 이름은 원문(한국어), 대화상자를 띄울 때 번역 */
const EXPORT_KINDS: Record<ExportKind, { ext: string; filter: FileFilter }> = {
  csv: { ext: '.csv', filter: { name: 'CSV (Excel)', extensions: ['csv'] } },
  xlsx: { ext: '.xlsx', filter: { name: 'Excel 통합 문서', extensions: ['xlsx'] } },
  png: { ext: '.png', filter: { name: 'PNG 이미지', extensions: ['png'] } },
  opblib: { ext: '.opblib', filter: { name: 'Open Perfboard 부품 라이브러리', extensions: ['opblib'] } }
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
    return Promise.all(r.filePaths.map(async (p) => ({ name: basename(p), content: await readProjectFile(p) })))
  })

  // ---- 프로젝트 파일
  ipcMain.handle('project:open', async (e) => {
    const win = windowOf(e)
    const opts = { title: mt('배선도 열기'), filters: [projectFilter()], properties: ['openFile' as const] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const path = grant(r.filePaths[0])
    const content = await readProjectFile(path)
    await addRecent(recentFile(), path)
    return { path, content }
  })

  /** path가 null이면 "다른 이름으로 저장" 대화상자를 띄운다. 취소하면 null */
  ipcMain.handle('project:save', async (e, path: unknown, content: unknown, suggestedName: unknown) => {
    assertString(content, 'content')
    let target: string
    if (path === null) {
      assertString(suggestedName, 'suggestedName')
      const win = windowOf(e)
      const opts = { title: mt('배선도 저장'), defaultPath: `${safeFileName(suggestedName)}${PROJECT_EXT}`, filters: [projectFilter()] }
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

  // ---- 내보내기
  ipcMain.handle('export:save', async (e, kind: unknown, suggestedName: unknown, data: unknown) => {
    if (typeof kind !== 'string' || !Object.hasOwn(EXPORT_KINDS, kind)) throw new Error('kind: csv, xlsx, png, opblib')
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

  registerCloseGuardIpc()
  registerLocaleIpc()
}
