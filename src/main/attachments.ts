// 부품 첨부: IPC, 썸네일용 읽기 전용 프로토콜(opb-attach://<id>), 보기 창.
// 보기 창은 앱 코드·Node에 접근하지 못하게 격리하고, 링크는 http/https만 기본 브라우저로 넘긴다.
import { BrowserWindow, dialog, ipcMain, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import { readFile } from 'node:fs/promises'
import { ATTACHMENT_ID, attachmentMime } from '../core/attachment'
import type { Attachment } from '../core/model'
import { appIconPath, attachmentsDir } from './paths'
import { mt } from './locale'
import { existingAttachments, findAttachment, importAttachmentFile, putAttachment, readAttachment } from './repositories/attachments'

export const ATTACHMENT_SCHEME = 'opb-attach'

/** app ready 전에 호출해야 한다 */
export function registerAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ATTACHMENT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

/** opb-attach://<id> → 첨부 파일 (첨부 폴더 안, id 형식만) */
function handleProtocol(): void {
  protocol.handle(ATTACHMENT_SCHEME, async (req) => {
    const id = new URL(req.url).hostname
    if (!ATTACHMENT_ID.test(id)) return new Response(null, { status: 400 })
    const found = await findAttachment(attachmentsDir(), id)
    if (!found) return new Response(null, { status: 404 })
    return new Response(await readFile(found.path), {
      headers: { 'content-type': attachmentMime(found.type), 'cache-control': 'max-age=31536000, immutable' }
    })
  })
}

const isHttp = (url: string) => /^https?:\/\//i.test(url)

/** 첨부 id → 열려 있는 보기 창 */
const viewers = new Map<string, BrowserWindow>()

async function openViewer(id: string, title: string): Promise<void> {
  const open = viewers.get(id)
  if (open && !open.isDestroyed()) {
    if (open.isMinimized()) open.restore()
    open.focus()
    return
  }
  const found = await findAttachment(attachmentsDir(), id)
  if (!found) throw new Error(mt('첨부 파일을 찾을 수 없습니다'))
  const win = new BrowserWindow({
    width: 900,
    height: 1000,
    title,
    icon: appIconPath(),
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true }
  })
  viewers.set(id, win)
  win.on('closed', () => viewers.delete(id))
  // 보기 창의 제목은 첨부 제목으로 고정 (그림은 크기, PDF는 파일 안 제목으로 바뀌려 한다)
  win.on('page-title-updated', (e) => e.preventDefault())
  // file://로 열면 Chromium이 형식을 Windows의 확장자 설정에서 가져와, PC 설정에 따라 PDF가 열리지 않는다
  // → 형식을 직접 정해 주는 앱 프로토콜로 연다
  const self = `${ATTACHMENT_SCHEME}://${id}`
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttp(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(self)) return // PDF 안의 쪽 이동(#page=)
    e.preventDefault()
    if (isHttp(url)) shell.openExternal(url)
  })
  await win.loadURL(self)
}

const windowOf = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender)

export function registerAttachmentIpc(): void {
  handleProtocol()

  /** 파일 고르기 → 첨부 폴더로 복사 → 목록. 문제 있는 파일은 건너뛰고 이유를 돌려준다 */
  ipcMain.handle('attachments:add', async (e) => {
    const win = windowOf(e)
    const opts = {
      title: mt('파일 첨부'),
      filters: [{ name: mt('데이터시트·그림 (PDF, PNG, JPG, WEBP)'), extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile' as const, 'multiSelections' as const]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const attachments: Attachment[] = []
    const problems: string[] = []
    if (r.canceled) return { attachments, problems }
    for (const file of r.filePaths) {
      try {
        attachments.push(await importAttachmentFile(attachmentsDir(), file))
      } catch (err) {
        problems.push(`${file.split(/[\\/]/).pop()}: ${(err as Error).message}`)
      }
    }
    return { attachments, problems }
  })

  ipcMain.handle('attachments:put', (_e, id: unknown, data: unknown) => {
    if (typeof id !== 'string' || !(data instanceof Uint8Array)) throw new Error('id, data')
    return putAttachment(attachmentsDir(), id, data)
  })

  ipcMain.handle('attachments:read', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('id')
    return readAttachment(attachmentsDir(), id)
  })

  ipcMain.handle('attachments:exists', (_e, ids: unknown) => {
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new Error('ids')
    return existingAttachments(attachmentsDir(), ids)
  })

  ipcMain.handle('attachments:open', (_e, id: unknown, title: unknown) => {
    if (typeof id !== 'string' || typeof title !== 'string') throw new Error('id, title')
    return openViewer(id, title)
  })
}
