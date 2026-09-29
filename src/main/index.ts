import { join } from 'node:path'
import { app, BrowserWindow, Menu, shell } from 'electron'
import { installCloseGuard } from './closeGuard'
import { registerIpc } from './ipc'
import { appIconPath, applyUserDataOverride } from './paths'
import { registerAttachmentIpc, registerAttachmentScheme } from './attachments'
import { installRecoveryCleanup, openInWindow, projectArg, registerDocumentIpc, setPendingOpen } from './documents'

applyUserDataOverride()
registerAttachmentScheme()

// 한 번에 하나만 실행한다: .opb를 더블클릭했을 때 이미 켜져 있으면 그 창에서 연다
if (!app.requestSingleInstanceLock()) app.quit()
else {
  setPendingOpen(projectArg(process.argv))
  app.on('second-instance', (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    const path = projectArg(argv)
    if (!win) return
    if (path) void openInWindow(win, path)
    else {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(start)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'Open Perfboard',
    icon: appIconPath(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // 기본 메뉴를 뺐으므로 개발 중에는 F12로 개발자 도구를 연다
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools()
    })
  }
  installCloseGuard(win)
  installRecoveryCleanup(win)

  // 오프라인 앱: 외부 링크는 앱 안에서 열지 않고 기본 브라우저로 넘긴다
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  // 보안: 앱 창은 앱 페이지만. HTML 파일을 끌어다 놓거나 링크를 눌러 다른 페이지로 넘어가면
  // 그 페이지도 preload의 window.api(파일 읽기·쓰기)를 얻는다 → 넘어가지 않게 막고, 웹 주소는 기본 브라우저로
  win.webContents.on('will-navigate', (e, url) => {
    e.preventDefault()
    if (url.startsWith('https://')) void shell.openExternal(url)
  })
  win.webContents.on('will-redirect', (e) => e.preventDefault())
  // 카메라·마이크·알림 같은 권한은 쓰지 않는다
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function start(): void {
  // Electron 기본 메뉴(숨겨져 있어도 단축키는 동작)를 뺀다: Ctrl+= / Ctrl+- / Ctrl+0이 화면 전체를 확대하지 않고
  // 캔버스 배율 단축키로 쓰이게, Ctrl+R 새로고침으로 작업이 날아가지 않게
  Menu.setApplicationMenu(null)
  registerIpc()
  registerAttachmentIpc()
  registerDocumentIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
