// 캔버스 위 마지막 마우스 위치 (월드 좌표). 붙여넣기 위치에 쓴다. CanvasView가 등록한다.
import type { Point } from '@core/geometry'

let getter: () => Point | null = () => null

export function registerCanvasPointer(fn: (() => Point | null) | null): void {
  getter = fn ?? (() => null)
}

/** 마우스가 지금 캔버스 위에 있으면 그 위치, 아니면 null */
export const getCanvasPointer = (): Point | null => getter()
