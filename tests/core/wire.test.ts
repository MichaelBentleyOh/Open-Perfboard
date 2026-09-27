import { describe, expect, it } from 'vitest'
import { rectFromPoints } from '@core/geometry'
import { insertWirePoint, moveInstances, moveWirePoint, removeWirePoint, updateWires } from '@core/ops'
import { selectInRect } from '@core/selection'
import { parseProject, serializeProject } from '@core/serialize'
import { flatten, nearestSegment, pathMidpoint, snapPoint, wirePath } from '@core/wire'
import { loadSample } from '../helpers'

const A = { x: 0, y: 0 }
const B = { x: 100, y: 50 }

describe('wirePath', () => {
  it('직선: 핀 → 꺾임점 → 핀 그대로', () => {
    expect(wirePath(A, [{ x: 30, y: 80 }], B)).toEqual([A, { x: 30, y: 80 }, B])
  })

  it('직각: 비스듬한 구간마다 가로 먼저 꺾는다', () => {
    expect(wirePath(A, [], B, true)).toEqual([A, { x: 100, y: 0 }, B])
    expect(wirePath(A, [{ x: 50, y: 80 }], B, true)).toEqual([A, { x: 50, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 80 }, B])
  })

  it('직각: 이미 가로·세로로 맞으면 점을 더 넣지 않는다', () => {
    expect(wirePath(A, [{ x: 0, y: 50 }], B, true)).toEqual([A, { x: 0, y: 50 }, B])
  })

  it('직각 경로의 모든 구간은 가로 또는 세로', () => {
    const path = wirePath({ x: 3, y: 7 }, [{ x: 41, y: -20 }, { x: 90, y: 33 }], { x: -15, y: 60 }, true)
    for (let i = 1; i < path.length; i++) {
      expect(path[i].x === path[i - 1].x || path[i].y === path[i - 1].y).toBe(true)
    }
  })

  it('flatten', () => {
    expect(flatten([A, B])).toEqual([0, 0, 100, 50])
  })
})

describe('pathMidpoint / snapPoint / nearestSegment', () => {
  it('경로 길이의 절반 지점', () => {
    expect(pathMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])).toEqual({ x: 100, y: 0 })
    expect(pathMidpoint([{ x: 0, y: 0 }, { x: 40, y: 0 }])).toEqual({ x: 20, y: 0 })
  })

  it('10단위 격자에 맞춘다', () => {
    expect(snapPoint({ x: 14, y: -26 })).toEqual({ x: 10, y: -30 })
    expect(Object.is(snapPoint({ x: -3, y: 0 }).x, 0)).toBe(true) // -0이 아니라 0
  })

  it('가장 가까운 구간', () => {
    const nodes = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
    expect(nearestSegment(nodes, { x: 50, y: 5 })).toBe(0)
    expect(nearestSegment(nodes, { x: 95, y: 60 })).toBe(1)
  })
})

describe('꺾임점 편집', () => {
  const withPoints = () => updateWires(loadSample(), ['w1'], { points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], orthogonal: true })

  it('이동·추가·삭제', () => {
    let p = moveWirePoint(withPoints(), 'w1', 1, { x: 25, y: 30 })
    expect(p.wires[0].points).toEqual([{ x: 10, y: 10 }, { x: 25, y: 30 }])
    p = insertWirePoint(p, 'w1', 1, { x: 15, y: 15 })
    expect(p.wires[0].points).toEqual([{ x: 10, y: 10 }, { x: 15, y: 15 }, { x: 25, y: 30 }])
    p = removeWirePoint(removeWirePoint(removeWirePoint(p, 'w1', 0), 'w1', 0), 'w1', 0)
    expect(p.wires[0]).not.toHaveProperty('points') // 다 지우면 필드 자체가 사라진다
  })

  it('직각 끄기 = 필드 삭제', () => {
    expect(updateWires(withPoints(), ['w1'], { orthogonal: false }).wires[0]).not.toHaveProperty('orthogonal')
  })

  it('양 끝 부품을 함께 옮기면 꺾임점도 옮긴다, 한쪽만 옮기면 그대로', () => {
    const both = moveInstances(withPoints(), ['i1', 'i2'], 5, -5)
    expect(both.wires[0].points).toEqual([{ x: 15, y: 5 }, { x: 25, y: 15 }])
    const one = moveInstances(withPoints(), ['i1'], 5, -5)
    expect(one.wires[0].points).toEqual([{ x: 10, y: 10 }, { x: 20, y: 20 }])
  })

  it('선택 사각형: 꺾임점이 밖에 있으면 전선은 선택되지 않는다', () => {
    const p = updateWires(loadSample(), ['w1'], { points: [{ x: 250, y: 900 }] })
    const hit = selectInRect(p, rectFromPoints({ x: -200, y: -200 }, { x: 600, y: 300 }))
    expect(hit.wires).toEqual(['w2'])
  })

  it('파일 왕복, 잘못된 꺾임점은 거부', () => {
    const p = withPoints()
    const again = parseProject(serializeProject(p))
    expect(again.ok && again.value.wires[0]).toMatchObject({ points: [{ x: 10, y: 10 }, { x: 20, y: 20 }], orthogonal: true })

    const raw = JSON.parse(serializeProject(p))
    raw.wires[0].points[1].y = 'a'
    const bad = parseProject(JSON.stringify(raw))
    expect(bad.ok ? [] : bad.errors).toContain('wires[0].points[1].y: 숫자여야 합니다')
  })
})
