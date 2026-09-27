// 전선 경로 계산. 전선 = 시작 핀 → 꺾임점들 → 끝 핀
import type { Point } from './geometry'

/** 꺾임점 격자 간격 (월드 단위) */
export const BEND_SNAP = 10

/** 격자에 맞춘다. -0은 0으로 (저장·비교가 깔끔하도록) */
export function snapPoint(p: Point, step = BEND_SNAP): Point {
  const snap = (v: number) => Math.round(v / step) * step + 0
  return { x: snap(p.x), y: snap(p.y) }
}

/**
 * 화면에 그릴 꼭짓점 목록 (시작 핀, 꺾임점들, 끝 핀 포함).
 * 직각이면 두 점이 가로·세로 어느 쪽으로도 맞지 않을 때 "가로 먼저" 꺾는 점을 넣는다.
 */
export function wirePath(a: Point, points: readonly Point[] = [], b: Point, orthogonal = false): Point[] {
  const nodes = [a, ...points, b]
  if (!orthogonal) return nodes
  const out: Point[] = [nodes[0]]
  for (let i = 1; i < nodes.length; i++) {
    const p = out[out.length - 1]
    const q = nodes[i]
    if (p.x !== q.x && p.y !== q.y) out.push({ x: q.x, y: p.y })
    out.push(q)
  }
  return out
}

/** Konva Line용 [x0, y0, x1, y1, ...] */
export const flatten = (path: readonly Point[]): number[] => path.flatMap((p) => [p.x, p.y])

const dist = (p: Point, q: Point) => Math.hypot(q.x - p.x, q.y - p.y)

/** 경로 길이의 절반 지점 (라벨 위치) */
export function pathMidpoint(path: readonly Point[]): Point {
  if (path.length === 1) return path[0]
  const total = path.slice(1).reduce((s, q, i) => s + dist(path[i], q), 0)
  let left = total / 2
  for (let i = 1; i < path.length; i++) {
    const d = dist(path[i - 1], path[i])
    if (left <= d && d > 0) {
      const t = left / d
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t }
    }
    left -= d
  }
  return path[path.length - 1]
}

/** 점에서 선분까지 거리 */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return dist(p, { x: a.x + dx * t, y: a.y + dy * t })
}

/**
 * 꺾임점을 넣을 위치. nodes = [시작 핀, 꺾임점들, 끝 핀]일 때 p에 가장 가까운 구간 번호.
 * 반환값 i는 꺾임점 배열에 넣을 인덱스 (구간 nodes[i]–nodes[i+1] 사이)
 */
export function nearestSegment(nodes: readonly Point[], p: Point): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < nodes.length - 1; i++) {
    const d = segmentDistance(p, nodes[i], nodes[i + 1])
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

// ---------------------------------------------------------------- 자동 정리 (매끄럽지 않은 꺾임 제거)

/** 이보다 짧은 계단·지그재그 구간은 없앤다 (월드 단위, 격자 3칸) */
export const JOG_MAX = 30
/** 직선 모드: 이보다 가까운 점은 겹친 것으로 본다 */
const TINY = 5
/** 직선 모드: 이보다 선에 가까우면 일직선 위의 점으로 본다 */
const COLLINEAR_TOL = 1.5
const EPS = 1e-6

const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS
const samePath = (a: readonly Point[], b: readonly Point[]) => a.length === b.length && a.every((p, i) => same(p, b[i]))

/** 직각 경로: 겹친 점과 가로·세로 일직선 위의 가운데 점을 없앤다 (양 끝은 유지) */
function normalizeOrthogonal(nodes: readonly Point[]): Point[] {
  let out = [...nodes]
  let changed = true
  while (changed) {
    changed = false
    const next: Point[] = [out[0]]
    for (let i = 1; i < out.length; i++) {
      const q = out[i]
      if (same(next[next.length - 1], q) && i < out.length - 1) {
        changed = true
        continue
      }
      next.push(q)
    }
    out = next
    for (let i = 1; i < out.length - 1; i++) {
      const [p, q, r] = [out[i - 1], out[i], out[i + 1]]
      const vertical = Math.abs(p.x - q.x) < EPS && Math.abs(q.x - r.x) < EPS
      const horizontal = Math.abs(p.y - q.y) < EPS && Math.abs(q.y - r.y) < EPS
      if (vertical || horizontal || same(p, q)) {
        out.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return out
}

type Dir = { axis: 'x' | 'y'; sign: number }

/** 가로·세로 구간의 방향 (축과 부호) */
function dirOf(p: Point, q: Point): Dir {
  return Math.abs(q.x - p.x) > EPS ? { axis: 'x', sign: Math.sign(q.x - p.x) } : { axis: 'y', sign: Math.sign(q.y - p.y) }
}
const sameDir = (a: Dir, b: Dir) => a.axis === b.axis && a.sign === b.sign

/**
 * 매끄럽지 않은 구간을 없앤다. 대상 구간 i(양 끝이 모두 꺾는 점)를 이웃한 평행 구간을 밀어 길이 0으로 만든다.
 * - 짧은 구간(JOG_MAX 미만): 계단의 한 단, 지그재그
 * - 단조 계단(→↓→↓ 처럼 같은 방향으로만 가는 계단): 길이와 상관없이 하나의 ㄱ/ㄴ자로.
 *   가로·세로 이동 거리의 합이 그대로라 경로가 길어지지 않는다. 위로 갔다 돌아오는 우회로는 단조가 아니라 남는다.
 * 핀(경로의 첫·마지막 점)은 움직이지 않는다.
 */
function removeJogs(nodes: readonly Point[]): Point[] {
  let out = normalizeOrthogonal(nodes)
  for (let guard = 0; guard < 200; guard++) {
    const last = out.length - 1
    const seg = (k: number) => dirOf(out[k], out[k + 1])
    type Candidate = { i: number; mode: 'after' | 'before'; rank: number }
    const candidates: Candidate[] = []
    for (let i = 1; i + 1 <= last - 1; i++) {
      const len = Math.abs(out[i + 1].x - out[i].x) + Math.abs(out[i + 1].y - out[i].y)
      if (len < EPS) continue
      const canAfter = i + 2 <= last - 1 // 뒤쪽 평행 구간의 끝이 꺾는 점이라 밀 수 있다
      const canBefore = i - 1 >= 1
      const stair = sameDir(seg(i - 1), seg(i + 1))
      const monoAfter = canAfter && stair && sameDir(seg(i), seg(i + 2))
      const monoBefore = canBefore && stair && i - 2 >= 0 && sameDir(seg(i), seg(i - 2))
      if (len < JOG_MAX && (canAfter || canBefore)) candidates.push({ i, mode: canAfter ? 'after' : 'before', rank: len })
      else if (monoAfter) candidates.push({ i, mode: 'after', rank: JOG_MAX + len })
      else if (monoBefore) candidates.push({ i, mode: 'before', rank: JOG_MAX + len })
    }
    if (candidates.length === 0) break
    candidates.sort((a, b) => a.rank - b.rank)
    const { i, mode } = candidates[0]
    const axis = Math.abs(out[i].x - out[i + 1].x) < EPS ? 'y' : 'x' // 세로 구간이면 y를 맞춘다
    const next = out.map((p) => ({ ...p }))
    if (mode === 'after') {
      // 뒤쪽 평행 구간을 앞쪽 높이로 민다
      next[i + 1] = { ...next[i] }
      next[i + 2][axis] = next[i][axis]
    } else {
      // 앞쪽 평행 구간을 뒤쪽 높이로 민다
      next[i - 1][axis] = next[i + 1][axis]
      next[i] = { ...next[i + 1] }
    }
    out = normalizeOrthogonal(next)
  }
  return out
}

/** 직선 모드: 겹친 점, 거의 일직선 위의 점 제거 */
function simplifyStraight(nodes: readonly Point[]): Point[] {
  let out = [...nodes]
  let changed = true
  while (changed) {
    changed = false
    for (let i = 1; i < out.length - 1; i++) {
      const [p, q, r] = [out[i - 1], out[i], out[i + 1]]
      if (dist(p, q) < TINY || dist(q, r) < TINY || segmentDistance(q, p, r) < COLLINEAR_TOL) {
        out.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return out
}

/**
 * 꺾임점을 정리해 돌려준다. 결과 경로는 원래 경로와 같은 두 핀을 잇는다.
 * 직각이면 저장할 꺾임점을 최소로 줄인다 (wirePath가 자동으로 다시 넣는 꺾는 점은 저장하지 않음).
 */
export function simplifyBends(a: Point, points: readonly Point[], b: Point, orthogonal = false): Point[] {
  if (!orthogonal) return simplifyStraight([a, ...points, b]).slice(1, -1)

  return minimalOrthogonalPoints(a, removeJogs(wirePath(a, points, b, true)), b)
}

/**
 * 직각 경로(양 끝 포함)를 그대로 그리게 하는 가장 적은 꺾임점.
 * wirePath가 "가로 먼저"로 다시 넣어 주는 꺾는 점은 저장하지 않는다.
 */
export function minimalOrthogonalPoints(a: Point, path: readonly Point[], b: Point): Point[] {
  const target = normalizeOrthogonal(path)
  const shape = (pts: readonly Point[]) => normalizeOrthogonal(wirePath(a, pts, b, true))
  let pts = target.slice(1, -1)
  // 빼도 모양이 같으면 저장하지 않는다
  for (let i = pts.length - 1; i >= 0; i--) {
    const without = [...pts.slice(0, i), ...pts.slice(i + 1)]
    if (samePath(shape(without), target)) pts = without
  }
  return pts.map((p) => ({ x: p.x, y: p.y }))
}

// ---------------------------------------------------------------- 경로 위의 점 (분기 위치)

/**
 * 경로에서 p에 가장 가까운 점과 그 구간 번호.
 * 가로·세로 구간이면 그 선 위에서 10단위 격자에 맞춘다 (구간 밖으로는 나가지 않음)
 */
export function projectOnPath(path: readonly Point[], p: Point): { segment: number; point: Point } {
  let best = { segment: 0, point: path[0], d: Infinity }
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    let q = { x: a.x + dx * t, y: a.y + dy * t }
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi))
    if (dy === 0 && dx !== 0) q = { x: clamp(Math.round(q.x / BEND_SNAP) * BEND_SNAP, a.x, b.x), y: a.y }
    else if (dx === 0 && dy !== 0) q = { x: a.x, y: clamp(Math.round(q.y / BEND_SNAP) * BEND_SNAP, a.y, b.y) }
    const d = dist(p, q)
    if (d < best.d) best = { segment: i, point: q, d }
  }
  return { segment: best.segment, point: best.point }
}
