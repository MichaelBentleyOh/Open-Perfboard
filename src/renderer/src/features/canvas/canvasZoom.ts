import { useUiStore } from '@/stores/uiStore'

// 캔버스 배율 조작 (입력칸·단축키에서 호출). CanvasView가 구현을 등록한다.
export interface CanvasZoom {
  /** 캔버스 가운데를 기준으로 배율을 정한다 (범위 밖이면 맞춰짐) */
  setZoom: (scale: number) => void
  /** 정해진 단계로 한 칸 확대(+1)/축소(-1) */
  step: (dir: 1 | -1) => void
  /** 모든 내용이 보이게 맞춘다. 비어 있으면 100% */
  fit: () => void
  /** 지금 화면 가운데의 월드 좌표 (새 글 상자 위치 등) */
  center: () => { x: number; y: number }
  /** 이 월드 좌표가 화면 가운데에 오게 옮긴다 (검색 결과로 가기). 배율이 너무 작으면 100%로 */
  centerOn: (p: { x: number; y: number }) => void
}

/** 배선도 캔버스와 회로도(039)가 따로 등록한다. 단축키·배율 칸은 지금 보기의 것을 쓴다 */
export type ZoomSlot = 'diagram' | 'schematic'
const slots: Record<ZoomSlot, CanvasZoom | null> = { diagram: null, schematic: null }

export function registerCanvasZoom(z: CanvasZoom | null, slot: ZoomSlot = 'diagram'): void {
  slots[slot] = z
}

export const canvasZoom = (): CanvasZoom | null => slots[useUiStore.getState().view === 'schematic' ? 'schematic' : 'diagram']
