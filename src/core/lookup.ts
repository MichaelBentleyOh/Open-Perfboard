// id → 항목 색인. core는 배열을 바꾸지 않고 새 배열을 만들므로, 같은 배열이면 색인을 한 번만 만들어 다시 쓴다.
const cache = new WeakMap<readonly { id: string }[], Map<string, { id: string }>>()

/** 배열의 id 색인 (배열마다 한 번만 만든다). 배열을 제자리에서 바꾸면 안 된다 */
export function byId<T extends { id: string }>(list: readonly T[]): ReadonlyMap<string, T> {
  let map = cache.get(list)
  if (!map) {
    map = new Map(list.map((x) => [x.id, x]))
    cache.set(list, map)
  }
  return map as Map<string, T>
}

/** 공간 색인: 칸(size × size) → 항목 목록. 넓은 항목은 걸친 칸마다 들어간다. 가까운 것만 찾을 때 쓴다 */
export class CellIndex<T> {
  private cells = new Map<number, T[]>()
  constructor(private readonly size: number) {}
  private cell(v: number): number {
    return Math.floor(v / this.size)
  }
  /** 칸 (cx, cy) → 숫자 열쇠 (좌표 ±30억 안에서 겹치지 않음) */
  private static key = (cx: number, cy: number) => cx * 67_108_864 + cy
  add(item: T, x0: number, y0: number, x1: number, y1: number): void {
    for (let cx = this.cell(x0); cx <= this.cell(x1); cx++) {
      for (let cy = this.cell(y0); cy <= this.cell(y1); cy++) {
        const k = CellIndex.key(cx, cy)
        const list = this.cells.get(k)
        if (list) list.push(item)
        else this.cells.set(k, [item])
      }
    }
  }
  /** 점이 든 칸의 항목 */
  at(x: number, y: number): readonly T[] | undefined {
    return this.cells.get(CellIndex.key(this.cell(x), this.cell(y)))
  }
  /** 사각형에 걸친 칸들의 항목 (중복 없이) */
  inRect(x0: number, y0: number, x1: number, y1: number): Set<T> {
    const out = new Set<T>()
    for (let cx = this.cell(x0); cx <= this.cell(x1); cx++) {
      for (let cy = this.cell(y0); cy <= this.cell(y1); cy++) {
        for (const item of this.cells.get(CellIndex.key(cx, cy)) ?? []) out.add(item)
      }
    }
    return out
  }
}
