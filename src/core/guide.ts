// 부품 편집기 보조선 (026): 사진 위에 그은 선분에 핀을 고르게 놓거나 붙인다. 좌표는 사진 기준 0~1 (핀과 같음)
// 보조선은 편집하는 동안만 쓰고 부품 파일에는 저장하지 않는다 (결과인 핀 좌표만 남는다)
import type { Pin } from './model'

export interface Point {
  x: number
  y: number
}

export interface Guide {
  id: string
  a: Point
  b: Point
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** a에서 b까지 n개를 같은 간격으로 (양 끝 포함). n = 1이면 가운데 */
export function evenPoints(a: Point, b: Point, n: number): Point[] {
  if (n <= 0) return []
  if (n === 1) return [lerp(a, b, 0.5)]
  return Array.from({ length: n }, (_, i) => lerp(a, b, i / (n - 1)))
}

/**
 * 선분 위에서 p에 가장 가까운 점. scale로 x·y를 실제 크기(화면 px)로 늘려 거리를 잰다 (사진이 가로로 길면 0~1 거리가 왜곡되므로)
 * t = 0(a) ~ 1(b)
 */
export function projectOnGuide(p: Point, g: Guide, scale: Point = { x: 1, y: 1 }): { point: Point; t: number; distance: number } {
  const dx = (g.b.x - g.a.x) * scale.x
  const dy = (g.b.y - g.a.y) * scale.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : clamp01((((p.x - g.a.x) * scale.x) * dx + ((p.y - g.a.y) * scale.y) * dy) / len2)
  const point = lerp(g.a, g.b, t)
  const distance = Math.hypot((p.x - point.x) * scale.x, (p.y - point.y) * scale.y)
  return { point, t, distance }
}

/** 여러 보조선 중 tolerance(scale 기준 거리) 안에서 가장 가까운 선 위의 점. 없으면 undefined */
export function snapToGuides(p: Point, guides: readonly Guide[], tolerance: number, scale: Point = { x: 1, y: 1 }): Point | undefined {
  let best: { point: Point; distance: number } | undefined
  for (const g of guides) {
    const r = projectOnGuide(p, g, scale)
    if (r.distance <= tolerance && (!best || r.distance < best.distance)) best = r
  }
  return best?.point
}

/** 보조선 위(tolerance 안)에 있는 핀들, a → b 순서 */
export function pinsOnGuide(pins: readonly Pin[], g: Guide, tolerance: number, scale: Point = { x: 1, y: 1 }): Pin[] {
  return pins
    .map((pin) => ({ pin, r: projectOnGuide(pin, g, scale) }))
    .filter((x) => x.r.distance <= tolerance)
    .sort((x, y) => x.r.t - y.r.t)
    .map((x) => x.pin)
}

/**
 * 보조선 위 핀들을 첫 핀과 마지막 핀 사이에 같은 간격으로 다시 놓는다 (순서 유지, 양 끝 핀은 선 위로만 옮김).
 * 새 위치 목록 { id, x, y }
 */
export function respacePins(pins: readonly Pin[], g: Guide, tolerance: number, scale: Point = { x: 1, y: 1 }): { id: string; x: number; y: number }[] {
  const on = pinsOnGuide(pins, g, tolerance, scale)
  if (on.length < 2) return on.map((p) => ({ id: p.id, ...projectOnGuide(p, g, scale).point }))
  const t0 = projectOnGuide(on[0], g, scale).t
  const t1 = projectOnGuide(on[on.length - 1], g, scale).t
  return on.map((p, i) => ({ id: p.id, ...lerp(g.a, g.b, t0 + ((t1 - t0) * i) / (on.length - 1)) }))
}

/** 수평·수직에서 maxDegrees 안이면 그쪽으로 맞춘 끝점 (scale로 실제 각도를 잰다) */
export function straighten(a: Point, b: Point, maxDegrees: number, scale: Point = { x: 1, y: 1 }): Point {
  const dx = (b.x - a.x) * scale.x
  const dy = (b.y - a.y) * scale.y
  const deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI)
  const fromHorizontal = Math.min(deg, 180 - deg)
  if (fromHorizontal <= maxDegrees) return { x: b.x, y: a.y }
  if (Math.abs(90 - deg) <= maxDegrees) return { x: a.x, y: b.y }
  return b
}
