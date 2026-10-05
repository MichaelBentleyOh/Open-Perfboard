import { describe, expect, it } from 'vitest'
import type { Point, Rect } from '@core/geometry'
import { endPosition } from '@core/ends'
import { routeWires, updateWires } from '@core/ops'
import { compressPath, routeAll } from '@core/route'
import { wirePath } from '@core/wire'
import { loadSample } from '../helpers'

const isOrthogonal = (path: Point[]) => path.slice(1).every((q, i) => q.x === path[i].x || q.y === path[i].y)
const bends = (path: Point[]) => compressPath(path).length - 2

/** 선분이 사각형 안쪽을 지나는지 */
function crossesRect(path: Point[], r: Rect): boolean {
  return path.slice(1).some((q, i) => {
    const p = path[i]
    const [x0, x1] = [Math.min(p.x, q.x), Math.max(p.x, q.x)]
    const [y0, y1] = [Math.min(p.y, q.y), Math.max(p.y, q.y)]
    return x1 > r.x && x0 < r.x + r.width && y1 > r.y && y0 < r.y + r.height
  })
}

describe('routeAll', () => {
  it('막힌 것이 없으면 일직선, 대각 위치면 한 번만 꺾는다', () => {
    const r = routeAll(
      [
        { id: 's', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
        { id: 'l', a: { x: 0, y: 200 }, b: { x: 200, y: 300 } }
      ],
      []
    )
    expect(r.s).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }])
    expect(bends(r.l)).toBe(1)
    expect(isOrthogonal(r.l)).toBe(true)
  })

  it('격자에 맞지 않는 핀에서도 정확히 시작하고 끝난다', () => {
    const a = { x: 3.3, y: 7.7 }
    const b = { x: 105.1, y: 57.2 }
    const { w } = routeAll([{ id: 'w', a, b }], [])
    expect(w[0]).toEqual(a)
    expect(w[w.length - 1]).toEqual(b)
    expect(isOrthogonal(w)).toBe(true)
  })

  it('가운데 부품 사진을 돌아간다', () => {
    const rect = { x: 100, y: -50, width: 100, height: 100 }
    const { w } = routeAll([{ id: 'w', a: { x: 0, y: 0 }, b: { x: 300, y: 0 } }], [{ rect, owner: 'U9' }])
    expect(crossesRect(w, rect)).toBe(false)
    expect(isOrthogonal(w)).toBe(true)
  })

  it('끝점이 자기 부품 안에 있어도 경로가 나오고, 남의 부품은 피한다', () => {
    const own = { x: -50, y: -50, width: 100, height: 100 }
    const other = { x: 150, y: -60, width: 60, height: 120 }
    const { w } = routeAll(
      [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, aOwner: 'U1' }],
      [
        { rect: own, owner: 'U1' },
        { rect: other, owner: 'U2' }
      ]
    )
    expect(w[0]).toEqual({ x: 0, y: 0 })
    expect(crossesRect(w, other)).toBe(false)
  })

  it('다른 전선이 차지한 줄에 겹치지 않는다', () => {
    const fixed = [[{ x: 50, y: 0 }, { x: 250, y: 0 }]]
    const { w } = routeAll([{ id: 'w', a: { x: 0, y: 0 }, b: { x: 300, y: 0 } }], [], fixed)
    const onLine = w.slice(1).some((q, i) => q.y === 0 && w[i].y === 0 && Math.max(q.x, w[i].x) > 60 && Math.min(q.x, w[i].x) < 240)
    expect(onLine).toBe(false)
  })

  it('끝점이 아닌 핀 위를 지나지 않는다 (이어진 것처럼 보이므로), 자기 끝점 핀은 괜찮다', () => {
    const pin = { x: 100, y: 0 }
    const { w } = routeAll([{ id: 'w', a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }], [], [], [pin, { x: 0, y: 0 }, { x: 200, y: 0 }])
    const near = w.slice(1).some((q, i) => {
      const p = w[i]
      const dx = Math.max(0, Math.min(p.x, q.x) - pin.x, pin.x - Math.max(p.x, q.x))
      const dy = Math.max(0, Math.min(p.y, q.y) - pin.y, pin.y - Math.max(p.y, q.y))
      return Math.max(dx, dy) <= 8
    })
    expect(near).toBe(false)
    expect(w[0]).toEqual({ x: 0, y: 0 })
  })

  it('나란한 두 전선은 같은 줄을 쓰지 않는다 (먼저 정리한 쪽이 곧게)', () => {
    const r = routeAll(
      [
        { id: 'p', a: { x: 0, y: 0 }, b: { x: 200, y: 0 } },
        { id: 'q', a: { x: -20, y: 0 }, b: { x: 220, y: 0 } }
      ],
      []
    )
    expect(r.p).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0 }])
    const shared = r.q.slice(1).some((q, i) => q.y === 0 && r.q[i].y === 0 && Math.max(q.x, r.q[i].x) > 10 && Math.min(q.x, r.q[i].x) < 190)
    expect(shared).toBe(false)
  })
})

describe('routeAll 성능', () => {
  it('부품 12개, 전선 40개도 빠르게 (2초 이내)', () => {
    const obstacles = Array.from({ length: 12 }, (_, k) => ({
      rect: { x: (k % 4) * 400, y: Math.floor(k / 4) * 400, width: 240, height: 240 },
      owner: `U${k}`
    }))
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const pinOf = (k: number) => ({ x: (k % 4) * 400 + 20 + rnd() * 200, y: Math.floor(k / 4) * 400 + 20 + rnd() * 200 })
    const requests = Array.from({ length: 40 }, (_, n) => {
      const i = n % 12
      const j = (n * 5 + 3) % 12
      return { id: `w${n}`, a: pinOf(i), b: pinOf(j === i ? (j + 1) % 12 : j), aOwner: `U${i}`, bOwner: `U${j}` }
    })
    const t = performance.now()
    const r = routeAll(requests, obstacles)
    expect(performance.now() - t).toBeLessThan(2000)
    expect(Object.keys(r)).toHaveLength(40)
  })
})

describe('routeWires', () => {
  it('전선을 직각으로 바꾸고 양 끝은 그대로, 다시 정리하면 바뀌지 않는다', () => {
    const p = loadSample()
    const ids = p.wires.map((w) => w.id)
    const routed = routeWires(p, ids)
    expect(routed).not.toBe(p)
    for (const w of routed.wires) {
      expect(w.orthogonal).toBe(true)
      const path = wirePath(endPosition(routed, w.from)!, w.points, endPosition(routed, w.to)!, true)
      expect(isOrthogonal(path)).toBe(true)
    }
    expect(routeWires(routed, ids)).toBe(routed)
    expect(p.wires[0].orthogonal).toBeUndefined() // 입력은 그대로
  })

  it('고른 전선만 바뀐다', () => {
    const p = updateWires(loadSample(), [], {})
    const [first, ...rest] = p.wires
    const routed = routeWires(p, [first.id])
    expect(routed.wires.slice(1)).toEqual(rest)
  })
})

describe('routeAll: 끝점 부품 (자기 부품)', () => {
  // 부품 A (0,0)–(200,200), 사진 안은 지나갈 수 없음
  const A = { x: 0, y: 0, width: 200, height: 200 }
  const obstacles = [{ rect: A, owner: 'A', hard: A }]
  const insideA = (path: Point[]) =>
    path.slice(1).reduce((sum, q, i) => {
      const p = path[i]
      if (p.y === q.y && p.y > A.y && p.y < A.y + A.height) {
        return sum + Math.max(0, Math.min(Math.max(p.x, q.x), A.x + A.width) - Math.max(Math.min(p.x, q.x), A.x))
      }
      if (p.x === q.x && p.x > A.x && p.x < A.x + A.width) {
        return sum + Math.max(0, Math.min(Math.max(p.y, q.y), A.y + A.height) - Math.max(Math.min(p.y, q.y), A.y))
      }
      return sum
    }, 0)

  it('왼쪽 가장자리 근처 핀 → 오른쪽 멀리: 부품을 가로지르지 않고 가까운 가장자리로 곧게 빠져나간다', () => {
    const { w } = routeAll([{ id: 'w', a: { x: 20, y: 100 }, b: { x: 500, y: 100 }, aOwner: 'A' }], obstacles)
    expect(w[0]).toEqual({ x: 20, y: 100 })
    // 왼쪽 가장자리 너머까지 곧게 (가장자리에서 꺾지 않고 이어 가면 그 점은 합쳐진다)
    expect(w[1].y).toBe(100)
    expect(w[1].x).toBeLessThanOrEqual(0)
    expect(insideA(w)).toBe(20)
    expect(isOrthogonal(w)).toBe(true)
  })

  it('목표 쪽으로도 같다: 오른쪽 멀리서 → 왼쪽 가장자리 근처 핀으로 곧게 들어간다', () => {
    const { w } = routeAll([{ id: 'w', a: { x: 500, y: 100 }, b: { x: 20, y: 100 }, bOwner: 'A' }], obstacles)
    expect(w[w.length - 2].y).toBe(100)
    expect(w[w.length - 2].x).toBeLessThanOrEqual(0)
    expect(insideA(w)).toBe(20)
  })

  it('같은 부품의 두 핀: 각자 가까운 가장자리로 빠져나가 바깥으로 잇는다', () => {
    const { w } = routeAll([{ id: 'w', a: { x: 20, y: 100 }, b: { x: 180, y: 100 }, aOwner: 'A', bOwner: 'A' }], obstacles)
    expect(insideA(w)).toBe(40)
  })

  it('나란한 이웃 핀은 사진 안에서 곧게 바로 잇는다 (돌아가는 것보다 짧다)', () => {
    const { w } = routeAll([{ id: 'w', a: { x: 100, y: 20 }, b: { x: 110, y: 20 }, aOwner: 'A', bOwner: 'A' }], obstacles)
    expect(w).toEqual([{ x: 100, y: 20 }, { x: 110, y: 20 }])
  })
})
