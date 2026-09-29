// 배선도마다 회로도 (039): 기호 자리(자동 배치 포함), 좌표 변환, 회로도 선 경로, 넷 이름, 동작.
// 연결은 배선도의 wires를 그대로 쓴다. 회로도가 따로 저장하는 것은 기호·접속점 자리와 라벨로 보일 전선뿐.
// 좌표 1 = 5 mil. 기호 자리 (x, y) = 몸통 가운데를 격자에 맞춘 점(pivot) → 90° 단위로 돌려도 핀 끝이 격자 위
import type { PartDef, PartSymbol, Project, SchPlacement, SchRotation, Schematic, SymbolPin, SymbolSide, Wire, WireEnd } from './model'
import { autoSymbol, bodyBox, freeSpot, missingPins, placePin, syncSymbol, SYMBOL_GRID, SYMBOL_PIN_LENGTH, snapGrid, POWER_BOTTOM, POWER_TOP } from './symbol'
import { shapeBounds, unionBox, type Box } from './drawing'
import { byId } from './lookup'
import { naturalCompare } from './sort'

export interface Point {
  x: number
  y: number
}

/** 자동 배치: 한 줄 너비, 기호 사이 간격 */
const ROW_WIDTH = 1200
const GAP = 40
const ceilGrid = (v: number) => Math.ceil(v / SYMBOL_GRID) * SYMBOL_GRID

// ---------------------------------------------------------------- 기호

const autoCache = new WeakMap<PartDef, PartSymbol>()

/**
 * 부품의 회로도 기호 (부품 정의마다 한 번만 만든다). 저장된 기호가 없으면 기본 기호,
 * 저장된 기호에 놓지 않은 핀이 있으면 빈 자리에 채운다 (회로도·KiCad에서 모든 핀이 이어질 수 있게)
 */
export function schematicSymbol(part: PartDef): PartSymbol {
  let s = autoCache.get(part)
  if (s) return s
  if (part.symbol) {
    const missing = missingPins(part, part.symbol)
    if (missing.length === 0) return part.symbol
    s = syncSymbol(part, part.symbol)
    for (const p of missing) {
      const spot = freeSpot(s)
      s = placePin(s, p.id, spot, spot.side)
    }
  } else {
    let n = 0
    s = autoSymbol(part, () => `auto-${++n}`)
  }
  autoCache.set(part, s)
  return s
}

interface SymbolFrame {
  /** 몸통 가운데 (격자 위, 기호 자기 좌표) */
  pivot: Point
  /** 기호 전체(도형 + 핀 끝) 상자, pivot 기준 상대 좌표 (회전 전) */
  extent: Box
  /** 몸통 상자 (글상자 빼고), pivot 기준 상대 좌표 — 회로도 선이 피해 간다 */
  body: Box
}
const frameCache = new WeakMap<PartSymbol, SymbolFrame>()

export function symbolFrame(sym: PartSymbol): SymbolFrame {
  let f = frameCache.get(sym)
  if (!f) {
    const body = bodyBox(sym)
    const pivot = { x: snapGrid(body.x + body.width / 2), y: snapGrid(body.y + body.height / 2) }
    const box = unionBox([...sym.drawing.shapes.map(shapeBounds), ...sym.pins.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 }))]) ?? body
    f = {
      pivot,
      extent: { x: box.x - pivot.x, y: box.y - pivot.y, width: box.width, height: box.height },
      body: { x: body.x - pivot.x, y: body.y - pivot.y, width: body.width, height: body.height }
    }
    frameCache.set(sym, f)
  }
  return f
}

/** 방향(벡터)을 자리의 반전·회전대로 돌린다 (화면 좌표, y 아래로, 시계 방향) */
function orient(pl: Pick<SchPlacement, 'rotation' | 'mirror'>, x: number, y: number): Point {
  const mx = pl.mirror ? -x : x
  switch (pl.rotation ?? 0) {
    case 90:
      return { x: -y, y: mx }
    case 180:
      return { x: -mx, y: -y }
    case 270:
      return { x: y, y: -mx }
    default:
      return { x: mx, y }
  }
}

/** 기호 자기 좌표 → 회로도 좌표 */
export function toWorld(pl: SchPlacement, pivot: Point, p: Point): Point {
  const r = orient(pl, p.x - pivot.x, p.y - pivot.y)
  return { x: pl.x + r.x, y: pl.y + r.y }
}

const SIDE_VEC: Record<SymbolSide, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } }
function sideOf(v: Point): SymbolSide {
  if (v.x < 0) return 'left'
  if (v.x > 0) return 'right'
  return v.y < 0 ? 'top' : 'bottom'
}

/** 기호 핀 → 회로도 좌표의 기호 핀 (끝점·붙는 쪽이 돌아간 것) */
export function worldPin(pl: SchPlacement, pivot: Point, sp: SymbolPin): SymbolPin {
  const at = toWorld(pl, pivot, sp)
  const v = SIDE_VEC[sp.side]
  return { ...sp, x: at.x, y: at.y, side: sideOf(orient(pl, v.x, v.y)) }
}

/** 자리의 기호 전체 상자 (회로도 좌표) */
export function placedBox(pl: SchPlacement, extent: Box): Box {
  const a = orient(pl, extent.x, extent.y)
  const b = orient(pl, extent.x + extent.width, extent.y + extent.height)
  return { x: pl.x + Math.min(a.x, b.x), y: pl.y + Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

// ---------------------------------------------------------------- 배치

export interface SchLayout {
  symbols: ReadonlyMap<string, SchPlacement>
  junctions: ReadonlyMap<string, Point>
}

/**
 * 모든 기호·접속점 자리. 저장된 자리는 그대로, 없는 부품은 참조명 순으로 저장된 것들 아래에 줄지어,
 * 없는 접속점은 이어진 핀들의 가운데
 */
export function layoutSchematic(project: Project): SchLayout {
  const stored = project.schematic?.symbols ?? {}
  const symbols = new Map<string, SchPlacement>()
  const unplaced: { id: string; refDes: string; extent: Box }[] = []
  let placedBottom: number | undefined
  let placedLeft: number | undefined
  for (const inst of project.instances) {
    const part = project.parts[inst.partId]
    if (!part) continue
    const { extent } = symbolFrame(schematicSymbol(part))
    const pl = stored[inst.id]
    if (pl) {
      symbols.set(inst.id, pl)
      const b = placedBox(pl, extent)
      placedBottom = Math.max(placedBottom ?? -Infinity, b.y + b.height)
      placedLeft = Math.min(placedLeft ?? Infinity, b.x)
    } else unplaced.push({ id: inst.id, refDes: inst.refDes, extent })
  }
  unplaced.sort((a, b) => naturalCompare(a.refDes, b.refDes))
  const left = placedLeft ?? 0
  let cursor = left
  let rowTop = placedBottom === undefined ? 0 : placedBottom + GAP * 2
  let rowHeight = 0
  for (const u of unplaced) {
    if (cursor > left && cursor + u.extent.width > left + ROW_WIDTH) {
      cursor = left
      rowTop += rowHeight + GAP * 2
      rowHeight = 0
    }
    // 상자 왼쪽 위가 (cursor, rowTop)보다 앞서지 않게 격자 위로 올림
    symbols.set(u.id, { x: ceilGrid(cursor - u.extent.x), y: ceilGrid(rowTop - u.extent.y) })
    cursor += u.extent.width + GAP
    rowHeight = Math.max(rowHeight, u.extent.height)
  }

  const junctions = new Map<string, Point>()
  const storedJ = project.schematic?.junctions ?? {}
  const pins = schematicPinsFor(project, symbols)
  const near = new Map<string, Point[]>()
  for (const w of project.wires) {
    for (const [a, b] of [
      [w.from, w.to],
      [w.to, w.from]
    ] as const) {
      if (!('junctionId' in a) || storedJ[a.junctionId] || !('instanceId' in b)) continue
      const p = pins.get(pinKey(b.instanceId, b.pinId))
      if (!p) continue
      const list = near.get(a.junctionId)
      if (list) list.push(p)
      else near.set(a.junctionId, [p])
    }
  }
  for (const j of project.junctions ?? []) {
    const s = storedJ[j.id]
    if (s) {
      junctions.set(j.id, s)
      continue
    }
    const ps = near.get(j.id) ?? []
    const c = ps.length ? { x: ps.reduce((n, p) => n + p.x, 0) / ps.length, y: ps.reduce((n, p) => n + p.y, 0) / ps.length } : { x: left, y: rowTop }
    junctions.set(j.id, { x: snapGrid(c.x), y: snapGrid(c.y) })
  }
  return { symbols, junctions }
}

export const pinKey = (instanceId: string, pinId: string) => `${instanceId}/${pinId}`

/** 모든 부품 핀의 회로도 기호 핀 (기호에 놓인 핀만) */
function schematicPinsFor(project: Project, symbols: ReadonlyMap<string, SchPlacement>): Map<string, SymbolPin> {
  const out = new Map<string, SymbolPin>()
  for (const inst of project.instances) {
    const part = project.parts[inst.partId]
    const pl = symbols.get(inst.id)
    if (!part || !pl) continue
    const sym = schematicSymbol(part)
    const { pivot } = symbolFrame(sym)
    for (const sp of sym.pins) out.set(pinKey(inst.id, sp.pinId), worldPin(pl, pivot, sp))
  }
  return out
}

export function schematicPins(project: Project, layout: SchLayout): Map<string, SymbolPin> {
  return schematicPinsFor(project, layout.symbols)
}

// ---------------------------------------------------------------- 선·넷

export interface SchEnd extends Point {
  /** 핀이면 바깥 방향 (선이 나가는 쪽) */
  side?: SymbolSide
}

/** 전선 끝의 회로도 자리. 기호에 놓지 않은 핀이면 기호 가운데 */
export function schematicEnd(end: WireEnd, layout: SchLayout, pins: ReadonlyMap<string, SymbolPin>): SchEnd | undefined {
  if ('junctionId' in end) return layout.junctions.get(end.junctionId)
  const p = pins.get(pinKey(end.instanceId, end.pinId))
  if (p) return { x: p.x, y: p.y, side: p.side }
  return layout.symbols.get(end.instanceId)
}

const horizontal = (s: SymbolSide | undefined) => s === 'left' || s === 'right'

/** 가로·세로 선분이 상자 안쪽을 지나는지 (가장자리에 닿는 것은 괜찮다) */
function crosses(x1: number, y1: number, x2: number, y2: number, b: Box): boolean {
  const e = 0.5
  const [lx, hx] = x1 < x2 ? [x1, x2] : [x2, x1]
  const [ly, hy] = y1 < y2 ? [y1, y2] : [y2, y1]
  return hx > b.x + e && lx < b.x + b.width - e && hy > b.y + e && ly < b.y + b.height - e
}
const pathCrosses = (pts: number[], boxes: readonly Box[]) => {
  for (let i = 0; i + 3 < pts.length; i += 2) {
    for (const b of boxes) if (crosses(pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!, b)) return true
  }
  return false
}
/** 연달아 같은 점·한 줄 위의 가운데 점을 뺀다 */
function simplify(pts: number[]): number[] {
  const out: number[] = []
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]!
    const y = pts[i + 1]!
    const n = out.length
    if (n >= 2 && out[n - 2] === x && out[n - 1] === y) continue
    if (n >= 4) {
      const px = out[n - 4]!
      const py = out[n - 3]!
      const mx = out[n - 2]!
      const my = out[n - 1]!
      if ((px === mx && mx === x) || (py === my && my === y)) {
        out[n - 2] = x
        out[n - 1] = y
        continue
      }
    }
    out.push(x, y)
  }
  return out
}

/** 핀 끝에서 핀 방향으로 조금 나간 점 (몸통을 피해 돌아 나가는 자리) */
const STUB = SYMBOL_GRID * 3
function stub(e: SchEnd): Point {
  switch (e.side) {
    case 'left':
      return { x: e.x - STUB, y: e.y }
    case 'right':
      return { x: e.x + STUB, y: e.y }
    case 'top':
      return { x: e.x, y: e.y - STUB }
    case 'bottom':
      return { x: e.x, y: e.y + STUB }
    default:
      return e
  }
}

/**
 * 회로도 선 (가로·세로만): 곧게 → ㄱ자 두 가지 → 핀에서 조금 나가 ㄹ자 순으로, 양 끝 기호 몸통(avoid)을 가로지르지 않는 첫 경로.
 * 모두 가로지르면 ㄱ자. 핀에서는 핀이 향한 방향으로 먼저 나간다
 */
export function schematicWirePath(a: SchEnd, b: SchEnd, avoid: readonly Box[] = []): number[] {
  const hFirst = a.side ? horizontal(a.side) : b.side ? !horizontal(b.side) : true
  const straight = [a.x, a.y, b.x, b.y]
  const l1 = hFirst ? [a.x, a.y, b.x, a.y, b.x, b.y] : [a.x, a.y, a.x, b.y, b.x, b.y]
  const l2 = hFirst ? [a.x, a.y, a.x, b.y, b.x, b.y] : [a.x, a.y, b.x, a.y, b.x, b.y]
  const sa = stub(a)
  const sb = stub(b)
  const mx = Math.round((sa.x + sb.x) / 2 / SYMBOL_GRID) * SYMBOL_GRID
  const my = Math.round((sa.y + sb.y) / 2 / SYMBOL_GRID) * SYMBOL_GRID
  const zx = [a.x, a.y, sa.x, sa.y, mx, sa.y, mx, sb.y, sb.x, sb.y, b.x, b.y]
  const zy = [a.x, a.y, sa.x, sa.y, sa.x, my, sb.x, my, sb.x, sb.y, b.x, b.y]
  const candidates = a.x === b.x || a.y === b.y ? [straight, l1, l2, zx, zy] : [l1, l2, zx, zy]
  const pick = candidates.find((p) => !pathCrosses(p, avoid)) ?? (a.x === b.x || a.y === b.y ? straight : l1)
  return simplify(pick)
}

const endKey = (e: WireEnd) => ('junctionId' in e ? `j:${e.junctionId}` : `p:${e.instanceId}/${e.pinId}`)

/** 전선 → 넷 번호 (이어진 전선끼리 같은 번호) */
function netRoots(wires: readonly Wire[]): { rootOf: Map<string, number>; nets: Map<number, Wire[]> } {
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let r = k
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!
    let c = k
    while (c !== r) {
      const n = parent.get(c)!
      parent.set(c, r)
      c = n
    }
    return r
  }
  for (const w of wires) {
    const a = endKey(w.from)
    const b = endKey(w.to)
    if (!parent.has(a)) parent.set(a, a)
    if (!parent.has(b)) parent.set(b, b)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const index = new Map<string, number>()
  const rootOf = new Map<string, number>()
  const nets = new Map<number, Wire[]>()
  for (const w of wires) {
    const r = find(endKey(w.from))
    let n = index.get(r)
    if (n === undefined) {
      n = index.size
      index.set(r, n)
    }
    rootOf.set(w.id, n)
    const list = nets.get(n)
    if (list) list.push(w)
    else nets.set(n, [w])
  }
  return { rootOf, nets }
}

/** 전선 id → 넷 번호 (0부터, 이어진 전선끼리 같은 번호) */
export function wireNets(project: Project): Map<string, number> {
  return netRoots(project.wires).rootOf
}

/** 같은 넷의 전선 id (자기 포함) */
export function netWires(project: Project, wireIds: readonly string[]): string[] {
  const { rootOf, nets } = netRoots(project.wires)
  const want = new Set(wireIds.map((id) => rootOf.get(id)).filter((n) => n !== undefined))
  return [...want].flatMap((n) => nets.get(n)!.map((w) => w.id))
}

/**
 * 넷 이름 (전선 id → 이름): 전선 라벨이 있으면 그것, 없으면 넷에 이어진 핀의 신호 이름(전원·GND 먼저),
 * 그것도 없으면 N1, N2 … (전선 순서)
 */
export function netNames(project: Project): Map<string, string> {
  const { rootOf, nets } = netRoots(project.wires)
  const instances = byId(project.instances)
  const names = new Map<number, string>()
  let auto = 0
  for (const [n, ws] of nets) {
    const label = ws.find((w) => w.label?.trim())?.label?.trim()
    let name = label
    if (!name) {
      const signals: string[] = []
      for (const w of ws) {
        for (const e of [w.from, w.to]) {
          if (!('instanceId' in e)) continue
          const inst = instances.get(e.instanceId)
          const sig = inst && project.parts[inst.partId]?.pins.find((p) => p.id === e.pinId)?.signal?.trim()
          if (sig) signals.push(sig)
        }
      }
      name = signals.find((s) => POWER_BOTTOM.test(s) || POWER_TOP.test(s)) ?? signals.sort(naturalCompare)[0]
    }
    names.set(n, name ?? `N${++auto}`)
  }
  return new Map([...rootOf].map(([id, n]) => [id, names.get(n)!]))
}

// ---------------------------------------------------------------- 그리기용 장면

export interface SchSymbolItem {
  instanceId: string
  refDes: string
  part: PartDef
  symbol: PartSymbol
  placement: SchPlacement
  pivot: Point
  /** 회로도 좌표의 기호 핀 */
  pins: SymbolPin[]
  box: Box
  /** 몸통 상자 (회로도 좌표) */
  body: Box
}
export interface SchWireItem {
  wireId: string
  points: number[]
}
export interface SchLabelItem {
  /** 붙는 점 */
  x: number
  y: number
  /** 글이 뻗는 쪽 */
  side: SymbolSide
  text: string
  wireIds: string[]
}
export interface SchScene {
  symbols: SchSymbolItem[]
  wires: SchWireItem[]
  junctions: (Point & { id: string })[]
  /** 선 세 개 이상이 만나는 핀 끝 (점) */
  dots: Point[]
  labels: SchLabelItem[]
  bounds: Box | null
}

/** 회로도 전체 (화면·PNG·PDF가 같이 쓴다) */
export function buildSchematicScene(project: Project, layout: SchLayout = layoutSchematic(project)): SchScene {
  const pins = schematicPins(project, layout)
  const symbols: SchSymbolItem[] = []
  for (const inst of project.instances) {
    const part = project.parts[inst.partId]
    const pl = layout.symbols.get(inst.id)
    if (!part || !pl) continue
    const symbol = schematicSymbol(part)
    const { pivot, extent, body } = symbolFrame(symbol)
    symbols.push({
      body: placedBox(pl, body),
      instanceId: inst.id,
      refDes: inst.refDes,
      part,
      symbol,
      placement: pl,
      pivot,
      pins: symbol.pins.map((sp) => pins.get(pinKey(inst.id, sp.pinId))!),
      box: placedBox(pl, extent)
    })
  }
  const bodyOf = new Map(symbols.map((s) => [s.instanceId, s.body]))
  const labeledSet = new Set(project.schematic?.labeled ?? [])
  const names = labeledSet.size ? netNames(project) : new Map<string, string>()
  const wires: SchWireItem[] = []
  const labels = new Map<string, SchLabelItem>()
  const lineEnds = new Map<string, number>()
  for (const w of project.wires) {
    const a = schematicEnd(w.from, layout, pins)
    const b = schematicEnd(w.to, layout, pins)
    if (!a || !b) continue
    if (labeledSet.has(w.id)) {
      for (const e of [a, b]) {
        const k = `${e.x},${e.y}`
        const prev = labels.get(k)
        if (prev) prev.wireIds.push(w.id)
        else labels.set(k, { x: e.x, y: e.y, side: e.side ?? 'right', text: names.get(w.id) ?? '?', wireIds: [w.id] })
      }
      continue
    }
    // 양 끝 기호의 몸통만 피한다 (전체를 보면 부품 수의 제곱)
    const avoid = [w.from, w.to].flatMap((e) => {
      const s = 'instanceId' in e ? bodyOf.get(e.instanceId) : undefined
      return s ? [s] : []
    })
    wires.push({ wireId: w.id, points: schematicWirePath(a, b, avoid) })
    for (const e of [w.from, w.to]) if ('instanceId' in e) lineEnds.set(endKey(e), (lineEnds.get(endKey(e)) ?? 0) + 1)
  }
  const dots: Point[] = []
  for (const [k, n] of lineEnds) {
    if (n < 2) continue
    const p = pins.get(k.slice(2))
    if (p) dots.push({ x: p.x, y: p.y })
  }
  const junctions = (project.junctions ?? []).flatMap((j) => {
    const p = layout.junctions.get(j.id)
    return p ? [{ id: j.id, ...p }] : []
  })
  const bounds = unionBox([
    ...symbols.map((s) => s.box),
    ...junctions.map((j) => ({ x: j.x, y: j.y, width: 0, height: 0 })),
    ...[...labels.values()].map((l) => ({ x: l.x - 80, y: l.y - 10, width: 160, height: 20 }))
  ])
  return { symbols, wires, junctions, dots, labels: [...labels.values()], bounds: bounds ?? null }
}

// ---------------------------------------------------------------- 동작 (모두 새 Project를 돌려준다)

/** 자동 배치된 자리까지 모두 저장한다 (처음 옮길 때 다른 기호가 따라 움직이지 않게) */
function fixed(project: Project): Schematic {
  const layout = layoutSchematic(project)
  return {
    ...project.schematic,
    symbols: Object.fromEntries(layout.symbols),
    ...(layout.junctions.size ? { junctions: Object.fromEntries(layout.junctions) } : {})
  }
}

/** 기호·접속점을 (dx, dy)만큼 옮긴다. 격자 단위로 맞춘다 */
export function moveSchematicItems(project: Project, items: { instances?: readonly string[]; junctions?: readonly string[] }, dx: number, dy: number): Project {
  const gx = snapGrid(dx)
  const gy = snapGrid(dy)
  if ((gx === 0 && gy === 0) || (!items.instances?.length && !items.junctions?.length)) return project
  const s = fixed(project)
  const symbols = { ...s.symbols }
  for (const id of items.instances ?? []) {
    const pl = symbols[id]
    if (pl) symbols[id] = { ...pl, x: pl.x + gx, y: pl.y + gy }
  }
  const junctions = { ...s.junctions }
  for (const id of items.junctions ?? []) {
    const p = junctions[id]
    if (p) junctions[id] = { x: p.x + gx, y: p.y + gy }
  }
  return { ...project, schematic: { ...s, symbols, ...(Object.keys(junctions).length ? { junctions } : {}) } }
}

/** 접속점 하나를 그 자리로 (격자에 맞춤) */
export function placeSchematicJunction(project: Project, id: string, p: Point): Project {
  const s = fixed(project)
  if (!s.junctions?.[id]) return project
  return { ...project, schematic: { ...s, junctions: { ...s.junctions, [id]: { x: snapGrid(p.x), y: snapGrid(p.y) } } } }
}

const turn = (r: SchRotation | undefined, delta: number) => ((((((r ?? 0) + delta) % 360) + 360) % 360) as SchRotation)

function updateSymbols(project: Project, ids: readonly string[], fn: (pl: SchPlacement) => SchPlacement): Project {
  if (ids.length === 0) return project
  const s = fixed(project)
  const symbols = { ...s.symbols }
  for (const id of ids) {
    const pl = symbols[id]
    if (!pl) continue
    const next = fn(pl)
    symbols[id] = { x: next.x, y: next.y, ...(next.rotation ? { rotation: next.rotation } : {}), ...(next.mirror ? { mirror: true } : {}) }
  }
  return { ...project, schematic: { ...s, symbols } }
}

/** 기호를 제자리(몸통 가운데)에서 90° 단위로 돌린다 (+ = 시계 방향) */
export function rotateSymbols(project: Project, ids: readonly string[], delta: 90 | -90): Project {
  return updateSymbols(project, ids, (pl) => ({ ...pl, rotation: turn(pl.rotation, delta) }))
}

/** 화면 기준 반전: 좌우 = 반전 토글·회전 반대로, 상하 = 좌우 반전 + 180° */
export function mirrorSymbols(project: Project, ids: readonly string[], axis: 'horizontal' | 'vertical'): Project {
  return updateSymbols(project, ids, (pl) => ({
    ...pl,
    mirror: !pl.mirror,
    rotation: turn(0, (axis === 'horizontal' ? 0 : 180) - (pl.rotation ?? 0))
  }))
}

/** 전선이 속한 넷 전체를 라벨로(또는 선으로) 보인다 */
export function setNetLabels(project: Project, wireIds: readonly string[], on: boolean): Project {
  const ids = netWires(project, wireIds)
  if (ids.length === 0) return project
  const cur = new Set(project.schematic?.labeled ?? [])
  for (const id of ids) {
    if (on) cur.add(id)
    else cur.delete(id)
  }
  const { labeled: _old, ...rest } = project.schematic ?? {}
  const labeled = project.wires.map((w) => w.id).filter((id) => cur.has(id))
  return { ...project, schematic: { ...rest, ...(labeled.length ? { labeled } : {}) } }
}

/** 지워진 부품·접속점·전선의 회로도 항목을 뺀다 */
export function pruneSchematic(project: Project): Project {
  const s = project.schematic
  if (!s) return project
  const inst = byId(project.instances)
  const junctionIds = new Set((project.junctions ?? []).map((j) => j.id))
  const wires = byId(project.wires)
  const symbols = s.symbols && Object.fromEntries(Object.entries(s.symbols).filter(([id]) => inst.has(id)))
  const junctions = s.junctions && Object.fromEntries(Object.entries(s.junctions).filter(([id]) => junctionIds.has(id)))
  const labeled = s.labeled?.filter((id) => wires.has(id))
  const same =
    Object.keys(symbols ?? {}).length === Object.keys(s.symbols ?? {}).length &&
    Object.keys(junctions ?? {}).length === Object.keys(s.junctions ?? {}).length &&
    (labeled?.length ?? 0) === (s.labeled?.length ?? 0)
  if (same) return project
  const next: Schematic = {
    ...(symbols && Object.keys(symbols).length ? { symbols } : {}),
    ...(junctions && Object.keys(junctions).length ? { junctions } : {}),
    ...(labeled?.length ? { labeled } : {})
  }
  const { schematic: _s, ...rest } = project
  return Object.keys(next).length ? { ...rest, schematic: next } : rest
}

export { SYMBOL_GRID as SCH_GRID, SYMBOL_PIN_LENGTH }
