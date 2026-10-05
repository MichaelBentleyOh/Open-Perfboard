// 프로젝트 편집 연산. 모두 입력을 변경하지 않고 새 Project를 반환한다.
// ID는 호출하는 쪽(스토어)에서 만들어 넘긴다 → 테스트에서 결과가 결정적이다.
import {
  DEFAULT_REF_PREFIX,
  PROJECT_FILE_VERSION,
  type Junction,
  type PartDef,
  type PartInstance,
  type PinRef,
  type WireEnd,
  type BomItem,
  type BomOverride,
  type Project,
  type ProjectBom,
  type ProjectMeta,
  type Wire,
  type Currency
} from './model'
import { instanceBounds, normalizeAngle, pinWorldPosition, type Point, type Rect } from './geometry'
import { endExists, endInstanceId, endJunctionId, endPosition, findJunction, isJunctionEnd, isPinEnd, sameEnd } from './ends'
import { minimalOrthogonalPoints, projectOnPath, simplifyBends, snapPoint, wirePath } from './wire'
import { routeAll, type RouteObstacle, type RouteOptions, type RouteRequest } from './route'
import { convertMoney, inProjectCurrency, projectCurrency, withCurrency } from './money'
import { pruneSupplies } from './supply'
import { moveNotes, removeNotes, resizeNotes } from './note'
import { pruneSchematic } from './schematic'

export { resolvePin } from './ends'

export function emptyProject(name: string): Project {
  return { version: PROJECT_FILE_VERSION, name, parts: {}, instances: [], wires: [] }
}

/** 같은 접두사 참조명 중 가장 큰 번호 + 1 (U1, U2 → U3). 빈 번호는 채우지 않는다 */
export function nextRefDes(project: Project, prefix: string): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`)
  let max = 0
  for (const inst of project.instances) {
    const m = re.exec(inst.refDes)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${prefix}${max + 1}`
}

/**
 * 부품 정의를 배선도 통화로 맞춘 사본 (029). 단가를 환율로 바꾸고 currency 표시를 맞춘다.
 * 환율이 없어 바꿀 수 없으면 단가를 뺀다 (BOM에 "단가 미입력"으로 보인다)
 */
export const partForProject = (project: Project, part: PartDef): PartDef => inProjectCurrency(project, part)

/** 부품을 배치한다. 부품 정의가 프로젝트에 없으면 사본을 넣는다 */
export function addInstance(
  project: Project,
  part: PartDef,
  at: { id: string; x: number; y: number }
): Project {
  const parts = project.parts[part.id] ? project.parts : { ...project.parts, [part.id]: partForProject(project, part) }
  const instance: PartInstance = {
    id: at.id,
    partId: part.id,
    refDes: nextRefDes(project, part.refPrefix || DEFAULT_REF_PREFIX),
    x: at.x,
    y: at.y,
    rotation: 0,
    scale: 1
  }
  return { ...project, parts, instances: [...project.instances, instance] }
}

/** 부품 배율 범위 (034) */
export const SCALE_MIN = 0.2
export const SCALE_MAX = 5
/** ] / [ 키·버튼 한 번에 바뀌는 비율 */
export const RESIZE_STEP = 1.1
export const clampScale = (s: number) => Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, s)) * 1000) / 1000

/**
 * 부품·글 상자 크기를 factor배로 (034). 부품은 중심, 글 상자는 왼쪽 위를 그대로 둔다.
 * 범위 끝에 닿은 것은 거기서 멈춘다. 바뀐 게 없으면 같은 객체
 */
export function resizeItems(project: Project, items: { instances?: readonly string[]; notes?: readonly string[] }, factor: number): Project {
  if (!(factor > 0) || factor === 1) return project
  let next = project
  const ids = new Set(items.instances ?? [])
  if (ids.size > 0) {
    let changed = false
    const instances = project.instances.map((i) => {
      if (!ids.has(i.id)) return i
      const scale = clampScale(i.scale * factor)
      if (scale === i.scale) return i
      changed = true
      return { ...i, scale }
    })
    if (changed) next = { ...next, instances }
  }
  return resizeNotes(next, items.notes ?? [], factor)
}

export type InstancePatch = Partial<Pick<PartInstance, 'x' | 'y' | 'rotation' | 'scale' | 'refDes'>>

export function updateInstance(project: Project, instanceId: string, patch: InstancePatch): Project {
  return {
    ...project,
    instances: project.instances.map((i) => (i.id === instanceId ? { ...i, ...patch } : i))
  }
}

/** 부품을 지운다. 연결된 전선도 지우고, 더 이상 쓰이지 않는 부품 정의 사본도 지운다 */
export function removeInstance(project: Project, instanceId: string): Project {
  const target = project.instances.find((i) => i.id === instanceId)
  if (!target) return project
  const instances = project.instances.filter((i) => i.id !== instanceId)
  const wires = project.wires.filter(
    (w) => endInstanceId(w.from) !== instanceId && endInstanceId(w.to) !== instanceId
  )
  let parts = project.parts
  let result: Project = { ...project, instances, wires }
  if (!instances.some((i) => i.partId === target.partId)) {
    parts = { ...project.parts }
    delete parts[target.partId]
    // 부품 정의가 빠지면 그 BOM 수정값도 뺀다
    if (project.bom?.overrides?.[target.partId]) {
      const overrides = { ...project.bom.overrides }
      delete overrides[target.partId]
      result = withBom(result, { ...project.bom, overrides })
    }
  }
  return cleanupJunctions({ ...result, parts })
}

export type ConnectError = 'same-pin' | 'unknown-pin' | 'duplicate'
export type ConnectResult = { ok: true; project: Project } | { ok: false; error: ConnectError }

/** 두 끝(핀·접속점)을 전선으로 잇는다. 같은 끝, 없는 끝, 이미 있는 연결(방향 무관)은 거부한다 */
export function connect(project: Project, wire: Wire): ConnectResult {
  if (sameEnd(wire.from, wire.to)) return { ok: false, error: 'same-pin' }
  if (!endExists(project, wire.from) || !endExists(project, wire.to)) {
    return { ok: false, error: 'unknown-pin' }
  }
  const dup = project.wires.some(
    (w) =>
      (sameEnd(w.from, wire.from) && sameEnd(w.to, wire.to)) ||
      (sameEnd(w.from, wire.to) && sameEnd(w.to, wire.from))
  )
  if (dup) return { ok: false, error: 'duplicate' }
  return { ok: true, project: { ...project, wires: [...project.wires, wire] } }
}

export function disconnect(project: Project, wireId: string): Project {
  return cleanupJunctions({ ...project, wires: project.wires.filter((w) => w.id !== wireId) })
}

export type WirePatch = Partial<Pick<Wire, 'color' | 'width' | 'label' | 'points' | 'orthogonal' | 'awg' | 'memo' | 'direction'>>

export function updateWire(project: Project, wireId: string, patch: WirePatch): Project {
  return { ...project, wires: project.wires.map((w) => (w.id === wireId ? applyWirePatch(w, patch) : w)) }
}

/** undefined·빈 값은 필드를 지운다 (파일에 빈 값이 남지 않게) */
function applyWirePatch(w: Wire, patch: WirePatch): Wire {
  const next: Wire = { ...w, ...patch }
  if (!next.label) delete next.label
  if (!next.points || next.points.length === 0) delete next.points
  if (!next.orthogonal) delete next.orthogonal
  if (next.awg === undefined) delete next.awg
  if (!next.direction) delete next.direction
  if (!next.memo) delete next.memo
  return next
}

// ---------------------------------------------------------------- 꺾임점 편집

function mapPoints(project: Project, wireId: string, fn: (pts: { x: number; y: number }[]) => { x: number; y: number }[]): Project {
  return {
    ...project,
    wires: project.wires.map((w) => (w.id === wireId ? applyWirePatch(w, { points: fn([...(w.points ?? [])]) }) : w))
  }
}

export const moveWirePoint = (project: Project, wireId: string, index: number, p: { x: number; y: number }) =>
  mapPoints(project, wireId, (pts) => pts.map((q, i) => (i === index ? { x: p.x, y: p.y } : q)))

export const insertWirePoint = (project: Project, wireId: string, index: number, p: { x: number; y: number }) =>
  mapPoints(project, wireId, (pts) => [...pts.slice(0, index), { x: p.x, y: p.y }, ...pts.slice(index)])

export const removeWirePoint = (project: Project, wireId: string, index: number) =>
  mapPoints(project, wireId, (pts) => pts.filter((_, i) => i !== index))

// ---------------------------------------------------------------- 여러 대상 한 번에 (다중 선택)
// 한 번의 호출 = 새 Project 하나 → 실행 취소 1회로 되돌아간다

export interface ItemIds {
  instances: readonly string[]
  wires: readonly string[]
  junctions?: readonly string[]
  /** 글 상자 (032) */
  notes?: readonly string[]
}

/** 부품(과 접속점)을 함께 옮긴다. 양 끝이 모두 움직이는 전선은 꺾임점도 옮겨 모양을 유지한다 */
export function moveInstances(
  project: Project,
  ids: readonly string[],
  dx: number,
  dy: number,
  junctionIds: readonly string[] = [],
  noteIds: readonly string[] = []
): Project {
  if ((ids.length === 0 && junctionIds.length === 0 && noteIds.length === 0) || (dx === 0 && dy === 0)) return project
  const set = new Set(ids)
  const jset = new Set(junctionIds)
  const moving = (e: WireEnd) => (isPinEnd(e) ? set.has(e.instanceId) : jset.has(e.junctionId))
  const next: Project = {
    ...project,
    instances: project.instances.map((i) => (set.has(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i)),
    wires: project.wires.map((w) =>
      w.points && moving(w.from) && moving(w.to)
        ? { ...w, points: w.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
        : w
    )
  }
  if (project.junctions && jset.size > 0) {
    next.junctions = project.junctions.map((j) => (jset.has(j.id) ? { ...j, x: j.x + dx, y: j.y + dy } : j))
  }
  return moveNotes(next, noteIds, dx, dy)
}

/** 부품마다 다른 만큼 옮긴다. 양 끝이 같은 만큼 움직이는 전선만 꺾임점도 옮긴다 */
export function moveInstancesBy(project: Project, deltas: ReadonlyMap<string, Point>): Project {
  const moved = [...deltas].filter(([, d]) => d.x !== 0 || d.y !== 0)
  if (moved.length === 0) return project
  const delta = new Map(moved)
  const endDelta = (e: WireEnd) => (isPinEnd(e) ? delta.get(e.instanceId) : undefined)
  return {
    ...project,
    instances: project.instances.map((i) => {
      const d = delta.get(i.id)
      return d ? { ...i, x: i.x + d.x, y: i.y + d.y } : i
    }),
    wires: project.wires.map((w) => {
      const a = endDelta(w.from)
      const b = endDelta(w.to)
      if (!w.points || !a || !b || a.x !== b.x || a.y !== b.y) return w
      return { ...w, points: w.points.map((p) => ({ x: p.x + a.x, y: p.y + a.y })) }
    })
  }
}

export type AlignMode = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom' | 'distributeX' | 'distributeY'
export const ALIGN_MODES: readonly AlignMode[] = ['left', 'centerX', 'right', 'top', 'centerY', 'bottom', 'distributeX', 'distributeY']

/**
 * 부품 줄 맞추기 (회전 반영 경계 상자 기준).
 * 줄 맞추기는 2개 이상, 간격 맞추기는 3개 이상: 중심 순서대로 양 끝 부품은 그대로 두고 상자 사이 빈칸을 같게 한다
 */
export function alignInstances(project: Project, ids: readonly string[], mode: AlignMode): Project {
  const set = new Set(ids)
  const boxes = project.instances.flatMap((inst) => {
    const part = set.has(inst.id) ? project.parts[inst.partId] : undefined
    return part ? [{ id: inst.id, r: instanceBounds(inst, part) }] : []
  })
  const distribute = mode === 'distributeX' || mode === 'distributeY'
  if (boxes.length < (distribute ? 3 : 2)) return project
  const deltas = new Map<string, Point>()
  if (distribute) {
    const horizontal = mode === 'distributeX'
    const start = (r: Rect) => (horizontal ? r.x : r.y)
    const size = (r: Rect) => (horizontal ? r.width : r.height)
    const sorted = [...boxes].sort((p, q) => start(p.r) + size(p.r) / 2 - (start(q.r) + size(q.r) / 2))
    const first = sorted[0].r
    const last = sorted[sorted.length - 1].r
    const span = start(last) + size(last) - start(first)
    const gap = (span - sorted.reduce((s, b) => s + size(b.r), 0)) / (sorted.length - 1)
    let at = start(first)
    for (const b of sorted) {
      const d = at - start(b.r)
      deltas.set(b.id, horizontal ? { x: d, y: 0 } : { x: 0, y: d })
      at += size(b.r) + gap
    }
  } else {
    const x0 = Math.min(...boxes.map((b) => b.r.x))
    const x1 = Math.max(...boxes.map((b) => b.r.x + b.r.width))
    const y0 = Math.min(...boxes.map((b) => b.r.y))
    const y1 = Math.max(...boxes.map((b) => b.r.y + b.r.height))
    for (const { id, r } of boxes) {
      const d =
        mode === 'left' ? { x: x0 - r.x, y: 0 }
        : mode === 'right' ? { x: x1 - (r.x + r.width), y: 0 }
        : mode === 'centerX' ? { x: (x0 + x1) / 2 - (r.x + r.width / 2), y: 0 }
        : mode === 'top' ? { x: 0, y: y0 - r.y }
        : mode === 'bottom' ? { x: 0, y: y1 - (r.y + r.height) }
        : { x: 0, y: (y0 + y1) / 2 - (r.y + r.height / 2) }
      deltas.set(id, d)
    }
  }
  return moveInstancesBy(project, deltas)
}

/** 각 부품을 자기 중심 기준으로 회전한다 */
export function rotateInstances(project: Project, ids: readonly string[], delta: number): Project {
  if (ids.length === 0) return project
  const set = new Set(ids)
  return {
    ...project,
    instances: project.instances.map((i) =>
      set.has(i.id) ? { ...i, rotation: normalizeAngle(i.rotation + delta) } : i
    )
  }
}

/** 전선·부품·접속점을 한 번에 지운다 (부품·접속점에 연결된 전선도 함께) */
export function removeItems(project: Project, items: ItemIds): Project {
  const wireSet = new Set(items.wires)
  const jset = new Set(items.junctions ?? [])
  const onRemovedJunction = (e: WireEnd) => isJunctionEnd(e) && jset.has(e.junctionId)
  let next: Project = {
    ...project,
    wires: project.wires.filter((w) => !wireSet.has(w.id) && !onRemovedJunction(w.from) && !onRemovedJunction(w.to))
  }
  if (jset.size > 0 && next.junctions) next = withJunctions(next, next.junctions.filter((j) => !jset.has(j.id)))
  for (const id of items.instances) next = removeInstance(next, id)
  return pruneSchematic(pruneSupplies(cleanupJunctions(removeNotes(next, items.notes ?? []))))
}

export function updateWires(project: Project, ids: readonly string[], patch: WirePatch): Project {
  const set = new Set(ids)
  return { ...project, wires: project.wires.map((w) => (set.has(w.id) ? applyWirePatch(w, patch) : w)) }
}

// ---------------------------------------------------------------- 라이브러리 → 프로젝트 사본 갱신

/**
 * 프로젝트에 들어 있는 부품 정의 사본을 새 정의로 바꾼다.
 * 새 정의에 없는 핀에 연결돼 있던 전선은 지우고 그 수를 알려 준다.
 */
export function replacePartDef(project: Project, source: PartDef): { project: Project; removedWires: number } {
  if (!project.parts[source.id]) return { project, removedWires: 0 }
  const part = partForProject(project, source)
  const pinIds = new Set(part.pins.map((p) => p.id))
  const usesPart = new Set(project.instances.filter((i) => i.partId === part.id).map((i) => i.id))
  const dangling = (r: WireEnd) => isPinEnd(r) && usesPart.has(r.instanceId) && !pinIds.has(r.pinId)
  const wires = project.wires.filter((w) => !dangling(w.from) && !dangling(w.to))
  return {
    project: pruneSchematic(cleanupJunctions({ ...project, parts: { ...project.parts, [part.id]: part }, wires })),
    removedWires: project.wires.length - wires.length
  }
}

/**
 * 화면 기준 반전. 부품은 "자기 좌표에서 좌우 반전 → 회전" 순서로 그려지므로
 * 화면 좌우 반전 M·R(θ)·F = R(-θ)·F·F → 회전 -θ, 반전 토글
 * 화면 상하 반전 = 좌우 반전 후 180° 회전 → 회전 180-θ, 반전 토글
 */
export function flipInstances(project: Project, ids: readonly string[], axis: 'horizontal' | 'vertical'): Project {
  if (ids.length === 0) return project
  const set = new Set(ids)
  return {
    ...project,
    instances: project.instances.map((i) => {
      if (!set.has(i.id)) return i
      const rotation = normalizeAngle(axis === 'horizontal' ? -i.rotation : 180 - i.rotation)
      const next: PartInstance = { ...i, rotation }
      if (i.flipped) delete next.flipped
      else next.flipped = true
      return next
    })
  }
}

export function setMeta(project: Project, meta: ProjectMeta): Project {
  const clean: ProjectMeta = {}
  if (meta.author?.trim()) clean.author = meta.author.trim()
  if (meta.notes?.trim()) clean.notes = meta.notes.trim()
  const next = { ...project }
  if (Object.keys(clean).length > 0) next.meta = clean
  else delete next.meta
  return next
}

// ---------------------------------------------------------------- 전선 자동 정리

/** 지정한 전선들의 꺾임점을 정리한다. 바뀐 것이 없으면 같은 객체를 돌려준다 */
export function tidyWires(project: Project, wireIds: readonly string[]): Project {
  const set = new Set(wireIds)
  let changed = false
  const wires = project.wires.map((w) => {
    if (!set.has(w.id) || !w.points?.length) return w
    const pa = endPosition(project, w.from)
    const pb = endPosition(project, w.to)
    if (!pa || !pb) return w
    const pts = simplifyBends(pa, w.points, pb, w.orthogonal)
    if (pts.length === w.points.length && pts.every((p, i) => p.x === w.points![i].x && p.y === w.points![i].y)) return w
    changed = true
    return applyWirePatch(w, { points: pts })
  })
  return changed ? { ...project, wires } : project
}

/** 캔버스가 부품 사진 위에 그리는 참조명 자리 (월드 단위) */
const REF_LABEL_SPACE = 22

/** 배선 정리에 넘길 입력 (routeAll의 인자). 구조화 복제가 되는 값만 → 작업자(Worker)로 보낼 수 있다 */
export interface RouteJob {
  requests: RouteRequest[]
  obstacles: RouteObstacle[]
  fixed: Point[][]
  avoid: Point[]
}

/** 부품마다: 피할 영역(사진 + 위쪽 참조명 자리, 지나면 비쌈)과 지나갈 수 없는 영역(사진) */
export function partObstacles(project: Project): RouteObstacle[] {
  return project.instances.flatMap((inst) => {
    const part = project.parts[inst.partId]
    if (!part) return []
    const r = instanceBounds(inst, part)
    return [{ rect: { ...r, y: r.y - REF_LABEL_SPACE, height: r.height + REF_LABEL_SPACE }, owner: inst.id, hard: r }]
  })
}

/** 핀·접속점 위치 (끝점이 아니면 그 위를 지나지 않는다) */
export function pinPoints(project: Project): Point[] {
  return [
    ...project.instances.flatMap((inst) => {
      const part = project.parts[inst.partId]
      return part ? part.pins.map((pin) => pinWorldPosition(inst, part, pin)) : []
    }),
    ...(project.junctions ?? []).map((j) => ({ x: j.x, y: j.y }))
  ]
}

/** 배선 정리 입력 만들기: 고른 전선은 새로 찾고, 나머지 전선·부품·핀은 피할 대상 */
export function routeJob(project: Project, wireIds: readonly string[]): RouteJob {
  const ids = new Set(wireIds)
  const obstacles = partObstacles(project)
  const requests: RouteRequest[] = []
  const fixed: Point[][] = []
  for (const w of project.wires) {
    const a = endPosition(project, w.from)
    const b = endPosition(project, w.to)
    if (!a || !b) continue
    if (ids.has(w.id)) {
      const aOwner = endInstanceId(w.from)
      const bOwner = endInstanceId(w.to)
      requests.push({ id: w.id, a, b, ...(aOwner ? { aOwner } : {}), ...(bOwner ? { bOwner } : {}) })
    } else fixed.push(wirePath(a, w.points, b, w.orthogonal))
  }
  // 끝점이 아닌 핀·접속점 위를 지나면 이어진 것처럼 보이므로 피한다
  return { requests, obstacles, fixed, avoid: pinPoints(project) }
}

/** 찾은 경로를 전선 꺾임점으로 넣는다. 바뀐 것이 없으면 같은 객체를 돌려준다 */
export function applyRoutes(project: Project, routes: Readonly<Record<string, Point[]>>): Project {
  let changed = false
  const wires = project.wires.map((w) => {
    const path = routes[w.id]
    if (!path) return w
    const a = path[0]
    const b = path[path.length - 1]
    const points = minimalOrthogonalPoints(a, path, b)
    const same =
      w.orthogonal === true &&
      (w.points ?? []).length === points.length &&
      points.every((p, i) => p.x === w.points![i].x && p.y === w.points![i].y)
    if (same) return w
    changed = true
    return applyWirePatch(w, { points, orthogonal: true })
  })
  return changed ? { ...project, wires } : project
}

/**
 * 배선 정리: 전선들을 부품을 피하고 서로 겹치지 않는 직각 경로로 다시 그린다.
 * 정리하지 않는 전선은 그대로 두고 피해 간다. 바뀐 것이 없으면 같은 객체를 돌려준다.
 * (화면에서는 오래 걸릴 수 있어 routeJob → 작업자에서 routeAll → applyRoutes로 나눠 쓴다)
 */
export function routeWires(project: Project, wireIds: readonly string[], options?: Partial<RouteOptions>): Project {
  const j = routeJob(project, wireIds)
  return applyRoutes(project, routeAll(j.requests, j.obstacles, j.fixed, j.avoid, options))
}

/** 부품 사본에서 고칠 수 있는 스펙. 문자열을 비우거나 undefined면 필드를 지운다 */
export type PartSpecPatch = Partial<Pick<PartDef, 'name' | 'partNumber' | 'manufacturer' | 'memo' | 'purchaseUrl' | 'supplier' | 'unitPrice'>>

/**
 * 이 배선도의 부품 사본 스펙을 고친다 (같은 부품을 쓰는 배치 전부에 적용). 라이브러리는 그대로.
 * 이름은 비울 수 없다(빈 이름이면 바꾸지 않음). 바뀐 것이 없으면 같은 객체.
 */
export function updatePartDef(project: Project, partId: string, patch: PartSpecPatch): Project {
  const part = project.parts[partId]
  if (!part) return project
  const next: PartDef = { ...part }
  for (const [k, v] of Object.entries(patch) as [keyof PartSpecPatch, string | number | undefined][]) {
    if (k === 'name') {
      if (typeof v === 'string' && v.trim()) next.name = v.trim()
    } else if (k === 'unitPrice') {
      if (typeof v === 'number') next.unitPrice = v
      else delete next.unitPrice
    } else if (typeof v === 'string' && v.trim()) next[k] = v.trim()
    else delete next[k]
  }
  if (JSON.stringify(next) === JSON.stringify(part)) return project
  return { ...project, parts: { ...project.parts, [partId]: next } }
}

/** 부품들에 연결된 전선 id */
export function wiresOf(project: Project, instanceIds: readonly string[]): string[] {
  const set = new Set(instanceIds)
  const touches = (e: WireEnd) => { const id = endInstanceId(e); return id !== undefined && set.has(id) }
  return project.wires.filter((w) => touches(w.from) || touches(w.to)).map((w) => w.id)
}

// ---------------------------------------------------------------- BOM 편집 (단가·비고 수정, 직접 추가 항목)

/** 빈 BOM 정보는 파일에 남기지 않는다 */
function withBom(project: Project, bom: ProjectBom): Project {
  const next = { ...project }
  const clean: ProjectBom = {}
  if (bom.overrides && Object.keys(bom.overrides).length > 0) clean.overrides = bom.overrides
  if (bom.items && bom.items.length > 0) clean.items = bom.items
  if (bom.supplies && Object.keys(bom.supplies).length > 0) clean.supplies = bom.supplies
  if (bom.currency && bom.currency !== 'KRW') clean.currency = bom.currency
  if (bom.exchangeRate !== undefined) clean.exchangeRate = bom.exchangeRate
  if (Object.keys(clean).length > 0) next.bom = clean
  else delete next.bom
  return next
}

/** undefined나 빈 문자열인 필드를 뺀다 */
function compact<T extends object>(o: T): T {
  const out = { ...o }
  for (const k of Object.keys(out) as (keyof T)[]) {
    if (out[k] === undefined || out[k] === '') delete out[k]
  }
  return out
}

export type BomOverridePatch = { quantity?: number | null; unitPrice?: number | null; memo?: string | null; supplier?: string | null }

/** 배선도 부품 행의 수량·단가·비고·조달처. null은 지운다 (수량은 배치한 개수로, 단가는 부품 기본 단가로 돌아감) */
export function setBomOverride(project: Project, partId: string, patch: BomOverridePatch): Project {
  const overrides = { ...(project.bom?.overrides ?? {}) }
  const merged = { ...overrides[partId] } as BomOverride
  if (patch.quantity !== undefined) merged.quantity = patch.quantity ?? undefined
  if (patch.unitPrice !== undefined) merged.unitPrice = patch.unitPrice ?? undefined
  if (patch.memo !== undefined) merged.memo = patch.memo?.trim() || undefined
  if (patch.supplier !== undefined) merged.supplier = patch.supplier?.trim() || undefined
  const o = compact(merged)
  if (Object.keys(o).length > 0) overrides[partId] = o
  else delete overrides[partId]
  return withBom(project, { ...project.bom, overrides })
}

export function addBomItem(project: Project, item: BomItem): Project {
  return withBom(project, { ...project.bom, items: [...(project.bom?.items ?? []), compact(item)] })
}

export type BomItemPatch = Partial<Omit<BomItem, 'id'>>

export function updateBomItem(project: Project, id: string, patch: BomItemPatch): Project {
  const items = (project.bom?.items ?? []).map((it) => (it.id === id ? compact({ ...it, ...patch }) : it))
  return withBom(project, { ...project.bom, items })
}

export function removeBomItem(project: Project, id: string): Project {
  return withBom(project, { ...project.bom, items: (project.bom?.items ?? []).filter((it) => it.id !== id) })
}

/**
 * BOM 통화·환율 (029). 통화가 바뀌면 배선도 안의 모든 단가(부품 사본, BOM 수정값, 직접 추가 항목)를 환율로 환산한다.
 * rate = 1 USD의 원화 값, 0보다 커야 한다 (아니면 그대로). 실행 취소 1회
 */
export function setBomCurrency(project: Project, currency: Currency, rate: number): Project {
  if (!(Number.isFinite(rate) && rate > 0)) return project
  const from = projectCurrency(project)
  const bom: ProjectBom = { ...project.bom, currency, exchangeRate: rate }
  if (from === currency) {
    return project.bom?.exchangeRate === rate ? project : withBom(project, bom)
  }
  const conv = (v: number) => convertMoney(v, from, currency, rate)!
  // 사본은 모두 배선도 통화(from)로 되어 있다
  const parts = Object.fromEntries(Object.entries(project.parts).map(([id, p]) => [id, withCurrency(p, currency, rate)]))
  if (project.bom?.overrides) {
    bom.overrides = Object.fromEntries(
      Object.entries(project.bom.overrides).map(([k, o]) => [k, o.unitPrice === undefined ? o : { ...o, unitPrice: conv(o.unitPrice) }])
    )
  }
  if (project.bom?.items) {
    bom.items = project.bom.items.map((it) => (it.unitPrice === undefined ? it : { ...it, unitPrice: conv(it.unitPrice) }))
  }
  if (project.bom?.supplies) {
    bom.supplies = Object.fromEntries(
      Object.entries(project.bom.supplies).map(([k, c]) => [k, c.unitPrice === undefined ? c : { ...c, unitPrice: conv(c.unitPrice) }])
    )
  }
  const next: Project = { ...project, parts }
  if (project.supplies) {
    next.supplies = Object.fromEntries(Object.entries(project.supplies).map(([id, s]) => [id, withCurrency(s, currency, rate)]))
  }
  return withBom(next, bom)
}

// ---------------------------------------------------------------- 접속점 (전선 중간 분기)

/** 접속점 목록을 바꾼다. 비면 필드를 지운다 */
function withJunctions(project: Project, junctions: Junction[]): Project {
  const next = { ...project }
  if (junctions.length > 0) next.junctions = junctions
  else delete next.junctions
  return next
}

/** SP1, SP2 … 중 다음 이름 (빈 번호는 채우지 않음) */
export function nextJunctionLabel(project: Project): string {
  let max = 0
  for (const j of project.junctions ?? []) {
    const m = /^SP(\d+)$/.exec(j.label)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `SP${max + 1}`
}

export function moveJunction(project: Project, junctionId: string, p: Point): Project {
  if (!project.junctions?.some((j) => j.id === junctionId)) return project
  return withJunctions(project, project.junctions.map((j) => (j.id === junctionId ? { ...j, x: p.x, y: p.y } : j)))
}

/** 전선을 거꾸로 (from ↔ to, 꺾임점 순서도 뒤집음) */
function reverseWire(w: Wire): Wire {
  const r: Wire = { ...w, from: w.to, to: w.from }
  if (w.points) r.points = [...w.points].reverse()
  return r
}

/**
 * 접속점 정리: 연결된 전선이 2개면 다시 한 전선으로 합치고(접속점 위치는 꺾임점으로),
 * 1개 이하면 접속점과 매달린 전선을 지운다. 바뀐 게 없으면 같은 객체.
 */
export function cleanupJunctions(project: Project): Project {
  let next = project
  for (let guard = 0; guard < 1000; guard++) {
    const target = (next.junctions ?? []).find((j) => {
      const n = next.wires.filter((w) => endJunctionId(w.from) === j.id || endJunctionId(w.to) === j.id).length
      return n < 3
    })
    if (!target) return next
    const at = (e: WireEnd) => endJunctionId(e) === target.id
    const attached = next.wires.filter((w) => at(w.from) || at(w.to))
    let wires = next.wires.filter((w) => !attached.includes(w))
    if (attached.length === 2) {
      const a = at(attached[0].to) ? attached[0] : reverseWire(attached[0]) // a: x → J
      const b = at(attached[1].from) ? attached[1] : reverseWire(attached[1]) // b: J → y
      if (!sameEnd(a.from, b.to)) {
        const merged = applyWirePatch(
          { ...a, to: b.to, label: a.label ?? b.label },
          { points: [...(a.points ?? []), { x: target.x, y: target.y }, ...(b.points ?? [])] }
        )
        wires = [...wires, merged]
      }
    }
    next = withJunctions({ ...next, wires }, (next.junctions ?? []).filter((j) => j.id !== target.id))
    if (attached.length === 2) next = tidyWires(next, [attached[0].id])
  }
  return next
}

/**
 * 전선을 point에서 둘로 나누고 그 자리에 접속점을 만든다.
 * point는 실제로 그려지는 경로(직각 자동 꺾임 포함) 위로 옮겨진다.
 * 앞쪽 전선은 원래 id, 뒤쪽 전선은 ids.wire2
 */
export function splitWire(
  project: Project,
  wireId: string,
  point: Point,
  ids: { junction: string; wire2: string }
): { project: Project; junctionId: string; axis: 'h' | 'v' | 'd' } | undefined {
  const w = project.wires.find((x) => x.id === wireId)
  if (!w) return undefined
  const a = endPosition(project, w.from)
  const b = endPosition(project, w.to)
  if (!a || !b) return undefined
  const path = wirePath(a, w.points, b, w.orthogonal)
  const { segment, point: at } = projectOnPath(path, point)
  const s0 = path[segment]
  const s1 = path[segment + 1]
  const axis = s0.y === s1.y ? 'h' : s0.x === s1.x ? 'v' : 'd'
  const junction: Junction = { id: ids.junction, x: at.x, y: at.y, label: nextJunctionLabel(project) }
  const ref = { junctionId: junction.id }
  // 그려지는 경로의 꼭짓점을 두 전선의 꺾임점으로 나눈다 (정리는 뒤에서 tidy가 한다)
  const first = applyWirePatch({ ...w, to: ref }, { points: path.slice(1, segment + 1) })
  const second = applyWirePatch({ ...w, id: ids.wire2, from: ref }, { points: path.slice(segment + 1, -1) })
  delete second.label // 라벨은 앞쪽 전선에만
  const wires = project.wires.flatMap((x) => (x.id === wireId ? [first, second] : [x]))
  let next = withJunctions({ ...project, wires }, [...(project.junctions ?? []), junction])
  next = tidyWires(next, [first.id, second.id])
  return { project: next, junctionId: junction.id, axis }
}

/** 전선을 그릴 때의 끝: 기존 핀·접속점, 또는 기존 전선 위의 한 점(그 자리에서 분기) */
export type WireTarget = WireEnd | { wireId: string; point: Point }

export const isSplitTarget = (t: WireTarget): t is { wireId: string; point: Point } => 'wireId' in t

/** 점에서 가장 가까운 전선 (후보 중) */
function nearestWire(project: Project, ids: readonly string[], p: Point): string | undefined {
  let best: { id: string; d: number } | undefined
  for (const id of ids) {
    const w = project.wires.find((x) => x.id === id)
    const a = w && endPosition(project, w.from)
    const b = w && endPosition(project, w.to)
    if (!w || !a || !b) continue
    const q = projectOnPath(wirePath(a, w.points, b, w.orthogonal), p).point
    const d = Math.hypot(q.x - p.x, q.y - p.y)
    if (!best || d < best.d) best = { id, d }
  }
  return best?.id
}

/**
 * 두 끝을 잇는다. 끝이 "전선 위의 점"이면 먼저 그 전선을 나눠 접속점을 만든다.
 * 전부 한 번의 연산 → 실행 취소 1회. 연결이 거부되면 아무것도 바꾸지 않는다.
 */
export function connectEnds(
  project: Project,
  from: WireTarget,
  to: WireTarget,
  style: Omit<Wire, 'id' | 'from' | 'to'>,
  newId: () => string
): ConnectResult & { wireId?: string } {
  let next = project
  const splitIds: Record<string, string[]> = {} // 원래 전선 id → 나뉜 뒤 전선 id들
  const axes: Record<string, 'h' | 'v' | 'd'> = {} // 새 접속점 → 나뉜 전선의 방향
  const resolve = (t: WireTarget): WireEnd | undefined => {
    if (!isSplitTarget(t)) return t
    const candidates = splitIds[t.wireId] ?? [t.wireId]
    const wireId = candidates.length === 1 ? candidates[0] : nearestWire(next, candidates, t.point)
    if (!wireId) return undefined
    const wire2 = newId()
    const r = splitWire(next, wireId, t.point, { junction: newId(), wire2 })
    if (!r) return undefined
    splitIds[t.wireId] = [...candidates, wire2]
    next = r.project
    axes[r.junctionId] = r.axis
    return { junctionId: r.junctionId }
  }
  const a = resolve(from)
  const b = resolve(to)
  if (!a || !b) return { ok: false, error: 'unknown-pin' }
  const wireId = newId()
  const points = style.orthogonal ? perpendicularBranch(next, a, b, style.points ?? [], axes) : style.points
  const r = connect(next, { ...style, ...(points && points.length ? { points } : {}), id: wireId, from: a, to: b } as Wire)
  if (!r.ok) return r
  return { ok: true, project: tidyWires(r.project, [wireId]), wireId }
}

/**
 * 직각 전선이 접속점에서 갈라질 때 원래 전선과 겹치지 않게, 원래 전선에 수직으로 나가고 들어오도록 꺾임점을 더한다.
 * 기본 직각 경로는 "가로 먼저"라서
 * - 가로 전선에서 나갈 때: 처음에 세로로 나가도록 (J.x, 다음 점.y)를 앞에
 * - 세로 전선으로 들어올 때: 마지막에 가로로 들어오도록 (이전 점.x, J.y)를 뒤에
 */
function perpendicularBranch(
  project: Project,
  from: WireEnd,
  to: WireEnd,
  points: readonly Point[],
  axes: Record<string, 'h' | 'v' | 'd'>
): Point[] {
  const a = endPosition(project, from)
  const b = endPosition(project, to)
  if (!a || !b) return [...points]
  let pts = [...points]
  const fj = endJunctionId(from)
  if (fj && axes[fj] === 'h') {
    const next = pts[0] ?? b
    if (next.y !== a.y) pts = [{ x: a.x, y: next.y }, ...pts]
  }
  const tj = endJunctionId(to)
  if (tj && axes[tj] === 'v') {
    const prev = pts[pts.length - 1] ?? a
    if (prev.x !== b.x) pts = [...pts, { x: prev.x, y: b.y }]
  }
  return pts
}
