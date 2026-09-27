// 캔버스 배율 조작 (입력칸·단축키에서 호출). CanvasView가 구현을 등록한다.
export interface CanvasZoom {
  /** 캔버스 가운데를 기준으로 배율을 정한다 (범위 밖이면 맞춰짐) */
  setZoom: (scale: number) => void
  /** 정해진 단계로 한 칸 확대(+1)/축소(-1) */
  step: (dir: 1 | -1) => void
  /** 모든 내용이 보이게 맞춘다. 비어 있으면 100% */
  fit: () => void
}

let current: CanvasZoom | null = null

export function registerCanvasZoom(z: CanvasZoom | null): void {
  current = z
}

export const canvasZoom = (): CanvasZoom | null => current
