import { describe, expect, it } from 'vitest'
import { instanceBounds } from '@core/geometry'
import { PROJECT_FILE_VERSION, type PartInstance, type Project, type Wire } from '@core/model'
import { alignInstances } from '@core/ops'
import { makePart } from '../helpers'

// 200x100 사진 → 표시 240x120
const part = makePart('p', {
  image: { data: 'data:image/png;base64,AA==', width: 200, height: 100 },
  pins: [{ id: 'a', number: '1', x: 0.5, y: 0.5 }]
})
const inst = (id: string, x: number, y: number, rotation = 0): PartInstance => ({
  id, partId: 'p', refDes: id.toUpperCase(), x, y, rotation, scale: 1
})
const project = (instances: PartInstance[], wires: Wire[] = []): Project => ({
  version: PROJECT_FILE_VERSION, name: 't', parts: { p: part }, instances, wires
})
const box = (p: Project, id: string) => instanceBounds(p.instances.find((i) => i.id === id)!, part)

describe('alignInstances', () => {
  // i1: x -120..120, i2: 회전 90 → 60x240 상자, x 440..560, i3: x 780..1020
  const base = project([inst('i1', 0, 0), inst('i2', 500, 300, 90), inst('i3', 900, -200)])

  it('왼쪽·오른쪽·가운데: 회전 반영 상자 기준', () => {
    const left = alignInstances(base, ['i1', 'i2', 'i3'], 'left')
    for (const id of ['i1', 'i2', 'i3']) expect(box(left, id).x).toBeCloseTo(-120, 6)
    const right = alignInstances(base, ['i1', 'i2', 'i3'], 'right')
    for (const id of ['i1', 'i2', 'i3']) expect(box(right, id).x + box(right, id).width).toBeCloseTo(1020, 6)
    const mid = alignInstances(base, ['i1', 'i2', 'i3'], 'centerY')
    for (const id of ['i1', 'i2', 'i3']) expect(mid.instances.find((i) => i.id === id)!.y).toBeCloseTo(mid.instances[0].y, 6)
    // 줄 맞추기는 한 축만 움직인다
    expect(left.instances.map((i) => i.y)).toEqual(base.instances.map((i) => i.y))
  })

  it('위·아래', () => {
    const top = alignInstances(base, ['i1', 'i2', 'i3'], 'top')
    const y0 = Math.min(...['i1', 'i2', 'i3'].map((id) => box(base, id).y))
    for (const id of ['i1', 'i2', 'i3']) expect(box(top, id).y).toBeCloseTo(y0, 6)
    const bottom = alignInstances(base, ['i1', 'i2'], 'bottom')
    expect(box(bottom, 'i1').y + box(bottom, 'i1').height).toBeCloseTo(box(bottom, 'i2').y + box(bottom, 'i2').height, 6)
    expect(bottom.instances[2]).toBe(base.instances[2]) // 고르지 않은 부품은 그대로
  })

  it('가로 간격 맞추기: 양 끝은 그대로, 상자 사이 빈칸이 같다', () => {
    const p = alignInstances(base, ['i3', 'i1', 'i2'], 'distributeX')
    expect(p.instances[0]).toBe(base.instances[0])
    expect(p.instances[2]).toBe(base.instances[2])
    const gap1 = box(p, 'i2').x - (box(p, 'i1').x + box(p, 'i1').width)
    const gap2 = box(p, 'i3').x - (box(p, 'i2').x + box(p, 'i2').width)
    expect(gap1).toBeCloseTo(gap2, 6)
    expect(p.instances[1].y).toBe(300)
  })

  it('개수가 모자라면 그대로 (줄 맞추기 2개, 간격 3개)', () => {
    expect(alignInstances(base, ['i1'], 'left')).toBe(base)
    expect(alignInstances(base, ['i1', 'i2'], 'distributeY')).toBe(base)
    expect(alignInstances(base, [], 'top')).toBe(base)
  })

  it('입력을 바꾸지 않고, 같은 만큼 움직인 전선만 꺾임점도 옮긴다', () => {
    const w = (id: string, a: string, b: string): Wire => ({
      id, from: { instanceId: a, pinId: 'a' }, to: { instanceId: b, pinId: 'a' }, color: '#000', width: 2, points: [{ x: 10, y: 10 }]
    })
    // i1, i2는 같은 x → 왼쪽 맞추기에서 둘 다 같은 만큼 움직임
    const p0 = project([inst('i1', 100, 0), inst('i2', 100, 500), inst('i3', 0, 1000)], [w('same', 'i1', 'i2'), w('diff', 'i1', 'i3')])
    const snapshot = JSON.stringify(p0)
    const p = alignInstances(p0, ['i1', 'i2', 'i3'], 'left')
    expect(JSON.stringify(p0)).toBe(snapshot)
    expect(p.wires[0].points).toEqual([{ x: -90, y: 10 }])
    expect(p.wires[1].points).toEqual([{ x: 10, y: 10 }])
  })
})
