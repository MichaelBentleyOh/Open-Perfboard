// 큰 배선도에서 앱 반응 속도 측정: npm run perf:e2e (일반 E2E에서는 빠진다)
// 합격/불합격보다 수치를 남기는 것이 목적이다. 결과는 test-results/perf-e2e.md
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { serializeProject } from '../../src/core/serialize'
import { synthProject } from '../perf/synth'
import { launchApp, makeTempDir, makeUserDataDir, nextFrame, stubDialogs } from './launch'

const SIZES = (process.env.PERF_SIZES ?? '1000,5000').split(',').map(Number)
const OUT = 'test-results/perf-e2e.md'


/** 한 번 움직이고 화면에 그려질 때까지 걸린 시간들 (ms) */
async function frameTimes(win: Page, steps: number, move: (k: number) => Promise<void>): Promise<number[]> {
  const out: number[] = []
  for (let k = 0; k < steps; k++) {
    const t = Date.now()
    await move(k)
    await nextFrame(win)
    out.push(Date.now() - t)
  }
  return out
}
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
const worst = (v: number[]) => Math.max(...v)

test('큰 배선도: 열기·전체 보기·끌기·화면 이동', async () => {
  const photo = `data:image/png;base64,${readFileSync(join(__dirname, '../fixtures/part-photo.png')).toString('base64')}`
  writeFileSync(OUT, `| 전선 | 열기 | 빈 프레임 | 끌기 100% (중앙/최악) | 끌기 전체 보기 (중앙/최악) | 화면 이동 100% (중앙/최악) | 탭: BOM / 결선표 / 배선도 |\n|---:|---:|---:|---:|---:|---:|---:|\n`)
  for (const n of SIZES) {
    const dir = makeTempDir('opb-perf-')
    const file = join(dir, `big-${n}.opb`)
    writeFileSync(file, serializeProject(synthProject({ wires: n, imageData: photo })))
    const { app, win } = await launchApp(makeUserDataDir())
    try {
      await expect(win.getByText('부품함이 비어 있습니다.')).toBeVisible()
      await stubDialogs(app, { open: file })
      let t = Date.now()
      await win.keyboard.press('Control+o')
      await expect(win.getByTestId('doc-name')).toHaveText(`big-${n}`, { timeout: 5 * 60_000 })
      await nextFrame(win)
      const open = Date.now() - t
      // 배선도의 부품을 라이브러리로 가져올지 묻는 창은 닫는다
      await win.getByRole('dialog', { name: '부품 가져오기' }).getByRole('button', { name: '취소' }).click()
      await nextFrame(win)
      const idle = median(await frameTimes(win, 10, async () => {}))

      /** 가운데 가까운 부품을 끈다 */
      const drag = async () => {
        const box = (await win.getByTestId('diagram-canvas').boundingBox())!
        // 가운데에서 가까운 부품 중, 전선·핀에 가려지지 않은 점 (Konva 판정으로 부품 사진이 맨 위인 곳)
        const best = await win.evaluate((box) => {
          const hooks = window.__opbCanvas!
          type Stage = { getIntersection: (p: { x: number; y: number }) => { getClassName: () => string; name: () => string } | null }
          const stage = (window as unknown as { Konva: { stages: Stage[] } }).Konva.stages[0]
          const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
          const list = hooks
            .getProject()
            .instances.map((inst) => ({ inst, c: hooks.instanceClientPosition(inst.id)! }))
            .sort((p, q) => Math.hypot(p.c.x - center.x, p.c.y - center.y) - Math.hypot(q.c.x - center.x, q.c.y - center.y))
          // 화면 배율: 부품 사진(240×180) 안쪽만 살핀다
          const k = hooks.worldToClient({ x: 1, y: 0 }).x - hooks.worldToClient({ x: 0, y: 0 }).x
          const stepPx = Math.max(1, 8 * k)
          for (const { inst, c } of list.slice(0, 20)) {
            for (let dy = -70 * k; dy <= 70 * k; dy += stepPx) {
              for (let dx = -100 * k; dx <= 100 * k; dx += stepPx) {
                const hit = stage.getIntersection({ x: c.x + dx - box.x, y: c.y + dy - box.y })
                if (hit && (hit.getClassName() === 'Image' || hit.getClassName() === 'Rect') && hit.name() === '')
                  return { id: inst.id, x: c.x + dx, y: c.y + dy, before: inst.x }
              }
            }
          }
          throw new Error('끌 수 있는 부품 자리를 찾지 못함')
        }, box)
        await win.mouse.move(best.x, best.y)
        await win.mouse.down()
        const times = await frameTimes(win, 30, (k) => win.mouse.move(best.x + (k + 1) * 4, best.y + (k + 1) * 2))
        t = Date.now()
        await win.mouse.up()
        await nextFrame(win)
        const drop = Date.now() - t
        // 정말 끌렸는지 (헛측정 방지)
        const after = await win.evaluate((id) => window.__opbCanvas!.getProject().instances.find((i) => i.id === id)!.x, best.id)
        expect(after).not.toBe(best.before)
        await win.keyboard.press('Control+z')
        await nextFrame(win)
        return { times, drop }
      }

      await win.keyboard.press('Control+0') // 100%
      await nextFrame(win)
      const d100 = await drag()
      await win.keyboard.press('Home') // 전체 보기
      await nextFrame(win)
      await win.screenshot({ path: `test-results/perf-fit-${n}.png` })
      const dFit = await drag()

      // 화면 이동 (휠 버튼 끌기) 100%
      await win.keyboard.press('Control+0')
      await nextFrame(win)
      const box = (await win.getByTestId('diagram-canvas').boundingBox())!
      await win.mouse.move(box.x + 100, box.y + 100)
      await win.mouse.down({ button: 'middle' })
      const pan = await frameTimes(win, 30, (k) => win.mouse.move(box.x + 100 + (k + 1) * 10, box.y + 100 + (k + 1) * 5))
      await win.mouse.up({ button: 'middle' })

      // BOM·결선표 탭 열기 (표가 그려질 때까지)
      const tab = async (name: RegExp) => {
        const s = Date.now()
        await win.getByRole('button', { name }).click()
        await nextFrame(win)
        return Date.now() - s
      }
      const bom = await tab(/^BOM \(/)
      const netlist = await tab(/^결선표 \(/)
      const back = await tab(/^배선도$/)

      const f = (v: number[]) => `${median(v)} / ${worst(v)}`
      appendFileSync(
        OUT,
        `| ${n} | ${open} | ${idle} | ${f(d100.times)} (놓기 ${d100.drop}) | ${f(dFit.times)} (놓기 ${dFit.drop}) | ${f(pan)} | ${bom} / ${netlist} / ${back} |\n`
      )
    } finally {
      await app.close()
    }
  }
  appendFileSync(OUT, '\n(단위 ms. 한 번 움직이고 두 프레임 기다린 시간이라 빈 프레임 시간이 바닥값)\n')
  console.log(readFileSync(OUT, 'utf8'))
})
