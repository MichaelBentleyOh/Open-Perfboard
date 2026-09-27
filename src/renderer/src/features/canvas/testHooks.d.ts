import type { Project } from '@core/model'

type ClientPoint = { x: number; y: number }

declare global {
  interface Window {
    /** E2E·디버깅용 읽기 전용 훅 (CanvasView가 등록) */
    __opbCanvas?: {
      getProject: () => Project
      getSelection: () => { instances: string[]; wires: string[]; junctions: string[] }
      /** 핀의 화면(client) 좌표 */
      pinClientPosition: (instanceId: string, pinId: string) => ClientPoint | null
      /** 월드 좌표 → 화면(client) 좌표 */
      worldToClient: (p: ClientPoint) => ClientPoint
      /** 전선이 실제로 그려지는 경로의 화면 좌표 */
      wirePathClient: (wireId: string) => ClientPoint[] | null
      /** 부품 중심의 화면(client) 좌표 */
      instanceClientPosition: (instanceId: string) => ClientPoint | null
    }
  }
}
