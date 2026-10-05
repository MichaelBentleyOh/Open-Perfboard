// 회로도 기호 (038): 기본 기호 만들기, 기호 핀 놓기·검사.
// 좌표 1 = 5 mil (0.127 mm). 핀 끝점은 SYMBOL_GRID(= 50 mil, KiCad 기본 격자) 배수 → 040에서 그대로 옮긴다
import type { Connector, Drawing, PartDef, PartSymbol, Pin, PinElectrical, Shape, SymbolPin, SymbolSide } from './model'
import { shapeBounds, unionBox, type Box } from './drawing'
import { naturalCompare } from './sort'
import { msg } from './i18n'

/** 전기 종류 이름 (표시할 때 번역) */
export const PIN_ELECTRICAL_LABEL: Record<PinElectrical, string> = {
  passive: msg('수동 (기본)'),
  input: msg('입력'),
  output: msg('출력'),
  bidirectional: msg('양방향'),
  power_in: msg('전원 입력'),
  power_out: msg('전원 출력'),
  ground: msg('GND (접지)'),
  open_collector: msg('오픈 컬렉터'),
  no_connect: msg('연결 안 함')
}

export const SYMBOL_GRID = 10
/** 기본 핀 길이 (100 mil) */
export const SYMBOL_PIN_LENGTH = 20
/** 핀 사이 간격 (100 mil) */
export const SYMBOL_PIN_PITCH = 20
/** 핀 번호·이름 글자 크기 (50 mil) */
export const SYMBOL_TEXT = 10
const MARGIN = 20

export type HasPins = Pick<PartDef, 'pins' | 'connectors'>

export const snapGrid = (v: number) => Math.round(v / SYMBOL_GRID) * SYMBOL_GRID
const roundUp = (v: number, step = SYMBOL_GRID) => Math.ceil(v / step) * step

/** 핀 번호 표시: 커넥터가 있으면 J1.3 (한 부품 안에서 겹치지 않게, KiCad 핀 번호도 이것) */
export function pinLabel(connectors: readonly Connector[], pin: Pin): string {
  const c = pin.connectorId ? connectors.find((x) => x.id === pin.connectorId) : undefined
  return c ? `${c.name}.${pin.number}` : pin.number
}

/** 글자 폭 어림 (좌표 단위): 한글·한자는 글자 크기만큼, 나머지는 0.6배 */
export function textWidth(s: string, size = SYMBOL_TEXT): number {
  let w = 0
  for (const ch of s) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? size : size * 0.6
  return w
}

export const POWER_TOP = /^(\+?\d+(\.\d+)?V\d*|\d+V\d+|V(CC|DD|IN|BAT|BUS|M|S|\+)\d*|3V3|VREF|PWR)$/i
export const POWER_BOTTOM = /^(GND|[ADP]GND|VSS|V-|0V|COM)$/i

/** 핀이 기호 어디에 붙는지 (기본 기호) */
function autoSide(pin: Pin): 'top' | 'bottom' | undefined {
  const name = (pin.signal ?? '').trim()
  if (POWER_BOTTOM.test(name)) return 'bottom'
  if (POWER_TOP.test(name)) return 'top'
  return undefined
}

/** 끝점 → 몸통 쪽 끝 (핀 선) */
export function pinLine(sp: SymbolPin): { x1: number; y1: number; x2: number; y2: number } {
  const l = sp.length ?? SYMBOL_PIN_LENGTH
  const dx = sp.side === 'left' ? l : sp.side === 'right' ? -l : 0
  const dy = sp.side === 'top' ? l : sp.side === 'bottom' ? -l : 0
  return { x1: sp.x, y1: sp.y, x2: sp.x + dx, y2: sp.y + dy }
}

/** 기호에 놓는 핀 순서: 커넥터 순 → 번호 순 */
export function symbolPinOrder(part: HasPins): Pin[] {
  const connOrder = new Map(part.connectors.map((c, i) => [c.id, i]))
  return [...part.pins].sort(
    (a, b) => (connOrder.get(a.connectorId ?? '') ?? 1e9) - (connOrder.get(b.connectorId ?? '') ?? 1e9) || naturalCompare(a.number, b.number)
  )
}

export interface PinTextBox {
  x: number
  y: number
  width: number
  rotation: 0 | -90
  align: 'left' | 'center' | 'right'
  offsetY: number
}

/** 핀 번호(선 옆: 가로 핀은 위, 세로 핀은 왼쪽)와 이름(몸통 안쪽)의 글자 자리. 그림판·회로도가 함께 쓴다 */
export function pinTextLayout(pin: SymbolPin): { number: PinTextBox; name: PinTextBox } {
  const { x1, y1, x2, y2 } = pinLine(pin)
  const vertical = pin.side === 'top' || pin.side === 'bottom'
  const len = Math.abs(x2 - x1) + Math.abs(y2 - y1)
  const T = SYMBOL_TEXT
  const number: PinTextBox = vertical
    ? { x: x1 - 2, y: Math.max(y1, y2), width: len, rotation: -90, align: 'center', offsetY: T + 1 }
    : { x: Math.min(x1, x2), y: y1 - T - 2, width: len, rotation: 0, align: 'center', offsetY: 0 }
  const nameW = 200
  const name: PinTextBox =
    pin.side === 'left'
      ? { x: x2 + 4, y: y2 - T / 2, width: nameW, align: 'left', rotation: 0, offsetY: 0 }
      : pin.side === 'right'
        ? { x: x2 - 4 - nameW, y: y2 - T / 2, width: nameW, align: 'right', rotation: 0, offsetY: 0 }
        : pin.side === 'top'
          ? // -90° 돌린 글은 아래에서 위로 읽힌다 → 오른쪽 정렬이면 글 끝이 몸통 위 가장자리에 붙는다
            { x: x2 - T / 2, y: y2 + 4 + nameW, width: nameW, align: 'right', rotation: -90, offsetY: 0 }
          : { x: x2 - T / 2, y: y2 - 4, width: nameW, align: 'left', rotation: -90, offsetY: 0 }
  return { number, name }
}

/**
 * 기본 기호: 사각형 몸통 + 가운데 부품 이름, 핀은 커넥터 순 → 번호 순.
 * 전원(VCC·5V…)은 위, GND는 아래, 나머지는 절반씩 왼쪽·오른쪽. 크기는 신호 이름 길이에 맞춘다
 */
export function autoSymbol(part: HasPins & { name: string }, makeId: () => string): PartSymbol {
  const sorted = symbolPinOrder(part)
  const top = sorted.filter((p) => autoSide(p) === 'top')
  const bottom = sorted.filter((p) => autoSide(p) === 'bottom')
  const rest = sorted.filter((p) => !autoSide(p))
  const left = rest.slice(0, Math.ceil(rest.length / 2))
  const right = rest.slice(left.length)

  const nameW = (list: readonly Pin[]) => Math.max(0, ...list.map((p) => textWidth(p.signal ?? '')))
  const L = SYMBOL_PIN_LENGTH
  const P = SYMBOL_PIN_PITCH
  // 위·아래 핀 이름(세로 글)이 차지하는 몸통 안쪽 높이 → 양옆 핀은 그 아래부터
  const band = (list: readonly Pin[]) => (list.length ? roundUp(nameW(list) + 10, 2 * SYMBOL_GRID) : 0)
  const topBand = band(top)
  const bottomBand = band(bottom)
  const sideRows = Math.max(left.length, right.length)
  // 몸통 폭: 양옆 이름이 마주 보고 들어가고, 위·아래 핀이 들어갈 만큼
  const width = roundUp(Math.max(80, nameW(left) + nameW(right) + 30, (Math.max(top.length, bottom.length) + 1) * P), 2 * SYMBOL_GRID)
  const height = roundUp(Math.max(60, topBand + (sideRows + 1) * P + bottomBand), 2 * SYMBOL_GRID)
  // 몸통 왼쪽 위 (핀 길이 + 번호 자리만큼 안쪽, 격자 위)
  const bx = roundUp(MARGIN + L + textWidth('J9.99'))
  const by = roundUp(MARGIN + L + SYMBOL_TEXT * 2)
  /** 위·아래 핀은 몸통 가운데에 모은다 */
  const centered = (n: number, i: number) => bx + snapGrid((width - (n - 1) * P) / 2) + P * i

  const pins: SymbolPin[] = [
    ...left.map((p, i): SymbolPin => ({ pinId: p.id, side: 'left', x: bx - L, y: by + topBand + P * (i + 1) })),
    ...right.map((p, i): SymbolPin => ({ pinId: p.id, side: 'right', x: bx + width + L, y: by + topBand + P * (i + 1) })),
    ...top.map((p, i): SymbolPin => ({ pinId: p.id, side: 'top', x: centered(top.length, i), y: by - L })),
    ...bottom.map((p, i): SymbolPin => ({ pinId: p.id, side: 'bottom', x: centered(bottom.length, i), y: by + height + L }))
  ]
  // 부품 이름은 몸통 아래 바깥 (몸통 안 핀 이름과 겹치지 않게, KiCad의 값 자리).
  // 아래 핀이 있으면 회로도의 세로 넷 라벨(GND 등)이 들어갈 만큼 더 아래
  const nameY = by + height + (bottom.length ? L + 30 : 6)
  const shapes: Shape[] = [
    { id: makeId(), type: 'rect', x: bx, y: by, w: width, h: height, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 },
    { id: makeId(), type: 'text', x: bx - 40, y: nameY, w: width + 80, text: part.name || '?', fontSize: 12, color: '#000000', bold: true, align: 'center' }
  ]
  const drawing: Drawing = { width: bx + width + L + roundUp(textWidth('J9.99')) + MARGIN, height: nameY + 16 + MARGIN, shapes }
  return { drawing, pins }
}

/** 몸통 상자: 기호 그림의 도형들 (글상자는 빼고 — 부품 이름은 몸통 밖에 있다. 없으면 핀 끝점들) */
export function bodyBox(symbol: PartSymbol): Box {
  const body = symbol.drawing.shapes.filter((s) => s.type !== 'text')
  const b = unionBox((body.length ? body : symbol.drawing.shapes).map(shapeBounds))
  if (b) return b
  return unionBox(symbol.pins.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 }))) ?? { x: 0, y: 0, width: 0, height: 0 }
}

/** 끝점 자리에 맞는 쪽: 몸통 밖 어느 방향인지 (안쪽이면 가장 가까운 가장자리) */
export function sideFor(body: Box, at: { x: number; y: number }): SymbolSide {
  const d: [SymbolSide, number][] = [
    ['left', at.x - body.x],
    ['right', body.x + body.width - at.x],
    ['top', at.y - body.y],
    ['bottom', body.y + body.height - at.y]
  ]
  d.sort((a, b) => a[1] - b[1])
  return d[0]![0]
}

const key = (x: number, y: number) => `${x},${y}`

/**
 * 핀을 at 근처에 놓는다 (새로 놓기·옮기기 모두). 격자에 맞추고, 쪽은 몸통과의 위치로 정한다.
 * 다른 핀 끝점과 겹치면 그 쪽 가장자리를 따라 빈 칸으로 민다
 */
export function placePin(symbol: PartSymbol, pinId: string, at: { x: number; y: number }, side?: SymbolSide): PartSymbol {
  const body = bodyBox(symbol)
  const s = side ?? sideFor(body, at)
  const taken = new Set(symbol.pins.filter((p) => p.pinId !== pinId).map((p) => key(p.x, p.y)))
  const prev = symbol.pins.find((p) => p.pinId === pinId)
  let x = snapGrid(at.x)
  let y = snapGrid(at.y)
  const horizontal = s === 'top' || s === 'bottom'
  for (let i = 0; taken.has(key(x, y)) && i < 1000; i++) {
    // 가운데서부터 양쪽으로 번갈아
    const step = SYMBOL_GRID * Math.ceil((i + 1) / 2) * (i % 2 ? -1 : 1)
    if (horizontal) x = snapGrid(at.x) + step
    else y = snapGrid(at.y) + step
  }
  const pin: SymbolPin = { ...(prev?.length !== undefined ? { length: prev.length } : {}), pinId, x, y, side: s }
  return { ...symbol, pins: prev ? symbol.pins.map((p) => (p.pinId === pinId ? pin : p)) : [...symbol.pins, pin] }
}

/** 놓지 않은 핀을 놓을 빈 자리: 핀이 적은 쪽(왼쪽·오른쪽) 몸통 옆, 아래로 이어서 */
export function freeSpot(symbol: PartSymbol): { x: number; y: number; side: SymbolSide } {
  const body = bodyBox(symbol)
  const count = (s: SymbolSide) => symbol.pins.filter((p) => p.side === s).length
  const side: SymbolSide = count('left') <= count('right') ? 'left' : 'right'
  const L = SYMBOL_PIN_LENGTH
  const x = snapGrid(side === 'left' ? body.x - L : body.x + body.width + L)
  const taken = new Set(symbol.pins.map((p) => key(p.x, p.y)))
  let y = snapGrid(body.y + SYMBOL_PIN_PITCH)
  while (taken.has(key(x, y))) y += SYMBOL_PIN_PITCH
  return { x, y, side }
}

/** 기호에 아직 놓지 않은 부품 핀 */
export function missingPins(part: HasPins, symbol: PartSymbol): Pin[] {
  const placed = new Set(symbol.pins.map((p) => p.pinId))
  return part.pins.filter((p) => !placed.has(p.id))
}

/** 끝점이 겹치는 핀 id 묶음 (KiCad에서 서로 이어져 버린다) */
export function overlappingPins(symbol: PartSymbol): string[][] {
  const by = new Map<string, string[]>()
  for (const p of symbol.pins) by.set(key(p.x, p.y), [...(by.get(key(p.x, p.y)) ?? []), p.pinId])
  return [...by.values()].filter((ids) => ids.length > 1)
}

/**
 * 그림판을 내용(도형 + 핀 끝점 + 글자 자리)에 맞춘다. 핀이 격자에서 벗어나지 않게 격자 단위로만 옮긴다
 */
export function fitSymbol(symbol: PartSymbol): PartSymbol {
  const pad = SYMBOL_TEXT * 2
  const boxes = [
    ...symbol.drawing.shapes.map(shapeBounds),
    ...symbol.pins.map((p) => ({ x: p.x - pad, y: p.y - pad, width: pad * 2, height: pad * 2 }))
  ]
  const box = unionBox(boxes)
  if (!box) return symbol
  const dx = snapGrid(MARGIN - box.x)
  const dy = snapGrid(MARGIN - box.y)
  return {
    ...symbol,
    drawing: {
      ...symbol.drawing,
      width: Math.ceil(box.width + MARGIN * 2),
      height: Math.ceil(box.height + MARGIN * 2),
      shapes: symbol.drawing.shapes.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }))
    },
    pins: symbol.pins.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }))
  }
}

/** 부품 핀이 바뀐 뒤 기호를 맞춘다: 없어진 핀은 빼고 (새 핀은 missingPins로 보인다) */
export function syncSymbol(part: HasPins, symbol: PartSymbol): PartSymbol {
  const ids = new Set(part.pins.map((p) => p.id))
  return symbol.pins.every((p) => ids.has(p.pinId)) ? symbol : { ...symbol, pins: symbol.pins.filter((p) => ids.has(p.pinId)) }
}
