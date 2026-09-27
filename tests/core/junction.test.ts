import { describe, expect, it } from 'vitest'
import { copySelection, pasteClipboard } from '@core/clipboard'
import { endPosition } from '@core/ends'
import { rectFromPoints } from '@core/geometry'
import { PROJECT_FILE_VERSION, type Project } from '@core/model'
import { buildNetlist } from '@core/netlist'
import {
  cleanupJunctions,
  connectEnds,
  disconnect,
  moveInstances,
  moveJunction,
  removeItems,
  splitWire,
  updateWires
} from '@core/ops'
import { selectInRect } from '@core/selection'
import { parseProject, serializeProject } from '@core/serialize'
import { wirePath } from '@core/wire'
import { loadSample, readFixture } from '../helpers'

// 샘플 w1: CN1.+ (496,52) → U1.1 (4,28). 직각으로 만들면 (496,52) → (4,52) → (4,28)
const sample = (): Project => updateWires(loadSample(), ['w1'], { orthogonal: true })
const counter = (prefix = 'n') => {
  let n = 0
  return () => `${prefix}${++n}`
}
const netlist = (p: Project) => buildNetlist(p).map((r) => `${r.from.label} ↔ ${r.to.label}`)

describe('파일 포맷 v2', () => {
  it('v1 파일은 최신 버전으로 올라가 열린다', () => {
    expect(JSON.parse(readFixture('sample-project.opb')).version).toBe(1)
    const r = parseProject(readFixture('sample-project.opb'))
    expect(r.ok && r.value.version).toBe(PROJECT_FILE_VERSION)
  })

  it('접속점이 있는 배선도 왕복, 없는 접속점을 가리키면 거부', () => {
    const p = splitWire(sample(), 'w1', { x: 250, y: 60 }, { junction: 'j1', wire2: 'w1b' })!.project
    const again = parseProject(serializeProject(p))
    expect(again.ok && again.value).toEqual(p)
    const raw = JSON.parse(serializeProject(p))
    raw.junctions = []
    const bad = parseProject(JSON.stringify(raw))
    expect(bad.ok ? [] : bad.errors).toContain('wires[0].to: 존재하지 않는 핀을 가리킵니다')
  })
})

describe('splitWire', () => {
  it('그려지는 경로 위에 접속점을 만들고 전선을 둘로 나눈다', () => {
    const r = splitWire(sample(), 'w1', { x: 253, y: 60 }, { junction: 'j1', wire2: 'w1b' })!
    const p = r.project
    expect(p.junctions).toEqual([{ id: 'j1', label: 'SP1', x: 250, y: 52 }]) // 가로선 위, 10단위
    expect(netlist(p)).toEqual(['CN1.P1.- ↔ U1.J1.2', 'CN1.P1.+ ↔ SP1', 'SP1 ↔ U1.J1.1'])
    // 나뉜 두 전선을 이으면 원래 경로와 같은 모양
    const w1 = p.wires.find((w) => w.id === 'w1')!
    const w1b = p.wires.find((w) => w.id === 'w1b')!
    const a = endPosition(p, w1.from)!
    const j = endPosition(p, w1.to)!
    const b = endPosition(p, w1b.to)!
    expect(wirePath(a, w1.points, j, true)).toEqual([a, j])
    expect(wirePath(j, w1b.points, b, true)).toEqual([j, { x: 4, y: 52 }, b])
  })

  it('라벨은 앞쪽 전선에만 남는다', () => {
    const p = updateWires(sample(), ['w1'], { label: '+12V' })
    const r = splitWire(p, 'w1', { x: 250, y: 52 }, { junction: 'j1', wire2: 'w1b' })!
    expect(r.project.wires.find((w) => w.id === 'w1')!.label).toBe('+12V')
    expect(r.project.wires.find((w) => w.id === 'w1b')!.label).toBeUndefined()
  })
})

describe('connectEnds (분기)', () => {
  const style = { color: '#1e88e5', width: 2, orthogonal: true }

  it('전선 중간에서 핀으로: 나누기 + 연결이 한 번에', () => {
    const r = connectEnds(sample(), { wireId: 'w1', point: { x: 250, y: 52 } }, { instanceId: 'i1', pinId: 'p3' }, style, counter())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.project.junctions).toHaveLength(1)
    expect(netlist(r.project)).toContain('SP1 ↔ U1.J1.3')
    expect(r.project.wires).toHaveLength(4)
  })

  it('서로 다른 두 전선의 중간끼리 잇기 (접속점 2개)', () => {
    // w2: CN1.- (496,148) → U1.2 (4,76) 직선, x=250에서 y=112
    const r = connectEnds(sample(), { wireId: 'w1', point: { x: 250, y: 52 } }, { wireId: 'w2', point: { x: 250, y: 112 } }, style, counter())
    expect(r.ok && r.project.junctions?.map((j) => j.label)).toEqual(['SP1', 'SP2'])
    expect(r.ok && netlist(r.project)).toContain('SP1 ↔ SP2')
  })

  it('같은 전선의 두 곳을 잇는 건 이미 있는 연결이라 거부 (아무것도 바뀌지 않음)', () => {
    const r = connectEnds(sample(), { wireId: 'w1', point: { x: 400, y: 52 } }, { wireId: 'w1', point: { x: 100, y: 52 } }, style, counter())
    expect(r).toEqual({ ok: false, error: 'duplicate' })
  })

  it('거부되면 아무것도 바꾸지 않는다 (없는 핀)', () => {
    const before = sample()
    const r = connectEnds(before, { wireId: 'w1', point: { x: 250, y: 52 } }, { instanceId: 'i1', pinId: 'nope' }, style, counter())
    expect(r).toEqual({ ok: false, error: 'unknown-pin' })
    expect(before.junctions).toBeUndefined()
  })
})

describe('cleanupJunctions', () => {
  const branched = () => {
    const r = connectEnds(sample(), { wireId: 'w1', point: { x: 250, y: 52 } }, { instanceId: 'i1', pinId: 'p3' }, { color: '#000', width: 2 }, counter())
    if (!r.ok) throw new Error('setup')
    return { project: r.project, branch: r.wireId! }
  }

  it('가지 전선을 지우면 접속점이 사라지고 원래 한 전선으로 합쳐진다', () => {
    const { project, branch } = branched()
    const p = disconnect(project, branch)
    expect(p.junctions).toBeUndefined()
    expect(netlist(p)).toEqual(['CN1.P1.- ↔ U1.J1.2', 'CN1.P1.+ ↔ U1.J1.1'])
    expect(p.wires.map((w) => w.id).sort()).toEqual(['w1', 'w2'])
  })

  it('접속점을 지우면 붙은 전선도 함께', () => {
    const { project } = branched()
    const p = removeItems(project, { instances: [], wires: [], junctions: [project.junctions![0].id] })
    expect(p.junctions).toBeUndefined()
    expect(netlist(p)).toEqual(['CN1.P1.- ↔ U1.J1.2'])
  })

  it('정리할 게 없으면 같은 객체', () => {
    const { project } = branched()
    expect(cleanupJunctions(project)).toBe(project)
  })
})

describe('접속점 이동·선택·복사', () => {
  const branched = () => {
    const r = connectEnds(sample(), { wireId: 'w1', point: { x: 250, y: 52 } }, { instanceId: 'i1', pinId: 'p3' }, { color: '#000', width: 2 }, counter('b'))
    if (!r.ok) throw new Error('setup')
    return r.project
  }

  it('moveJunction, 함께 이동', () => {
    const p = branched()
    const jid = p.junctions![0].id
    expect(moveJunction(p, jid, { x: 260, y: 100 }).junctions![0]).toMatchObject({ x: 260, y: 100 })
    const moved = moveInstances(p, ['i1', 'i2'], 10, 0, [jid])
    expect(moved.junctions![0]).toMatchObject({ x: 260, y: 52 })
  })

  it('선택 사각형에 접속점이 들어간다', () => {
    const p = branched()
    const hit = selectInRect(p, rectFromPoints({ x: 240, y: 40 }, { x: 260, y: 60 }))
    expect(hit.junctions).toEqual([p.junctions![0].id])
  })

  it('부품 + 접속점 복사 → 붙여넣으면 SP2와 가지 전선까지', () => {
    const p = branched()
    const clip = copySelection(p, { instances: ['i1', 'i2'], wires: [], junctions: [p.junctions![0].id] })!
    expect(clip.wires).toHaveLength(4)
    const r = pasteClipboard(p, clip, { x: 0, y: 400 }, counter('c'))
    expect(r.junctions).toHaveLength(1)
    expect(r.project.junctions!.map((j) => j.label)).toEqual(['SP1', 'SP2'])
    expect(r.wires).toHaveLength(4)
  })
})

describe('분기 전선은 원래 전선에 수직으로', () => {
  it('가로 전선에서 아래 핀으로: 세로로 먼저 나가서 원래 전선과 겹치지 않는다', () => {
    // w1(직각): (496,52) → (4,52) → (4,28). x=250 가로 구간에서 분기해 U1.4(28,172)로
    const r = connectEnds(sample(), { wireId: 'w1', point: { x: 250, y: 52 } }, { instanceId: 'i1', pinId: 'p4' }, { color: '#000', width: 2, orthogonal: true }, counter())
    if (!r.ok) throw new Error('connect')
    const w = r.project.wires.find((x) => x.id === r.wireId)!
    const j = endPosition(r.project, w.from)!
    const b = endPosition(r.project, w.to)!
    const path = wirePath(j, w.points, b, true)
    // 첫 구간은 세로 (x 그대로)
    expect(path[1].x).toBe(j.x)
    expect(path[1].y).not.toBe(j.y)
  })

  it('세로 전선으로 들어올 때는 가로로 들어온다', () => {
    // w1의 세로 구간 (4,52)→(4,28)에서 끝나게: CN1의 +는 이미 연결돼 있으니 w2의 끝(CN1.-)에서 출발
    const r = connectEnds(sample(), { instanceId: 'i2', pinId: 'b2' }, { wireId: 'w1', point: { x: 4, y: 40 } }, { color: '#000', width: 2, orthogonal: true }, counter())
    if (!r.ok) throw new Error('connect')
    const w = r.project.wires.find((x) => x.id === r.wireId)!
    const a = endPosition(r.project, w.from)!
    const j = endPosition(r.project, w.to)!
    const path = wirePath(a, w.points, j, true)
    const last = path[path.length - 2]
    expect(last.y).toBe(j.y) // 마지막 구간은 가로
  })
})
