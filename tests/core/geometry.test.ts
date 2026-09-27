import { describe, expect, it } from 'vitest'
import { PART_BASE_SIZE, normalizeAngle, partSize, pinWorldPosition } from '@core/geometry'
import type { PartInstance } from '@core/model'
import { makePart } from '../helpers'

// 가로 200 x 세로 100 사진 → 표시 크기 240 x 120
const part = makePart('p', {
  image: { data: 'data:image/png;base64,AA==', width: 200, height: 100 },
  pins: [
    { id: 'tl', number: '1', x: 0, y: 0 },
    { id: 'r', number: '2', x: 1, y: 0.5 },
    { id: 'c', number: '3', x: 0.5, y: 0.5 }
  ]
})
const pin = (id: string) => part.pins.find((p) => p.id === id)!
const inst = (o: Partial<PartInstance> = {}): PartInstance => ({
  id: 'i', partId: 'p', refDes: 'U1', x: 1000, y: 500, rotation: 0, scale: 1, ...o
})

const close = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6)
  expect(p.y).toBeCloseTo(y, 6)
}

describe('partSize', () => {
  it('긴 변을 기준 크기에 맞추고 비율을 유지한다', () => {
    expect(partSize(part)).toEqual({ width: PART_BASE_SIZE, height: PART_BASE_SIZE / 2 })
    expect(partSize(part, 2)).toEqual({ width: PART_BASE_SIZE * 2, height: PART_BASE_SIZE })
  })
})

describe('pinWorldPosition', () => {
  it('회전 없음: 중심 기준으로 사진 위 위치를 옮긴다', () => {
    close(pinWorldPosition(inst(), part, pin('tl')), 1000 - 120, 500 - 60)
    close(pinWorldPosition(inst(), part, pin('r')), 1000 + 120, 500)
    close(pinWorldPosition(inst(), part, pin('c')), 1000, 500)
  })

  it('90도 회전: 오른쪽 핀이 아래로 간다', () => {
    close(pinWorldPosition(inst({ rotation: 90 }), part, pin('r')), 1000, 500 + 120)
    close(pinWorldPosition(inst({ rotation: 90 }), part, pin('tl')), 1000 + 60, 500 - 120)
  })

  it('180도 회전과 scale', () => {
    close(pinWorldPosition(inst({ rotation: 180, scale: 0.5 }), part, pin('r')), 1000 - 60, 500)
  })

  it('at을 주면 그 위치를 중심으로 계산한다 (드래그 중)', () => {
    close(pinWorldPosition(inst(), part, pin('r'), { x: 0, y: 0 }), 120, 0)
  })
})

describe('normalizeAngle', () => {
  it('0~359로 맞춘다', () => {
    expect(normalizeAngle(450)).toBe(90)
    expect(normalizeAngle(-90)).toBe(270)
    expect(normalizeAngle(360)).toBe(0)
  })
})
