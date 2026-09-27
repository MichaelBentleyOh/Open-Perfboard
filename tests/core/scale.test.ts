// 개수 제한이 아니라 "늘어나는 모양"을 지킨다: 전선이 4배면 시간도 대략 4배여야 한다.
// 전선 수의 제곱으로 느려지는 코드가 다시 들어오면(4배 → 16배) 여기서 잡힌다. 자세한 수치는 npm run perf
import { describe, expect, it } from 'vitest'
import { crossingWires } from '@core/avoid'
import { endPosition } from '@core/ends'
import { findCrossings } from '@core/crossing'
import { buildNetlist } from '@core/netlist'
import { routeWires } from '@core/ops'
import { sceneWires } from '@core/scene'
import { selectInRect } from '@core/selection'
import { parseProjectFile, serializeProject } from '@core/serialize'
import type { Project } from '@core/model'
import { wirePath } from '@core/wire'
import { synthProject } from '../perf/synth'

/** 여러 번 돌려 가장 빠른 시간 (다른 일로 느려진 측정을 버린다) */
function fastest(fn: () => unknown, runs = 5): number {
  let best = Infinity
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    fn()
    best = Math.min(best, performance.now() - t)
  }
  return best
}

/** 작은 배선도 대비 4배 배선도의 시간 배수 */
function growth(small: number, op: (p: Project) => () => unknown, runs?: number): number {
  const a = synthProject({ wires: small, imageBytes: 10 })
  const b = synthProject({ wires: small * 4, imageBytes: 10 })
  const fa = op(a)
  const fb = op(b)
  fa() // 준비 운동 (JIT)
  fb()
  return fastest(fb, runs) / fastest(fa, runs)
}

/** 4배 크기에서 선형이면 약 4, 제곱이면 약 16. 측정 흔들림을 감안해 10 미만이면 통과 */
const LINEAR_ENOUGH = 10

describe('큰 배선도: 전선 수에 비례해서만 느려진다', () => {
  it('전선 경로(끝 좌표 찾기)', () => {
    expect(growth(2000, (p) => () => p.wires.map((w) => endPosition(p, w.from)))).toBeLessThan(LINEAR_ENOUGH)
  })

  it('교차 점프', () => {
    const paths = (p: Project) =>
      p.wires.map((w) => ({ id: w.id, path: wirePath(endPosition(p, w.from)!, w.points, endPosition(p, w.to)!, w.orthogonal) }))
    expect(growth(1000, (p) => { const g = paths(p); return () => findCrossings(g) })).toBeLessThan(LINEAR_ENOUGH)
  })

  it('화면 전선 모양 전체 (경로 + 점프)', () => {
    expect(growth(1000, (p) => () => sceneWires(p))).toBeLessThan(LINEAR_ENOUGH)
  })

  it('선택 사각형', () => {
    expect(growth(2000, (p) => () => selectInRect(p, { x: -1e6, y: -1e6, width: 2e6, height: 2e6 }))).toBeLessThan(LINEAR_ENOUGH)
  })

  it('부품을 가로지르는 전선 찾기 (모든 부품을 옮겼을 때)', () => {
    expect(growth(1000, (p) => { const all = p.instances.map((i) => i.id); return () => crossingWires(p, { instances: all }) })).toBeLessThan(LINEAR_ENOUGH)
  })

  it('결선표', () => {
    expect(growth(1000, (p) => () => buildNetlist(p))).toBeLessThan(LINEAR_ENOUGH)
  })

  it('파일 열기(검증 포함)', () => {
    expect(growth(1000, (p) => { const s = serializeProject(p); return () => parseProjectFile(s) })).toBeLessThan(LINEAR_ENOUGH)
  })

  it('배선 정리: 전선 하나에 드는 시간이 배선도 크기와 상관없다', () => {
    expect(growth(60, (p) => () => routeWires(p, p.wires.map((w) => w.id)), 2)).toBeLessThan(LINEAR_ENOUGH)
  }, 30_000)
})
