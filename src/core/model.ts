// 프로젝트 파일(.opb)과 부품 라이브러리가 공유하는 데이터 모델

/** v2: 전선 끝이 핀 또는 접속점(junction)일 수 있다 · v8: 부품·부속 부품 그림 원본(drawing, 037b) · v9: 회로도 기호·핀 전기 종류 (038) */
export const PROJECT_FILE_VERSION = 9
export const DEFAULT_REF_PREFIX = 'U'

/** 부품 사진. data는 base64 data URL */
export interface PartImage {
  data: string
  width: number
  height: number
}

// ---- 부품 그림 원본 (037b). 부품 작업실에서 그린 도형. 배선도는 구운 PNG(image)만 쓴다

/** 도형 공통: x, y = 왼쪽 위 (그림판 픽셀), 회전은 그 점 기준 (도) */
interface ShapeBase {
  id: string
  x: number
  y: number
  rotation?: number
  /** 0~1, 없으면 1 */
  opacity?: number
  /** 잠그면 고르거나 옮길 수 없다 (배경 사진 등) */
  locked?: boolean
}
/** 채우기·선 색은 #rrggbb. 없으면 그리지 않는다 */
export interface RectShape extends ShapeBase {
  type: 'rect'
  w: number
  h: number
  /** 모서리 둥글기 */
  radius?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
}
export interface EllipseShape extends ShapeBase {
  type: 'ellipse'
  w: number
  h: number
  fill?: string
  stroke?: string
  strokeWidth?: number
}
/** 선: points는 (x, y) 기준 상대 좌표 [x0, y0, x1, y1, …] (꺾은선) */
export interface LineShape extends ShapeBase {
  type: 'line'
  points: number[]
  stroke: string
  strokeWidth: number
  arrowStart?: boolean
  arrowEnd?: boolean
  dashed?: boolean
}
export type TextAlign = 'left' | 'center' | 'right'
export interface TextShape extends ShapeBase {
  type: 'text'
  /** 글상자 너비 (넘치면 줄바꿈) */
  w: number
  text: string
  fontSize: number
  color: string
  bold?: boolean
  align?: TextAlign
}
export interface ImageShape extends ShapeBase {
  type: 'image'
  w: number
  h: number
  /** data:image/… URL */
  src: string
}
export type Shape = RectShape | EllipseShape | LineShape | TextShape | ImageShape
export type ShapeType = Shape['type']

/** 그림판. 크기 = 구운 PNG의 비율, 핀 좌표(0~1)의 기준 */
export interface Drawing {
  width: number
  height: number
  /** 없으면 투명 */
  background?: string
  /** 뒤에 있는 것부터 */
  shapes: Shape[]
}

/** 커넥터는 부품의 속성이다 (예: J1 = "JST-XH 4P") */
export interface Connector {
  id: string
  name: string
  type: string
}

/** 핀의 전기 종류 (038). KiCad 핀 종류·시뮬레이션 GPIO에 쓴다. 신호 방향(Wire.direction)과는 따로 */
export type PinElectrical = 'input' | 'output' | 'bidirectional' | 'passive' | 'power_in' | 'power_out' | 'open_collector' | 'no_connect'
export const PIN_ELECTRICALS: readonly PinElectrical[] = ['passive', 'input', 'output', 'bidirectional', 'power_in', 'power_out', 'open_collector', 'no_connect']

export interface Pin {
  id: string
  number: string
  signal?: string
  connectorId?: string
  /** 사진 기준 0~1 정규화 좌표 */
  x: number
  y: number
  /** 없으면 passive */
  electrical?: PinElectrical
}

// ---- 회로도 기호 (038). 좌표 1 = 5 mil (0.127 mm), 핀 끝점은 10 (= 50 mil, KiCad 격자) 배수

export type SymbolSide = 'left' | 'right' | 'top' | 'bottom'
export const SYMBOL_SIDES: readonly SymbolSide[] = ['left', 'right', 'top', 'bottom']

/** 기호 위의 핀: 끝점(전선이 닿는 곳)과 몸통 쪽 */
export interface SymbolPin {
  /** 부품 핀 id (한 핀은 기호에 한 번) */
  pinId: string
  x: number
  y: number
  /** 몸통의 어느 쪽에 붙나 (left = 끝점이 왼쪽, 선이 오른쪽으로 몸통까지) */
  side: SymbolSide
  /** 없으면 SYMBOL_PIN_LENGTH */
  length?: number
}

export interface PartSymbol {
  /** 몸통 그림 (그림판 도형) */
  drawing: Drawing
  pins: SymbolPin[]
  /** 없으면 보임 */
  showNumbers?: boolean
  showNames?: boolean
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
  /** 조달처 (구매처 이름, 031) */
  supplier?: string
  /** 기본 단가. 배선도 BOM에서 따로 정하면 그 값이 우선 */
  unitPrice?: number
  /** 단가의 통화 (029). 없으면 KRW. 배선도 사본은 배선도 통화로 바꿔 넣는다 */
  currency?: Currency
  /** 첨부(데이터시트·핀아웃). 목록만, 본문은 라이브러리 첨부 폴더 (core/attachment.ts) */
  attachments?: Attachment[]
  image: PartImage
  /** 부품 작업실에서 그린 원본 (037b). 있으면 image는 이것을 구운 것 */
  drawing?: Drawing
  /** 회로도 기호 (038). 없으면 회로도·KiCad가 기본 기호를 그때 만든다 */
  symbol?: PartSymbol
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

/** 캔버스 글 상자 (메모, 032). x·y = 왼쪽 위 (월드 좌표) */
export interface Note {
  id: string
  x: number
  y: number
  /** 너비 (월드 단위). 글이 길면 줄을 바꾼다 */
  width: number
  text: string
  /** 글자 크기. 없으면 16 */
  fontSize?: number
  /** 글자 색 (#rrggbb). 없으면 기본 */
  color?: string
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
  /** 메모 (027: 길이 칸 대신, 예전 길이는 "길이 120 mm"로 옮겨 온다) */
  memo?: string
  /** 신호 방향 (025): forward = from → to, reverse = to → from, 없으면 양방향. 결선표에서만 바꾼다 */
  direction?: WireDirection
  /** 전선 종류 (027, 부속 부품 kind = 'wire'의 id) */
  supplyId?: string
  /** 수축 튜브 (027): 양 끝에 1조각씩, 중간에 1조각. 값은 부속 부품(kind = 'tube') id */
  tubes?: WireTubes
}

export interface WireTubes {
  ends?: string
  middle?: string
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
  /** 글 상자 (032) */
  notes?: Note[]
  /** 타이틀 블록 정보 (PDF) */
  meta?: ProjectMeta
  /** BOM 편집 내용 (단가·비고 수정, 직접 추가한 항목) */
  bom?: ProjectBom
  /** 쓰인 부속 부품 사본 (027): 전선 종류·수축 튜브, BOM에 넣은 하우징·단자. 파일 단독으로 열리게 */
  supplies?: Record<string, Supply>
}

/** 배선도 부품 행의 수정값 */
export interface BomOverride {
  unitPrice?: number
  memo?: string
  /** 조달처 (031) */
  supplier?: string
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
  /** 조달처 (031) */
  supplier?: string
}

export interface ProjectBom {
  /** 부품 정의 id → 수정값 */
  overrides?: Record<string, BomOverride>
  items?: BomItem[]
  /** 부속 부품 id → BOM에 넣을지와 수정값 (027). 없으면 아직 묻는 중 */
  supplies?: Record<string, SupplyChoice>
  /** 이 배선도의 통화 (029). 없으면 KRW. 모든 단가가 이 통화다 */
  currency?: Currency
  /** 환율: 1 USD = ? KRW */
  exchangeRate?: number
}

/** BOM에서 부속 부품을 넣을지 정한 값. quantity를 비우면 제안 수량을 따른다 */
export interface SupplyChoice {
  include: boolean
  quantity?: number
  unitPrice?: number
  memo?: string
  /** 조달처 (031) */
  supplier?: string
}

export type SupplyKind = 'housing' | 'terminal' | 'tube' | 'wire'
export const SUPPLY_KINDS: readonly SupplyKind[] = ['housing', 'terminal', 'tube', 'wire']

/** 부속 부품 (027): 하우징·단자·수축 튜브·전선. 핀 없이 BOM용 정보만 */
export interface Supply {
  id: string
  kind: SupplyKind
  name: string
  partNumber?: string
  manufacturer?: string
  purchaseUrl?: string
  /** 조달처 (031) */
  supplier?: string
  /** 단가 (tube·wire는 묶음당) */
  unitPrice?: number
  currency?: Currency
  memo?: string
  image?: PartImage
  /** 부품 작업실에서 그린 원본 (037b) */
  drawing?: Drawing
  /** housing: 짝이 되는 커넥터 종류 (부품 커넥터의 type과 같은 문자열, 예: "JST-XH 4P") */
  connectorType?: string
  /** housing: 쓰는 단자 (kind = 'terminal'의 id) */
  terminalId?: string
  /** tube: 지름 (mm) */
  diameter?: number
  /** tube·wire: 색 (#rrggbb) */
  color?: string
  /** wire: 규격 (AWG) */
  awg?: number
  /** tube·wire: 묶음 설명 (예: "1 m 롤", "100개입") */
  pack?: string
}

export type Currency = 'KRW' | 'USD'
export const CURRENCIES: readonly Currency[] = ['KRW', 'USD']

export interface ProjectMeta {
  author?: string
  notes?: string
}
