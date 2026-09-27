// 부품 정의 편집 연산 (부품 에디터용). 입력을 변경하지 않고 새 값을 반환한다.
import type { Connector, PartDef, PartImage, Pin } from './model'
import { isHttpUrl } from './url'
import { ko, type T } from './i18n'

/** 사진을 아직 고르지 않은 편집 중 부품 */
export type PartDraft = Omit<PartDef, 'image'> & { image?: PartImage }

type HasPins = Pick<PartDef, 'pins' | 'connectors'>

export function emptyPartDraft(id: string): PartDraft {
  return { id, name: '', connectors: [], pins: [] }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 같은 커넥터 안에서 숫자 핀 번호의 최대값 + 1. 숫자가 아닌 번호(A, +)는 건너뛴다 */
export function nextPinNumber(pins: readonly Pin[], connectorId?: string): string {
  let max = 0
  for (const p of pins) {
    if (p.connectorId !== connectorId) continue
    if (/^\d+$/.test(p.number)) max = Math.max(max, Number(p.number))
  }
  return String(max + 1)
}

export function addPin<T extends HasPins>(
  part: T,
  at: { id: string; x: number; y: number; connectorId?: string }
): T {
  const pin: Pin = {
    id: at.id,
    number: nextPinNumber(part.pins, at.connectorId),
    x: clamp01(at.x),
    y: clamp01(at.y),
    ...(at.connectorId ? { connectorId: at.connectorId } : {})
  }
  return { ...part, pins: [...part.pins, pin] }
}

export function movePin<T extends HasPins>(part: T, pinId: string, x: number, y: number): T {
  return {
    ...part,
    pins: part.pins.map((p) => (p.id === pinId ? { ...p, x: clamp01(x), y: clamp01(y) } : p))
  }
}

export type PinPatch = { number?: string; signal?: string; connectorId?: string | null }

/** 빈 문자열 signal과 null connectorId는 필드를 지운다 */
export function updatePin<T extends HasPins>(part: T, pinId: string, patch: PinPatch): T {
  return {
    ...part,
    pins: part.pins.map((p) => {
      if (p.id !== pinId) return p
      const next: Pin = { ...p }
      if (patch.number !== undefined) next.number = patch.number
      if (patch.signal !== undefined) {
        if (patch.signal === '') delete next.signal
        else next.signal = patch.signal
      }
      if (patch.connectorId !== undefined) {
        if (patch.connectorId === null) delete next.connectorId
        else next.connectorId = patch.connectorId
      }
      return next
    })
  }
}

export function removePin<T extends HasPins>(part: T, pinId: string): T {
  return { ...part, pins: part.pins.filter((p) => p.id !== pinId) }
}

/** J1, J2 ... 중 다음 이름 */
export function nextConnectorName(connectors: readonly Connector[]): string {
  let max = 0
  for (const c of connectors) {
    const m = /^J(\d+)$/.exec(c.name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `J${max + 1}`
}

export function addConnector<T extends HasPins>(part: T, at: { id: string; type?: string }): T {
  const connector: Connector = { id: at.id, name: nextConnectorName(part.connectors), type: at.type ?? '' }
  return { ...part, connectors: [...part.connectors, connector] }
}

export function updateConnector<T extends HasPins>(
  part: T,
  connectorId: string,
  patch: Partial<Pick<Connector, 'name' | 'type'>>
): T {
  return {
    ...part,
    connectors: part.connectors.map((c) => (c.id === connectorId ? { ...c, ...patch } : c))
  }
}

/** 커넥터를 지우고, 그 커넥터에 속한 핀은 커넥터 없음으로 바꾼다 */
export function removeConnector<T extends HasPins>(part: T, connectorId: string): T {
  return {
    ...part,
    connectors: part.connectors.filter((c) => c.id !== connectorId),
    pins: part.pins.map((p) => {
      if (p.connectorId !== connectorId) return p
      const { connectorId: _, ...rest } = p
      return rest
    })
  }
}

export interface DraftCheck {
  /** 저장을 막는 문제 */
  errors: string[]
  /** 저장은 되지만 알려 줄 문제 */
  warnings: string[]
}

export function checkDraft(draft: PartDraft, t: T = ko): DraftCheck {
  const errors: string[] = []
  const warnings: string[] = []
  if (!draft.name.trim()) errors.push(t('이름을 입력하세요'))
  if (!draft.image) errors.push(t('사진을 불러오세요'))
  if (draft.pins.some((p) => !p.number.trim())) errors.push(t('비어 있는 핀 번호가 있습니다'))
  const url = draft.purchaseUrl?.trim()
  if (url && !isHttpUrl(url)) errors.push(t('구매 링크는 http:// 또는 https://로 시작해야 합니다'))
  if (draft.unitPrice !== undefined && !(Number.isFinite(draft.unitPrice) && draft.unitPrice >= 0)) {
    errors.push(t('단가는 0 이상의 숫자여야 합니다'))
  }

  const seen = new Map<string, number>()
  for (const p of draft.pins) {
    const key = `${p.connectorId ?? ''}\u0000${p.number.trim()}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  for (const [key, count] of seen) {
    if (count < 2) continue
    const [connectorId, number] = key.split('\u0000')
    const conn = draft.connectors.find((c) => c.id === connectorId)?.name
    warnings.push(
      conn
        ? t("{connector}의 핀 번호 '{number}'가 {count}번 쓰였습니다", { connector: conn, number, count })
        : t("핀 번호 '{number}'가 {count}번 쓰였습니다", { number, count })
    )
  }
  if (draft.pins.length === 0) warnings.push(t('핀이 없습니다. 사진을 클릭해 핀을 찍으세요'))
  return { errors, warnings }
}

/** 검사를 통과한 초안을 저장용 부품 정의로 바꾼다 (앞뒤 공백 정리) */
export function finalizeDraft(draft: PartDraft): PartDef | undefined {
  if (checkDraft(draft).errors.length > 0 || !draft.image) return undefined
  const opt = (v?: string) => (v && v.trim() ? v.trim() : undefined)
  const part: PartDef = {
    id: draft.id,
    name: draft.name.trim(),
    image: draft.image,
    connectors: draft.connectors.map((c) => ({ ...c, name: c.name.trim(), type: c.type.trim() })),
    pins: draft.pins.map((p) => ({ ...p, number: p.number.trim() }))
  }
  if (draft.unitPrice !== undefined) part.unitPrice = draft.unitPrice
  if (draft.attachments?.length) part.attachments = draft.attachments.map((a) => ({ ...a, name: a.name.trim() || a.name }))
  for (const key of ['partNumber', 'manufacturer', 'memo', 'refPrefix', 'purchaseUrl'] as const) {
    const v = opt(draft[key])
    if (v) part[key] = v
  }
  return part
}
