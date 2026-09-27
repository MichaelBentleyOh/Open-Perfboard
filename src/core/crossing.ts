// 전선 교차 점프 표시. 연결되지 않은 전선이 교차하는 곳에서 한쪽이 반원으로 넘어간다.
import type { Point } from './geometry'

/** 점프 반원의 반지름 (월드 단위) */
export const HOP_RADIUS = 6
const EPS = 1e-9

export interface WirePathInfo {
  id: string
  path: readonly Point[]
}

/** 경로의 segment번째 구간 위 point에서 점프 */
export interface Hop {
  segment: number
  point: Point
}

const isHorizontal = (a: Point, b: Point) => Math.abs(a.y - b.y) < EPS && Math.abs(a.x - b.x) > EPS
const isVertical = (a: Point, b: Point) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) > EPS
const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y)

/** 두 선분이 "가운데에서" 교차하면 교차점. 끝점에서 만나는 T자·꺾임, 평행은 제외 */
function crossPoint(a: Point, b: Point, c: Point, d: Point, margin: number): Point | undefined {
  const r = { x: b.x - a.x, y: b.y - a.y }
  const s = { x: d.x - c.x, y: d.y - c.y }
  const denom = r.x * s.y - r.y * s.x
  if (Math.abs(denom) < EPS) return undefined // 평행
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return undefined
  const p = { x: a.x + r.x * t, y: a.y + r.y * t }
  // 반원이 들어갈 자리가 없을 만큼 끝점(핀·꺾임·접속점)에 가까우면 점프하지 않는다
  if ([a, b, c, d].some((q) => dist(p, q) < margin)) return undefined
  return p
}

/**
 * 전선들의 교차점을 찾아 전선별 점프 목록을 돌려준다.
 * 가로-세로 교차는 가로선이, 그 밖에는 목록에서 뒤에 있는 전선이 점프한다.
 */
export function findCrossings(wires: readonly WirePathInfo[], r = HOP_RADIUS): Record<string, Hop[]> {
  const hops: Record<string, Hop[]> = {}
  const add = (id: string, hop: Hop) => {
    const list = (hops[id] ??= [])
    // 같은 구간에서 너무 가까운 점프는 하나만
    if (list.some((h) => h.segment === hop.segment && dist(h.point, hop.point) < r * 2)) return
    list.push(hop)
  }
  // 모든 쌍을 비교하면 전선 수의 제곱으로 느려진다 → 가까이 있는(같은 칸에 걸친) 구간끼리만 비교
  const found: { i: number; j: number; s: number; k: number; p: Point }[] = []
  for (const [a, b] of nearbySegmentPairs(wires)) {
    const pa = wires[a.wire].path
    const pb = wires[b.wire].path
    const p = crossPoint(pa[a.seg], pa[a.seg + 1], pb[b.seg], pb[b.seg + 1], r)
    if (p) found.push({ i: a.wire, s: a.seg, j: b.wire, k: b.seg, p })
  }
  // 점프를 고르는 순서(겹치는 점프 하나만 남기기)가 결과를 바꾸므로 전선·구간 순서대로
  found.sort((x, y) => x.i - y.i || x.j - y.j || x.s - y.s || x.k - y.k)
  for (const { i, j, s, k, p } of found) {
    const pa = wires[i].path
    const pb = wires[j].path
    const iHorizontal = isHorizontal(pa[s], pa[s + 1]) && isVertical(pb[k], pb[k + 1])
    if (iHorizontal) add(wires[i].id, { segment: s, point: p })
    else add(wires[j].id, { segment: k, point: p })
  }
  return hops
}

/** 공간 격자 칸 크기 (월드 단위) */
const CELL = 100

interface SegRef {
  wire: number
  seg: number
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * 경계 상자가 겹치는 (서로 다른 전선의) 구간 쌍. a.wire < b.wire.
 * 칸마다 구간을 모아 같은 칸 안에서만 비교하고, 두 상자가 겹치는 영역의 왼쪽 위 칸에서만 내보내 중복을 없앤다.
 */
function* nearbySegmentPairs(wires: readonly WirePathInfo[]): Generator<[SegRef, SegRef]> {
  // 칸 (cx, cy) → 숫자 열쇠 (좌표 ±30억 안에서 겹치지 않음)
  const cells = new Map<number, { cx: number; cy: number; list: SegRef[] }>()
  const cell = (v: number) => Math.floor(v / CELL)
  wires.forEach((w, wire) => {
    for (let seg = 0; seg < w.path.length - 1; seg++) {
      const p = w.path[seg]
      const q = w.path[seg + 1]
      const ref: SegRef = { wire, seg, x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) }
      for (let cx = cell(ref.x0); cx <= cell(ref.x1); cx++) {
        for (let cy = cell(ref.y0); cy <= cell(ref.y1); cy++) {
          const key = cx * 67_108_864 + cy
          const c = cells.get(key)
          if (c) c.list.push(ref)
          else cells.set(key, { cx, cy, list: [ref] })
        }
      }
    }
  })
  for (const { cx, cy, list } of cells.values()) {
    for (let m = 0; m < list.length; m++) {
      for (let n = m + 1; n < list.length; n++) {
        const a = list[m]
        const b = list[n]
        if (a.wire === b.wire) continue
        const ox = Math.max(a.x0, b.x0)
        const oy = Math.max(a.y0, b.y0)
        if (ox > Math.min(a.x1, b.x1) || oy > Math.min(a.y1, b.y1)) continue // 상자가 겹치지 않음
        if (cell(ox) !== cx || cell(oy) !== cy) continue // 다른 칸에서 이미 내보냄
        yield a.wire < b.wire ? [a, b] : [b, a]
      }
    }
  }
}

export type DrawOp =
  | { kind: 'move'; p: Point }
  | { kind: 'line'; p: Point }
  /** 캔버스 arc: 각도는 라디안, anticlockwise는 canvas와 같은 뜻 */
  | { kind: 'arc'; center: Point; r: number; start: number; end: number; anticlockwise: boolean }

/**
 * 점프를 넣은 그리기 명령. 반원은 가로선이면 위로, 세로선이면 오른쪽으로 볼록하다.
 */
export function hopDrawOps(path: readonly Point[], hops: readonly Hop[] = [], r = HOP_RADIUS): DrawOp[] {
  if (path.length === 0) return []
  const ops: DrawOp[] = [{ kind: 'move', p: path[0] }]
  for (let s = 0; s < path.length - 1; s++) {
    const a = path[s]
    const b = path[s + 1]
    const theta = Math.atan2(b.y - a.y, b.x - a.x)
    const dir = { x: Math.cos(theta), y: Math.sin(theta) }
    const onSeg = hops
      .filter((h) => h.segment === s)
      .map((h) => ({ h, t: (h.point.x - a.x) * dir.x + (h.point.y - a.y) * dir.y }))
      .sort((x, y) => x.t - y.t)
    // 볼록한 쪽: 가로에 가까우면 위(-y), 세로에 가까우면 오른쪽(+x)
    const prefer = Math.abs(dir.x) >= Math.abs(dir.y) ? { x: 0, y: -1 } : { x: 1, y: 0 }
    // 시계 방향(anticlockwise=false)이면 반원 가운데 각도 = θ + 3π/2
    const cwMid = { x: Math.cos(theta + (3 * Math.PI) / 2), y: Math.sin(theta + (3 * Math.PI) / 2) }
    const anticlockwise = cwMid.x * prefer.x + cwMid.y * prefer.y < 0
    for (const { h } of onSeg) {
      ops.push({ kind: 'line', p: { x: h.point.x - dir.x * r, y: h.point.y - dir.y * r } })
      ops.push({ kind: 'arc', center: h.point, r, start: theta + Math.PI, end: theta, anticlockwise })
    }
    ops.push({ kind: 'line', p: b })
  }
  return ops
}
