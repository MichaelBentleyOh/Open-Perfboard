// 캔버스 배율 계산. 화면 좌표 = 월드 좌표 × scale + (x, y)
import type { Project } from './model'
import { instanceBounds, type Point, type Rect } from './geometry'
import { endPosition } from './ends'
import { wirePath } from './wire'

export interface View {
  x: number
  y: number
  scale: number
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

/** 단축키(Ctrl+= / Ctrl+-)로 오가는 배율 */
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4, 6, 8] as const

export const clampZoom = (scale: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))

/** "150", "150%", " 75 % " → 1.5, 0.75. 숫자가 아니면 NaN (범위는 clampZoom으로 따로 맞춘다) */
export function parseZoomInput(text: string): number {
  const t = text.trim().replace(/\s*%$/, '').replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN
  return Number(t) / 100
}

/** 지금 배율에서 한 단계 위(+1)/아래(-1). 단계 사이에 있으면 가장 가까운 다음 단계로 */
export function nextZoomStep(scale: number, dir: 1 | -1): number {
  const EPS = 1e-6
  if (dir > 0) return ZOOM_STEPS.find((s) => s > scale + EPS) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((s) => s < scale - EPS) ?? MIN_ZOOM
}

/** anchor(화면 좌표)가 가리키는 월드 점을 그대로 두고 배율만 바꾼다 */
export function zoomAround(view: View, scale: number, anchor: Point): View {
  const s = clampZoom(scale)
  const wx = (anchor.x - view.x) / view.scale
  const wy = (anchor.y - view.y) / view.scale
  return { scale: s, x: anchor.x - wx * s, y: anchor.y - wy * s }
}

/** bounds(월드)가 viewport(화면 크기) 안에 여백 pad(화면 px)를 두고 가운데 오게 */
export function fitView(bounds: Rect, viewport: { width: number; height: number }, pad = 40): View {
  const w = Math.max(bounds.width, 1)
  const h = Math.max(bounds.height, 1)
  const scale = clampZoom(Math.min((viewport.width - pad * 2) / w, (viewport.height - pad * 2) / h))
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  return { scale, x: viewport.width / 2 - cx * scale, y: viewport.height / 2 - cy * scale }
}

/** 참조명(U1 …)이 부품 사진 위에 그려지는 자리 */
const LABEL_SPACE = 24

/** 부품·전선·접속점을 모두 담는 사각형. 비어 있으면 undefined */
export function contentBounds(project: Project): Rect | undefined {
  const xs: number[] = []
  const ys: number[] = []
  const add = (p: Point) => {
    xs.push(p.x)
    ys.push(p.y)
  }
  for (const inst of project.instances) {
    const part = project.parts[inst.partId]
    if (!part) continue
    const r = instanceBounds(inst, part)
    add({ x: r.x, y: r.y - LABEL_SPACE })
    add({ x: r.x + r.width, y: r.y + r.height })
  }
  for (const j of project.junctions ?? []) add(j)
  for (const w of project.wires) {
    const a = endPosition(project, w.from)
    const b = endPosition(project, w.to)
    if (a && b) wirePath(a, w.points, b, w.orthogonal).forEach(add)
  }
  if (xs.length === 0) return undefined
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
