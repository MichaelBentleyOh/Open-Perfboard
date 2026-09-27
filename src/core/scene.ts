// 캔버스에 그릴 전선 모양 계산 (화면과 무관한 순수 계산)
import { findCrossings, type Hop } from './crossing'
import { endPosition, isPinEnd } from './ends'
import type { Point, Rect } from './geometry'
import type { Project, Wire } from './model'
import { wirePath } from './wire'

export interface WireShape {
  wire: Wire
  /** 양 끝 */
  a: Point
  b: Point
  /** 꺾임점 */
  pts: Point[]
  /** 그리는 경로 (양 끝 포함, 직각 모드면 자동 꺾임 포함) */
  path: Point[]
  bounds: Rect
}

export function pathBounds(path: readonly Point[]): Rect {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of path) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function wireShape(wire: Wire, a: Point, b: Point, pts: Point[] = wire.points ?? []): WireShape {
  const path = wirePath(a, pts, b, wire.orthogonal)
  return { wire, a, b, pts, path, bounds: pathBounds(path) }
}

export interface SceneWires {
  list: WireShape[]
  hops: Record<string, Hop[]>
}

const samePoint = (p: Point, q: Point) => p.x === q.x && p.y === q.y
const sameHops = (p: readonly Hop[], q: readonly Hop[]) =>
  p.length === q.length && p.every((h, i) => h.segment === q[i].segment && samePoint(h.point, q[i].point))

/**
 * 모든 전선의 모양과 교차 점프. 끝을 찾을 수 없는 전선은 빠진다.
 * prev(직전 결과)를 주면 바뀌지 않은 전선은 모양·점프 객체를 그대로 다시 쓴다 → 화면은 바뀐 전선만 다시 그린다.
 */
export function sceneWires(project: Project, prev?: SceneWires): SceneWires {
  const before = new Map(prev?.list.map((s) => [s.wire.id, s]))
  const list: WireShape[] = []
  for (const w of project.wires) {
    const a = endPosition(project, w.from)
    const b = endPosition(project, w.to)
    if (!a || !b) continue
    const old = before.get(w.id)
    list.push(old && old.wire === w && samePoint(old.a, a) && samePoint(old.b, b) ? old : wireShape(w, a, b))
  }
  const hops = findCrossings(list.map((s) => ({ id: s.wire.id, path: s.path })))
  if (prev) {
    for (const [id, h] of Object.entries(hops)) {
      const old = prev.hops[id]
      if (old && sameHops(old, h)) hops[id] = old
    }
  }
  return { list, hops }
}

/** 부품·접속점에 닿은 전선 id (끄는 중 다시 그릴 전선) */
export function wiresTouching(project: Project, instanceIds: ReadonlySet<string>, junctionIds: ReadonlySet<string>): Set<string> {
  const touches = (e: Wire['from']) => (isPinEnd(e) ? instanceIds.has(e.instanceId) : junctionIds.has(e.junctionId))
  return new Set(project.wires.filter((w) => touches(w.from) || touches(w.to)).map((w) => w.id))
}

/** 접속점 색 = 그 접속점에 닿은 첫 전선의 색 */
export function junctionColors(project: Project): Map<string, string> {
  const colors = new Map<string, string>()
  for (const w of project.wires) {
    for (const e of [w.from, w.to]) if (!isPinEnd(e) && !colors.has(e.junctionId)) colors.set(e.junctionId, w.color)
  }
  return colors
}
