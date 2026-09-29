import { describe, expect, it } from 'vitest'
import { PROJECT_FILE_VERSION, type PartDef, type Pin } from '../../src/core/model'
import {
  SYMBOL_GRID,
  autoSymbol,
  bodyBox,
  freeSpot,
  missingPins,
  overlappingPins,
  pinLabel,
  pinLine,
  placePin,
  syncSymbol
} from '../../src/core/symbol'
import { removePin, updatePin } from '../../src/core/part'
import { parsePart, parseProjectFile, serializePart } from '../../src/core/serialize'

const pin = (id: string, number: string, signal?: string, connectorId?: string): Pin => ({ id, number, x: 0.5, y: 0.5, ...(signal ? { signal } : {}), ...(connectorId ? { connectorId } : {}) })

const part: PartDef = {
  id: 'imu',
  name: 'IMU',
  image: { data: 'data:image/png;base64,AA==', width: 10, height: 10 },
  connectors: [{ id: 'c1', name: 'J1', type: 'XH 4P' }],
  pins: [pin('a', '1', 'VCC', 'c1'), pin('b', '2', 'GND', 'c1'), pin('c', '3', 'SDA', 'c1'), pin('d', '4', 'SCL', 'c1'), pin('e', '5')]
}
let n = 0
const makeId = () => `s${++n}`

describe('회로도 기호 (038)', () => {
  it('핀 번호 표시: 커넥터가 있으면 J1.3', () => {
    expect(pinLabel(part.connectors, part.pins[2]!)).toBe('J1.3')
    expect(pinLabel(part.connectors, part.pins[4]!)).toBe('5')
  })

  it('기본 기호: VCC 위, GND 아래, 나머지 양옆, 끝점은 모두 격자 위, 핀 선은 몸통에 닿는다', () => {
    const s = autoSymbol(part, makeId)
    const side = (id: string) => s.pins.find((p) => p.pinId === id)!.side
    expect([side('a'), side('b'), side('c'), side('d'), side('e')]).toEqual(['top', 'bottom', 'left', 'left', 'right'])
    for (const p of s.pins) {
      expect(p.x % SYMBOL_GRID).toBe(0)
      expect(p.y % SYMBOL_GRID).toBe(0)
    }
    const body = bodyBox({ ...s, drawing: { ...s.drawing, shapes: s.drawing.shapes.slice(0, 1) } })
    const left = pinLine(s.pins.find((p) => p.pinId === 'c')!)
    expect(left.x2).toBe(body.x)
    const top = pinLine(s.pins.find((p) => p.pinId === 'a')!)
    expect(top.y2).toBe(body.y)
    // 그림판 안에 모두 들어간다
    expect(Math.max(...s.pins.map((p) => p.x))).toBeLessThan(s.drawing.width)
    expect(Math.max(...s.pins.map((p) => p.y))).toBeLessThan(s.drawing.height)
    expect(overlappingPins(s)).toEqual([])
    expect(s.drawing.shapes[1]).toMatchObject({ type: 'text', text: 'IMU' })
  })

  it('핀 놓기: 격자에 맞추고, 쪽은 몸통과의 위치로, 겹치면 가장자리를 따라 옆 칸', () => {
    const s = autoSymbol(part, makeId)
    const body = bodyBox(s)
    const c = s.pins.find((p) => p.pinId === 'c')!
    // SCL(d)을 SDA 자리에 놓으면 겹치지 않게 한 칸 옆
    const moved = placePin(s, 'd', { x: c.x + 3, y: c.y - 2 })
    const d = moved.pins.find((p) => p.pinId === 'd')!
    expect(d.side).toBe('left')
    expect(d.x).toBe(c.x)
    expect(Math.abs(d.y - c.y)).toBe(SYMBOL_GRID)
    // 몸통 오른쪽 밖이면 오른쪽
    const right = placePin(s, 'd', { x: body.x + body.width + 25, y: body.y + 40 })
    expect(right.pins.find((p) => p.pinId === 'd')!.side).toBe('right')
    expect(right.pins).toHaveLength(s.pins.length)
  })

  it('놓지 않은 핀과 빈 자리, 부품 핀을 지우면 기호 핀도', () => {
    const s = autoSymbol(part, makeId)
    const without = { ...s, pins: s.pins.filter((p) => p.pinId !== 'e') }
    expect(missingPins(part, without).map((p) => p.id)).toEqual(['e'])
    const spot = freeSpot(without)
    const placed = placePin(without, 'e', spot, spot.side)
    expect(missingPins(part, placed)).toEqual([])
    expect(overlappingPins(placed)).toEqual([])
    const removed = removePin({ ...part, symbol: s }, 'c')
    expect(removed.symbol!.pins.some((p) => p.pinId === 'c')).toBe(false)
    expect(syncSymbol({ ...part, pins: part.pins.slice(1) }, s).pins.some((p) => p.pinId === 'a')).toBe(false)
  })

  it('전기 종류: passive는 기본값이라 저장하지 않는다', () => {
    const p = updatePin(part, 'a', { electrical: 'power_in' })
    expect(p.pins[0]!.electrical).toBe('power_in')
    expect(updatePin(p, 'a', { electrical: 'passive' }).pins[0]).not.toHaveProperty('electrical')
  })

  it('파일: 기호·전기 종류가 오가고, 없는 핀·잘못된 값은 거부, v8은 지금 버전으로', () => {
    const symbol = autoSymbol(part, makeId)
    const full: PartDef = { ...part, symbol: { ...symbol, showNumbers: false }, pins: part.pins.map((p, i) => (i === 0 ? { ...p, electrical: 'power_in' } : p)) }
    const r = parsePart(serializePart(full))
    expect(r.ok && r.value.symbol).toEqual(full.symbol)
    expect(r.ok && r.value.pins[0]!.electrical).toBe('power_in')
    const bad = parsePart(serializePart({ ...full, symbol: { ...symbol, pins: [{ pinId: 'zz', x: 0, y: 0, side: 'left' }] } }))
    expect(bad.ok ? '' : bad.errors.join()).toContain('symbol.pins[0].pinId')
    const badSide = parsePart(JSON.stringify({ ...full, symbol: { ...symbol, pins: [{ pinId: 'a', x: 0, y: 0, side: 'up' }] } }))
    expect(badSide.ok).toBe(false)
    const badKind = parsePart(JSON.stringify({ ...full, pins: [{ ...part.pins[0], electrical: 'gpio' }] }))
    expect(badKind.ok).toBe(false)
    const v8 = parseProjectFile(JSON.stringify({ version: 8, name: 'x', parts: { imu: part }, instances: [], wires: [] }))
    expect(v8.ok && v8.value.project.version).toBe(PROJECT_FILE_VERSION)
  })
})
