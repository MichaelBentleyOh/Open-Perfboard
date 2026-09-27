// HTML → PDF. 렌더러가 만든 보고서 HTML을 숨은 창에서 인쇄한다.
// 이 창은 JavaScript를 끄고, 이동·새 창을 막아 HTML 안의 내용이 아무것도 실행하지 못하게 한다.
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

export interface PdfOptions {
  pageSize: 'A4' | 'A3'
  landscape: boolean
}

const FOOTER = `<div style="width:100%;font-size:7px;color:#666;text-align:center;font-family:sans-serif">
  <span class="pageNumber"></span> / <span class="totalPages"></span></div>`

export async function renderPdf(html: string, o: PdfOptions): Promise<Uint8Array> {
  const tmp = join(app.getPath('temp'), `opb-report-${process.pid}-${Date.now()}.html`)
  await writeFile(tmp, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await win.loadFile(tmp)
    const pdf = await win.webContents.printToPDF({
      pageSize: o.pageSize,
      landscape: o.landscape,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER
    })
    return new Uint8Array(pdf)
  } finally {
    win.destroy()
    await rm(tmp, { force: true })
  }
}
