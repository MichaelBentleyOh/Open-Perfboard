// 개수 제한이 아니라 "늘어나는 모양"을 지킨다: 전선이 4배면 시간도 대략 4배여야 한다.
// 전선 수의 제곱으로 느려지는 코드가 다시 들어오면(4배 → 16배) 여기서 잡힌다. 자세한 수치는 npm run perf
import { describe, expect, it } from 'vitest'
import { crossingWires } from '@core/avoid'
import { endPosition } from '@core/ends'
import { findCrossings } from '@core/crossing'
import { buildNetlist } from '@core/netlist'
import { buildConnectionLabels, labelsByInstance } from '@core/connection'
import { routeWires } from '@core/ops'
import { sceneWires } from '@core/scene'
import { selectInRect } from '@core/selection'
import { parseProjectFile, serializeProject } from '@core/serialize'
import type { Project, Supply } from '@core/model'
import { supplyUsage } from '@core/supply'
import { wirePath } from '@core/wire'
import { buildSchematicScene } from '@core/schematic'
import { exportKicadSchematic } from '@core/kicad'
import { synthProject } from '../perf/synth'

const time = (fn: () => unknown): number => {
  const t = performance.now()
  fn()
  return performance.now() - t
}

/**
 * 작은 배선도 대비 4배 배선도의 시간 배수.
 * 다른 테스트 파일이 동시에 돌면 CPU를 나눠 쓰므로, 작은 것·큰 것을 바로 이어 재서 같은 부하에서 비교하고
 * 그 배수들의 가운데 값을 쓴다 (한쪽만 느려진 측정에 끌려가지 않게)
 */
function growth(small: number, op: (p: Project) => () => unknown, runs = 7): number {
  const a = synthProject({ wires: small, imageBytes: 10 })
  const b = synthProject({ wires: small * 4, imageBytes: 10 })
  const fa = op(a)
  const fb = op(b)
  fa() // 준비 운동 (JIT)
  fb()
  const ratios: number[] = []
  for (let i = 0; i < runs; i++) {
    const ta = time(fa)
    ratios.push(time(fb) / ta)
  }
  ratios.sort((x, y) => x - y)
  return ratios[Math.floor(ratios.length / 2)]
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

  it('KiCad 회로도 내보내기 (040)', () => {
    let n = 0
    const o = { title: 't', date: '2026-01-01', newUuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` }
    expect(growth(500, (p) => () => exportKicadSchematic(p, o))).toBeLessThan(LINEAR_ENOUGH)
  })

  it('회로도 장면 (자동 배치·핀·선·넷 라벨, 039)', () => {
    const labeled = (p: Project): Project => ({ ...p, schematic: { labeled: p.wires.filter((_, i) => i % 2).map((w) => w.id) } })
    expect(growth(1000, (p) => { const q = labeled(p); return () => buildSchematicScene(q) })).toBeLessThan(LINEAR_ENOUGH)
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

  it('결선표 연결 라벨', () => {
    expect(growth(1000, (p) => () => labelsByInstance(buildConnectionLabels(p)))).toBeLessThan(LINEAR_ENOUGH)
  })

  it('부속 부품 제안 수량 (모든 핀이 커넥터에 속함)', () => {
    const lib: Supply[] = [
      { id: 't', kind: 'terminal', name: 'T' },
      { id: 'h', kind: 'housing', name: 'H', connectorType: 'XH', terminalId: 't' }
    ]
    const withConnectors = (p: Project): Project => ({
      ...p,
      parts: Object.fromEntries(
        Object.entries(p.parts).map(([id, d]) => [
          id,
          { ...d, connectors: [{ id: 'j', name: 'J1', type: 'XH' }], pins: d.pins.map((pin) => ({ ...pin, connectorId: 'j' })) }
        ])
      )
    })
    expect(growth(1000, (p) => { const q = withConnectors(p); return () => supplyUsage(q, lib) })).toBeLessThan(LINEAR_ENOUGH)
  })

  it('파일 열기(검증 포함)', () => {
    expect(growth(1000, (p) => { const s = serializeProject(p); return () => parseProjectFile(s) })).toBeLessThan(LINEAR_ENOUGH)
  })

  it('배선 정리: 전선 하나에 드는 시간이 배선도 크기와 상관없다', () => {
    expect(growth(60, (p) => () => routeWires(p, p.wires.map((w) => w.id)), 2)).toBeLessThan(LINEAR_ENOUGH)
  }, 30_000)
})
