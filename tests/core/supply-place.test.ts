// 핀 있는 부속 부품을 배선도에 올리기, 커넥터 색, GND 핀
import { describe, expect, it } from 'vitest'
import { buildBom } from '@core/bom'
import { exportKicadSchematic } from '@core/kicad'
import type { Supply } from '@core/model'
import { addInstance, emptyProject } from '@core/ops'
import { updateConnector } from '@core/part'
import { parseProject, parseSupply, serializeProject, serializeSupply } from '@core/serialize'
import { canPlaceSupply, checkSupply, finalizeSupply, supplyAsPart, supplyUsage } from '@core/supply'
import { makePart } from '../helpers'

const image = { data: 'data:image/png;base64,AA==', width: 10, height: 10 }
const housing: Supply = {
  id: 'h1',
  kind: 'housing',
  name: 'XH 2P 하우징',
  connectorType: 'JST-XH 2P',
  unitPrice: 50,
  image,
  connectors: [{ id: 'c', name: 'J1', type: 'JST-XH 2P', color: '#123456' }],
  pins: [
    { id: 'p1', number: '1', connectorId: 'c', x: 0.2, y: 0.5 },
    { id: 'p2', number: '2', connectorId: 'c', x: 0.8, y: 0.5, electrical: 'ground' }
  ]
}

describe('부속 부품을 배선도에 올리기', () => {
  it('사진이 있어야 올릴 수 있다', () => {
    expect(canPlaceSupply(housing)).toBe(true)
    expect(canPlaceSupply({ ...housing, image: undefined })).toBe(false)
    expect(supplyAsPart({ ...housing, image: undefined })).toBeUndefined()
  })

  it('부품 정의로 바뀐다: 같은 id, 종류별 참조명, 핀·커넥터·단가', () => {
    const part = supplyAsPart(housing)!
    expect(part).toMatchObject({ id: 'h1', name: 'XH 2P 하우징', refPrefix: 'J', supplyKind: 'housing', unitPrice: 50 })
    expect(part.pins).toHaveLength(2)
    expect(part.connectors[0].color).toBe('#123456')
  })

  it('BOM에서는 부속 부품 종류로 분류하고, 짝 하우징을 찾지 않는다', () => {
    const board = makePart('board', {
      connectors: [{ id: 'j', name: 'J1', type: 'JST-XH 2P' }],
      pins: [{ id: 'a', number: '1', connectorId: 'j', x: 0, y: 0 }]
    })
    let p = addInstance(emptyProject('t'), supplyAsPart(housing)!, { id: 'i1', x: 0, y: 0 })
    p = addInstance(p, board, { id: 'i2', x: 0, y: 0 })
    p = { ...p, wires: [{ id: 'w', from: { instanceId: 'i1', pinId: 'p1' }, to: { instanceId: 'i2', pinId: 'a' }, color: '#000000', width: 2 }] }
    const row = buildBom(p).find((r) => r.id === 'h1')!
    expect(row).toMatchObject({ kind: 'part', category: '하우징', quantity: 1, refDes: ['J1'] })
    // 보드 J1만 짝 하우징을 찾는다 (올린 하우징 자신은 빼고)
    const uses = supplyUsage(p, [housing]).uses
    expect(uses.map((u) => [u.supply.id, u.refs])).toEqual([['h1', ['U1.J1']]])
  })

  it('배선도 파일에 저장하고 다시 읽는다 (supplyKind, 커넥터 색, GND)', () => {
    const p = addInstance(emptyProject('t'), supplyAsPart(housing)!, { id: 'i1', x: 0, y: 0 })
    const again = parseProject(serializeProject(p))
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.value.parts.h1).toEqual(p.parts.h1)
  })

  it('부속 부품 파일: 핀·커넥터를 저장하고, 빈 목록은 뺀다', () => {
    const r = parseSupply(serializeSupply(finalizeSupply(housing)))
    expect(r.ok && r.value.pins).toEqual(housing.pins)
    expect(r.ok && r.value.connectors).toEqual(housing.connectors)
    // 커넥터 없이 핀만 있어도 된다
    const pinsOnly = finalizeSupply({ ...housing, connectors: [], pins: [{ id: 'p', number: '1', x: 0, y: 0 }] })
    expect(pinsOnly.connectors).toBeUndefined()
    expect(parseSupply(serializeSupply(pinsOnly)).ok).toBe(true)
    const plain = finalizeSupply({ ...housing, pins: [], connectors: [] })
    expect(plain.pins).toBeUndefined()
    expect(plain.connectors).toBeUndefined()
  })

  it('빈 핀 번호는 저장을 막는다', () => {
    const bad: Supply = { ...housing, pins: [{ ...housing.pins![0], number: ' ' }] }
    expect(checkSupply(bad)).toContain('비어 있는 핀 번호가 있습니다')
  })
})

describe('커넥터 색', () => {
  const part = makePart('x', { connectors: [{ id: 'c', name: 'J1', type: '' }] })

  it('고르고, null이면 기본 색으로', () => {
    const colored = updateConnector(part, 'c', { color: '#ff0000' })
    expect(colored.connectors[0].color).toBe('#ff0000')
    expect(updateConnector(colored, 'c', { color: null }).connectors[0]).toEqual({ id: 'c', name: 'J1', type: '' })
    // 다른 칸만 고치면 색은 그대로
    expect(updateConnector(colored, 'c', { name: 'J9' }).connectors[0].color).toBe('#ff0000')
  })

  it('색 형식이 틀린 파일은 거부한다', () => {
    const p = addInstance(emptyProject('t'), updateConnector(part, 'c', { color: 'red' }), { id: 'i', x: 0, y: 0 })
    expect(parseProject(serializeProject(p)).ok).toBe(false)
  })
})

describe('GND 핀', () => {
  it('KiCad에는 전원 입력으로 내보낸다', () => {
    const part = makePart('g', { pins: [{ id: 'a', number: '1', x: 0, y: 0, electrical: 'ground', signal: 'GND' }] })
    const p = addInstance(emptyProject('t'), part, { id: 'i', x: 0, y: 0 })
    let n = 0
    const newUuid = () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`
    const sch = exportKicadSchematic(p, { title: 't', date: '2026-10-03', newUuid })
    expect(sch).toContain('(pin power_in line')
    expect(sch).not.toContain('(pin ground')
  })
})
