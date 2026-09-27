// 캔버스 좌표 계산. 부품 배치(PartInstance)의 x, y는 부품 사진의 "중심" 좌표다.
import type { PartDef, PartInstance, Pin } from './model'

/** scale 1일 때 부품 사진의 긴 변 길이 (월드 단위) */
export const PART_BASE_SIZE = 240

export interface Point {
  x: number
  y: number
}

/** 배치된 부품 사진의 표시 크기. 가로세로 비율은 사진을 따른다 */
export function partSize(part: PartDef, scale = 1): { width: number; height: number } {
  const { width, height } = part.image
  const k = (PART_BASE_SIZE * scale) / Math.max(width, height)
  return { width: width * k, height: height * k }
}

/** 점을 원점 기준으로 회전 (도 단위, 시계 방향 = 화면 좌표계에서 양수) */
export function rotate(p: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

/** 핀의 월드 좌표. at을 주면 부품 중심을 그 위치로 가정한다 (드래그 중 미리보기용) */
export function pinWorldPosition(instance: PartInstance, part: PartDef, pin: Pin, at?: Point): Point {
  const { width, height } = partSize(part, instance.scale)
  const lx = (pin.x - 0.5) * width
  const local = { x: instance.flipped ? -lx : lx, y: (pin.y - 0.5) * height }
  const r = rotate(local, instance.rotation)
  const c = at ?? instance
  return { x: c.x + r.x, y: c.y + r.y }
}

/** 각도를 0~359로 정규화 */
export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360
}

// ---------------------------------------------------------------- 사각형 (선택 영역)

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 두 점으로 만든 사각형 (어느 방향으로 드래그해도 너비·높이가 양수) */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

/** 회전을 반영한 부품 사진의 축 정렬 경계 상자 */
export function instanceBounds(instance: PartInstance, part: PartDef): Rect {
  const { width, height } = partSize(part, instance.scale)
  const corners = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 }
  ].map((c) => rotate(c, instance.rotation))
  const xs = corners.map((c) => c.x + instance.x)
  const ys = corners.map((c) => c.y + instance.y)
  return rectFromPoints({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) })
}
