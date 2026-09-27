import { describe, expect, it } from 'vitest'
import {
  addInstance,
  connect,
  disconnect,
  emptyProject,
  nextRefDes,
  removeInstance,
  updateInstance,
  updateWire
} from '@core/ops'
import type { Project, Wire } from '@core/model'
import { loadSample, makePart } from '../helpers'

const wire = (id: string, from: [string, string], to: [string, string]): Wire => ({
  id,
  from: { instanceId: from[0], pinId: from[1] },
  to: { instanceId: to[0], pinId: to[1] },
  color: '#000',
  width: 2
})

/** 두 부품이 배치된 프로젝트 (i1 = U1, i2 = U2) */
function twoParts(): Project {
  const part = makePart('p')
  let p = addInstance(emptyProject('t'), part, { id: 'i1', x: 0, y: 0 })
  p = addInstance(p, part, { id: 'i2', x: 100, y: 0 })
  return p
}

describe('nextRefDes', () => {
  it('같은 접두사의 최대 번호 + 1을 준다 (빈 번호는 채우지 않음)', () => {
    const p = { ...emptyProject('t'), instances: [
      { id: 'a', partId: 'x', refDes: 'U1', x: 0, y: 0, rotation: 0, scale: 1 },
      { id: 'b', partId: 'x', refDes: 'U3', x: 0, y: 0, rotation: 0, scale: 1 },
      { id: 'c', partId: 'x', refDes: 'J7', x: 0, y: 0, rotation: 0, scale: 1 }
    ] }
    expect(nextRefDes(p, 'U')).toBe('U4')
    expect(nextRefDes(p, 'J')).toBe('J8')
    expect(nextRefDes(p, 'BT')).toBe('BT1')
  })

  it('접두사가 다른 접두사의 앞부분이어도 섞이지 않는다', () => {
    const p = { ...emptyProject('t'), instances: [
      { id: 'a', partId: 'x', refDes: 'BT5', x: 0, y: 0, rotation: 0, scale: 1 }
    ] }
    expect(nextRefDes(p, 'B')).toBe('B1')
  })
})

describe('addInstance', () => {
  it('부품 정의 사본을 넣고 접두사에 맞춰 참조명을 붙인다', () => {
    const batt = makePart('batt', { refPrefix: 'BT' })
    let p = addInstance(emptyProject('t'), batt, { id: 'i1', x: 10, y: 20 })
    p = addInstance(p, batt, { id: 'i2', x: 0, y: 0 })
    expect(p.parts.batt).toEqual(batt)
    expect(p.instances.map((i) => i.refDes)).toEqual(['BT1', 'BT2'])
    expect(p.instances[0]).toMatchObject({ x: 10, y: 20, rotation: 0, scale: 1 })
  })

  it('접두사가 없으면 U를 쓴다', () => {
    const p = addInstance(emptyProject('t'), makePart('x'), { id: 'i1', x: 0, y: 0 })
    expect(p.instances[0].refDes).toBe('U1')
  })

  it('입력 프로젝트를 변경하지 않는다', () => {
    const before = emptyProject('t')
    const snapshot = structuredClone(before)
    addInstance(before, makePart('x'), { id: 'i1', x: 0, y: 0 })
    expect(before).toEqual(snapshot)
  })
})

describe('removeInstance', () => {
  it('연결된 전선을 함께 지운다', () => {
    const p = loadSample() // i2(BT1) → i1(U1) 전선 2개
    const r = removeInstance(p, 'i1')
    expect(r.instances.map((i) => i.id)).toEqual(['i2'])
    expect(r.wires).toEqual([])
  })

  it('더 이상 쓰이지 않는 부품 정의만 지운다', () => {
    const p = twoParts()
    const once = removeInstance(p, 'i1')
    expect(once.parts.p).toBeDefined()
    expect(removeInstance(once, 'i2').parts.p).toBeUndefined()
  })

  it('없는 id면 그대로 돌려준다', () => {
    const p = twoParts()
    expect(removeInstance(p, 'nope')).toBe(p)
  })
})

describe('connect', () => {
  it('두 핀을 잇는다', () => {
    const r = connect(twoParts(), wire('w1', ['i1', 'a'], ['i2', 'b']))
    expect(r.ok && r.project.wires.map((w) => w.id)).toEqual(['w1'])
  })

  it('같은 핀끼리는 거부한다', () => {
    expect(connect(twoParts(), wire('w', ['i1', 'a'], ['i1', 'a']))).toEqual({ ok: false, error: 'same-pin' })
  })

  it('없는 부품이나 핀은 거부한다', () => {
    expect(connect(twoParts(), wire('w', ['i1', 'a'], ['i9', 'a']))).toEqual({ ok: false, error: 'unknown-pin' })
    expect(connect(twoParts(), wire('w', ['i1', 'a'], ['i2', 'zz']))).toEqual({ ok: false, error: 'unknown-pin' })
  })

  it('이미 있는 연결은 방향이 반대여도 거부한다', () => {
    const r = connect(twoParts(), wire('w1', ['i1', 'a'], ['i2', 'b']))
    if (!r.ok) throw new Error('setup')
    expect(connect(r.project, wire('w2', ['i2', 'b'], ['i1', 'a']))).toEqual({ ok: false, error: 'duplicate' })
  })
})

describe('전선/부품 수정', () => {
  it('updateWire, disconnect', () => {
    const p = loadSample()
    const updated = updateWire(p, 'w1', { color: '#fff', label: 'PWR' })
    expect(updated.wires.find((w) => w.id === 'w1')).toMatchObject({ color: '#fff', label: 'PWR' })
    expect(disconnect(updated, 'w1').wires.map((w) => w.id)).toEqual(['w2'])
  })

  it('updateInstance는 지정한 필드만 바꾼다', () => {
    const p = updateInstance(loadSample(), 'i1', { x: 5, rotation: 90 })
    expect(p.instances[0]).toMatchObject({ x: 5, y: 100, rotation: 90, refDes: 'U1' })
  })
})
