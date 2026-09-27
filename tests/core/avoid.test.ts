import { describe, expect, it } from 'vitest'
import { avoidParts, pathCrossesParts, segmentCrossesRect } from '@core/avoid'
import { endPosition } from '@core/ends'
import { instanceBounds, type Point } from '@core/geometry'
import type { Project, Wire } from '@core/model'
import { addInstance, connect, emptyProject, moveInstances, routeWires } from '@core/ops'
import { wirePath } from '@core/wire'
import { makePart } from '../helpers'

// 사진 100×100 → 화면 240×240. 핀: 왼쪽 가운데(L), 오른쪽 가운데(R)
const part = makePart('box', {
  image: { data: 'data:image/png;base64,AA==', width: 100, height: 100 },
  pins: [
    { id: 'L', number: '1', x: 0, y: 0.5 },
    { id: 'R', number: '2', x: 1, y: 0.5 }
  ]
})

/** U1 (0,0) · U2 (400,0) · U3 (800,0): 가운데 부품이 U1-U3 일직선을 막는다 */
function row(): Project {
  let p = emptyProject('t')
  p = addInstance(p, part, { id: 'u1', x: 0, y: 0 })
  p = addInstance(p, part, { id: 'u2', x: 400, y: 0 })
  p = addInstance(p, part, { id: 'u3', x: 800, y: 0 })
  return p
}

function withWire(p: Project, wire: Partial<Wire> = {}): Project {
  const r = connect(p, { id: 'w', from: { instanceId: 'u1', pinId: 'R' }, to: { instanceId: 'u3', pinId: 'L' }, color: '#f00', width: 2, ...wire })
  if (!r.ok) throw new Error(r.error)
  return r.project
}

const pathOf = (p: Project, id = 'w'): Point[] => {
  const w = p.wires.find((x) => x.id === id)!
  return wirePath(endPosition(p, w.from)!, w.points, endPosition(p, w.to)!, w.orthogonal)
}
const boxes = (p: Project) => p.instances.map((i) => ({ id: i.id, rect: instanceBounds(i, p.parts[i.partId]) }))
const crossesOthers = (p: Project, id = 'w') => {
  const w = p.wires.find((x) => x.id === id)!
  const own = new Set([w.from, w.to].flatMap((e) => ('instanceId' in e ? [e.instanceId] : [])))
  return pathCrossesParts(pathOf(p, id), boxes(p), own)
}

describe('가로지름 판정', () => {
  const r = { x: 0, y: 0, width: 100, height: 50 }
  it('안쪽을 지나면 가로지름, 가장자리를 따라가거나 밖이면 아님', () => {
    expect(segmentCrossesRect({ x: -10, y: 25 }, { x: 110, y: 25 }, r)).toBe(true)
    expect(segmentCrossesRect({ x: 50, y: -10 }, { x: 50, y: 10 }, r)).toBe(true)
    expect(segmentCrossesRect({ x: -10, y: 0 }, { x: 110, y: 0 }, r)).toBe(false) // 위 가장자리
    expect(segmentCrossesRect({ x: 100, y: -10 }, { x: 100, y: 60 }, r)).toBe(false) // 오른쪽 가장자리
    expect(segmentCrossesRect({ x: -10, y: 60 }, { x: 110, y: 60 }, r)).toBe(false)
    expect(segmentCrossesRect({ x: -10, y: -10 }, { x: 20, y: 20 }, r)).toBe(true) // 비스듬히 모서리 안으로
    expect(segmentCrossesRect({ x: -10, y: 10 }, { x: 10, y: -10 }, r)).toBe(false) // 모서리 바깥을 스침
  })
})

describe('avoidParts', () => {
  it('가운데 부품을 가로지르는 새 전선 → 돌아가고, 양 끝은 그대로', () => {
    const before = withWire(row(), { orthogonal: true })
    expect(crossesOthers(before)).toBe(true)
    const after = avoidParts(before, { wires: ['w'] })
    expect(crossesOthers(after)).toBe(false)
    const path = pathOf(after)
    expect(path[0]).toEqual(pathOf(before)[0])
    expect(path[path.length - 1]).toEqual(pathOf(before)[pathOf(before).length - 1])
    expect(after.wires[0].orthogonal).toBe(true)
    expect(before.wires[0].points).toBeUndefined() // 입력은 그대로
  })

  it('비스듬한(직선) 전선도 피해 간다', () => {
    const after = avoidParts(withWire(row()), { wires: ['w'] })
    expect(crossesOthers(after)).toBe(false)
  })

  it('가로지르지 않으면 같은 객체 (사용자가 그린 모양 유지)', () => {
    const p = withWire(row(), { points: [{ x: 120, y: -300 }, { x: 680, y: -300 }], orthogonal: true })
    expect(crossesOthers(p)).toBe(false)
    expect(avoidParts(p, { wires: ['w'] })).toBe(p)
  })

  it('직접 찍은 꺾임점을 거쳐 간다, 부품 안에 찍힌 점은 바깥으로 옮긴다', () => {
    const via = { x: 400, y: 300 } // 아래로 크게 돌아가는 경유지
    const after = avoidParts(withWire(row(), { points: [via], orthogonal: true }), { wires: ['w'] })
    // 원래 경로가 가운데 부품을 가로지르지 않으면 그대로이므로, 가로지르게 만든 경우만 확인
    expect(crossesOthers(after)).toBe(false)
    const inside = avoidParts(withWire(row(), { points: [{ x: 400, y: 10 }], orthogonal: true }), { wires: ['w'] })
    expect(crossesOthers(inside)).toBe(false)
    const b = boxes(inside).find((x) => x.id === 'u2')!.rect
    for (const q of inside.wires[0].points ?? []) {
      expect(q.x > b.x && q.x < b.x + b.width && q.y > b.y && q.y < b.y + b.height).toBe(false)
    }
  })

  it('경유지를 실제로 지난다', () => {
    // 가운데 부품을 가로지르고, 위쪽 경유지를 거치는 전선
    const via = { x: 600, y: -250 }
    const p = withWire(row(), { points: [{ x: 300, y: 0 }, via], orthogonal: false })
    expect(crossesOthers(p)).toBe(true)
    const path = pathOf(avoidParts(p, { wires: ['w'] }))
    const onPath = path.slice(1).some((q, k) => {
      const a = path[k]
      return Math.min(a.x, q.x) <= via.x && via.x <= Math.max(a.x, q.x) && Math.min(a.y, q.y) <= via.y && via.y <= Math.max(a.y, q.y)
    })
    expect(onPath).toBe(true)
  })

  it('부품을 전선 위로 옮기면 그 전선만 비킨다, 관련 없는 옛 가로지름은 건드리지 않는다', () => {
    // U2를 위로 치워 두고 U1-U3를 일직선으로 잇는다
    let p = moveInstances(row(), ['u2'], 0, -600)
    p = withWire(p, { orthogonal: true })
    p = addInstance(p, part, { id: 'far', x: 0, y: 2000 }) // 전선과 관련 없는 부품
    expect(crossesOthers(p)).toBe(false)
    const moved = moveInstances(p, ['u2'], 0, 600) // 다시 가운데로 → 전선을 가로막음
    expect(crossesOthers(moved)).toBe(true)
    const after = avoidParts(moved, { instances: ['u2'] })
    expect(crossesOthers(after)).toBe(false)
    // 바뀐 것(먼 부품)과 관련 없으면 가로질러도 그대로
    expect(avoidParts(moved, { instances: ['far'] })).toBe(moved)
  })

  it('피할 길이 없으면(핀이 남의 사진 안) 그대로', () => {
    let p = row()
    p = moveInstances(p, ['u2'], 330, 0) // U2가 U3와 겹쳐 U3 왼쪽 핀이 U2 사진 안
    p = withWire(p, { orthogonal: true })
    expect(avoidParts(p, { wires: ['w'] })).toBe(p)
  })
})

describe('배선 정리도 부품을 가로지르지 않는다', () => {
  it('돌아가는 길이 길어도 가로지르지 않는다', () => {
    const p = routeWires(withWire(row()), ['w'])
    expect(crossesOthers(p)).toBe(false)
  })
})
