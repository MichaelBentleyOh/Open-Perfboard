// 회로도 장면 → 그리기 요소 (039). 화면(SchematicView)과 PNG·PDF(schematicRender)가 같은 요소를 그린다.
import Konva from 'konva'
import type { Shape } from '@core/model'
import type { SchLabelItem, SchScene, SchSymbolItem, SchWireItem } from '@core/schematic'
import { toWorld } from '@core/schematic'
import { pinLabel, pinLine, pinTextLayout, SYMBOL_TEXT } from '@core/symbol'
import { ellipseConfig, FONT_FAMILY, LINE_HEIGHT, lineConfig, rectConfig, textConfig } from '@/features/studio/drawing/shapeNodes'

export type Prim =
  | { kind: 'group'; config: Konva.GroupConfig; children: Prim[] }
  | { kind: 'rect'; config: Konva.RectConfig }
  | { kind: 'ellipse'; config: Konva.EllipseConfig }
  /** 그림판 선 도형 (화살표 가능) */
  | { kind: 'line'; config: Konva.ArrowConfig }
  /** 회로도 선·핀 선 */
  | { kind: 'polyline'; config: Konva.LineConfig }
  | { kind: 'text'; config: Konva.TextConfig }
  | { kind: 'circle'; config: Konva.CircleConfig }

export const SCH_COLORS = {
  wire: '#2e7d32',
  pinNumber: '#8d2b1b',
  ref: '#00695c',
  label: '#4527a0',
  selected: '#1e88e5',
  background: '#ffffff'
}
export const WIRE_WIDTH = 1.6
export const JUNCTION_R = 3

const textHeight = (s: Extract<Shape, { type: 'text' }>) => Math.max(1, s.text.split('\n').length) * s.fontSize * LINE_HEIGHT

/** 기호 하나: 몸통 도형(돌리고 뒤집은 묶음), 글상자는 똑바로, 핀 선·번호·이름, 참조명 */
export function symbolPrims(item: SchSymbolItem): Prim[] {
  const { placement: pl, pivot, symbol, part } = item
  const body: Prim[] = []
  const texts: Prim[] = []
  for (const s of symbol.drawing.shapes) {
    switch (s.type) {
      case 'rect':
        body.push({ kind: 'rect', config: { ...rectConfig(s), listening: false } })
        break
      case 'ellipse':
        body.push({ kind: 'ellipse', config: { ...ellipseConfig(s), listening: false } })
        break
      case 'line':
        body.push({ kind: 'line', config: { ...lineConfig(s), listening: false } })
        break
      case 'text': {
        // 글은 기호를 돌려도 읽히게 가운데 자리만 옮긴다
        const h = textHeight(s)
        const c = toWorld(pl, pivot, { x: s.x + s.w / 2, y: s.y + h / 2 })
        texts.push({ kind: 'text', config: { ...textConfig({ ...s, x: c.x - s.w / 2, y: c.y - h / 2 }), listening: false } })
        break
      }
      default:
        break // 사진 도형은 회로도에 그리지 않는다
    }
  }
  const out: Prim[] = [
    {
      kind: 'group',
      config: { x: pl.x, y: pl.y, offsetX: pivot.x, offsetY: pivot.y, rotation: pl.rotation ?? 0, scaleX: pl.mirror ? -1 : 1, listening: false },
      children: body
    },
    ...texts
  ]
  const pinsById = new Map(part.pins.map((p) => [p.id, p]))
  for (const sp of item.pins) {
    const l = pinLine(sp)
    out.push({ kind: 'polyline', config: { points: [l.x1, l.y1, l.x2, l.y2], stroke: '#000000', strokeWidth: 1.5, lineCap: 'round', listening: false } })
    const pin = pinsById.get(sp.pinId)
    if (!pin) continue
    const { number, name } = pinTextLayout(sp)
    if (symbol.showNumbers !== false) {
      out.push({ kind: 'text', config: { ...number, text: pinLabel(part.connectors, pin), fontSize: SYMBOL_TEXT * 0.9, fill: SCH_COLORS.pinNumber, fontFamily: FONT_FAMILY, listening: false } })
    }
    if (symbol.showNames !== false && pin.signal) {
      out.push({ kind: 'text', config: { ...name, text: pin.signal, fontSize: SYMBOL_TEXT, fill: '#000000', fontFamily: FONT_FAMILY, listening: false } })
    }
  }
  out.push({
    kind: 'text',
    config: { x: item.box.x, y: item.box.y - 14, text: item.refDes, fontSize: 11, fontStyle: 'bold', fill: SCH_COLORS.ref, fontFamily: FONT_FAMILY, listening: false }
  })
  return out
}

export const wirePrim = (w: SchWireItem, selected = false): Prim => ({
  kind: 'polyline',
  config: {
    points: w.points,
    stroke: selected ? SCH_COLORS.selected : SCH_COLORS.wire,
    strokeWidth: selected ? WIRE_WIDTH * 1.8 : WIRE_WIDTH,
    lineCap: 'round',
    lineJoin: 'round',
    listening: false
  }
})

/** 넷 이름 라벨: 붙는 점에서 바깥쪽으로 이름 (위·아래는 세로 글) */
export function labelPrims(l: SchLabelItem, selected = false): Prim[] {
  const size = 10
  const w = 200
  const fill = selected ? SCH_COLORS.selected : SCH_COLORS.label
  const common = { text: l.text, fontSize: size, fontStyle: 'bold', fill, fontFamily: FONT_FAMILY, width: w, listening: false }
  const text: Konva.TextConfig =
    l.side === 'left'
      ? { ...common, x: l.x - 4 - w, y: l.y - size / 2, align: 'right' }
      : l.side === 'right'
        ? { ...common, x: l.x + 4, y: l.y - size / 2, align: 'left' }
        : l.side === 'top'
          ? // 위·아래 핀은 세로 글 (가로 글은 20 간격 핀끼리 겹친다). 기본 기호는 부품 이름을 그만큼 아래에 둔다
            { ...common, x: l.x - size / 2, y: l.y - 4, rotation: -90, align: 'left' }
          : { ...common, x: l.x - size / 2, y: l.y + 4 + w, rotation: -90, align: 'right' }
  return [
    { kind: 'circle', config: { x: l.x, y: l.y, radius: 1.8, fill, listening: false } },
    { kind: 'text', config: text }
  ]
}

/** 장면 전체 (PNG·PDF용, 고르지 않은 상태) */
export function scenePrims(scene: SchScene): Prim[] {
  return [
    ...scene.wires.map((w) => wirePrim(w)),
    ...scene.symbols.flatMap((s) => symbolPrims(s)),
    ...scene.labels.flatMap((l) => labelPrims(l)),
    ...scene.junctions.map((j): Prim => ({ kind: 'circle', config: { x: j.x, y: j.y, radius: JUNCTION_R, fill: SCH_COLORS.wire } })),
    ...scene.dots.map((d): Prim => ({ kind: 'circle', config: { x: d.x, y: d.y, radius: JUNCTION_R * 0.8, fill: SCH_COLORS.wire } }))
  ]
}

/** 요소 → Konva 노드 (화면에 붙이지 않고 그릴 때) */
export function primNode(p: Prim): Konva.Node {
  switch (p.kind) {
    case 'group': {
      const g = new Konva.Group(p.config)
      for (const c of p.children) g.add(primNode(c) as Konva.Shape | Konva.Group)
      return g
    }
    case 'rect':
      return new Konva.Rect(p.config)
    case 'ellipse':
      return new Konva.Ellipse(p.config)
    case 'line':
      return new Konva.Arrow({ ...p.config, points: p.config.points ?? [] })
    case 'polyline':
      return new Konva.Line(p.config)
    case 'text':
      return new Konva.Text(p.config)
    case 'circle':
      return new Konva.Circle(p.config)
  }
}
