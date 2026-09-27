// 저장하지 않은 변경이 있으면 창을 닫기 전에 묻는다.
// dirty 여부는 렌더러가 알려 준다 (app:set-dirty). 저장은 렌더러가 하고 끝나면 app:close-now를 보낸다.
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { mt } from './locale'

const dirtyWindows = new Set<number>()

export function registerCloseGuardIpc(): void {
  ipcMain.on('app:set-dirty', (e, dirty: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (dirty === true) dirtyWindows.add(win.id)
    else dirtyWindows.delete(win.id)
  })

  ipcMain.on('app:close-now', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    dirtyWindows.delete(win.id)
    win.close()
  })
}

export function installCloseGuard(win: BrowserWindow): void {
  let prompting = false
  win.on('close', async (e) => {
    if (!dirtyWindows.has(win.id)) return
    e.preventDefault()
    if (prompting) return
    prompting = true
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: [mt('저장'), mt('저장 안 함'), mt('취소')],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: 'Open Perfboard',
        message: mt('저장하지 않은 변경 내용이 있습니다.'),
        detail: mt('닫기 전에 저장할까요?')
      })
      if (response === 0) win.webContents.send('app:save-and-close')
      else if (response === 1) {
        dirtyWindows.delete(win.id)
        win.close()
      }
    } finally {
      prompting = false
    }
  })
  win.on('closed', () => dirtyWindows.delete(win.id))
}
