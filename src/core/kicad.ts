// KiCad 회로도 내보내기 (040): 회로도(039)를 KiCad 7 형식(.kicad_sch, S식) 파일 하나로.
// - 단위: 기호 좌표 1 = 5 mil = 0.127 mm. 핀 끝은 50 mil 격자라 1.27 mm 배수에 놓인다
// - 기호는 파일 안(lib_symbols)에 넣는다. 부품 × (회전·반전)마다 따로 — 회전·반전을 도형에 미리 적용해 두고 배치는 회전 없이
// - KiCad는 선 끝이 다른 핀·선에 닿으면 이어 버린다 → 그런 넷은 선 대신 라벨로 (연결이 틀리지 않는 것이 먼저)
import type { PartDef, PartSymbol, PinElectrical, Project, SchPlacement, Shape, SymbolSide } from './model'
import { buildSchematicScene, layoutSchematic, netNames, pinKey, schematicPins, symbolFrame, toWorld, wireNets, worldPin, type Point, type SchSymbolItem } from './schematic'
import { pinLabel, SYMBOL_GRID, SYMBOL_PIN_LENGTH } from './symbol'
import { shapeBounds } from './drawing'

export const KICAD_SCH_VERSION = 20230121
/** 기호 단위 → mm */
const MM = 0.127
const LIB = 'open_perfboard'
/** 도면 왼쪽 위 여백 (기호 단위, 1인치) */
const SHEET_MARGIN = 200

export interface KicadExportOptions {
  title: string
  /** YYYY-MM-DD */
  date: string
  /** 8-4-4-4-12 16진수 */
  newUuid: () => string
}

const num = (v: number): string => {
  const r = Math.round(v * 10000) / 10000
  return String(r === 0 ? 0 : r)
}
const mm = (v: number) => num(v * MM)
const str = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`
const font = (size = 1.27) => `(font (size ${num(size)} ${num(size)}))`

// ---------------------------------------------------------------- 라이브러리 기호

type Placement0 = Pick<SchPlacement, 'rotation' | 'mirror'>

/** 기호 자기 좌표 → 라이브러리 좌표 (mm, y 위로) */
function libPoint(pl: Placement0, pivot: Point, p: Point): [string, string] {
  const r = toWorld({ x: 0, y: 0, ...pl }, pivot, p)
  return [mm(r.x), mm(-r.y)]
}

/** 도형 자기 회전(x, y 기준)을 적용한 점 */
function turnLocal(s: Shape, x: number, y: number): Point {
  const a = ((s.rotation ?? 0) * Math.PI) / 180
  if (!a) return { x: s.x + x, y: s.y + y }
  return { x: s.x + x * Math.cos(a) - y * Math.sin(a), y: s.y + x * Math.sin(a) + y * Math.cos(a) }
}

const stroke = (width: number | undefined, dashed = false) => `(stroke (width ${mm(width ?? 2)}) (type ${dashed ? 'dash' : 'default'}))`
/** 채우기: 없음 / 검정(선과 같은 색) = outline / 그 밖 = background */
function fill(color: string | undefined, strokeColor: string | undefined): string {
  if (!color) return '(fill (type none))'
  if (color === '#000000' || color === strokeColor) return '(fill (type outline))'
  return '(fill (type background))'
}

function polyline(pl: Placement0, pivot: Point, pts: Point[], strokeW: number | undefined, fillText: string, dashed = false): string {
  const xy = pts.map((p) => libPoint(pl, pivot, p)).map(([x, y]) => `(xy ${x} ${y})`)
  return `(polyline (pts ${xy.join(' ')}) ${stroke(strokeW, dashed)} ${fillText})`
}

/** 화살표 머리 (KiCad 선에는 화살표가 없어 작은 채운 삼각형으로) */
function arrowHead(tip: Point, from: Point, size: number): Point[] {
  const dx = tip.x - from.x
  const dy = tip.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const bx = tip.x - ux * size
  const by = tip.y - uy * size
  return [tip, { x: bx - uy * size * 0.5, y: by + ux * size * 0.5 }, { x: bx + uy * size * 0.5, y: by - ux * size * 0.5 }, tip]
}

/** 도형 하나 → KiCad 그림 요소들. 부품 이름 글상자는 Value 필드가 대신하므로 뺀다 */
function shapeItems(s: Shape, pl: Placement0, pivot: Point, partName: string): string[] {
  switch (s.type) {
    case 'rect': {
      const f = fill(s.fill, s.stroke)
      if (!s.rotation) {
        const [x1, y1] = libPoint(pl, pivot, { x: s.x, y: s.y })
        const [x2, y2] = libPoint(pl, pivot, { x: s.x + s.w, y: s.y + s.h })
        return [`(rectangle (start ${x1} ${y1}) (end ${x2} ${y2}) ${stroke(s.stroke ? s.strokeWidth : 0)} ${f})`]
      }
      const c = [turnLocal(s, 0, 0), turnLocal(s, s.w, 0), turnLocal(s, s.w, s.h), turnLocal(s, 0, s.h), turnLocal(s, 0, 0)]
      return [polyline(pl, pivot, c, s.stroke ? s.strokeWidth : 0, f)]
    }
    case 'ellipse': {
      const f = fill(s.fill, s.stroke)
      if (s.w === s.h && !s.rotation) {
        const [cx, cy] = libPoint(pl, pivot, { x: s.x + s.w / 2, y: s.y + s.h / 2 })
        return [`(circle (center ${cx} ${cy}) (radius ${mm(s.w / 2)}) ${stroke(s.stroke ? s.strokeWidth : 0)} ${f})`]
      }
      const pts = Array.from({ length: 33 }, (_, i) => {
        const a = (i / 32) * Math.PI * 2
        return turnLocal(s, s.w / 2 + (s.w / 2) * Math.cos(a), s.h / 2 + (s.h / 2) * Math.sin(a))
      })
      return [polyline(pl, pivot, pts, s.stroke ? s.strokeWidth : 0, f)]
    }
    case 'line': {
      const pts: Point[] = []
      for (let i = 0; i + 1 < s.points.length; i += 2) pts.push(turnLocal(s, s.points[i]!, s.points[i + 1]!))
      if (pts.length < 2) return []
      if (s.closed) return [polyline(pl, pivot, [...pts, pts[0]!], s.strokeWidth, fill(s.fill, s.stroke), s.dashed)]
      const out = [polyline(pl, pivot, pts, s.strokeWidth, '(fill (type none))', s.dashed)]
      const head = Math.max(4, s.strokeWidth * 3)
      if (s.arrowEnd) out.push(polyline(pl, pivot, arrowHead(pts[pts.length - 1]!, pts[pts.length - 2]!, head), 0, '(fill (type outline))'))
      if (s.arrowStart) out.push(polyline(pl, pivot, arrowHead(pts[0]!, pts[1]!, head), 0, '(fill (type outline))'))
      return out
    }
    case 'text': {
      if (s.text.trim() === partName.trim()) return []
      const h = Math.max(1, s.text.split('\n').length) * s.fontSize * 1.2
      const align = s.align ?? 'left'
      const ax = align === 'left' ? s.x : align === 'right' ? s.x + s.w : s.x + s.w / 2
      const [x, y] = libPoint(pl, pivot, { x: ax, y: s.y + h / 2 })
      const justify = align === 'center' ? '' : ` (justify ${align})`
      return [`(text ${str(s.text)} (at ${x} ${y} 0) (effects ${font(s.fontSize * MM)}${justify}))`]
    }
    default:
      return [] // 사진 도형은 회로도에 그리지 않는다
  }
}

/** 핀이 몸통으로 뻗는 방향 (KiCad 핀 각도: 0 = 오른쪽으로) */
const PIN_ANGLE: Record<SymbolSide, number> = { left: 0, right: 180, top: 270, bottom: 90 }

/** 한 기호 안에서 겹치지 않는 핀 번호 (KiCad는 같은 번호를 한 핀으로 본다) */
function pinNumbers(part: PartDef, symbol: PartSymbol): Map<string, string> {
  const byPin = new Map(part.pins.map((p) => [p.id, p]))
  const used = new Set<string>()
  const out = new Map<string, string>()
  for (const sp of symbol.pins) {
    const pin = byPin.get(sp.pinId)
    const base = (pin ? pinLabel(part.connectors, pin) : '') || '?'
    let n = base
    for (let k = 2; used.has(n); k++) n = `${base}_${k}`
    used.add(n)
    out.set(sp.pinId, n)
  }
  return out
}

interface LibVariant {
  libName: string
  text: string
  numbers: Map<string, string>
}

function libSymbol(item: SchSymbolItem, libName: string): LibVariant {
  const { part, symbol, pivot } = item
  const pl: Placement0 = { rotation: item.placement.rotation, mirror: item.placement.mirror }
  const numbers = pinNumbers(part, symbol)
  const byPin = new Map(part.pins.map((p) => [p.id, p]))
  const graphics = symbol.drawing.shapes.flatMap((s) => shapeItems(s, pl, pivot, part.name))
  const pins = symbol.pins.map((sp) => {
    const wp = worldPin({ x: 0, y: 0, ...pl }, pivot, sp)
    const pin = byPin.get(sp.pinId)
    // KiCad에는 GND 핀 종류가 없다: 전원 입력으로
    const electrical: PinElectrical = pin?.electrical ?? 'passive'
    const kind = electrical === 'ground' ? 'power_in' : electrical
    const name = pin?.signal?.trim() || '~'
    return (
      `(pin ${kind} line (at ${mm(wp.x)} ${mm(-wp.y)} ${PIN_ANGLE[wp.side]}) (length ${mm(sp.length ?? SYMBOL_PIN_LENGTH)})` +
      ` (name ${str(name)} (effects ${font()})) (number ${str(numbers.get(sp.pinId)!)} (effects ${font()})))`
    )
  })
  const flags = [symbol.showNumbers === false ? '(pin_numbers hide)' : '', `(pin_names (offset 0.508)${symbol.showNames === false ? ' hide' : ''})`].filter(Boolean).join(' ')
  const prefix = part.refPrefix || 'U'
  const text = [
    `(symbol ${str(`${LIB}:${libName}`)} ${flags} (in_bom yes) (on_board yes)`,
    `  (property "Reference" ${str(prefix)} (id 0) (at 0 0 0) (effects ${font()}))`,
    `  (property "Value" ${str(part.name)} (id 1) (at 0 0 0) (effects ${font()}))`,
    `  (property "Footprint" "" (id 2) (at 0 0 0) (effects ${font()} hide))`,
    `  (property "Datasheet" "" (id 3) (at 0 0 0) (effects ${font()} hide))`,
    `  (symbol ${str(`${libName}_0_1`)}`,
    ...graphics.map((g) => `    ${g}`),
    '  )',
    `  (symbol ${str(`${libName}_1_1`)}`,
    ...pins.map((p) => `    ${p}`),
    '  )',
    ')'
  ].join('\n')
  return { libName, text, numbers }
}

/** 라이브러리 기호 이름: 영문·숫자·_·- 만 (KiCad의 : 구분자와 겹치지 않게) */
const safeName = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'PART'

// ---------------------------------------------------------------- 연결 검사

type NetOf = (key: string) => number | undefined

/**
 * 선으로 내보내면 KiCad에서 연결이 틀어지는 넷: 선분이 지나는 격자점(끝 포함)에 다른 넷의 핀 끝이나 선 꼭짓점이 있다.
 * 모든 좌표가 격자(10) 위라 선분 위 격자점만 보면 된다 (선 길이에 비례)
 */
function conflictingNets(
  wires: readonly { net: number; points: number[] }[],
  pinNet: ReadonlyMap<string, number>,
  pinKeys: Iterable<string>
): Set<number> {
  const at = new Map<string, Set<number>>()
  const add = (k: string, n: number) => {
    const s = at.get(k)
    if (s) s.add(n)
    else at.set(k, new Set([n]))
  }
  // 이어지지 않은 핀은 어느 넷과도 다른 번호 (-1부터 아래로)
  let lone = -1
  for (const k of pinKeys) add(k, pinNet.get(k) ?? lone--)
  for (const w of wires) for (let i = 0; i + 1 < w.points.length; i += 2) add(`${w.points[i]},${w.points[i + 1]}`, w.net)
  const bad = new Set<number>()
  for (const w of wires) {
    for (let i = 0; i + 3 < w.points.length; i += 2) {
      const x1 = w.points[i]!
      const y1 = w.points[i + 1]!
      const x2 = w.points[i + 2]!
      const y2 = w.points[i + 3]!
      const steps = Math.round(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / SYMBOL_GRID)
      for (let s = 0; s <= steps; s++) {
        const x = steps ? x1 + ((x2 - x1) * s) / steps : x1
        const y = steps ? y1 + ((y2 - y1) * s) / steps : y1
        const nets = at.get(`${x},${y}`)
        if (!nets) continue
        for (const n of nets) {
          if (n === w.net) continue
          bad.add(w.net)
          if (n >= 0) bad.add(n)
        }
      }
    }
  }
  return bad
}

// ---------------------------------------------------------------- 파일

const PAPERS: { name: string; w: number; h: number }[] = [
  { name: 'A4', w: 297, h: 210 },
  { name: 'A3', w: 420, h: 297 },
  { name: 'A2', w: 594, h: 420 },
  { name: 'A1', w: 841, h: 594 },
  { name: 'A0', w: 1189, h: 841 }
]

const LABEL_ANGLE: Record<SymbolSide, { angle: number; justify: string }> = {
  left: { angle: 180, justify: 'right bottom' },
  right: { angle: 0, justify: 'left bottom' },
  top: { angle: 90, justify: 'left bottom' },
  bottom: { angle: 270, justify: 'right bottom' }
}

/** 지금 배선도의 회로도 → .kicad_sch 내용 */
export function exportKicadSchematic(project: Project, o: KicadExportOptions): string {
  const layout = layoutSchematic(project)
  const scene = buildSchematicScene(project, layout)
  const pins = schematicPins(project, layout)
  const root = o.newUuid()

  // 도면을 용지 안으로 (격자 단위로 옮겨 핀 끝이 격자에서 벗어나지 않게)
  const b = scene.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
  const sx = Math.round((SHEET_MARGIN - b.x) / SYMBOL_GRID) * SYMBOL_GRID
  const sy = Math.round((SHEET_MARGIN - b.y) / SYMBOL_GRID) * SYMBOL_GRID
  const X = (v: number) => mm(v + sx)
  const Y = (v: number) => mm(v + sy)
  const needW = (b.width + SHEET_MARGIN * 2) * MM
  const needH = (b.height + SHEET_MARGIN * 2) * MM
  const paper = PAPERS.find((p) => p.w >= needW && p.h >= needH)
  const paperText = paper ? `(paper ${str(paper.name)})` : `(paper "User" ${num(Math.ceil(needW))} ${num(Math.ceil(needH))})`

  // 넷: 전선 → 넷 번호, 핀 끝 → 넷 번호
  const nets = wireNets(project)
  const names = netNames(project)
  const pinNet = new Map<string, number>()
  for (const w of project.wires) {
    const n = nets.get(w.id)!
    for (const e of [w.from, w.to]) if ('instanceId' in e) pinNet.set(pinKey(e.instanceId, e.pinId), n)
  }
  const pinPoint = new Map<string, string>() // 핀 키 → "x,y"
  for (const [k, p] of pins) pinPoint.set(k, `${p.x},${p.y}`)
  const pinNetAt = new Map<string, number>()
  for (const [k, pt] of pinPoint) {
    const n = pinNet.get(k)
    if (n !== undefined) pinNetAt.set(pt, n)
  }

  const lineWires = scene.wires.map((w) => ({ ...w, net: nets.get(w.wireId)! }))
  const bad = conflictingNets(lineWires, pinNetAt, pinPoint.values())
  const labeledNets = new Set<number>([...bad])
  for (const id of project.schematic?.labeled ?? []) {
    const n = nets.get(id)
    if (n !== undefined) labeledNets.add(n)
  }

  // 라벨 이름: 넷마다 하나, 넷끼리 겹치지 않게
  const netName = new Map<number, string>()
  const usedNames = new Set<string>()
  for (const w of project.wires) {
    const n = nets.get(w.id)!
    if (!labeledNets.has(n) || netName.has(n)) continue
    const base = (names.get(w.id) ?? `N${n + 1}`).trim().replace(/\s+/g, '_') || `N${n + 1}`
    let name = base
    for (let k = 2; usedNames.has(name); k++) name = `${base}_${k}`
    usedNames.add(name)
    netName.set(n, name)
  }

  const items: string[] = []
  // 선
  for (const w of lineWires) {
    if (labeledNets.has(w.net)) continue
    for (let i = 0; i + 3 < w.points.length; i += 2) {
      items.push(`(wire (pts (xy ${X(w.points[i]!)} ${Y(w.points[i + 1]!)}) (xy ${X(w.points[i + 2]!)} ${Y(w.points[i + 3]!)})) (stroke (width 0) (type default)) (uuid ${o.newUuid()}))`)
    }
  }
  // 접속점: 선으로 내보낸 넷의 접속점과 선 둘 이상이 모이는 핀 끝
  const lineEnds = new Map<string, number>()
  for (const w of lineWires) {
    if (labeledNets.has(w.net)) continue
    for (const k of [`${w.points[0]},${w.points[1]}`, `${w.points[w.points.length - 2]},${w.points[w.points.length - 1]}`]) lineEnds.set(k, (lineEnds.get(k) ?? 0) + 1)
  }
  const junctionAt = new Set<string>()
  for (const [k, count] of lineEnds) {
    const isPin = pinNetAt.has(k)
    if ((isPin && count >= 2) || (!isPin && count >= 3)) junctionAt.add(k)
  }
  for (const k of junctionAt) {
    const [x, y] = k.split(',').map(Number)
    items.push(`(junction (at ${X(x!)} ${Y(y!)}) (diameter 0) (color 0 0 0 0) (uuid ${o.newUuid()}))`)
  }
  // 라벨: 라벨로 내보내는 넷의 핀 끝마다
  const labelDone = new Set<string>()
  for (const w of project.wires) {
    const n = nets.get(w.id)!
    if (!labeledNets.has(n)) continue
    for (const e of [w.from, w.to]) {
      if (!('instanceId' in e)) continue
      const k = pinKey(e.instanceId, e.pinId)
      const p = pins.get(k)
      if (!p || labelDone.has(k)) continue
      labelDone.add(k)
      const a = LABEL_ANGLE[p.side]
      items.push(`(label ${str(netName.get(n)!)} (at ${X(p.x)} ${Y(p.y)} ${a.angle}) (fields_autoplaced) (effects ${font()} (justify ${a.justify})) (uuid ${o.newUuid()}))`)
    }
  }

  // 기호: 부품 × 회전·반전마다 라이브러리 기호 하나
  const variants = new Map<string, LibVariant>()
  const usedLib = new Set<string>()
  const placed: string[] = []
  for (const item of scene.symbols) {
    const pl = item.placement
    const key = `${item.part.id}|${pl.rotation ?? 0}|${pl.mirror ? 1 : 0}`
    let v = variants.get(key)
    if (!v) {
      const base = safeName(item.part.name) + (pl.rotation ? `_R${pl.rotation}` : '') + (pl.mirror ? '_M' : '')
      let name = base
      for (let k = 2; usedLib.has(name); k++) name = `${base}_${k}`
      usedLib.add(name)
      v = libSymbol(item, name)
      variants.set(key, v)
    }
    // 부품 이름 글상자 자리 = Value 필드
    const nameShape = item.symbol.drawing.shapes.find((s) => s.type === 'text' && s.text.trim() === item.part.name.trim())
    const nb = nameShape ? shapeBounds(nameShape) : undefined
    const valueAt = nb ? toWorld(pl, item.pivot, { x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 }) : { x: item.box.x + item.box.width / 2, y: item.box.y + item.box.height + 10 }
    const extra = [
      ...(item.part.partNumber ? [['MPN', item.part.partNumber]] : []),
      ...(item.part.manufacturer ? [['Manufacturer', item.part.manufacturer]] : [])
    ]
    const fields = [
      `(property "Reference" ${str(item.refDes)} (id 0) (at ${X(item.box.x)} ${Y(item.box.y - 6)} 0) (effects ${font()} (justify left)))`,
      `(property "Value" ${str(item.part.name)} (id 1) (at ${X(valueAt.x)} ${Y(valueAt.y)} 0) (effects ${font()}))`,
      `(property "Footprint" "" (id 2) (at ${X(pl.x)} ${Y(pl.y)} 0) (effects ${font()} hide))`,
      `(property "Datasheet" "" (id 3) (at ${X(pl.x)} ${Y(pl.y)} 0) (effects ${font()} hide))`,
      ...extra.map(([k, v], i) => `(property ${str(k!)} ${str(v!)} (id ${4 + i}) (at ${X(pl.x)} ${Y(pl.y)} 0) (effects ${font()} hide))`)
    ]
    placed.push(
      [
        `(symbol (lib_id ${str(`${LIB}:${v.libName}`)}) (at ${X(pl.x)} ${Y(pl.y)} 0) (unit 1) (in_bom yes) (on_board yes) (dnp no)`,
        `  (uuid ${o.newUuid()})`,
        ...fields.map((f) => `  ${f}`),
        ...item.symbol.pins.map((sp) => `  (pin ${str(v!.numbers.get(sp.pinId)!)} (uuid ${o.newUuid()}))`),
        `  (instances (project ${str(o.title)} (path ${str(`/${root}`)} (reference ${str(item.refDes)}) (unit 1))))`,
        ')'
      ].join('\n')
    )
  }

  return [
    `(kicad_sch (version ${KICAD_SCH_VERSION}) (generator open_perfboard)`,
    `(uuid ${root})`,
    paperText,
    `(title_block (title ${str(o.title)}) (date ${str(o.date)}) (comment 1 "Open Perfboard"))`,
    '(lib_symbols',
    ...[...variants.values()].map((v) => v.text),
    ')',
    ...items,
    ...placed,
    '(sheet_instances (path "/" (page "1")))',
    ')',
    ''
  ].join('\n')
}
