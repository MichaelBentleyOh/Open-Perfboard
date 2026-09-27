// 크기별 core 연산 시간 측정: npm run perf
// 개수 제한이 아니라 "늘어나는 모양"을 본다. 전선이 10배일 때 시간이 대략 10배 이내면 괜찮다.
import { writeFileSync, mkdirSync } from 'node:fs'
import { test } from 'vitest'
import { endPosition } from '@core/ends'
import { findCrossings } from '@core/crossing'
import { wirePath } from '@core/wire'
import { selectInRect } from '@core/selection'
import { routeWires } from '@core/ops'
import { buildNetlist } from '@core/netlist'
import { buildBom } from '@core/bom'
import { parseProjectFile, serializeProject } from '@core/serialize'
import type { Project } from '@core/model'
import { synthProject } from './synth'

const SIZES = (process.env.PERF_SIZES ?? '100,1000,5000').split(',').map(Number)
/** 이보다 오래 걸린 연산은 더 큰 크기에서 건너뛴다 (측정 시간이 끝없이 늘지 않게) */
const SKIP_AFTER_MS = 20_000

function time(fn: () => unknown, minRuns = 3): number {
  const t0 = performance.now()
  fn()
  const first = performance.now() - t0
  if (first > 1000) return first
  const runs = Math.max(minRuns, Math.min(50, Math.floor(1000 / Math.max(first, 0.01))))
  const all: number[] = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn()
    all.push(performance.now() - s)
  }
  all.sort((a, b) => a - b)
  return all[Math.floor(all.length / 2)]
}

/** 캔버스가 한 프레임에 하는 계산: 모든 전선 경로 + 교차 점프 */
function geometry(p: Project) {
  const list = p.wires.flatMap((w) => {
    const a = endPosition(p, w.from)
    const b = endPosition(p, w.to)
    return a && b ? [{ id: w.id, path: wirePath(a, w.points, b, w.orthogonal) }] : []
  })
  return list
}

const ops: [string, (p: Project) => () => unknown][] = [
  ['전선 경로', (p) => () => geometry(p)],
  ['교차 점프', (p) => { const g = geometry(p); return () => findCrossings(g) }],
  ['선택 사각형', (p) => () => selectInRect(p, { x: -1e6, y: -1e6, width: 2e6, height: 2e6 })],
  ['결선표', (p) => () => buildNetlist(p)],
  ['BOM', (p) => () => buildBom(p)],
  ['저장(문자열)', (p) => () => serializeProject(p)],
  ['열기(파싱)', (p) => { const s = serializeProject(p); return () => parseProjectFile(s) }],
  ['배선 정리(전체)', (p) => () => routeWires(p, p.wires.map((w) => w.id))]
]

test('크기별 측정', { timeout: 30 * 60_000 }, () => {
  const rows: Record<string, (number | undefined)[]> = {}
  const skip = new Set<string>()
  const meta: string[] = []
  for (const n of SIZES) {
    const p = synthProject({ wires: n })
    const mb = (serializeProject(p).length / 1e6).toFixed(1)
    meta.push(`전선 ${n}: 부품 ${p.instances.length}, 접속점 ${p.junctions?.length ?? 0}, 파일 ${mb}MB`)
    for (const [name, make] of ops) {
      const list = (rows[name] ??= [])
      if (skip.has(name)) {
        list.push(undefined)
        continue
      }
      const ms = time(make(p))
      list.push(ms)
      if (ms > SKIP_AFTER_MS) skip.add(name)
    }
  }
  const fmt = (v: number | undefined) => (v === undefined ? '건너뜀' : v < 10 ? v.toFixed(2) : v.toFixed(0))
  const lines = [
    ...meta,
    '',
    `| 연산 | ${SIZES.map((n) => `전선 ${n}`).join(' | ')} | 10배당 배수 |`,
    `|---|${SIZES.map(() => '---:').join('|')}|---:|`,
    ...Object.entries(rows).map(([name, v]) => {
      // 마지막 두 측정 사이의 배수를 10배 기준으로 환산
      const k = v.length - 1
      let ratio = ''
      for (let i = k; i > 0; i--) {
        const a = v[i - 1]
        const b = v[i]
        if (a !== undefined && b !== undefined && a > 0.05) {
          ratio = (Math.pow(b / a, 1 / Math.log10(SIZES[i] / SIZES[i - 1])) ).toFixed(0) + '배'
          break
        }
      }
      return `| ${name} | ${v.map(fmt).join(' | ')} | ${ratio} |`
    })
  ]
  const text = lines.join('\n') + '\n(단위 ms, 중앙값)\n'
  mkdirSync('test-results', { recursive: true })
  writeFileSync(process.env.PERF_OUT ?? 'test-results/perf.md', text)
  process.stdout.write('\n' + text)
})
