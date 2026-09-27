// README 동작 GIF 만들기: npm run screenshots → images/demo.gif, images/demo-en.gif
// 실제 앱을 조작하면서 한 장면씩 찍어 GIF로 묶는다 (부품 놓기 → 전선 잇기 → 배선 정리 → BOM·결선표).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { dropPart, getProject, nextFrame } from '../../tests/e2e/launch'
import { OUT, openDemo, type Lang } from './common'

const WIDTH = 960 // GIF 가로 크기
const STEP_MS = 40 // 움직이는 장면 한 장의 길이
const DEBUG_DIR = process.env.OPB_DEMO_FRAMES // 지정하면 장면마다 PNG도 남긴다 (확인용)

type Frame = { rgba: Uint8Array; width: number; height: number; delay: number }

/** 창 화면을 한 장씩 모아 GIF로 쓴다 */
class Recorder {
  private frames: Frame[] = []
  private count = 0
  constructor(private app: ElectronApplication, private win: Page) {}

  async capture(delay = STEP_MS) {
    await nextFrame(this.win)
    const { width, height, data, png } = await this.app.evaluate(async ({ BrowserWindow }, [width, debug]) => {
      const img = (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).resize({ width, quality: 'best' })
      const size = img.getSize()
      return { width: size.width, height: size.height, data: img.toBitmap().toString('base64'), png: debug ? img.toPNG().toString('base64') : '' }
    }, [WIDTH, !!DEBUG_DIR] as const)
    if (DEBUG_DIR) writeFileSync(join(DEBUG_DIR, `${String(this.count++).padStart(3, '0')}.png`), Buffer.from(png, 'base64'))
    const rgba = new Uint8Array(Buffer.from(data, 'base64'))
    for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]] // BGRA → RGBA
    const last = this.frames.at(-1)
    if (last && last.rgba.length === rgba.length && Buffer.compare(last.rgba, rgba) === 0) last.delay += delay
    else this.frames.push({ rgba, width, height, delay })
  }

  /** 마지막 장면을 더 오래 보여 준다 */
  hold(ms: number) {
    this.frames.at(-1)!.delay += ms
  }

  /** 첫 장면은 통째로, 그다음부터는 바뀐 픽셀만 넣고 나머지는 투명(앞 장면이 그대로 보임)으로 둔다 → 용량이 크게 준다 */
  write(path: string) {
    const gif = GIFEncoder()
    let prev: Uint8Array | null = null
    for (const f of this.frames) {
      const n = f.width * f.height
      const changed = new Uint8Array(n)
      let count = 0
      for (let i = 0; i < n; i++) {
        const o = i * 4
        if (!prev || prev[o] !== f.rgba[o] || prev[o + 1] !== f.rgba[o + 1] || prev[o + 2] !== f.rgba[o + 2]) {
          changed[i] = 1
          count++
        }
      }
      const sample = new Uint8Array(Math.max(count, 1) * 4)
      for (let i = 0, j = 0; i < n; i++) if (changed[i]) sample.set(f.rgba.subarray(i * 4, i * 4 + 4), 4 * j++)
      const palette = quantize(sample, 255)
      const transparentIndex = palette.length
      palette.push([0, 0, 0])
      const index = applyPalette(f.rgba, palette.slice(0, transparentIndex))
      if (prev) for (let i = 0; i < n; i++) if (!changed[i]) index[i] = transparentIndex
      gif.writeFrame(index, f.width, f.height, { palette, delay: f.delay, transparent: !!prev, transparentIndex, dispose: 1 })
      prev = f.rgba
    }
    gif.finish()
    writeFileSync(path, gif.bytes())
  }
}

/** 화면 캡처에는 마우스 포인터가 안 찍히므로 포인터 그림을 페이지에 올린다 */
async function showCursor(win: Page) {
  await win.evaluate(() => {
    const c = document.createElement('div')
    c.id = 'demo-cursor'
    c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px)'
    c.innerHTML =
      '<div class="ring" style="position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;background:rgba(21,128,61,.35);display:none"></div>' +
      '<img class="ghost" style="position:absolute;left:14px;top:14px;width:120px;opacity:.75;display:none" />' +
      '<svg width="22" height="30" viewBox="0 0 22 30" style="position:absolute;left:-2px;top:-2px"><path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 17 L20 17 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>'
    document.body.appendChild(c)
    const ring = c.querySelector<HTMLElement>('.ring')!
    document.addEventListener('mousemove', (e) => (c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`), true)
    document.addEventListener('mousedown', () => (ring.style.display = 'block'), true)
    document.addEventListener('mouseup', () => (ring.style.display = 'none'), true)
  })
}

/** 부품함에서 끄는 동안 포인터 옆에 부품 그림을 붙인다 (진짜 HTML 끌기는 이벤트가 멈춰서 흉내만 낸다) */
async function setGhost(win: Page, src: string | null) {
  await win.evaluate((src) => {
    const g = document.querySelector<HTMLImageElement>('#demo-cursor .ghost')!
    const ring = document.querySelector<HTMLElement>('#demo-cursor .ring')!
    if (src) g.src = src
    g.style.display = ring.style.display = src ? 'block' : 'none'
  }, src)
}

type Point = { x: number; y: number }

async function recordDemo(lang: Lang) {
  mkdirSync(OUT, { recursive: true })
  const ui = lang === 'en' ? { netlist: /^Netlist \(/, tidy: '⌁ Tidy wiring' } : { netlist: /^결선표 \(/, tidy: '⌁ 배선 정리' }
  const { app, win } = await openDemo(lang, { omit: ['mot'] })
  const rec = new Recorder(app, win)
  let at: Point = { x: 720, y: 560 }
  /** 포인터를 부드럽게 옮기며 장면마다 찍는다 */
  const glide = async (to: Point, steps = 12) => {
    const from = at
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const e = t * t * (3 - 2 * t) // 천천히 출발·도착
      await win.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e)
      await rec.capture()
    }
    at = to
  }
  const click = async () => {
    await win.mouse.down()
    await rec.capture(120)
    await win.mouse.up()
    await rec.capture()
  }
  const world = (p: Point) => win.evaluate((p) => window.__opbCanvas!.worldToClient(p), p)
  const pin = async (instanceId: string, pinId: string) => (await win.evaluate(([i, p]) => window.__opbCanvas!.pinClientPosition(i, p), [instanceId, pinId]))!

  try {
    await showCursor(win)
    await win.mouse.move(at.x, at.y)
    await rec.capture()
    rec.hold(800)

    // 1. 부품함에서 모터를 끌어다 놓기
    const item = win.getByTestId('part-list').locator('.part-item').filter({ hasText: 'DCM-12' })
    const box = (await item.boundingBox())!
    await glide({ x: box.x + 60, y: box.y + box.height / 2 })
    await setGhost(win, await item.locator('img').first().getAttribute('src'))
    await rec.capture(150)
    const target = await world({ x: 350, y: -95 })
    await glide(target, 16)
    await setGhost(win, null)
    await dropPart(win, 'DCM-12', target.x, target.y)
    await rec.capture()
    rec.hold(500)
    const motor = (await getProject(win)).instances.find((i) => i.partId === 'demo-motor')!.id

    // 2. 배선 모드에서 핀과 핀을 잇기
    await win.keyboard.press('w')
    await rec.capture()
    rec.hold(300)
    for (const [from, to] of [['mp', 'mp'], ['mn', 'mn']] as const) {
      if (from === 'mn') {
        // 두 번째 전선은 툴바에서 검정을 골라 긋는다
        const black = (await win.locator('header .color-picker, .color-picker').first().locator('.swatch-btn').nth(1).boundingBox())!
        await glide({ x: black.x + black.width / 2, y: black.y + black.height / 2 }, 12)
        await click()
      }
      const start = await pin('drv', from)
      await glide(start, 10)
      await click()
      const end = await pin(motor, to)
      if (from === 'mn') {
        // 일부러 위로 크게 돌아가게 꺾어 둔다 → 배선 정리로 깔끔해지는 모습
        for (const bend of [{ x: start.x + 50, y: start.y - 120 }, { x: end.x - 50, y: start.y - 120 }]) {
          await glide(bend, 10)
          await click()
        }
      }
      await glide(end, 14)
      await click()
      rec.hold(400)
    }
    await expect.poll(async () => (await getProject(win)).wires.length).toBe(12)

    // 3. 배선 정리: 돌아가던 전선이 겹치지 않는 짧은 경로로 다시 그려진다
    const tidy = (await win.getByRole('button', { name: ui.tidy, exact: true }).first().boundingBox())!
    await glide({ x: tidy.x + tidy.width / 2, y: tidy.y + tidy.height / 2 }, 14)
    const messy = (await getProject(win)).wires.at(-1)!.id
    const before = JSON.stringify(await win.evaluate((id) => window.__opbCanvas!.wirePathClient(id), messy))
    await click()
    // 정리는 작업자(Worker)에서 돌아 결과가 조금 뒤에 들어온다
    await expect.poll(async () => JSON.stringify(await win.evaluate((id) => window.__opbCanvas!.wirePathClient(id), messy))).not.toBe(before)
    await rec.capture()
    rec.hold(1600)
    await win.keyboard.press('Escape')
    await win.keyboard.press('Escape')

    // 4. BOM과 결선표가 이미 만들어져 있다
    const bom = (await win.getByRole('button', { name: /^BOM \(/ }).boundingBox())!
    await glide({ x: bom.x + bom.width / 2, y: bom.y + bom.height / 2 }, 12)
    await click()
    rec.hold(1600)
    const net = (await win.getByRole('button', { name: ui.netlist }).boundingBox())!
    await glide({ x: net.x + net.width / 2, y: net.y + net.height / 2 }, 8)
    await click()
    rec.hold(2000)

    rec.write(join(OUT, lang === 'en' ? 'demo-en.gif' : 'demo.gif'))
  } finally {
    await app.close()
  }
}

test('README 동작 GIF (한국어)', () => recordDemo('ko'))
test('README 동작 GIF (영어)', () => recordDemo('en'))
