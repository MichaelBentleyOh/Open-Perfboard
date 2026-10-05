// 전선이 부품 사진을 가로지르지 않게 한다.
// 편집 뒤(연결, 부품 이동·회전·반전 …) 관련 전선 중 남의 부품 사진 안을 지나거나 자기 부품을 가로지르는(핀에서 빠져나가는 것보다 훨씬 길게 지나는) 전선만,
// 꺾임점을 경유지로 삼아 피해 가는 경로로 바꾼다.
import { endInstanceId, endJunctionId, endPosition } from './ends'
import { instanceBounds, type Point, type Rect } from './geometry'
import type { Project, Wire } from './model'
import { CellIndex } from './lookup'
import { applyRoutes, partObstacles, pinPoints } from './ops'
import { routeAll, type RouteRequest } from './route'
import { BEND_SNAP, wirePath } from './wire'

/** 편집으로 바뀐 것 */
export interface Changed {
  instances?: readonly string[]
  wires?: readonly string[]
  junctions?: readonly string[]
}

interface PartBox {
  id: string
  rect: Rect
}

const partBoxes = (project: Project): PartBox[] =>
  project.instances.flatMap((inst) => {
    const part = project.parts[inst.partId]
    return part ? [{ id: inst.id, rect: instanceBounds(inst, part) }] : []
  })

/** 선분 p-q의 일부가 사각형 안쪽(가장자리 제외)을 지나는지 */
export function segmentCrossesRect(p: Point, q: Point, r: Rect): boolean {
  // 선분을 t∈[0,1]로 두고 x, y 각각 열린 구간 안에 드는 t 범위를 좁힌다
  let lo = 0
  let hi = 1
  const clip = (start: number, delta: number, min: number, max: number): boolean => {
    if (delta === 0) return start > min && start < max
    let t0 = (min - start) / delta
    let t1 = (max - start) / delta
    if (t0 > t1) [t0, t1] = [t1, t0]
    lo = Math.max(lo, t0)
    hi = Math.min(hi, t1)
    return lo < hi
  }
  return clip(p.x, q.x - p.x, r.x, r.x + r.width) && clip(p.y, q.y - p.y, r.y, r.y + r.height) && lo < hi
}

/** 선분 p-q가 사각형 안쪽을 지나는 길이 */
export function insideLength(p: Point, q: Point, r: Rect): number {
  let lo = 0
  let hi = 1
  const clip = (start: number, delta: number, min: number, max: number): boolean => {
    if (delta === 0) return start > min && start < max
    let t0 = (min - start) / delta
    let t1 = (max - start) / delta
    if (t0 > t1) [t0, t1] = [t1, t0]
    lo = Math.max(lo, t0)
    hi = Math.min(hi, t1)
    return lo < hi
  }
  if (!clip(p.x, q.x - p.x, r.x, r.x + r.width) || !clip(p.y, q.y - p.y, r.y, r.y + r.height)) return 0
  return (hi - lo) * Math.hypot(q.x - p.x, q.y - p.y)
}

const insideRect = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height

/**
 * 핀에서 자기 부품 사진 밖으로 빠져나가는 데 봐줄 길이: 가장 가까운 가장자리까지의 1.5배(+격자 한 칸),
 * 또는 부품 긴 변의 60% 중 큰 것. 사용자가 그린 비스듬한 선·우회로는 건드리지 않고, 반대쪽까지 뚫고 지나가는 것만 잡는다
 */
function escapeAllowance(pin: Point, r: Rect): number {
  const nearest = Math.min(pin.x - r.x, r.x + r.width - pin.x, pin.y - r.y, r.y + r.height - pin.y)
  return Math.max(nearest * 1.5 + BEND_SNAP, Math.max(r.width, r.height) * 0.6)
}

/** 경로가 끝점 부품(자기 부품) 안을 빠져나가는 데 필요한 것보다 훨씬 길게 지나는지 (부품을 가로지름) */
function overrunsOwnParts(path: readonly Point[], w: Wire, boxById: ReadonlyMap<string, PartBox>): boolean {
  const ends: [string | undefined, Point][] = [
    [endInstanceId(w.from), path[0]],
    [endInstanceId(w.to), path[path.length - 1]]
  ]
  const allowance = new Map<string, number>()
  for (const [id, pin] of ends) {
    const box = id === undefined ? undefined : boxById.get(id)
    if (!box || !insideRect(pin, box.rect)) continue
    allowance.set(box.id, (allowance.get(box.id) ?? 0) + escapeAllowance(pin, box.rect))
  }
  for (const [id, allowed] of allowance) {
    const r = boxById.get(id)!.rect
    let inside = 0
    for (let k = 0; k < path.length - 1; k++) inside += insideLength(path[k], path[k + 1], r)
    if (inside > allowed) return true
  }
  return false
}

/** 전선 끝이 붙은 부품 (그 부품에서 빠져나오는 부분은 괜찮다) */
const ownParts = (w: Wire) => new Set([endInstanceId(w.from), endInstanceId(w.to)].filter((x): x is string => x !== undefined))

/** 부품 사진 공간 색인 (선분 근처의 부품만 확인 → 부품이 많아도 전선 하나 확인 시간이 늘지 않는다) */
const BOX_CELL = 200
function indexBoxes(boxes: readonly PartBox[]): CellIndex<PartBox> {
  const index = new CellIndex<PartBox>(BOX_CELL)
  for (const b of boxes) index.add(b, b.rect.x, b.rect.y, b.rect.x + b.rect.width, b.rect.y + b.rect.height)
  return index
}

function crossesIndexed(path: readonly Point[], index: CellIndex<PartBox>, own: ReadonlySet<string>): boolean {
  for (let k = 0; k < path.length - 1; k++) {
    const p = path[k]
    const q = path[k + 1]
    const near = index.inRect(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y))
    for (const b of near) if (!own.has(b.id) && segmentCrossesRect(p, q, b.rect)) return true
  }
  return false
}

/** 경로가 자기 부품이 아닌 부품 사진을 가로지르는지 */
export function pathCrossesParts(path: readonly Point[], boxes: readonly PartBox[], own: ReadonlySet<string>): boolean {
  return crossesIndexed(path, indexBoxes(boxes), own)
}

/** 점이 어느 부품 사진 안쪽에 있으면, 가장 가까운 바깥(격자에 맞춘 점)으로 옮긴다 */
function pushOutside(p: Point, index: CellIndex<PartBox>): Point {
  let q = p
  for (let tries = 0; tries < 4; tries++) {
    const inside = (index.at(q.x, q.y) ?? []).find((b) => q.x > b.rect.x && q.x < b.rect.x + b.rect.width && q.y > b.rect.y && q.y < b.rect.y + b.rect.height)
    if (!inside) return q
    const r = inside.rect
    const gap = BEND_SNAP
    const options = [
      { x: Math.floor((r.x - gap) / BEND_SNAP) * BEND_SNAP, y: q.y },
      { x: Math.ceil((r.x + r.width + gap) / BEND_SNAP) * BEND_SNAP, y: q.y },
      { x: q.x, y: Math.floor((r.y - gap) / BEND_SNAP) * BEND_SNAP },
      { x: q.x, y: Math.ceil((r.y + r.height + gap) / BEND_SNAP) * BEND_SNAP }
    ]
    q = options.reduce((best, o) => (Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(best.x - q.x, best.y - q.y) ? o : best))
  }
  return q
}

/** 바뀐 것과 관련된 전선: 바뀐 전선, 바뀐 부품·접속점에 닿은 전선, 바뀐 부품 자리를 지나는 전선 */
function relatedWires(project: Project, changed: Changed, boxes: readonly PartBox[]): Wire[] {
  const wires = new Set(changed.wires ?? [])
  const instances = new Set(changed.instances ?? [])
  const junctions = new Set(changed.junctions ?? [])
  const changedBoxes = boxes.filter((b) => instances.has(b.id))
  const changedIndex = indexBoxes(changedBoxes)
  return project.wires.filter((w) => {
    if (wires.has(w.id)) return true
    const ends = [w.from, w.to]
    if (ends.some((e) => instances.has(endInstanceId(e) ?? '') || junctions.has(endJunctionId(e) ?? ''))) return true
    if (changedBoxes.length === 0) return false
    const a = endPosition(project, w.from)
    const b = endPosition(project, w.to)
    return !!a && !!b && crossesIndexed(wirePath(a, w.points, b, w.orthogonal), changedIndex, ownParts(w))
  })
}

/** 바뀐 것과 관련된 전선 중 남의 부품 사진을 지나거나 자기 부품을 가로지르는 전선 */
export function crossingWires(
  project: Project,
  changed: Changed,
  boxes: readonly PartBox[] = partBoxes(project),
  index: CellIndex<PartBox> = indexBoxes(boxes)
): Wire[] {
  if (boxes.length === 0) return []
  const boxById = new Map(boxes.map((b) => [b.id, b]))
  return relatedWires(project, changed, boxes).filter((w) => {
    const a = endPosition(project, w.from)
    const b = endPosition(project, w.to)
    if (!a || !b) return false
    const path = wirePath(a, w.points, b, w.orthogonal)
    return crossesIndexed(path, index, ownParts(w)) || overrunsOwnParts(path, w, boxById)
  })
}

/**
 * 바뀐 것과 관련된 전선 중 남의 부품 사진을 지나거나 자기 부품을 가로지르는 전선을 피해 가는 직각 경로로 바꾼다.
 * 꺾임점은 경유지로 지킨다(부품 안에 있으면 바깥으로 옮김). 피할 길이 없는 전선은 그대로 둔다.
 * 바뀐 것이 없으면 같은 객체를 돌려준다.
 */
export function avoidParts(project: Project, changed: Changed): Project {
  const boxes = partBoxes(project)
  const index = indexBoxes(boxes)
  const bad = crossingWires(project, changed, boxes, index)
  if (bad.length === 0) return project

  // 전선마다 경유지 사이 구간을 하나의 요청으로 (구간 id = 전선 id#순번)
  const badIds = new Set(bad.map((w) => w.id))
  const requests: RouteRequest[] = []
  const legsOf = new Map<string, number>()
  for (const w of bad) {
    const a = endPosition(project, w.from)!
    const b = endPosition(project, w.to)!
    const stops = [a, ...(w.points ?? []).map((p) => pushOutside(p, index)), b]
    const fromOwner = endInstanceId(w.from)
    const toOwner = endInstanceId(w.to)
    for (let k = 0; k < stops.length - 1; k++) {
      // 첫 구간은 시작 핀에서 빠져나가고, 마지막 구간은 끝 핀으로 들어간다 (그 부품 안에서는 곧게만)
      requests.push({
        id: `${w.id}#${k}`,
        a: stops[k],
        b: stops[k + 1],
        ...(k === 0 && fromOwner ? { aOwner: fromOwner } : {}),
        ...(k === stops.length - 2 && toOwner ? { bOwner: toOwner } : {})
      })
    }
    legsOf.set(w.id, stops.length - 1)
  }
  const fixed = project.wires.flatMap((w) => {
    if (badIds.has(w.id)) return []
    const a = endPosition(project, w.from)
    const b = endPosition(project, w.to)
    return a && b ? [wirePath(a, w.points, b, w.orthogonal)] : []
  })
  const legs = routeAll(requests, partObstacles(project), fixed, pinPoints(project))

  // 구간을 이어 붙인다. 한 구간이라도 못 찾으면 그 전선은 그대로
  const routes: Record<string, Point[]> = {}
  for (const [id, n] of legsOf) {
    const parts = Array.from({ length: n }, (_, k) => legs[`${id}#${k}`])
    if (parts.some((p) => !p)) continue
    routes[id] = parts.flatMap((p, k) => (k === 0 ? p : p.slice(1)))
  }
  return applyRoutes(project, routes)
}
