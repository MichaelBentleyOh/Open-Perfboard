import { describe, expect, it } from 'vitest'
import { evenPoints, pinsOnGuide, projectOnGuide, respacePins, snapToGuides, straighten, type Guide } from '@core/guide'
import type { Pin } from '@core/model'

const g: Guide = { id: 'g', a: { x: 0.1, y: 0.5 }, b: { x: 0.9, y: 0.5 } }
const pin = (id: string, x: number, y: number): Pin => ({ id, number: id, x, y })
const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9)
  expect(p.y).toBeCloseTo(y, 9)
}

describe('보조선', () => {
  it('evenPoints: 양 끝을 포함해 같은 간격, 하나면 가운데', () => {
    const pts = evenPoints(g.a, g.b, 5)
    expect(pts).toHaveLength(5)
    ;[0.1, 0.3, 0.5, 0.7, 0.9].forEach((x, i) => close(pts[i], x, 0.5))
    close(evenPoints(g.a, g.b, 1)[0], 0.5, 0.5)
    expect(evenPoints(g.a, g.b, 0)).toEqual([])
  })

  it('projectOnGuide: 선분 위 가장 가까운 점, 끝을 넘으면 끝점', () => {
    const r = projectOnGuide({ x: 0.3, y: 0.6 }, g)
    close(r.point, 0.3, 0.5)
    expect(r.t).toBeCloseTo(0.25)
    expect(r.distance).toBeCloseTo(0.1)
    close(projectOnGuide({ x: 1, y: 0.5 }, g).point, 0.9, 0.5)
  })

  it('snapToGuides: 허용 거리 안이면 선 위로, 멀면 undefined. 거리는 화면 크기(scale)로 잰다', () => {
    close(snapToGuides({ x: 0.4, y: 0.52 }, [g], 0.03)!, 0.4, 0.5)
    expect(snapToGuides({ x: 0.4, y: 0.6 }, [g], 0.03)).toBeUndefined()
    // 사진이 세로로 400px이면 0.02 = 8px → 10px 안
    close(snapToGuides({ x: 0.4, y: 0.52 }, [g], 10, { x: 800, y: 400 })!, 0.4, 0.5)
    expect(snapToGuides({ x: 0.4, y: 0.54 }, [g], 10, { x: 800, y: 400 })).toBeUndefined()
  })

  it('pinsOnGuide / respacePins: 선 위 핀만 a → b 순서, 첫·끝 핀 사이를 같은 간격으로', () => {
    const pins = [pin('c', 0.8, 0.5), pin('a', 0.2, 0.5), pin('b', 0.35, 0.501), pin('off', 0.5, 0.9)]
    expect(pinsOnGuide(pins, g, 0.01).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    const moved = respacePins(pins, g, 0.01)
    expect(moved.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    close(moved[0], 0.2, 0.5)
    close(moved[1], 0.5, 0.5)
    close(moved[2], 0.8, 0.5)
  })

  it('straighten: 수평·수직에 가까우면 맞추고, 비스듬하면 그대로', () => {
    expect(straighten({ x: 0, y: 0 }, { x: 1, y: 0.05 }, 8)).toEqual({ x: 1, y: 0 })
    expect(straighten({ x: 0, y: 0 }, { x: 0.05, y: 1 }, 8)).toEqual({ x: 0, y: 1 })
    expect(straighten({ x: 0, y: 0 }, { x: 1, y: 1 }, 8)).toEqual({ x: 1, y: 1 })
    // 가로로 긴 사진에서는 실제 각도로 판단
    expect(straighten({ x: 0, y: 0 }, { x: 0.1, y: 0.1 }, 8, { x: 1000, y: 100 })).toEqual({ x: 0.1, y: 0 })
  })
})
