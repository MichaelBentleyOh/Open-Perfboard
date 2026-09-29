// 부품 그림 원본 (037b): 도형 추가·고치기·순서·정렬, 그림판 크기와 핀 좌표.
// 함수는 입력을 바꾸지 않고 새 값을 돌려준다. 좌표는 그림판 픽셀 (왼쪽 위 0,0)
import type { Drawing, Pin, Shape } from './model'
import { rotate, type Point } from './geometry'

export const DRAWING_MIN = 16
export const DRAWING_MAX = 4000
export const DRAWING_DEFAULT = { width: 400, height: 300 }
/** 한 그림의 도형 수 상한 (파일 검사용) */
export const SHAPES_MAX = 5000

export const emptyDrawing = (width = DRAWING_DEFAULT.width, height = DRAWING_DEFAULT.height): Drawing => ({ width, height, shapes: [] })

export const clampSize = (n: number) => Math.round(Math.min(DRAWING_MAX, Math.max(DRAWING_MIN, n)))

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** 회전 전 도형 자기 좌표의 상자 (x, y 기준 상대) */
function localBox(s: Shape): Box {
  switch (s.type) {
    case 'line': {
      const xs = s.points.filter((_, i) => i % 2 === 0)
      const ys = s.points.filter((_, i) => i % 2 === 1)
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
    }
    case 'text':
      // 높이는 글 줄 수에 따라 다르다 → 줄 수 × 1.2 × 글자 크기로 어림
      return { x: 0, y: 0, width: s.w, height: Math.max(1, s.text.split('\n').length) * s.fontSize * 1.2 }
    default:
      return { x: 0, y: 0, width: s.w, height: s.h }
  }
}

/** 도형이 차지하는 그림판 상자 (회전 포함) */
export function shapeBounds(s: Shape): Box {
  const b = localBox(s)
  const corners: Point[] = [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x, y: b.y + b.height },
    { x: b.x + b.width, y: b.y + b.height }
  ].map((p) => {
    const r = s.rotation ? rotate(p, s.rotation) : p
    return { x: r.x + s.x, y: r.y + s.y }
  })
  const x = Math.min(...corners.map((p) => p.x))
  const y = Math.min(...corners.map((p) => p.y))
  return { x, y, width: Math.max(...corners.map((p) => p.x)) - x, height: Math.max(...corners.map((p) => p.y)) - y }
}

export function unionBox(boxes: readonly Box[]): Box | undefined {
  if (boxes.length === 0) return undefined
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }
}

export function addShape(d: Drawing, shape: Shape): Drawing {
  return { ...d, shapes: [...d.shapes, shape] }
}

export function updateShape(d: Drawing, id: string, patch: Partial<Shape>): Drawing {
  return { ...d, shapes: d.shapes.map((s) => (s.id === id ? ({ ...s, ...patch } as Shape) : s)) }
}

/** 여러 도형에 같은 값 (색·굵기 등). 그 종류에 없는 속성이라도 넣지 않도록 keys로 거른다 */
export function updateShapes(d: Drawing, ids: readonly string[], patch: Partial<Record<string, unknown>>): Drawing {
  const set = new Set(ids)
  return {
    ...d,
    shapes: d.shapes.map((s) => {
      if (!set.has(s.id)) return s
      const next: Record<string, unknown> = { ...s }
      for (const [k, v] of Object.entries(patch)) {
        if (!applies(s, k)) continue
        if (v === undefined) delete next[k]
        else next[k] = v
      }
      return next as unknown as Shape
    })
  }
}

const KEYS: Record<Shape['type'], readonly string[]> = {
  rect: ['fill', 'stroke', 'strokeWidth', 'radius'],
  ellipse: ['fill', 'stroke', 'strokeWidth'],
  line: ['stroke', 'strokeWidth', 'arrowStart', 'arrowEnd', 'dashed'],
  text: ['color', 'fontSize', 'bold', 'align', 'text'],
  image: []
}
const COMMON = ['opacity', 'rotation', 'locked', 'x', 'y']
const applies = (s: Shape, key: string) => COMMON.includes(key) || KEYS[s.type].includes(key)

export function removeShapes(d: Drawing, ids: readonly string[]): Drawing {
  const set = new Set(ids)
  return { ...d, shapes: d.shapes.filter((s) => !set.has(s.id)) }
}

export function moveShapes(d: Drawing, ids: readonly string[], dx: number, dy: number): Drawing {
  const set = new Set(ids)
  return { ...d, shapes: d.shapes.map((s) => (set.has(s.id) && !s.locked ? { ...s, x: s.x + dx, y: s.y + dy } : s)) }
}

/** 복제: 새 id(makeId), offset만큼 옮겨 맨 앞에. 새 id 목록도 돌려준다 */
export function duplicateShapes(d: Drawing, ids: readonly string[], makeId: () => string, offset = 10): { drawing: Drawing; ids: string[] } {
  const set = new Set(ids)
  const copies = d.shapes
    .filter((s) => set.has(s.id))
    .map((s) => {
      // 잠긴 배경을 복제해도 사본은 옮길 수 있게
      const c: Shape = { ...structuredClone(s), id: makeId(), x: s.x + offset, y: s.y + offset }
      delete c.locked
      return c
    })
  return { drawing: { ...d, shapes: [...d.shapes, ...copies] }, ids: copies.map((c) => c.id) }
}

/** 붙여넣기: 다른 그림에서 복사한 도형을 새 id로 */
export function pasteShapes(d: Drawing, shapes: readonly Shape[], makeId: () => string, offset = 10): { drawing: Drawing; ids: string[] } {
  const copies = shapes.map((s) => ({ ...structuredClone(s), id: makeId(), x: s.x + offset, y: s.y + offset }))
  return { drawing: { ...d, shapes: [...d.shapes, ...copies] }, ids: copies.map((c) => c.id) }
}

export type Order = 'front' | 'back' | 'forward' | 'backward'

/** 앞뒤 순서. 고른 것끼리의 순서는 유지한다 */
export function reorder(d: Drawing, ids: readonly string[], order: Order): Drawing {
  const set = new Set(ids)
  const picked = d.shapes.filter((s) => set.has(s.id))
  const rest = d.shapes.filter((s) => !set.has(s.id))
  if (picked.length === 0) return d
  if (order === 'front') return { ...d, shapes: [...rest, ...picked] }
  if (order === 'back') return { ...d, shapes: [...picked, ...rest] }
  // 한 칸씩: 고른 것 하나하나를 이웃한 안 고른 것과 바꾼다
  const shapes = [...d.shapes]
  if (order === 'forward') {
    for (let i = shapes.length - 2; i >= 0; i--) {
      if (set.has(shapes[i]!.id) && !set.has(shapes[i + 1]!.id)) [shapes[i], shapes[i + 1]] = [shapes[i + 1]!, shapes[i]!]
    }
  } else {
    for (let i = 1; i < shapes.length; i++) {
      if (set.has(shapes[i]!.id) && !set.has(shapes[i - 1]!.id)) [shapes[i], shapes[i - 1]] = [shapes[i - 1]!, shapes[i]!]
    }
  }
  return { ...d, shapes }
}

export type Align = 'left' | 'centerX' | 'right' | 'top' | 'middle' | 'bottom'

/** 정렬: 둘 이상이면 고른 것들의 전체 상자에, 하나면 그림판에 맞춘다 */
export function alignShapes(d: Drawing, ids: readonly string[], align: Align): Drawing {
  const set = new Set(ids)
  const picked = d.shapes.filter((s) => set.has(s.id) && !s.locked)
  if (picked.length === 0) return d
  const ref = picked.length > 1 ? unionBox(picked.map(shapeBounds))! : { x: 0, y: 0, width: d.width, height: d.height }
  const move = new Map<string, Point>()
  for (const s of picked) {
    const b = shapeBounds(s)
    const dx =
      align === 'left' ? ref.x - b.x : align === 'right' ? ref.x + ref.width - (b.x + b.width) : align === 'centerX' ? ref.x + ref.width / 2 - (b.x + b.width / 2) : 0
    const dy =
      align === 'top' ? ref.y - b.y : align === 'bottom' ? ref.y + ref.height - (b.y + b.height) : align === 'middle' ? ref.y + ref.height / 2 - (b.y + b.height / 2) : 0
    move.set(s.id, { x: dx, y: dy })
  }
  return { ...d, shapes: d.shapes.map((s) => (move.has(s.id) ? { ...s, x: s.x + move.get(s.id)!.x, y: s.y + move.get(s.id)!.y } : s)) }
}

/** 상자 안에 들어오는 도형 (끌어 고르기). 잠긴 것은 빼고 */
export function shapesInBox(d: Drawing, box: Box): string[] {
  return d.shapes
    .filter((s) => {
      if (s.locked) return false
      const b = shapeBounds(s)
      return b.x >= box.x && b.y >= box.y && b.x + b.width <= box.x + box.width && b.y + b.height <= box.y + box.height
    })
    .map((s) => s.id)
}

// ---- 그림판 크기와 핀

/**
 * 그림판 크기를 바꾼다. anchor만큼 내용을 옮긴다(왼쪽 위 기준이면 0,0).
 * 핀은 그림 위 실제 자리가 그대로 있도록 0~1 좌표를 다시 계산하고, 그림판 밖으로 나간 핀은 가장자리에 붙인다 (clamped 개수를 알려 줌).
 */
export function resizeDrawing<P extends Pick<Pin, 'x' | 'y'>>(
  d: Drawing,
  pins: readonly P[],
  width: number,
  height: number,
  shift: Point = { x: 0, y: 0 }
): { drawing: Drawing; pins: P[]; clamped: number } {
  const w = clampSize(width)
  const h = clampSize(height)
  let clamped = 0
  const clamp01 = (v: number) => {
    if (v < 0 || v > 1) clamped++
    return Math.min(1, Math.max(0, v))
  }
  const nextPins = pins.map((p) => {
    const x = clamp01((p.x * d.width + shift.x) / w)
    const y = clamp01((p.y * d.height + shift.y) / h)
    return { ...p, x, y }
  })
  const shapes = shift.x || shift.y ? d.shapes.map((s) => ({ ...s, x: s.x + shift.x, y: s.y + shift.y })) : d.shapes
  return { drawing: { ...d, width: w, height: h, shapes }, pins: nextPins, clamped }
}

/** 그림판을 내용에 맞춘다 (둘레 margin). 내용이 없으면 그대로 */
export function fitDrawing<P extends Pick<Pin, 'x' | 'y'>>(d: Drawing, pins: readonly P[], margin = 8): { drawing: Drawing; pins: P[]; clamped: number } {
  const box = unionBox(d.shapes.map(shapeBounds))
  if (!box) return { drawing: d, pins: [...pins], clamped: 0 }
  return resizeDrawing(d, pins, Math.ceil(box.width + margin * 2), Math.ceil(box.height + margin * 2), {
    x: Math.round(margin - box.x),
    y: Math.round(margin - box.y)
  })
}

/** 사진 한 장을 그림판 가득 넣은 그림 (지금까지의 "사진만" 부품을 그림으로 열 때) */
export function drawingFromImage(src: string, width: number, height: number, id: string): Drawing {
  return { width, height, shapes: [{ id, type: 'image', x: 0, y: 0, w: width, h: height, src }] }
}
