// 배선 자동 정리(자동 경로). 격자 위 A* 탐색으로 직각 경로를 찾는다.
// 부품 둘레는 "비싼 곳", 부품 사진 안쪽은 지나갈 수 없다. 앞서 정리한 전선과 같은 줄에 겹치면 큰 벌점, 꺾을 때마다 벌점.
// 끝점 핀은 자기 부품 사진 안에 있으므로, 자기 부품 안에서는 핀에서 곧게 빠져나가는 길(탈출)과 핀으로 곧게 들어오는 길만 쓴다.
import type { Point, Rect } from './geometry'
import { CellIndex } from './lookup'

export interface RouteObstacle {
  /** 피하는 영역 (지나면 비싸다) */
  rect: Rect
  /** 부품 배치 id (끝점이 이 부품의 핀이면 둘레 벌점을 줄인다) */
  owner?: string
  /** 지나갈 수 없는 영역 (부품 사진). 끝점이 이 부품의 핀이면 그 핀에서 곧게 드나드는 길만 허락한다 */
  hard?: Rect
}

export interface RouteRequest {
  id: string
  a: Point
  b: Point
  /** a가 핀이면 그 부품 배치 id */
  aOwner?: string
  /** b가 핀이면 그 부품 배치 id */
  bOwner?: string
}

export interface RouteOptions {
  /** 격자 간격 */
  step: number
  /** 꺾을 때마다 더하는 비용 (월드 단위 길이로 환산) */
  bendCost: number
  /** 남의 부품 사진 위를 지날 때 길이 배수 */
  partFactor: number
  /** 자기 부품 사진 위를 지날 때 길이 배수 (핀에서 사진 밖으로 나가는 길) */
  ownPartFactor: number
  /** 다른 전선과 같은 줄에 겹칠 때 길이에 더하는 배수 */
  overlapFactor: number
  /** 다른 전선을 가로지를 때 더하는 비용 */
  crossCost: number
  /** 부품 사진 둘레에 두는 여유 */
  margin: number
  /** 끝점이 아닌 핀·접속점 가까이(pinClear 이내)를 지날 때 더하는 비용. 지나가면 이어진 것처럼 보인다 */
  pinCost: number
  pinClear: number
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
  step: 10,
  bendCost: 40,
  partFactor: 8,
  ownPartFactor: 2,
  overlapFactor: 12,
  crossCost: 12,
  margin: 14,
  pinCost: 600,
  pinClear: 8
}

/** 배선도 둘레 여유 */
const PAD = 80
/** 전선 하나를 찾을 때 두 끝을 감싼 상자 둘레로 더 보는 범위 (부품 하나를 돌아갈 만큼) */
const WINDOW_PAD = 150
/** 부품 색인 칸 크기 */
const OBSTACLE_CELL = 200

const uniqSorted = (v: number[]) => [...new Set(v)].sort((p, q) => p - q)

/** 격자선 목록: 간격마다 한 줄 + 꼭 지나야 하는 좌표(핀 등) */
function gridLines(lo: number, hi: number, step: number, extra: readonly number[]): number[] {
  const out: number[] = [...extra]
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step; v += step) out.push(v + 0)
  return uniqSorted(out)
}

/** 정렬된 배열에서 v 이상인 첫 위치 */
function lowerBound(a: readonly number[], v: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 정렬된 배열에서 v보다 큰 첫 위치 */
function upperBound(a: readonly number[], v: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 최소 힙 (비용, 상태) */
class Heap {
  private f: number[] = []
  private s: number[] = []
  get size(): number {
    return this.f.length
  }
  push(f: number, s: number): void {
    const a = this.f
    const b = this.s
    a.push(f)
    b.push(s)
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p] <= a[i]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      ;[b[p], b[i]] = [b[i], b[p]]
      i = p
    }
  }
  pop(): number {
    const a = this.f
    const b = this.s
    const top = b[0]
    const lf = a.pop()!
    const ls = b.pop()!
    if (a.length > 0) {
      a[0] = lf
      b[0] = ls
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l] < a[m]) m = l
        if (r < a.length && a[r] < a[m]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        ;[b[m], b[i]] = [b[i], b[m]]
        i = m
      }
    }
    return top
  }
}

/** 일직선 위의 가운데 점과 겹친 점을 없앤다 */
export function compressPath(path: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of path) {
    const last = out[out.length - 1]
    if (last && last.x === p.x && last.y === p.y) continue
    if (out.length >= 2) {
      const q = out[out.length - 2]
      if ((q.x === last.x && last.x === p.x) || (q.y === last.y && last.y === p.y)) out.pop()
    }
    out.push(p)
  }
  return out
}

// 방향: 0 오른쪽, 1 왼쪽, 2 아래, 3 위, 4 출발(방향 없음)
const DX = [1, -1, 0, 0]
const DY = [0, 0, 1, -1]

/** 전선이 차지한 일직선 구간. 가로면 at = y, lo..hi = x 범위 (세로는 반대) */
interface Run {
  at: number
  lo: number
  hi: number
}

/**
 * 여러 전선의 직각 경로를 차례로 찾는다. 짧은 전선부터 정리하고, 앞 전선이 지나간 줄은 뒤 전선이 피한다.
 * fixed: 정리하지 않는 전선들의 현재 경로 (피할 대상)
 * avoid: 핀·접속점 위치. 자기 끝점이 아니면 그 위를 지나지 않는다
 * 반환: 전선 id → 양 끝점을 포함한 경로. 찾지 못한 전선은 빠진다.
 *
 * 배선도가 커져도 전선 하나에 드는 시간이 늘지 않도록, 전선마다 두 끝 주변(창)에 격자를 따로 만들어 탐색한다.
 * 부품·차지한 줄·핀은 칸 색인에 두고 창 안의 것만 꺼내 쓴다. 격자 간격은 배선도 크기와 상관없이 그대로다.
 */
export function routeAll(
  requests: readonly RouteRequest[],
  obstacles: readonly RouteObstacle[],
  fixed: readonly (readonly Point[])[] = [],
  avoid: readonly Point[] = [],
  options: Partial<RouteOptions> = {},
  /** 전선 하나를 끝낼 때마다 (끝낸 수, 전체 수) */
  onProgress?: (done: number, total: number) => void
): Record<string, Point[]> {
  const o = { ...DEFAULT_ROUTE_OPTIONS, ...options }
  if (requests.length === 0) return {}

  // ---- 탐색할 수 있는 전체 범위 (창을 넓히다 여기에 닿으면 멈춘다)
  const lo = { x: Infinity, y: Infinity }
  const hi = { x: -Infinity, y: -Infinity }
  const extend = (x: number, y: number) => {
    lo.x = Math.min(lo.x, x)
    lo.y = Math.min(lo.y, y)
    hi.x = Math.max(hi.x, x)
    hi.y = Math.max(hi.y, y)
  }
  for (const r of requests) {
    extend(r.a.x, r.a.y)
    extend(r.b.x, r.b.y)
  }
  for (const path of fixed) for (const p of path) extend(p.x, p.y)
  for (const p of avoid) extend(p.x, p.y)
  for (const b of obstacles) {
    extend(b.rect.x, b.rect.y)
    extend(b.rect.x + b.rect.width, b.rect.y + b.rect.height)
  }
  lo.x -= PAD
  lo.y -= PAD
  hi.x += PAD
  hi.y += PAD

  // ---- 부품 사진(둘레 여유 포함)
  const inflated = obstacles.map((b) => ({
    x0: b.rect.x - o.margin,
    y0: b.rect.y - o.margin,
    x1: b.rect.x + b.rect.width + o.margin,
    y1: b.rect.y + b.rect.height + o.margin
  }))
  const obstacleIndex = new CellIndex<number>(OBSTACLE_CELL)
  inflated.forEach((r, k) => obstacleIndex.add(k, r.x0, r.y0, r.x1, r.y1))
  // 지나갈 수 없는 사진 영역
  const hardIndex = new CellIndex<number>(OBSTACLE_CELL)
  obstacles.forEach((b, k) => b.hard && hardIndex.add(k, b.hard.x, b.hard.y, b.hard.x + b.hard.width, b.hard.y + b.hard.height))
  const inside = (r: Rect, x: number, y: number) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height
  /**
   * 점이 어느 부품 사진 안쪽에 있나 (가장자리는 괜찮다). 비트: 1 남의 부품, 2 a의 부품, 4 b의 부품.
   * a·b가 같은 부품이면 2와 4가 함께
   */
  const hardAt = (x: number, y: number, aOwner?: string, bOwner?: string): number => {
    let bits = 0
    for (const k of hardIndex.at(x, y) ?? []) {
      const b = obstacles[k]
      if (!inside(b.hard!, x, y)) continue
      const mine = (b.owner !== undefined && b.owner === aOwner ? 2 : 0) | (b.owner !== undefined && b.owner === bOwner ? 4 : 0)
      bits |= mine || 1
    }
    return bits
  }
  /** 부품 배치의 사진 영역 */
  const hardOf = (owner?: string): Rect | undefined => (owner === undefined ? undefined : obstacles.find((b) => b.owner === owner && b.hard)?.hard)

  /** 점을 덮는 부품 번호 (여럿이면 가장 앞 번호), 없으면 -1 */
  const cover = (x: number, y: number): number => {
    let best = -1
    for (const k of obstacleIndex.at(x, y) ?? []) {
      const r = inflated[k]
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1 && (best < 0 || k < best)) best = k
    }
    return best
  }

  // ---- 이미 차지한 줄 (가로·세로 구간)
  const hRuns = new CellIndex<Run>(OBSTACLE_CELL)
  const vRuns = new CellIndex<Run>(OBSTACLE_CELL)
  const occupy = (path: readonly Point[]) => {
    for (let k = 0; k < path.length - 1; k++) {
      const p = path[k]
      const q = path[k + 1]
      if (p.y === q.y && p.x !== q.x) {
        const run = { at: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) }
        hRuns.add(run, run.lo, run.at, run.hi, run.at)
      } else if (p.x === q.x && p.y !== q.y) {
        const run = { at: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) }
        vRuns.add(run, run.at, run.lo, run.at, run.hi)
      }
    }
  }
  fixed.forEach(occupy)

  // ---- 핀·접속점
  const pinIndex = new CellIndex<Point>(OBSTACLE_CELL)
  for (const p of avoid) pinIndex.add(p, p.x, p.y, p.x, p.y)

  /** 창 [x0, x1] × [y0, y1] 안에서 한 전선 탐색 */
  const routeIn = (r: RouteRequest, x0: number, y0: number, x1: number, y1: number): Point[] | undefined => {
    const hr = [...hRuns.inRect(x0, y0, x1, y1)].filter((u) => u.at >= y0 && u.at <= y1 && u.hi >= x0 && u.lo <= x1)
    const vr = [...vRuns.inRect(x0, y0, x1, y1)].filter((u) => u.at >= x0 && u.at <= x1 && u.hi >= y0 && u.lo <= y1)
    const pins = [...pinIndex.inRect(x0 - o.pinClear, y0 - o.pinClear, x1 + o.pinClear, y1 + o.pinClear)]

    // 끝점 핀의 부품 사진: 그 안에서는 핀에서 곧게 드나드는 길만 (탈출·진입)
    const aRect = hardOf(r.aOwner)
    const bRect = hardOf(r.bOwner)
    const edgesX = [aRect, bRect].flatMap((q) => (q ? [q.x, q.x + q.width] : []))
    const edgesY = [aRect, bRect].flatMap((q) => (q ? [q.y, q.y + q.height] : []))

    // 창 안의 격자선: 간격마다 한 줄 + 두 끝 + 차지한 줄과 그 끝 + 끝점 부품의 가장자리 (탈출이 가장자리에서 딱 끝나게)
    const inX = (v: number) => v >= x0 && v <= x1
    const inY = (v: number) => v >= y0 && v <= y1
    const xs = gridLines(x0, x1, o.step, [r.a.x, r.b.x, ...edgesX, ...vr.map((u) => u.at), ...hr.flatMap((u) => [u.lo, u.hi])]).filter(inX)
    const ys = gridLines(y0, y1, o.step, [r.a.y, r.b.y, ...edgesY, ...hr.map((u) => u.at), ...vr.flatMap((u) => [u.lo, u.hi])]).filter(inY)
    const w = xs.length
    const h = ys.length
    const yi = new Map(ys.map((v, j) => [v, j]))
    const xi = new Map(xs.map((v, i) => [v, i]))
    const node = (i: number, j: number) => j * w + i

    // 간선을 덮는 부품, 격자점 정보 (탐색 중에는 배열만 읽는다)
    const own = new Set([r.aOwner, r.bOwner].filter((x): x is string => x !== undefined))
    const N = w * h
    const hObs = new Int32Array(N)
    const vObs = new Int32Array(N)
    /** 비트: 1 가로 간선 사용, 2 세로 간선 사용, 4 가로 전선이 지나는 점, 8 세로 전선이 지나는 점, 16 핀 근처,
     *  32 가로 간선 막힘, 64 세로 간선 막힘 (남의 부품 사진 안) */
    const flags = new Uint8Array(N)
    /** 끝점 부품 사진 안의 간선. 비트: 1 가로·a 부품, 2 세로·a 부품, 4 가로·b 부품, 8 세로·b 부품 */
    const mine = new Uint8Array(N)
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const n = node(i, j)
        if (i + 1 < w) {
          const mx = (xs[i] + xs[i + 1]) / 2
          hObs[n] = cover(mx, ys[j])
          const bits = hardAt(mx, ys[j], r.aOwner, r.bOwner)
          if (bits & 1) flags[n] |= 32
          mine[n] |= (bits & 2 ? 1 : 0) | (bits & 4 ? 4 : 0)
        } else hObs[n] = -1
        if (j + 1 < h) {
          const my = (ys[j] + ys[j + 1]) / 2
          vObs[n] = cover(xs[i], my)
          const bits = hardAt(xs[i], my, r.aOwner, r.bOwner)
          if (bits & 1) flags[n] |= 64
          mine[n] |= (bits & 2 ? 2 : 0) | (bits & 4 ? 8 : 0)
        } else vObs[n] = -1
      }
    }
    for (const u of hr) {
      const j = yi.get(u.at)!
      // xs[i] >= lo 이고 xs[i + 1] <= hi 인 칸
      const last = upperBound(xs, u.hi) - 2
      for (let i = lowerBound(xs, u.lo); i <= last; i++) {
        flags[node(i, j)] |= 1 | 4
        flags[node(i + 1, j)] |= 4
      }
    }
    for (const u of vr) {
      const i = xi.get(u.at)!
      const last = upperBound(ys, u.hi) - 2
      for (let j = lowerBound(ys, u.lo); j <= last; j++) {
        flags[node(i, j)] |= 2 | 8
        flags[node(i, j + 1)] |= 8
      }
    }
    /** 자기 끝점 근처는 핀 벌점을 받지 않는다 */
    const nearEnd = (x: number, y: number) => {
      const near = (p: Point) => Math.abs(x - p.x) <= o.pinClear && Math.abs(y - p.y) <= o.pinClear
      return near(r.a) || near(r.b)
    }
    for (const p of pins) {
      const i1 = upperBound(xs, p.x + o.pinClear)
      const j1 = upperBound(ys, p.y + o.pinClear)
      for (let j = lowerBound(ys, p.y - o.pinClear); j < j1; j++) {
        for (let i = lowerBound(xs, p.x - o.pinClear); i < i1; i++) if (!nearEnd(xs[i], ys[j])) flags[node(i, j)] |= 16
      }
    }

    const factorOf = (obs: number) => (obs < 0 ? 1 : own.has(obstacles[obs].owner ?? '\0') ? o.ownPartFactor : o.partFactor)
    /**
     * 남은 거리 + 꼭 필요한 꺾임 비용. 가로·세로가 모두 다르거나, 한 줄에 있어도 지금 방향이 목표 쪽이 아니면 한 번은 꺾어야 한다.
     * 실제 비용보다 크지 않고, 한 칸 갈 때 줄어드는 양이 그 칸의 비용보다 크지 않다 (최적 경로 보장)
     */
    const heuristic = (i: number, j: number, d: number) => {
      const dx = r.b.x - xs[i]
      const dy = r.b.y - ys[j]
      let bend = dx !== 0 && dy !== 0
      if (dx === 0 && dy !== 0) bend = d !== 4 && d !== (dy > 0 ? 2 : 3)
      if (dy === 0 && dx !== 0) bend = d !== 4 && d !== (dx > 0 ? 0 : 1)
      return Math.abs(dx) + Math.abs(dy) + (bend ? o.bendCost : 0)
    }

    /**
     * 끝점 부품 사진 안의 간선 (i, j) → (ni, nj)를 지날 수 있나. a에서 곧게 멀어지는 길(탈출)이나 b로 곧게 다가가는 길(진입)만.
     * 사진 안에서는 꺾지 않는다 → 부품을 가로지르거나 안에서 돌아다니지 않는다. bits = mine의 이 간선 비트
     */
    const ownEdgeOk = (bits: number, horizontal: boolean, i: number, j: number, ni: number, nj: number, d: number, nd: number): boolean => {
      const straight = d === 4 || d === nd
      const from = (p: Point) => (horizontal ? Math.abs(xs[i] - p.x) : Math.abs(ys[j] - p.y))
      const to = (p: Point) => (horizontal ? Math.abs(xs[ni] - p.x) : Math.abs(ys[nj] - p.y))
      const onRay = (p: Point) => (horizontal ? ys[j] === p.y : xs[i] === p.x)
      if (bits & (1 | 2) && straight && onRay(r.a) && to(r.a) > from(r.a)) return true
      // 진입은 사진 가장자리(또는 바깥)에서 꺾어 들어올 수 있다
      const turnOk = straight || !(bRect && inside(bRect, xs[i], ys[j]))
      return !!(bits & (4 | 8)) && turnOk && onRay(r.b) && to(r.b) < from(r.b)
    }

    // 상태 = 격자점 * 5 + 들어온 방향
    const cost = new Float64Array(N * 5).fill(Infinity)
    const prev = new Int32Array(N * 5).fill(-1)
    const done = new Uint8Array(N * 5)
    const start = node(xi.get(r.a.x)!, yi.get(r.a.y)!)
    const goal = node(xi.get(r.b.x)!, yi.get(r.b.y)!)
    const heap = new Heap()
    cost[start * 5 + 4] = 0
    heap.push(heuristic(start % w, Math.floor(start / w), 4), start * 5 + 4)
    let found = -1
    while (heap.size > 0) {
      const s = heap.pop()
      if (done[s]) continue
      done[s] = 1
      const n = Math.floor(s / 5)
      const d = s % 5
      if (n === goal) {
        found = s
        break
      }
      const i = n % w
      const j = Math.floor(n / w)
      for (let nd = 0; nd < 4; nd++) {
        if (d < 4 && nd === (d ^ 1)) continue // 되돌아가기 금지
        const ni = i + DX[nd]
        const nj = j + DY[nd]
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue
        const m = node(ni, nj)
        const horizontal = nd < 2
        const edge = horizontal ? (nd === 0 ? n : m) : nd === 2 ? n : m
        if (flags[edge] & (horizontal ? 32 : 64)) continue // 남의 부품 사진은 지나갈 수 없다
        const inOwn = mine[edge] & (horizontal ? 1 | 4 : 2 | 8)
        if (inOwn && !ownEdgeOk(inOwn, horizontal, i, j, ni, nj, d, nd)) continue // 자기 부품은 곧은 탈출·진입만
        const len = horizontal ? Math.abs(xs[ni] - xs[i]) : Math.abs(ys[nj] - ys[j])
        // 자기 부품 사진 안은 남의 부품 둘레만큼 비싸다 → 가장 짧은 탈출 쪽을 고른다
        let c = len * (inOwn ? o.partFactor : factorOf(horizontal ? hObs[edge] : vObs[edge]))
        if (flags[edge] & (horizontal ? 1 : 2)) c += len * o.overlapFactor
        if (m !== goal && flags[m] & (horizontal ? 8 : 4)) c += o.crossCost
        if (flags[m] & 16) c += o.pinCost
        if (d < 4 && d !== nd) c += o.bendCost
        const ns = m * 5 + nd
        const total = cost[s] + c
        if (total < cost[ns]) {
          cost[ns] = total
          prev[ns] = s
          heap.push(total + heuristic(ni, nj, nd), ns)
        }
      }
    }
    if (found < 0) return undefined
    const nodes: Point[] = []
    for (let s = found; s >= 0; s = prev[s]) {
      const n = Math.floor(s / 5)
      nodes.push({ x: xs[n % w], y: ys[Math.floor(n / w)] })
    }
    nodes.reverse()
    return compressPath(nodes)
  }

  /** 두 끝을 감싼 상자 + 여유 안에서 찾고, 못 찾으면 넓혀서 다시 (마지막엔 전체 범위) */
  const routeOne = (r: RouteRequest): Point[] | undefined => {
    if (r.a.x === r.b.x && r.a.y === r.b.y) return [r.a, r.b]
    for (let pad = WINDOW_PAD; ; pad *= 2) {
      const x0 = Math.max(lo.x, Math.min(r.a.x, r.b.x) - pad)
      const y0 = Math.max(lo.y, Math.min(r.a.y, r.b.y) - pad)
      const x1 = Math.min(hi.x, Math.max(r.a.x, r.b.x) + pad)
      const y1 = Math.min(hi.y, Math.max(r.a.y, r.b.y) + pad)
      const path = routeIn(r, x0, y0, x1, y1)
      if (path || (x0 === lo.x && y0 === lo.y && x1 === hi.x && y1 === hi.y)) return path
    }
  }

  // 짧은 전선부터
  const order = [...requests].sort(
    (p, q) => Math.abs(p.a.x - p.b.x) + Math.abs(p.a.y - p.b.y) - (Math.abs(q.a.x - q.b.x) + Math.abs(q.a.y - q.b.y))
  )
  const result: Record<string, Point[]> = {}
  order.forEach((r, k) => {
    const path = routeOne(r)
    if (path) {
      result[r.id] = path
      occupy(path)
    }
    onProgress?.(k + 1, order.length)
  })
  return result
}
