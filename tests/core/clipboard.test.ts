import { describe, expect, it } from 'vitest'
import { copySelection, pasteClipboard } from '@core/clipboard'
import { emptyProject, updateInstance, updateWires } from '@core/ops'
import { loadSample } from '../helpers'

// 샘플: U1(제어 보드, i1, 100,100) · CN1(전원 커넥터, i2, 400,100) · 전선 w1(CN1.+→U1.1), w2(CN1.-→U1.2)

const counter = () => {
  let n = 0
  return () => `n${++n}`
}

describe('copySelection', () => {
  it('선택한 부품 + 그 부품들 사이의 전선(선택 안 했어도) + 부품 정의', () => {
    const clip = copySelection(loadSample(), { instances: ['i1', 'i2'], wires: [] })!
    expect(clip.instances.map((i) => i.refDes)).toEqual(['U1', 'CN1'])
    expect(clip.wires.map((w) => w.id)).toEqual(['w1', 'w2'])
    expect(Object.keys(clip.parts).sort()).toEqual(['part-ctrl', 'part-pwr'])
    expect(clip.center).toEqual({ x: 250, y: 100 })
  })

  it('한쪽 끝만 복사되는 전선은 뺀다', () => {
    const clip = copySelection(loadSample(), { instances: ['i1'], wires: ['w1'] })!
    expect(clip.wires).toEqual([])
  })

  it('부품이 없으면 null', () => {
    expect(copySelection(loadSample(), { instances: [], wires: ['w1'] })).toBeNull()
  })

  it('복사본은 원본과 독립 (원본을 바꿔도 클립보드는 그대로)', () => {
    const p = loadSample()
    const clip = copySelection(p, { instances: ['i1'], wires: [] })!
    const moved = updateInstance(p, 'i1', { x: 999 })
    expect(moved.instances[0].x).toBe(999)
    expect(clip.instances[0].x).toBe(100)
  })
})

describe('pasteClipboard', () => {
  it('새 id·새 참조명(접두사 유지), 위치와 꺾임점 이동, 전선 연결 재지정', () => {
    let p = updateWires(loadSample(), ['w1'], { points: [{ x: 250, y: 50 }], orthogonal: true })
    const clip = copySelection(p, { instances: ['i1', 'i2'], wires: [] })!
    const r = pasteClipboard(p, clip, { x: 30, y: 40 }, counter())
    p = r.project
    expect(p.instances.map((i) => [i.refDes, i.x, i.y])).toEqual([
      ['U1', 100, 100],
      ['CN1', 400, 100],
      ['U2', 130, 140],
      ['CN2', 430, 140]
    ])
    expect(r.instances).toEqual(['n1', 'n2'])
    expect(r.wires).toEqual(['n3', 'n4'])
    const w = p.wires.find((x) => x.id === 'n3')!
    expect(w.from).toEqual({ instanceId: 'n2', pinId: 'b1' }) // CN2.+
    expect(w.to).toEqual({ instanceId: 'n1', pinId: 'p1' }) // U2.1
    expect(w.points).toEqual([{ x: 280, y: 90 }])
    expect(w.orthogonal).toBe(true)
  })

  it('두 번 붙여넣으면 번호가 이어진다, 원본 프로젝트는 그대로', () => {
    const p = loadSample()
    const clip = copySelection(p, { instances: ['i1'], wires: [] })!
    const once = pasteClipboard(p, clip, { x: 30, y: 30 }, counter()).project
    const twice = pasteClipboard(once, clip, { x: 60, y: 60 }, () => `m${Math.random()}`).project
    expect(twice.instances.map((i) => i.refDes)).toEqual(['U1', 'CN1', 'U2', 'U3'])
    expect(p.instances).toHaveLength(2)
  })

  it('다른 배선도에 붙여넣으면 부품 정의도 함께 들어간다', () => {
    const clip = copySelection(loadSample(), { instances: ['i1', 'i2'], wires: [] })!
    const r = pasteClipboard(emptyProject('다른 배선도'), clip, { x: 0, y: 0 }, counter())
    expect(Object.keys(r.project.parts).sort()).toEqual(['part-ctrl', 'part-pwr'])
    expect(r.project.instances.map((i) => i.refDes)).toEqual(['U1', 'CN1'])
    expect(r.project.wires).toHaveLength(2)
  })

  it('붙여넣을 곳의 같은 id 부품 정의에 없는 핀을 가리키는 전선은 뺀다', () => {
    const clip = copySelection(loadSample(), { instances: ['i1', 'i2'], wires: [] })!
    const target = loadSample()
    target.parts['part-pwr'] = { ...target.parts['part-pwr'], pins: target.parts['part-pwr'].pins.filter((pin) => pin.id !== 'b2') }
    const r = pasteClipboard(target, clip, { x: 0, y: 300 }, counter())
    expect(r.wires).toHaveLength(1) // b2(-)에 붙은 w2는 빠짐
  })
})
