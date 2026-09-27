import { describe, expect, it } from 'vitest'
import type { Point } from '@core/geometry'
import { tidyWires, updateWires, wiresOf } from '@core/ops'
import { JOG_MAX, simplifyBends, wirePath } from '@core/wire'
import { loadSample } from '../helpers'

/** 실제로 그려지는 꺾는 점 수 (양 끝 제외) */
const corners = (a: Point, pts: Point[], b: Point, ortho: boolean) => {
  const path = wirePath(a, pts, b, ortho)
  let n = 0
  for (let i = 1; i < path.length - 1; i++) {
    const [p, q, r] = [path[i - 1], path[i], path[i + 1]]
    const collinear = (p.x === q.x && q.x === r.x) || (p.y === q.y && q.y === r.y)
    if (!collinear) n++
  }
  return n
}

/** 실제로 꺾이는 점만 남긴 모양 (일직선 위의 점 제거) */
const shape = (path: Point[]) =>
  path.filter((q, i) => {
    if (i === 0 || i === path.length - 1) return true
    const [p, r] = [path[i - 1], path[i + 1]]
    return !((p.x === q.x && q.x === r.x) || (p.y === q.y && q.y === r.y))
  })

const isOrthogonal = (path: Point[]) => path.every((q, i) => i === 0 || q.x === path[i - 1].x || q.y === path[i - 1].y)

describe('simplifyBends (직각)', () => {
  it('잔 계단을 하나의 ㄱ자로', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 100, y: 100 }
    const stairs = [{ x: 20, y: 10 }, { x: 40, y: 20 }, { x: 60, y: 30 }]
    expect(corners(a, stairs, b, true)).toBeGreaterThan(3)
    const tidy = simplifyBends(a, stairs, b, true)
    expect(corners(a, tidy, b, true)).toBe(1)
    expect(tidy).toEqual([]) // 남은 ㄱ자는 자동으로 다시 생기므로 저장하지 않는다
  })

  it('일직선 위의 점, 겹친 점을 없앤다', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 100, y: 80 }
    expect(simplifyBends(a, [{ x: 50, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], b, true)).toEqual([])
  })

  it('되돌아가는 지그재그를 없앤다', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 200, y: 0 }
    // 오른쪽으로 갔다가 살짝 위로 튀었다가 다시 오른쪽
    const zig = [{ x: 80, y: 0 }, { x: 80, y: -15 }, { x: 110, y: -15 }, { x: 110, y: 0 }]
    expect(simplifyBends(a, zig, b, true)).toEqual([])
  })

  it('두 핀 사이에 꼭 필요한 Z자는 남긴다 (저장은 최소 1점)', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 100, y: 20 }
    const z = [{ x: 50, y: 0 }, { x: 50, y: 20 }] // → 가운데서 세로로 내려가는 Z
    const tidy = simplifyBends(a, z, b, true)
    expect(shape(wirePath(a, tidy, b, true))).toEqual(shape(wirePath(a, z, b, true)))
    expect(tidy).toEqual([{ x: 50, y: 20 }]) // (50,0)은 자동으로 다시 생긴다
  })

  it(`${JOG_MAX}보다 긴 우회로는 남긴다`, () => {
    const a = { x: 0, y: 0 }
    const b = { x: 200, y: 0 }
    const detour = [{ x: 50, y: -80 }, { x: 150, y: -80 }]
    const tidy = simplifyBends(a, detour, b, true)
    expect(shape(wirePath(a, tidy, b, true))).toEqual(shape(wirePath(a, detour, b, true)))
  })

  it('속성 검사: 무작위 경로 200개 — 같은 핀을 잇고, 직각이고, 꺾임이 늘지 않는다', () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const grid = () => Math.round(rnd() * 30) * 10 - 150
    for (let t = 0; t < 200; t++) {
      const a = { x: grid() + 3.7, y: grid() - 1.2 } // 핀은 격자 밖일 수 있다
      const b = { x: grid() - 2.1, y: grid() + 4.4 }
      const pts = Array.from({ length: Math.floor(rnd() * 6) }, () => ({ x: grid(), y: grid() }))
      const tidy = simplifyBends(a, pts, b, true)
      const path = wirePath(a, tidy, b, true)
      expect(path[0]).toEqual(a)
      expect(path[path.length - 1]).toEqual(b)
      expect(isOrthogonal(path)).toBe(true)
      expect(corners(a, tidy, b, true)).toBeLessThanOrEqual(corners(a, pts, b, true))
      // 한 번 더 정리해도 같다 (안정)
      expect(simplifyBends(a, tidy, b, true)).toEqual(tidy)
    }
  })
})

describe('simplifyBends (직선)', () => {
  it('겹친 점, 거의 일직선 위의 점 제거, 진짜 꺾임은 유지', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 100, y: 0 }
    expect(simplifyBends(a, [{ x: 50, y: 1 }, { x: 52, y: 1 }], b)).toEqual([])
    expect(simplifyBends(a, [{ x: 50, y: 40 }], b)).toEqual([{ x: 50, y: 40 }])
  })
})

describe('tidyWires', () => {
  it('전선의 꺾임점을 정리하고, 바뀐 게 없으면 같은 객체', () => {
    // 샘플 w1: CN1.+ (중심 400,100 기준) → U1.1
    const p = updateWires(loadSample(), ['w1'], { points: [{ x: 250, y: 0 }, { x: 250, y: 0 }], orthogonal: true })
    const t = tidyWires(p, ['w1'])
    expect(t.wires[0].points?.length ?? 0).toBeLessThan(2)
    expect(tidyWires(t, ['w1'])).toBe(t)
  })

  it('wiresOf: 부품에 연결된 전선', () => {
    expect(wiresOf(loadSample(), ['i1'])).toEqual(['w1', 'w2'])
    expect(wiresOf(loadSample(), [])).toEqual([])
  })
})

describe('단조 계단', () => {
  it('단이 길어도 같은 방향으로만 가는 계단은 ㄱ자로 (경로 길이는 그대로)', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 300, y: 300 }
    const stairs = [{ x: 60, y: 50 }, { x: 120, y: 100 }, { x: 180, y: 150 }, { x: 240, y: 200 }]
    const tidy = simplifyBends(a, stairs, b, true)
    expect(corners(a, tidy, b, true)).toBe(1)
    const manhattan = (path: Point[]) => path.slice(1).reduce((s, q, i) => s + Math.abs(q.x - path[i].x) + Math.abs(q.y - path[i].y), 0)
    expect(manhattan(wirePath(a, tidy, b, true))).toBe(manhattan(wirePath(a, stairs, b, true)))
  })
})
