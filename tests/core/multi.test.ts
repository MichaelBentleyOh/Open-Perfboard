import { describe, expect, it } from 'vitest'
import { instanceBounds, rectFromPoints } from '@core/geometry'
import {
  moveInstances,
  removeItems,
  replacePartDef,
  rotateInstances,
  updateWires
} from '@core/ops'
import { mergeSelection, selectInRect } from '@core/selection'
import { loadSample } from '../helpers'

// 샘플: U1(제어 보드) 중심 (100,100), CN1(전원 커넥터) 중심 (400,100), 둘 다 1x1 사진 → 240x240
// 전선 w1: CN1.+ → U1.1, w2: CN1.- → U1.2

describe('일괄 연산 (실행 취소 1회 단위)', () => {
  it('moveInstances: 지정한 부품만 같은 만큼 옮긴다', () => {
    const p = moveInstances(loadSample(), ['i1', 'i2'], 10, -5)
    expect(p.instances.map((i) => [i.x, i.y])).toEqual([[110, 95], [410, 95]])
  })

  it('이동량이 0이면 같은 객체를 돌려준다 (실행 취소 이력이 쌓이지 않음)', () => {
    const p = loadSample()
    expect(moveInstances(p, ['i1'], 0, 0)).toBe(p)
  })

  it('rotateInstances: 각자 중심으로 돌고 각도는 0~359', () => {
    let p = rotateInstances(loadSample(), ['i1'], -90)
    expect(p.instances.map((i) => i.rotation)).toEqual([270, 0])
    p = rotateInstances(p, ['i1', 'i2'], 90)
    expect(p.instances.map((i) => i.rotation)).toEqual([0, 90])
  })

  it('removeItems: 선택한 전선과 부품(연결 전선 포함)을 한 번에 지운다', () => {
    const p = removeItems(loadSample(), { instances: ['i2'], wires: [] })
    expect(p.instances.map((i) => i.id)).toEqual(['i1'])
    expect(p.wires).toEqual([])
    const q = removeItems(loadSample(), { instances: [], wires: ['w1'] })
    expect(q.wires.map((w) => w.id)).toEqual(['w2'])
  })

  it('updateWires: 여러 전선 색을 한 번에', () => {
    const p = updateWires(loadSample(), ['w1', 'w2'], { color: '#1e88e5' })
    expect(p.wires.map((w) => w.color)).toEqual(['#1e88e5', '#1e88e5'])
  })
})

describe('선택 사각형', () => {
  it('instanceBounds: 90도 회전하면 가로세로가 바뀐다', () => {
    const p = loadSample()
    const part = p.parts['part-ctrl']
    const inst = { ...p.instances[0], rotation: 90 }
    const b = instanceBounds(inst, { ...part, image: { ...part.image, width: 200, height: 100 } })
    expect(b.width).toBeCloseTo(120)
    expect(b.height).toBeCloseTo(240)
  })

  it('겹치는 부품과, 양 끝이 모두 안에 있는 전선만 고른다', () => {
    const p = loadSample()
    // U1만 덮는 사각형: 부품 U1, 전선 없음 (전선의 다른 끝은 CN1)
    expect(selectInRect(p, rectFromPoints({ x: -50, y: -50 }, { x: 150, y: 250 }))).toEqual({ instances: ['i1'], wires: [], junctions: [] })
    // 둘 다 덮는 사각형: 부품 2개, 전선 2개
    expect(selectInRect(p, rectFromPoints({ x: 600, y: 300 }, { x: -100, y: -100 }))).toEqual({
      instances: ['i1', 'i2'],
      wires: ['w1', 'w2'],
      junctions: []
    })
    // 빈 곳
    expect(selectInRect(p, rectFromPoints({ x: 1000, y: 1000 }, { x: 1100, y: 1100 }))).toEqual({ instances: [], wires: [], junctions: [] })
  })

  it('mergeSelection: 중복 없이 합친다', () => {
    expect(mergeSelection({ instances: ['a'], wires: ['w'] }, { instances: ['a', 'b'], wires: [] })).toEqual({
      instances: ['a', 'b'],
      wires: ['w'],
      junctions: []
    })
  })
})

describe('replacePartDef (라이브러리 최신 정보로 갱신)', () => {
  it('부품 정의 사본을 바꾸고, 사라진 핀에 연결된 전선만 지운다', () => {
    const p = loadSample()
    const batt = p.parts['part-pwr']
    const updated = { ...batt, purchaseUrl: 'https://example.com/batt', pins: batt.pins.filter((pin) => pin.id !== 'b2') }
    const r = replacePartDef(p, updated)
    expect(r.project.parts['part-pwr'].purchaseUrl).toBe('https://example.com/batt')
    expect(r.removedWires).toBe(1)
    expect(r.project.wires.map((w) => w.id)).toEqual(['w1'])
  })

  it('프로젝트에 없는 부품이면 아무것도 바꾸지 않는다', () => {
    const p = loadSample()
    const other = { ...p.parts['part-pwr'], id: 'nope' }
    expect(replacePartDef(p, other)).toEqual({ project: p, removedWires: 0 })
  })
})
