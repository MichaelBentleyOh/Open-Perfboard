// 프로젝트 파일(.opb)과 부품 라이브러리가 공유하는 데이터 모델

/** v2: 전선 끝이 핀 또는 접속점(junction)일 수 있다 */
export const PROJECT_FILE_VERSION = 6
export const DEFAULT_REF_PREFIX = 'U'

/** 부품 사진. data는 base64 data URL */
export interface PartImage {
  data: string
  width: number
  height: number
}

/** 커넥터는 부품의 속성이다 (예: J1 = "JST-XH 4P") */
export interface Connector {
  id: string
  name: string
  type: string
}

export interface Pin {
  id: string
  number: string
  signal?: string
  connectorId?: string
  /** 사진 기준 0~1 정규화 좌표 */
  x: number
  y: number
}

/** 라이브러리에 저장되는 부품 정의 */
export interface PartDef {
  id: string
  name: string
  partNumber?: string
  manufacturer?: string
  memo?: string
  /** 참조명 접두사 (U, J, BT ...). 없으면 DEFAULT_REF_PREFIX */
  refPrefix?: string
  /** 구매 사이트 링크 (http/https) */
  purchaseUrl?: string
  /** 기본 단가 (원). 배선도 BOM에서 따로 정하면 그 값이 우선 */
  unitPrice?: number
  /** 첨부(데이터시트·핀아웃). 목록만, 본문은 라이브러리 첨부 폴더 (core/attachment.ts) */
  attachments?: Attachment[]
  image: PartImage
  connectors: Connector[]
  pins: Pin[]
}

export type AttachmentType = 'pdf' | 'png' | 'jpeg' | 'webp'

/** 부품 첨부 파일 하나 */
export interface Attachment {
  /** 내용의 SHA-256 (16진수 64자) */
  id: string
  /** 제목 (기본값 = 파일 이름) */
  name: string
  type: AttachmentType
  /** 바이트 */
  size: number
}

/** 캔버스에 배치된 부품 */
export interface PartInstance {
  id: string
  partId: string
  /** 참조명 (U1, U2 ...) */
  refDes: string
  x: number
  y: number
  rotation: number
  scale: number
  /** 좌우 거울상 (부품 자기 좌표 기준, 회전보다 먼저 적용) */
  flipped?: boolean
}

export interface PinRef {
  instanceId: string
  pinId: string
}

/** 전선 중간에서 갈라지는 접속점 (스플라이스). 부품에 붙어 있지 않은 월드 좌표 */
export interface Junction {
  id: string
  x: number
  y: number
  /** SP1, SP2 … (결선표 표시) */
  label: string
}

export interface JunctionRef {
  junctionId: string
}

/** 전선의 한쪽 끝: 부품의 핀 또는 접속점 */
export type WireEnd = PinRef | JunctionRef

export interface Wire {
  id: string
  from: WireEnd
  to: WireEnd
  color: string
  width: number
  label?: string
  /** 사용자가 찍은 꺾임점 (월드 좌표). 없으면 핀과 핀을 바로 잇는다 */
  points?: { x: number; y: number }[]
  /** 직각 모드: 비스듬한 구간을 자동으로 ㄱ/ㄴ자로 꺾는다 */
  orthogonal?: boolean
  /** 전선 규격 (AWG, 10~30). width는 화면 표시용 굵기일 뿐 */
  awg?: number
  /** 실제 전선 길이 (mm) */
  length?: number
  /** 신호 방향 (025): forward = from → to, reverse = to → from, 없으면 양방향. 결선표에서만 바꾼다 */
  direction?: WireDirection
}

export type WireDirection = 'forward' | 'reverse'
export const WIRE_DIRECTIONS: readonly WireDirection[] = ['forward', 'reverse']

/** 전선 규격으로 고를 수 있는 AWG */
export const AWG_MIN = 10
export const AWG_MAX = 30

export interface Project {
  version: typeof PROJECT_FILE_VERSION
  name: string
  /** 사용된 부품 정의 사본. 라이브러리가 바뀌어도 파일 단독으로 열린다 */
  parts: Record<string, PartDef>
  instances: PartInstance[]
  wires: Wire[]
  /** 전선 접속점 (분기) */
  junctions?: Junction[]
  /** 타이틀 블록 정보 (PDF) */
  meta?: ProjectMeta
  /** BOM 편집 내용 (단가·비고 수정, 직접 추가한 항목) */
  bom?: ProjectBom
}

/** 배선도 부품 행의 수정값 */
export interface BomOverride {
  unitPrice?: number
  memo?: string
}

/** BOM에 직접 추가한 항목 (배선도에 없는 소모품 등) */
export interface BomItem {
  id: string
  name: string
  partNumber?: string
  manufacturer?: string
  quantity: number
  unitPrice?: number
  purchaseUrl?: string
  memo?: string
}

export interface ProjectBom {
  /** 부품 정의 id → 수정값 */
  overrides?: Record<string, BomOverride>
  items?: BomItem[]
}

export interface ProjectMeta {
  author?: string
  notes?: string
}
