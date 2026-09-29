// 도형 → Konva 설정. 작업실 캔버스(react-konva)와 PNG 굽기(bake.ts)가 같은 값을 써서 보이는 그대로 구워진다.
import Konva from 'konva'
import type { Drawing, Shape } from '@core/model'
import { loadHtmlImage } from '@/features/part-editor/image'

export const FONT_FAMILY = "'Segoe UI', 'Malgun Gothic', 'Noto Sans KR', 'Noto Sans CJK KR', sans-serif"
export const LINE_HEIGHT = 1.2

/** 모든 도형에 공통인 Konva 설정 */
const common = (s: Shape) => ({ x: s.x, y: s.y, rotation: s.rotation ?? 0, opacity: s.opacity ?? 1 })

export const rectConfig = (s: Extract<Shape, { type: 'rect' }>): Konva.RectConfig => ({
  ...common(s),
  width: s.w,
  height: s.h,
  cornerRadius: s.radius ?? 0,
  fill: s.fill,
  stroke: s.stroke,
  strokeWidth: s.stroke ? (s.strokeWidth ?? 1) : 0
})

/** 타원은 Konva에서 중심 기준 → 도형의 x, y(왼쪽 위)를 offset으로 맞춘다 */
export const ellipseConfig = (s: Extract<Shape, { type: 'ellipse' }>): Konva.EllipseConfig => ({
  ...common(s),
  radiusX: s.w / 2,
  radiusY: s.h / 2,
  offsetX: -s.w / 2,
  offsetY: -s.h / 2,
  fill: s.fill,
  stroke: s.stroke,
  strokeWidth: s.stroke ? (s.strokeWidth ?? 1) : 0
})

export const lineConfig = (s: Extract<Shape, { type: 'line' }>): Konva.ArrowConfig => ({
  ...common(s),
  points: s.points,
  stroke: s.stroke,
  // 열린 선의 fill은 화살표 머리 색, 닫힌 선(다각형)은 채우기
  fill: s.closed ? s.fill : s.stroke,
  closed: !!s.closed,
  strokeWidth: s.strokeWidth,
  lineCap: 'round',
  lineJoin: 'round',
  dash: s.dashed ? [s.strokeWidth * 3, s.strokeWidth * 2] : undefined,
  pointerAtBeginning: !s.closed && !!s.arrowStart,
  pointerAtEnding: !s.closed && !!s.arrowEnd,
  pointerLength: Math.max(4, s.strokeWidth * 3),
  pointerWidth: Math.max(4, s.strokeWidth * 3),
  hitStrokeWidth: Math.max(12, s.strokeWidth + 8)
})

export const textConfig = (s: Extract<Shape, { type: 'text' }>): Konva.TextConfig => ({
  ...common(s),
  width: s.w,
  text: s.text,
  fontSize: s.fontSize,
  fontFamily: FONT_FAMILY,
  fontStyle: s.bold ? 'bold' : 'normal',
  fill: s.color,
  align: s.align ?? 'left',
  lineHeight: LINE_HEIGHT,
  wrap: 'word'
})

export const imageConfig = (s: Extract<Shape, { type: 'image' }>, image: HTMLImageElement | undefined): Konva.ImageConfig => ({
  ...common(s),
  width: s.w,
  height: s.h,
  image
})

/** 그림에 쓰인 사진을 모두 읽는다 (src → 그림) */
export async function loadDrawingImages(d: Drawing): Promise<Map<string, HTMLImageElement>> {
  const srcs = [...new Set(d.shapes.flatMap((s) => (s.type === 'image' ? [s.src] : [])))]
  const pairs = await Promise.all(srcs.map(async (src) => [src, await loadHtmlImage(src)] as const))
  return new Map(pairs)
}

/** Konva 노드 하나 (굽기용) */
export function shapeNode(s: Shape, images: Map<string, HTMLImageElement>): Konva.Shape {
  switch (s.type) {
    case 'rect':
      return new Konva.Rect(rectConfig(s))
    case 'ellipse':
      return new Konva.Ellipse(ellipseConfig(s))
    case 'line':
      return new Konva.Arrow(lineConfig(s))
    case 'text':
      return new Konva.Text(textConfig(s))
    case 'image':
      return new Konva.Image(imageConfig(s, images.get(s.src)))
  }
}
