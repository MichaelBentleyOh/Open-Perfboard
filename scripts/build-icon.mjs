// build/icon.svg, build/icon-small.svg → build/icon.png(512), build/icon.ico(16~256), build/icons/*.png, images/logo.png(README 로고)
// 실행: npm run build:icon  (Electron의 Chromium으로 SVG를 래스터화한다)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const SMALL_MAX = 32 // 이 크기 이하는 단순화 버전 사용

const toDataUrl = (file) =>
  'data:image/svg+xml;base64,' + readFileSync(join(BUILD, file)).toString('base64')

async function rasterize(win, svgUrl, size) {
  const png = await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = c.height = ${size}
        const ctx = c.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, ${size}, ${size})
        resolve(c.toDataURL('image/png'))
      }
      img.onerror = reject
      img.src = ${JSON.stringify(svgUrl)}
    })`)
  return Buffer.from(png.split(',')[1], 'base64')
}

/** PNG 항목을 담은 ICO 파일 (Windows Vista 이상 지원) */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + 16 * images.length
  for (const { size, data } of images) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0)
    e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += data.length
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('about:blank')
  const big = toDataUrl('icon.svg')
  const small = toDataUrl('icon-small.svg')

  mkdirSync(join(BUILD, 'icons'), { recursive: true })
  const rendered = []
  for (const size of SIZES) {
    const data = await rasterize(win, size <= SMALL_MAX ? small : big, size)
    writeFileSync(join(BUILD, 'icons', `${size}x${size}.png`), data)
    rendered.push({ size, data })
  }
  const icon512 = rendered.find((r) => r.size === 512).data
  writeFileSync(join(BUILD, 'icon.png'), icon512)
  writeFileSync(join(BUILD, '..', 'images', 'logo.png'), icon512)
  writeFileSync(join(BUILD, 'icon.ico'), buildIco(rendered.filter((r) => ICO_SIZES.includes(r.size))))
  console.log('아이콘 생성 완료:', SIZES.join(', '))
  app.quit()
})
