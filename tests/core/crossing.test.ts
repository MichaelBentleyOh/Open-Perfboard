import { describe, expect, it } from 'vitest'
import { HOP_RADIUS, findCrossings, hopDrawOps, type DrawOp } from '@core/crossing'

const H = { id: 'h', path: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } // 가로
const V = { id: 'v', path: [{ x: 50, y: -50 }, { x: 50, y: 50 }] } // 세로

describe('findCrossings', () => {
  it('가로-세로 교차: 가로선이 점프한다 (순서와 무관)', () => {
    expect(findCrossings([H, V])).toEqual({ h: [{ segment: 0, point: { x: 50, y: 0 } }] })
    expect(findCrossings([V, H])).toEqual({ h: [{ segment: 0, point: { x: 50, y: 0 } }] })
  })

  it('T자로 만나거나 끝점에서 만나면 점프하지 않는다', () => {
    const T = { id: 't', path: [{ x: 50, y: 0 }, { x: 50, y: 50 }] }
    const corner = { id: 'c', path: [{ x: 100, y: 0 }, { x: 100, y: 50 }] }
    expect(findCrossings([H, T, corner])).toEqual({})
  })

  it('끝점에 너무 가까워 반원이 안 들어가면 점프하지 않는다', () => {
    const near = { id: 'n', path: [{ x: 3, y: -50 }, { x: 3, y: 50 }] }
    expect(findCrossings([H, near])).toEqual({})
  })

  it('평행·겹침은 교차가 아니다', () => {
    const parallel = { id: 'p', path: [{ x: 0, y: 10 }, { x: 100, y: 10 }] }
    const overlap = { id: 'o', path: [{ x: 20, y: 0 }, { x: 80, y: 0 }] }
    expect(findCrossings([H, parallel, overlap])).toEqual({})
  })

  it('대각선끼리는 목록에서 뒤의 전선이 점프, 꺾인 경로의 구간 번호', () => {
    const d1 = { id: 'd1', path: [{ x: 0, y: 0 }, { x: 100, y: 100 }] }
    const d2 = { id: 'd2', path: [{ x: -20, y: 50 }, { x: 0, y: 100 }, { x: 100, y: 0 }] }
    const r = findCrossings([d1, d2])
    expect(Object.keys(r)).toEqual(['d2'])
    expect(r.d2[0].segment).toBe(1)
    expect(r.d2[0].point.x).toBeCloseTo(50)
    expect(r.d2[0].point.y).toBeCloseTo(50)
  })

  it('한 전선이 여러 번 교차하면 점프도 여러 개', () => {
    const V2 = { id: 'v2', path: [{ x: 80, y: -50 }, { x: 80, y: 50 }] }
    expect(findCrossings([H, V, V2]).h.map((h) => h.point.x)).toEqual([50, 80])
  })
})

describe('hopDrawOps', () => {
  const kinds = (ops: DrawOp[]) => ops.map((o) => o.kind)

  it('점프가 없으면 선만', () => {
    expect(hopDrawOps(H.path)).toEqual([
      { kind: 'move', p: { x: 0, y: 0 } },
      { kind: 'line', p: { x: 100, y: 0 } }
    ])
  })

  it('점프 앞까지 선 → 반원 → 끝까지 선. 가로선의 반원은 위로 볼록', () => {
    const ops = hopDrawOps(H.path, [{ segment: 0, point: { x: 50, y: 0 } }])
    expect(kinds(ops)).toEqual(['move', 'line', 'arc', 'line'])
    expect(ops[1]).toEqual({ kind: 'line', p: { x: 50 - HOP_RADIUS, y: 0 } })
    const arc = ops[2] as Extract<DrawOp, { kind: 'arc' }>
    // 반원 가운데 각도 방향이 위(-y)
    const mid = arc.anticlockwise ? (arc.start + arc.end) / 2 : (arc.start + arc.end + 2 * Math.PI) / 2
    expect(Math.sin(mid)).toBeCloseTo(-1)
  })

  it('오른쪽에서 왼쪽으로 가는 가로선도 위로 볼록', () => {
    const ops = hopDrawOps([{ x: 100, y: 0 }, { x: 0, y: 0 }], [{ segment: 0, point: { x: 50, y: 0 } }])
    const arc = ops[2] as Extract<DrawOp, { kind: 'arc' }>
    const mid = arc.anticlockwise ? (arc.start + arc.end) / 2 : (arc.start + arc.end + 2 * Math.PI) / 2
    expect(Math.sin(mid)).toBeCloseTo(-1)
  })

  it('세로선의 반원은 오른쪽으로 볼록', () => {
    for (const path of [V.path, [...V.path].reverse()]) {
      const arc = hopDrawOps(path, [{ segment: 0, point: { x: 50, y: 0 } }])[2] as Extract<DrawOp, { kind: 'arc' }>
      const mid = arc.anticlockwise ? (arc.start + arc.end) / 2 : (arc.start + arc.end + 2 * Math.PI) / 2
      expect(Math.cos(mid)).toBeCloseTo(1)
    }
  })
})

describe('findCrossings: 가까운 구간만 비교해도 모든 쌍을 비교한 예전 방식과 결과가 같다', () => {
  type P = { x: number; y: number }
  /** 예전 구현 그대로 (모든 전선 쌍 × 모든 구간 쌍) */
  function reference(wires: { id: string; path: P[] }[], r = HOP_RADIUS) {
    const EPS = 1e-9
    const hor = (a: P, b: P) => Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) > EPS
    const ver = (a: P, b: P) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) > EPS
    const dist = (p: P, q: P) => Math.hypot(p.x - q.x, p.y - q.y)
    const cross = (a: P, b: P, c: P, d: P): P | undefined => {
      const rr = { x: b.x - a.x, y: b.y - a.y }
      const s = { x: d.x - c.x, y: d.y - c.y }
      const den = rr.x * s.y - rr.y * s.x
      if (Math.abs(den) < EPS) return undefined
      const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den
      const u = ((c.x - a.x) * rr.y - (c.y - a.y) * rr.x) / den
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return undefined
      const p = { x: a.x + rr.x * t, y: a.y + rr.y * t }
      return [a, b, c, d].some((q) => dist(p, q) < r) ? undefined : p
    }
    const hops: Record<string, { segment: number; point: P }[]> = {}
    const add = (id: string, hop: { segment: number; point: P }) => {
      const list = (hops[id] ??= [])
      if (list.some((h) => h.segment === hop.segment && dist(h.point, hop.point) < r * 2)) return
      list.push(hop)
    }
    for (let i = 0; i < wires.length; i++)
      for (let j = i + 1; j < wires.length; j++) {
        const pa = wires[i].path
        const pb = wires[j].path
        for (let s = 0; s < pa.length - 1; s++)
          for (let k = 0; k < pb.length - 1; k++) {
            const p = cross(pa[s], pa[s + 1], pb[k], pb[k + 1])
            if (!p) continue
            if (hor(pa[s], pa[s + 1]) && ver(pb[k], pb[k + 1])) add(wires[i].id, { segment: s, point: p })
            else add(wires[j].id, { segment: k, point: p })
          }
      }
    return hops
  }

  it('무작위 직각·대각선 전선 300개 (칸 경계에 걸친 구간 포함)', () => {
    let seed = 7
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const pt = () => ({ x: Math.round(rand() * 200) * 10, y: Math.round(rand() * 200) * 10 })
    const wires = Array.from({ length: 300 }, (_, n) => {
      const a = pt()
      const b = pt()
      const path = n % 3 === 0 ? [a, b] : [a, { x: b.x, y: a.y }, b]
      return { id: `w${n}`, path }
    })
    const expected = reference(wires)
    expect(Object.values(expected).flat().length).toBeGreaterThan(500) // 교차가 충분히 있어야 의미 있는 비교
    expect(findCrossings(wires)).toEqual(expected)
  })
})
