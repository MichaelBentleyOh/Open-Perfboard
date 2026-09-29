import { describe, expect, it } from 'vitest'
import type { PartDef, Pin } from '../../src/core/model'
import { SYMBOL_GRID, bodyBox, missingPins, overlappingPins, pinLine } from '../../src/core/symbol'
import { SYMBOL_TEMPLATES, TEMPLATE_GROUPS, applyTemplate, slotInner } from '../../src/core/symbolTemplates'
import { parsePart, serializePart } from '../../src/core/serialize'

const pin = (id: string, number: string, signal?: string): Pin => ({ id, number, x: 0.5, y: 0.5, ...(signal ? { signal } : {}) })
const partWith = (pins: Pin[]): PartDef => ({ id: 'p', name: 'Q1', image: { data: 'data:image/png;base64,AA==', width: 10, height: 10 }, connectors: [], pins })
let n = 0
const makeId = () => `t${++n}`
const tpl = (id: string) => SYMBOL_TEMPLATES.find((t) => t.id === id)!

describe('기본 회로 기호 모음 (038b)', () => {
  it('id가 겹치지 않고 모든 그룹에 기호가 있다', () => {
    expect(new Set(SYMBOL_TEMPLATES.map((t) => t.id)).size).toBe(SYMBOL_TEMPLATES.length)
    for (const g of TEMPLATE_GROUPS) expect(SYMBOL_TEMPLATES.some((t) => t.group === g.id)).toBe(true)
  })

  it.each(SYMBOL_TEMPLATES.map((t) => [t.id, t] as const))('%s: 끝점은 격자 위·서로 안 겹침, 핀 선 안쪽 끝은 몸통에 닿고 바깥 끝은 몸통 밖', (_id, t) => {
    const body = t.build(4)
    for (const s of body.slots) {
      expect(Math.abs(s.x % SYMBOL_GRID), `${s.x}`).toBe(0)
      expect(Math.abs(s.y % SYMBOL_GRID), `${s.y}`).toBe(0)
      expect(s.length).toBeGreaterThan(0)
    }
    expect(new Set(body.slots.map((s) => `${s.x},${s.y}`)).size).toBe(body.slots.length)

    // 슬롯 수만큼 핀이 있는 부품에 적용
    const part = partWith(body.slots.map((_, i) => pin(`p${i}`, String(i + 1))))
    const s = applyTemplate(t, part, makeId)
    expect(s.pins).toHaveLength(body.slots.length)
    expect(missingPins(part, s)).toEqual([])
    expect(overlappingPins(s)).toEqual([])
    const box = bodyBox(s)
    const inside = (x: number, y: number, pad: number) => x >= box.x - pad && x <= box.x + box.width + pad && y >= box.y - pad && y <= box.y + box.height + pad
    for (const p of s.pins) {
      expect(p.x % SYMBOL_GRID).toBe(0)
      expect(p.y % SYMBOL_GRID).toBe(0)
      const l = pinLine(p)
      expect(inside(l.x2, l.y2, 0.5), `${p.pinId} 안쪽 끝`).toBe(true)
      expect(inside(l.x1, l.y1, -0.5), `${p.pinId} 바깥 끝`).toBe(false)
    }
    // 그림판 안에 다 들어간다
    for (const p of s.pins) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.y).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(s.drawing.width)
      expect(p.y).toBeLessThan(s.drawing.height)
    }
    // 파일로 저장했다 읽어도 그대로 (닫힌 선·채우기 포함)
    const saved = parsePart(serializePart({ ...part, symbol: s }))
    expect(saved.ok && saved.value.symbol).toEqual(s)
  })

  it('슬롯 핀 자리는 slotInner와 pinLine이 같다', () => {
    const body = tpl('npn').build(3)
    const s = applyTemplate(tpl('npn'), partWith([pin('b', '1'), pin('c', '2'), pin('e', '3')]), makeId)
    const i = body.slots.findIndex((x) => x.side === 'left')
    const inner = slotInner(body.slots[i]!)
    const l = pinLine(s.pins.find((p) => p.pinId === 'b')!)
    expect(l.x2 - l.x1).toBe(inner.x - body.slots[i]!.x)
  })

  it('신호 이름으로 자리를 맞춘다: 다이오드 A/K, 트랜지스터 E/B/C, 연산증폭기', () => {
    const d = applyTemplate(tpl('diode'), partWith([pin('a', '1', 'A'), pin('k', '2', 'K')]), makeId)
    expect(d.pins.find((p) => p.pinId === 'a')!.side).toBe('left')
    expect(d.pins.find((p) => p.pinId === 'k')!.side).toBe('right')

    const q = applyTemplate(tpl('npn'), partWith([pin('e', '1', 'E'), pin('b', '2', 'B'), pin('c', '3', 'C')]), makeId)
    const side = (id: string) => q.pins.find((p) => p.pinId === id)!.side
    expect([side('b'), side('c'), side('e')]).toEqual(['left', 'top', 'bottom'])
    const pq = applyTemplate(tpl('pnp'), partWith([pin('e', '1', 'E'), pin('b', '2', 'B'), pin('c', '3', 'C')]), makeId)
    expect(pq.pins.find((p) => p.pinId === 'e')!.side).toBe('top')

    const op = applyTemplate(
      tpl('opamp'),
      partWith([pin('o', '1', 'OUT'), pin('m', '2', 'IN-'), pin('p', '3', 'IN+'), pin('g', '4', 'GND'), pin('v', '8', 'VCC')]),
      makeId
    )
    const at = (id: string) => op.pins.find((p) => p.pinId === id)!
    expect(at('p').y).toBeLessThan(at('m').y) // + 위
    expect(at('o').side).toBe('right')
    expect(at('v').side).toBe('top')
    expect(at('g').side).toBe('bottom')
  })

  it('이름이 없으면 번호 순서대로, 핀이 남으면 놓지 않은 핀, 모자라면 자리가 빈다', () => {
    const three = partWith([pin('x', '1'), pin('y', '2'), pin('z', '3')])
    const r = applyTemplate(tpl('resistor'), three, makeId)
    expect(r.pins.map((p) => p.pinId)).toEqual(['x', 'y'])
    expect(r.pins[0]!.side).toBe('top')
    expect(missingPins(three, r).map((p) => p.id)).toEqual(['z'])

    const one = applyTemplate(tpl('opamp'), partWith([pin('x', '1')]), makeId)
    expect(one.pins).toHaveLength(1)
  })

  it('커넥터는 핀 수만큼 자리를 만든다, 부품 이름 글상자가 들어간다', () => {
    const pins = Array.from({ length: 6 }, (_, i) => pin(`p${i}`, String(i + 1)))
    const s = applyTemplate(tpl('connector'), partWith(pins), makeId)
    expect(s.pins).toHaveLength(6)
    expect(new Set(s.pins.map((p) => p.x)).size).toBe(1)
    expect(s.drawing.shapes.some((x) => x.type === 'text' && x.text === 'Q1')).toBe(true)
  })

  it('작은 소자는 핀 번호·이름을 숨긴다', () => {
    const s = applyTemplate(tpl('capacitor'), partWith([pin('a', '1'), pin('b', '2')]), makeId)
    expect(s.showNumbers).toBe(false)
    expect(s.showNames).toBe(false)
  })
})
