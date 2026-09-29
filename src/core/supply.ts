// 부속 부품 (027): 하우징·단자·수축 튜브·전선.
// - 쓰인 양 계산(제안 수량): 하우징 = 전선이 연결된 커넥터 수, 단자 = 연결된 핀 수, 수축 튜브·전선 = 묶음 1개
// - BOM에는 자동으로 넣지 않고 사용자가 [넣기]/[빼기]를 고른다 (project.bom.supplies)
// - 쓰인 부속 부품은 배선도에 사본(project.supplies)으로 넣어 파일 하나로 열리게 한다
import { isPinEnd } from './ends'
import type { Project, Supply, SupplyChoice, SupplyKind, Wire, WireTubes } from './model'
import { inProjectCurrency } from './money'
import { naturalCompare } from './sort'
import { ko, msg, type T } from './i18n'
import { isHttpUrl } from './url'

export interface SupplyUse {
  /** 배선도 통화로 맞춘 부속 부품 (사본이 있으면 사본, 없으면 부품함) */
  supply: Supply
  /** 제안 수량: 하우징·단자는 개수, 수축 튜브·전선은 묶음 1개 */
  suggested: number
  /** 쓰인 개수: 하우징 = 커넥터, 단자 = 핀, 수축 튜브 = 조각, 전선 = 가닥 */
  count: number
  /** 하우징·단자가 쓰인 커넥터 (U1.J1, 자연 정렬) */
  refs: string[]
  /** 수축 튜브: 양 끝 조각 / 중간 조각 */
  ends?: number
  middle?: number
}

export interface MissingHousing {
  /** 짝 하우징이 없는 커넥터 종류 */
  type: string
  refs: string[]
}

export interface SupplyReport {
  uses: SupplyUse[]
  missing: MissingHousing[]
}

const KIND_ORDER: Record<SupplyKind, number> = { housing: 0, terminal: 1, tube: 2, wire: 3 }

/** 사본 우선, 그다음 부품함. 같은 종류 문자열의 하우징이 여럿이면 이름순 첫 번째 */
function catalogOf(project: Project, library: readonly Supply[]): Map<string, Supply> {
  const all = new Map<string, Supply>()
  for (const s of library) all.set(s.id, s)
  for (const s of Object.values(project.supplies ?? {})) all.set(s.id, s)
  return all
}

const typeKey = (t: string) => t.trim().toLowerCase()

/** 커넥터 종류 → 짝 하우징 */
export function housingsByType(supplies: Iterable<Supply>, preferred?: ReadonlySet<string>): Map<string, Supply> {
  const list = [...supplies].filter((s) => s.kind === 'housing' && s.connectorType?.trim())
  list.sort((a, b) => Number(!preferred?.has(a.id)) - Number(!preferred?.has(b.id)) || naturalCompare(a.name, b.name))
  const out = new Map<string, Supply>()
  for (const h of list) {
    const k = typeKey(h.connectorType!)
    if (!out.has(k)) out.set(k, h)
  }
  return out
}

/** 배선도에 쓰인 부속 부품과 제안 수량. library = 부품함의 부속 부품 */
export function supplyUsage(project: Project, library: readonly Supply[] = []): SupplyReport {
  const catalog = catalogOf(project, library)
  const housings = housingsByType(catalog.values(), new Set(Object.keys(project.supplies ?? {})))
  const uses = new Map<string, SupplyUse>()
  const use = (s: Supply | undefined, n: number, ref?: string) => {
    if (!s) return undefined
    let u = uses.get(s.id)
    if (!u) {
      u = { supply: inProjectCurrency(project, s), suggested: 0, count: 0, refs: [] }
      uses.set(s.id, u)
    }
    u.count += n
    if (ref) u.refs.push(ref)
    return u
  }

  // 전선이 연결된 핀
  const connected = new Set<string>()
  for (const w of project.wires) {
    for (const e of [w.from, w.to]) if (isPinEnd(e)) connected.add(`${e.instanceId}\u0000${e.pinId}`)
  }
  const missing = new Map<string, string[]>()
  for (const inst of project.instances) {
    const part = project.parts[inst.partId]
    if (!part || part.connectors.length === 0) continue
    const pinsOn = new Map<string, number>()
    for (const pin of part.pins) {
      if (pin.connectorId && connected.has(`${inst.id}\u0000${pin.id}`)) pinsOn.set(pin.connectorId, (pinsOn.get(pin.connectorId) ?? 0) + 1)
    }
    for (const c of part.connectors) {
      const pins = pinsOn.get(c.id) ?? 0
      if (pins === 0 || !c.type.trim()) continue
      const ref = `${inst.refDes}.${c.name}`
      const housing = housings.get(typeKey(c.type))
      if (!housing) {
        const list = missing.get(c.type.trim()) ?? []
        list.push(ref)
        missing.set(c.type.trim(), list)
        continue
      }
      use(housing, 1, ref)
      const terminal = housing.terminalId ? catalog.get(housing.terminalId) : undefined
      use(terminal?.kind === 'terminal' ? terminal : undefined, pins, ref)
    }
  }

  for (const w of project.wires) {
    if (w.supplyId) use(catalog.get(w.supplyId), 1)
    if (w.tubes?.ends) {
      const u = use(catalog.get(w.tubes.ends), 2)
      if (u) u.ends = (u.ends ?? 0) + 2
    }
    if (w.tubes?.middle) {
      const u = use(catalog.get(w.tubes.middle), 1)
      if (u) u.middle = (u.middle ?? 0) + 1
    }
  }

  for (const u of uses.values()) {
    u.refs = [...new Set(u.refs)].sort(naturalCompare)
    u.suggested = u.supply.kind === 'housing' || u.supply.kind === 'terminal' ? u.count : 1
  }
  return {
    uses: [...uses.values()].sort((a, b) => KIND_ORDER[a.supply.kind] - KIND_ORDER[b.supply.kind] || naturalCompare(a.supply.name, b.supply.name)),
    missing: [...missing]
      .map(([type, refs]) => ({ type, refs: refs.sort(naturalCompare) }))
      .sort((a, b) => naturalCompare(a.type, b.type))
  }
}

/** 아직 넣을지 정하지 않은 것 / 뺀 것 */
export function supplyDecisions(project: Project, report: SupplyReport): { pending: SupplyUse[]; excluded: SupplyUse[] } {
  const choices = project.bom?.supplies ?? {}
  return {
    pending: report.uses.filter((u) => !choices[u.supply.id]),
    excluded: report.uses.filter((u) => choices[u.supply.id]?.include === false)
  }
}

// ---------------------------------------------------------------- 편집 (입력을 바꾸지 않고 새 Project)

/** 사본을 넣는다 (배선도 통화로). 이미 같은 id가 있으면 그대로 둔다 */
function withCopies(project: Project, supplies: readonly (Supply | undefined)[]): Project {
  let copies = project.supplies
  for (const s of supplies) {
    if (!s || copies?.[s.id]) continue
    copies = { ...copies, [s.id]: inProjectCurrency(project, s) }
  }
  return copies === project.supplies ? project : { ...project, supplies: copies }
}

/** 전선·BOM 어디에서도 쓰지 않는 사본을 지운다 (하우징이 고른 단자는 남긴다) */
export function pruneSupplies(project: Project): Project {
  if (!project.supplies) return project
  const keep = new Set(Object.keys(project.bom?.supplies ?? {}))
  for (const w of project.wires) {
    for (const id of [w.supplyId, w.tubes?.ends, w.tubes?.middle]) if (id) keep.add(id)
  }
  for (const id of [...keep]) {
    const t = project.supplies[id]?.terminalId
    if (t) keep.add(t)
  }
  const entries = Object.entries(project.supplies).filter(([id]) => keep.has(id))
  if (entries.length === Object.keys(project.supplies).length) return project
  const next = { ...project }
  if (entries.length > 0) next.supplies = Object.fromEntries(entries)
  else delete next.supplies
  return next
}

/** BOM 부속 부품 선택값을 바꾼다. 빈 선택값은 지운다 */
function withChoice(project: Project, id: string, choice: SupplyChoice | undefined): Project {
  const choices = { ...project.bom?.supplies }
  if (choice) choices[id] = choice
  else delete choices[id]
  const bom = { ...project.bom }
  if (Object.keys(choices).length > 0) bom.supplies = choices
  else delete bom.supplies
  const next = { ...project }
  if (Object.keys(bom).length > 0) next.bom = bom
  else delete next.bom
  return next
}

/**
 * BOM에 넣기/빼기. 사본을 넣고(하우징이면 쓰는 단자도) 선택값을 남긴다. 수정한 수량·단가·비고는 유지.
 * include = undefined면 다시 "묻는 중"으로 되돌린다
 */
export function chooseSupply(project: Project, supply: Supply, include: boolean | undefined, library: readonly Supply[] = []): Project {
  if (include === undefined) return pruneSupplies(withChoice(project, supply.id, undefined))
  const terminal = supply.terminalId ? (project.supplies?.[supply.terminalId] ?? library.find((s) => s.id === supply.terminalId)) : undefined
  const prev = project.bom?.supplies?.[supply.id]
  return withChoice(withCopies(project, [supply, terminal]), supply.id, { ...prev, include })
}

export type SupplyChoicePatch = { quantity?: number | null; unitPrice?: number | null; memo?: string | null; supplier?: string | null }

/** BOM 부속 부품 행의 수량·단가·비고. null이면 지워서 제안 수량·기본 단가로 */
export function setSupplyChoice(project: Project, id: string, patch: SupplyChoicePatch): Project {
  const prev = project.bom?.supplies?.[id]
  if (!prev) return project
  const next: SupplyChoice = { ...prev }
  if (patch.quantity !== undefined) {
    if (patch.quantity === null) delete next.quantity
    else next.quantity = patch.quantity
  }
  if (patch.unitPrice !== undefined) {
    if (patch.unitPrice === null) delete next.unitPrice
    else next.unitPrice = patch.unitPrice
  }
  if (patch.memo !== undefined) {
    if (!patch.memo) delete next.memo
    else next.memo = patch.memo
  }
  if (patch.supplier !== undefined) {
    if (!patch.supplier?.trim()) delete next.supplier
    else next.supplier = patch.supplier.trim()
  }
  return withChoice(project, id, next)
}

export interface WireSupplyPatch {
  /** 전선 종류. null = 빼기 */
  wire?: Supply | null
  tubeEnds?: Supply | null
  tubeMiddle?: Supply | null
}

/** 전선 종류·수축 튜브를 고른다. 전선 종류를 고르면 그 색·AWG가 전선에 들어간다 */
export function setWireSupplies(project: Project, wireIds: readonly string[], patch: WireSupplyPatch): Project {
  const ids = new Set(wireIds)
  const withSupply = withCopies(project, [patch.wire ?? undefined, patch.tubeEnds ?? undefined, patch.tubeMiddle ?? undefined])
  const apply = (w: Wire): Wire => {
    const next: Wire = { ...w }
    if (patch.wire !== undefined) {
      if (patch.wire) {
        next.supplyId = patch.wire.id
        if (patch.wire.color) next.color = patch.wire.color
        if (patch.wire.awg !== undefined) next.awg = patch.wire.awg
      } else delete next.supplyId
    }
    const tubes: WireTubes = { ...w.tubes }
    if (patch.tubeEnds !== undefined) {
      if (patch.tubeEnds) tubes.ends = patch.tubeEnds.id
      else delete tubes.ends
    }
    if (patch.tubeMiddle !== undefined) {
      if (patch.tubeMiddle) tubes.middle = patch.tubeMiddle.id
      else delete tubes.middle
    }
    if (tubes.ends || tubes.middle) next.tubes = tubes
    else delete next.tubes
    return next
  }
  return pruneSupplies({ ...withSupply, wires: withSupply.wires.map((w) => (ids.has(w.id) ? apply(w) : w)) })
}

// ---------------------------------------------------------------- 편집 대화상자

/** 새 부속 부품 초안 */
export const emptySupply = (id: string, kind: SupplyKind): Supply => ({ id, kind, name: '' })

/** 저장을 막는 문제 */
export function checkSupply(s: Supply, t: T = ko): string[] {
  const errors: string[] = []
  if (!s.name.trim()) errors.push(t('이름을 입력하세요'))
  const url = s.purchaseUrl?.trim()
  if (url && !isHttpUrl(url)) errors.push(t('구매 링크는 http:// 또는 https://로 시작해야 합니다'))
  if (s.unitPrice !== undefined && !(Number.isFinite(s.unitPrice) && s.unitPrice >= 0)) errors.push(t('단가는 0 이상의 숫자여야 합니다'))
  if (s.diameter !== undefined && !(Number.isFinite(s.diameter) && s.diameter > 0)) errors.push(t('지름은 0보다 큰 숫자여야 합니다'))
  return errors
}

/** 저장용으로 정리: 앞뒤 공백, 빈 칸 삭제, 종류에 맞지 않는 칸 삭제 */
export function finalizeSupply(s: Supply): Supply {
  const out: Supply = { id: s.id, kind: s.kind, name: s.name.trim() }
  for (const k of ['partNumber', 'manufacturer', 'purchaseUrl', 'supplier', 'memo', 'pack', 'connectorType', 'terminalId', 'color'] as const) {
    const v = s[k]?.trim()
    if (v) out[k] = v
  }
  if (s.unitPrice !== undefined) out.unitPrice = s.unitPrice
  if (s.currency && s.currency !== 'KRW') out.currency = s.currency
  if (s.image) out.image = s.image
  if (s.drawing) out.drawing = s.drawing
  if (s.diameter !== undefined) out.diameter = s.diameter
  if (s.awg !== undefined) out.awg = s.awg
  const only: Record<SupplyKind, readonly (keyof Supply)[]> = {
    housing: ['connectorType', 'terminalId'],
    terminal: [],
    tube: ['diameter', 'color', 'pack'],
    wire: ['awg', 'color', 'pack']
  }
  for (const k of ['connectorType', 'terminalId', 'diameter', 'color', 'pack', 'awg'] as const) {
    if (!only[s.kind].includes(k)) delete out[k]
  }
  return out
}

/** 목록에 보일 한 줄 설명: 하우징 "JST-XH 4P 짝", 수축 튜브 "Ø3 · 1 m 롤", 전선 "AWG22 · 10 m 릴" */
export function supplySummary(s: Supply, t: T = ko): string {
  const bits: string[] = []
  if (s.kind === 'housing' && s.connectorType) bits.push(t('{type} 짝', { type: s.connectorType }))
  if (s.diameter !== undefined) bits.push(`Ø${s.diameter}`)
  if (s.awg !== undefined) bits.push(`AWG${s.awg}`)
  if (s.pack) bits.push(s.pack)
  if (s.partNumber) bits.push(s.partNumber)
  return bits.join(' · ')
}

/** 부속 부품 종류 이름 (화면 표시용 원문) */
export const SUPPLY_KIND_LABEL: Record<SupplyKind, string> = {
  housing: msg('하우징'),
  terminal: msg('단자'),
  tube: msg('수축 튜브'),
  wire: msg('전선')
}
