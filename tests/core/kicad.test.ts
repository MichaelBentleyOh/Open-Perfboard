import { describe, expect, it } from 'vitest'
import type { PartDef, Pin, Project } from '../../src/core/model'
import { addInstance, connectEnds, emptyProject } from '../../src/core/ops'
import { exportKicadSchematic } from '../../src/core/kicad'
import { moveSchematicItems, rotateSymbols, mirrorSymbols, setNetLabels, schematicSymbol } from '../../src/core/schematic'
import { SYMBOL_TEMPLATES, applyTemplate } from '../../src/core/symbolTemplates'

// ---- 작은 S식 읽기 (테스트용)
type SExpr = string | SExpr[]
function parse(text: string): SExpr {
  let i = 0
  const read = (): SExpr => {
    while (/\s/.test(text[i]!)) i++
    if (text[i] === '(') {
      i++
      const list: SExpr[] = []
      for (;;) {
        while (/\s/.test(text[i]!)) i++
        if (text[i] === ')') {
          i++
          return list
        }
        list.push(read())
      }
    }
    if (text[i] === '"') {
      i++
      let s = ''
      while (text[i] !== '"') {
        if (text[i] === '\\') i++
        s += text[i++]
      }
      i++
      return s
    }
    let s = ''
    while (i < text.length && !/[\s()]/.test(text[i]!)) s += text[i++]
    return s
  }
  const r = read()
  while (i < text.length && /\s/.test(text[i]!)) i++
  expect(i).toBe(text.length) // 괄호가 맞고 뒤에 남은 것이 없다
  return r
}
const kids = (e: SExpr, head: string) => (Array.isArray(e) ? e.filter((x): x is SExpr[] => Array.isArray(x) && x[0] === head) : [])
const one = (e: SExpr, head: string) => kids(e, head)[0]!
const n = (s: SExpr) => Number(s)

// ---- KiCad처럼 연결 풀기: 선 끝·핀 끝·라벨이 같은 점이거나 선분 위에 있으면 이어지고, 같은 이름 라벨은 이어진다
function kicadNets(root: SExpr): { pinGroup: Map<string, string>; pinsAt: Map<string, string> } {
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k)
    let r = k
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(k, r)
    return r
  }
  const join = (a: string, b: string) => parent.set(find(a), find(b))
  const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`

  const libs = new Map<string, SExpr[]>()
  for (const s of kids(one(root, 'lib_symbols'), 'symbol')) libs.set(s[1] as string, s)
  const points: { k: string; x: number; y: number; id: string }[] = []
  const pinsAt = new Map<string, string>()
  for (const inst of kids(root, 'symbol')) {
    const lib = libs.get(one(inst, 'lib_id')[1] as string)!
    const at = one(inst, 'at')
    const ref = kids(inst, 'property').find((p) => p[1] === 'Reference')![2] as string
    expect(at[3]).toBe('0') // 배치는 회전 없이
    for (const unit of kids(lib, 'symbol')) {
      for (const p of kids(unit, 'pin')) {
        const pat = one(p, 'at')
        const x = n(at[1]!) + n(pat[1]!)
        const y = n(at[2]!) - n(pat[2]!)
        const id = `${ref}:${one(p, 'number')[1]}`
        pinsAt.set(id, key(x, y))
        points.push({ k: key(x, y), x, y, id })
      }
    }
  }
  const segs = kids(root, 'wire').map((w) => {
    const [a, b] = kids(one(w, 'pts'), 'xy').map((xy) => ({ x: n(xy[1]!), y: n(xy[2]!) }))
    join(key(a!.x, a!.y), key(b!.x, b!.y))
    return { a: a!, b: b! }
  })
  for (const l of kids(root, 'label')) {
    const at = one(l, 'at')
    join(key(n(at[1]!), n(at[2]!)), `label:${l[1]}`)
  }
  // 선분 위에 놓인 점(핀 끝·다른 선의 끝)은 그 선과 이어진다
  const ends = [...points.map((p) => ({ x: p.x, y: p.y })), ...segs.flatMap((s) => [s.a, s.b])]
  for (const s of segs) {
    for (const p of ends) {
      const onX = Math.abs(s.a.x - s.b.x) < 1e-6 && Math.abs(p.x - s.a.x) < 1e-6 && p.y >= Math.min(s.a.y, s.b.y) - 1e-6 && p.y <= Math.max(s.a.y, s.b.y) + 1e-6
      const onY = Math.abs(s.a.y - s.b.y) < 1e-6 && Math.abs(p.y - s.a.y) < 1e-6 && p.x >= Math.min(s.a.x, s.b.x) - 1e-6 && p.x <= Math.max(s.a.x, s.b.x) + 1e-6
      if (onX || onY) join(key(p.x, p.y), key(s.a.x, s.a.y))
    }
  }
  const pinGroup = new Map<string, string>()
  for (const [id, k] of pinsAt) pinGroup.set(id, find(k))
  return { pinGroup, pinsAt }
}

const pin = (id: string, number: string, signal?: string): Pin => ({ id, number, x: 0.5, y: 0.5, ...(signal ? { signal } : {}) })
const part = (id: string, name: string, pins: Pin[], extra: Partial<PartDef> = {}): PartDef => ({
  id,
  name,
  image: { data: 'data:image/png;base64,AA==', width: 10, height: 10 },
  connectors: [],
  pins,
  ...extra
})
let c = 0
const uuid = () => `00000000-0000-4000-8000-${String(++c).padStart(12, '0')}`
const opts = { title: 'board', date: '2026-09-29', newUuid: uuid }

function wire(p: Project, a: [string, string], b: [string, string]): Project {
  const r = connectEnds(p, { instanceId: a[0], pinId: a[1] }, { instanceId: b[0], pinId: b[1] }, { color: '#000000', width: 2 }, uuid)
  if (!r.ok) throw new Error(r.error)
  return r.project
}

const mcu = part('mcu', 'ESP32 DevKit', [pin('v', '1', 'VCC'), pin('g', '2', 'GND'), pin('a', '3', 'SDA'), pin('b', '4', 'SCL'), pin('x', '5', 'IO5')], {
  partNumber: 'ESP32-DEVKITC',
  manufacturer: 'Espressif'
})
const sensor = part('bme', 'BME280', [pin('v', '1', 'VCC'), pin('g', '2', 'GND'), pin('a', '3', 'SDA'), pin('b', '4', 'SCL')], { refPrefix: 'U' })
const res = part('r', '10k', [pin('1', '1'), pin('2', '2')], { refPrefix: 'R' })

function board(): Project {
  let p = emptyProject('b')
  p = addInstance(p, mcu, { id: 'u1', x: 0, y: 0 })
  p = addInstance(p, sensor, { id: 'u2', x: 400, y: 0 })
  p = addInstance(p, { ...res, symbol: applyTemplate(SYMBOL_TEMPLATES.find((t) => t.id === 'resistor')!, res, uuid) }, { id: 'r1', x: 200, y: 200 })
  p = wire(p, ['u1', 'v'], ['u2', 'v'])
  p = wire(p, ['u1', 'g'], ['u2', 'g'])
  p = wire(p, ['u1', 'a'], ['u2', 'a'])
  p = wire(p, ['u1', 'b'], ['u2', 'b'])
  p = wire(p, ['r1', '1'], ['u1', 'a'])
  p = wire(p, ['r1', '2'], ['u1', 'v'])
  return p
}

/** 우리 넷과 KiCad에서 풀린 넷이 같다: 같은 넷 핀은 이어지고, 다른 넷·안 이은 핀은 떨어져 있다 */
function expectSameNets(p: Project, text: string) {
  const { pinGroup } = kicadNets(parse(text))
  const ref = new Map(p.instances.map((i) => [i.id, i.refDes]))
  const ours = new Map<string, number>()
  const groups: string[][] = []
  for (const w of p.wires) {
    const ids = [w.from, w.to].map((e) => ('instanceId' in e ? `${ref.get(e.instanceId)}:${p.parts[p.instances.find((i) => i.id === e.instanceId)!.partId]!.pins.find((x) => x.id === e.pinId)!.number}` : ''))
    groups.push(ids.filter(Boolean))
  }
  // 우리 쪽 넷 묶기
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k)
    return parent.get(k) === k ? k : find(parent.get(k)!)
  }
  for (const g of groups) for (const x of g.slice(1)) parent.set(find(x), find(g[0]!))
  let i = 0
  for (const id of pinGroup.keys()) ours.set(id, parent.has(id) ? [...parent.keys()].indexOf(find(id)) : 1000 + i++)
  const all = [...pinGroup.keys()]
  for (const a of all) {
    for (const b of all) {
      if (a >= b) continue
      expect(pinGroup.get(a) === pinGroup.get(b), `${a} ↔ ${b}`).toBe(ours.get(a) === ours.get(b))
    }
  }
}

describe('KiCad 회로도 내보내기 (040)', () => {
  it('구조: 괄호가 맞고, 기호는 파일 안에, 부품마다 배치·필드·핀', () => {
    const text = exportKicadSchematic(board(), opts)
    const root = parse(text)
    expect(root[0]).toBe('kicad_sch')
    expect(one(root, 'version')[1]).toBe('20230121')
    const libs = kids(one(root, 'lib_symbols'), 'symbol')
    expect(libs.map((s) => s[1])).toEqual(['open_perfboard:ESP32_DevKit', 'open_perfboard:BME280', 'open_perfboard:10k'])
    const placed = kids(root, 'symbol')
    expect(placed).toHaveLength(3)
    const u1 = placed[0]!
    const prop = (s: SExpr[], k: string) => kids(s, 'property').find((x) => x[1] === k)?.[2]
    expect([prop(u1, 'Reference'), prop(u1, 'Value'), prop(u1, 'MPN'), prop(u1, 'Manufacturer')]).toEqual(['U1', 'ESP32 DevKit', 'ESP32-DEVKITC', 'Espressif'])
    expect(kids(u1, 'pin')).toHaveLength(5)
    expect(prop(placed[2]!, 'Reference')).toBe('R1')
    // 저항: 핀 번호·이름 숨김
    expect(kids(libs[2]!, 'pin_numbers')).toHaveLength(1)
  })

  it('좌표는 모두 1.27 mm 격자 위 (핀 끝·선·라벨·배치)', () => {
    const text = exportKicadSchematic(setNetLabels(board(), [board().wires[1]!.id], true), opts)
    const root = parse(text)
    const onGrid = (v: SExpr) => Math.abs(n(v) / 1.27 - Math.round(n(v) / 1.27)) < 1e-6
    for (const w of kids(root, 'wire')) for (const xy of kids(one(w, 'pts'), 'xy')) expect(onGrid(xy[1]!) && onGrid(xy[2]!)).toBe(true)
    for (const l of kids(root, 'label')) expect(onGrid(one(l, 'at')[1]!) && onGrid(one(l, 'at')[2]!)).toBe(true)
    const { pinsAt } = kicadNets(root)
    for (const k of pinsAt.values()) {
      const [x, y] = k.split(',').map((v) => Number(v) / 1000)
      expect(onGrid(String(x)) && onGrid(String(y)), k).toBe(true)
    }
  })

  it('연결이 우리 넷과 같다 — 기본 배치, 옮기고 돌리고 뒤집은 뒤, 넷 라벨', () => {
    let p = board()
    expectSameNets(p, exportKicadSchematic(p, opts))
    p = rotateSymbols(mirrorSymbols(moveSchematicItems(p, { instances: ['r1'] }, -300, 40), ['u2'], 'horizontal'), ['r1'], 90)
    expectSameNets(p, exportKicadSchematic(p, opts))
    p = setNetLabels(p, [p.wires[0]!.id], true)
    const text = exportKicadSchematic(p, opts)
    expectSameNets(p, text)
    expect(kids(parse(text), 'label').map((l) => l[1])).toContain('VCC')
  })

  it('선이 다른 넷의 핀 위를 지나면 그 넷은 라벨로 (KiCad에서 잘못 이어지지 않게)', () => {
    // 핀이 왼쪽·오른쪽에 하나씩인 기호 셋을 한 줄로 → a의 왼쪽 핀과 c의 오른쪽 핀을 이으면 가운데 b의 핀을 지나기 쉽다
    let p = emptyProject('x')
    const two = part('d', 'D', [pin('a', '1'), pin('b', '2')])
    p = addInstance(p, two, { id: 'a', x: 0, y: 0 })
    p = addInstance(p, two, { id: 'b', x: 0, y: 0 })
    p = addInstance(p, two, { id: 'c', x: 0, y: 0 })
    expect(schematicSymbol(p.parts.d!).pins.map((s) => s.side).sort()).toEqual(['left', 'right'])
    p = { ...p, schematic: { symbols: { a: { x: 0, y: 0 }, b: { x: 300, y: 0 }, c: { x: 600, y: 0 } } } }
    p = wire(p, ['a', 'b'], ['c', 'a']) // a 오른쪽 → c 왼쪽: 곧은 선이 b를 지난다
    const text = exportKicadSchematic(p, opts)
    expectSameNets(p, text)
    // 곧은 선은 b의 핀 끝을 지나므로 선 대신 양 끝 라벨
    const root = parse(text)
    expect(kids(root, 'wire')).toHaveLength(0)
    expect(kids(root, 'label')).toHaveLength(2)
  })

  it('넷 이름이 겹치면 _2, 한 기호 안 핀 번호가 겹치면 _2', () => {
    let p = emptyProject('x')
    const dup = part('m', 'M', [pin('a', '1', 'SIG'), pin('b', '1', 'SIG'), pin('c', '2', 'SIG'), pin('d', '3', 'SIG')])
    p = addInstance(p, dup, { id: 'u', x: 0, y: 0 })
    p = wire(p, ['u', 'a'], ['u', 'c'])
    p = wire(p, ['u', 'b'], ['u', 'd'])
    p = setNetLabels(p, p.wires.map((w) => w.id), true)
    const root = parse(exportKicadSchematic(p, opts))
    const names = [...new Set(kids(root, 'label').map((l) => l[1]))].sort()
    expect(names).toEqual(['SIG', 'SIG_2'])
    const lib = kids(one(root, 'lib_symbols'), 'symbol')[0]!
    const numbers = kids(lib, 'symbol').flatMap((u) => kids(u, 'pin')).map((x) => one(x, 'number')[1])
    expect(numbers).toEqual(['1', '2', '3', '1_2'].sort((a, b) => numbers.indexOf(a) - numbers.indexOf(b)))
    expect(new Set(numbers).size).toBe(4)
  })

  it('전기 종류와 핀 방향: 왼쪽 핀은 0°, 오른쪽 180°, 위 270°, 아래 90°', () => {
    const p = addInstance(emptyProject('x'), { ...mcu, pins: mcu.pins.map((x) => (x.id === 'a' ? { ...x, electrical: 'bidirectional' as const } : x)) }, { id: 'u', x: 0, y: 0 })
    const lib = kids(one(parse(exportKicadSchematic(p, opts)), 'lib_symbols'), 'symbol')[0]!
    const pins = kids(lib, 'symbol').flatMap((u) => kids(u, 'pin'))
    const by = (name: string) => pins.find((x) => one(x, 'name')[1] === name)!
    expect(by('SDA')[1]).toBe('bidirectional')
    expect(by('SCL')[1]).toBe('passive')
    expect(one(by('VCC'), 'at')[3]).toBe('270')
    expect(one(by('GND'), 'at')[3]).toBe('90')
    expect(one(by('SDA'), 'at')[3]).toBe('0')
  })
})
