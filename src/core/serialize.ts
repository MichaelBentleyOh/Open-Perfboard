// 프로젝트/부품 파일 직렬화와 검증.
// 파일 내용은 외부 입력이므로 필드 하나하나 검사하고, 알려진 필드만 골라 새 객체를 만든다.
import {
  type Attachment,
  AWG_MAX,
  AWG_MIN,
  PROJECT_FILE_VERSION,
  WIRE_DIRECTIONS,
  type WireDirection,
  type Connector,
  type PartDef,
  type PartImage,
  type PartInstance,
  type Pin,
  type PinRef,
  type BomItem,
  type BomOverride,
  type Junction,
  type Note,
  type WireEnd,
  type Project,
  type ProjectBom,
  type ProjectMeta,
  type Wire,
  CURRENCIES,
  type Currency,
  SUPPLY_KINDS,
  type Supply,
  type SupplyChoice,
  type SupplyKind,
  type WireTubes,
  type Drawing,
  type Shape,
  type TextAlign,
  PIN_ELECTRICALS,
  type PinElectrical,
  type PartSymbol,
  SYMBOL_SIDES,
  type SymbolPin,
  type SymbolSide,
  SCH_ROTATIONS,
  type SchPlacement,
  type SchRotation,
  type Schematic
} from './model'
import { DRAWING_MAX, DRAWING_MIN, SHAPES_MAX } from './drawing'
import { isHttpUrl } from './url'
import { ATTACHMENT_ID, isAttachmentType, type AttachmentData } from './attachment'
import { ko, type Params, type T } from './i18n'

export type ParseResult<V> = { ok: true; value: V } | { ok: false; errors: string[] }

/** 오류 모음. 원문(한국어)과 변수를 받아 고른 언어로 쌓는다 */
interface Errors {
  push: (text: string, params?: Params) => void
  readonly items: string[]
  readonly length: number
}

function collector(t: T): Errors {
  const items: string[] = []
  return {
    items,
    push: (text, params) => void items.push(t(text, params)),
    get length() {
      return items.length
    }
  }
}

/**
 * 배선도 파일 내용. library를 주면 부품 라이브러리(다른 PC에서 가져올 수 있게)를 함께 넣는다.
 * attachmentData를 주면 첨부 본문(base64)도 넣는다 (다른 PC에서 데이터시트를 볼 수 있게).
 * library와 attachmentData는 편집 중인 Project에는 없고 파일에만 있다.
 */
export function serializeProject(project: Project, library: readonly PartDef[] = [], attachmentData: AttachmentData = {}): string {
  return JSON.stringify(
    {
      ...project,
      ...(library.length > 0 ? { library } : {}),
      ...(Object.keys(attachmentData).length > 0 ? { attachmentData } : {})
    },
    null,
    2
  )
}

export function serializePart(part: PartDef): string {
  return JSON.stringify(part, null, 2)
}

export function parseProject(text: string, t: T = ko): ParseResult<Project> {
  const r = parseProjectFile(text, t)
  return r.ok ? { ok: true, value: r.value.project } : r
}

/** 배선도 파일 = Project + 함께 저장된 부품 라이브러리(v3부터) + 첨부 본문(v5부터). 없으면 비어 있음 */
export interface ProjectFile {
  project: Project
  library: PartDef[]
  attachmentData: AttachmentData
}

export function parseProjectFile(text: string, t: T = ko): ParseResult<ProjectFile> {
  const raw = parseJson(text, t)
  if (!raw.ok) return raw
  const errors = collector(t)
  const migrated = migrate(raw.value, errors)
  const project = migrated && readProject(migrated, errors)
  let library: PartDef[] = []
  if (migrated && migrated.library !== undefined) {
    library = list(migrated, 'library', '', errors, (v, p) => readPart(v, p, errors))
    checkUnique(library, 'library', errors)
  }
  const attachmentData = migrated ? readAttachmentData(migrated.attachmentData, errors) : {}
  return project && errors.length === 0 ? { ok: true, value: { project, library, attachmentData } } : { ok: false, errors: errors.items }
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** 첨부 본문 {id: base64}. 키·값 모양만 검사한다 (내용과 id가 맞는지는 저장할 때 main이 해시로 확인) */
function readAttachmentData(v: unknown, errors: Errors): AttachmentData {
  if (v === undefined) return {}
  if (!isObject(v)) {
    errors.push('{path}: 객체가 아닙니다', { path: 'attachmentData' })
    return {}
  }
  const out: AttachmentData = {}
  for (const [id, data] of Object.entries(v)) {
    if (!ATTACHMENT_ID.test(id) || typeof data !== 'string' || !BASE64.test(data)) {
      errors.push('{path}: 첨부 본문이 올바르지 않습니다', { path: `attachmentData.${id.slice(0, 16)}` })
      continue
    }
    out[id] = data
  }
  return out
}

/** 라이브러리 파일(.opblib)의 첨부 본문 읽기. 문제는 첫 번째만 알려 준다 */
export function parseAttachmentData(v: unknown, t: T = ko): { data: AttachmentData; problems: string[] } {
  const errors = collector(t)
  const data = readAttachmentData(v, errors)
  return { data, problems: errors.items.slice(0, 1) }
}

export function parsePart(text: string, t: T = ko): ParseResult<PartDef> {
  const raw = parseJson(text, t)
  if (!raw.ok) return raw
  return readPartValue(raw.value, t)
}

/** 이미 JSON으로 읽은 값을 부품 정의로 검증한다 (라이브러리 묶음 파일의 각 부품) */
export function readPartValue(v: unknown, t: T = ko): ParseResult<PartDef> {
  const errors = collector(t)
  const part = readPart(v, '', errors)
  return part && errors.length === 0 ? { ok: true, value: part } : { ok: false, errors: errors.items }
}

export function serializeSupply(supply: Supply): string {
  return JSON.stringify(supply, null, 2)
}

export function parseSupply(text: string, t: T = ko): ParseResult<Supply> {
  const raw = parseJson(text, t)
  if (!raw.ok) return raw
  return readSupplyValue(raw.value, t)
}

/** 이미 JSON으로 읽은 값을 부속 부품으로 검증한다 (.opblib의 supplies 각 항목) */
export function readSupplyValue(v: unknown, t: T = ko): ParseResult<Supply> {
  const errors = collector(t)
  const supply = readSupply(v, '', errors)
  return supply && errors.length === 0 ? { ok: true, value: supply } : { ok: false, errors: errors.items }
}

// ---------------------------------------------------------------- 마이그레이션

/** 버전별 변환. 키 N은 vN → vN+1. 포맷을 바꾸면 여기에 추가하고 테스트를 쓴다 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: 전선 끝에 접속점이 올 수 있게 됨. v1 파일은 핀만 쓰므로 내용은 그대로
  1: (raw) => ({ ...raw, version: 2 }),
  // v2 → v3: 부품 라이브러리(library)를 함께 저장할 수 있게 됨. 없는 파일은 그대로
  2: (raw) => ({ ...raw, version: 3 }),
  // v3 → v4: 전선 규격(awg)·길이(length)가 생김. 없는 파일은 그대로
  3: (raw) => ({ ...raw, version: 4 }),
  // v4 → v5: 부품 첨부(attachments)와 첨부 본문(attachmentData)이 생김. 없는 파일은 그대로
  4: (raw) => ({ ...raw, version: 5 }),
  // v5 → v6: 전선 신호 방향(direction)이 생김. 없는 전선은 양방향
  5: (raw) => ({ ...raw, version: 6 }),
  // v7: 전선 길이(mm) 칸을 없애고 메모로 옮긴다 (027), BOM 통화·환율 (029)
  6: migrateWireLength,
  // v7 → v8: 부품·부속 부품 그림 원본(drawing, 037b)이 생김. 없는 파일은 그대로
  7: (raw) => ({ ...raw, version: 8 }),
  // v8 → v9: 회로도 기호(symbol)와 핀 전기 종류(electrical, 038)가 생김. 없는 파일은 그대로
  8: (raw) => ({ ...raw, version: 9 }),
  // v9 → v10: 배선도마다 회로도(schematic, 039)가 생김. 없는 파일은 그대로
  9: (raw) => ({ ...raw, version: 10 })
}

/** v6 → v7: 전선 길이(length, mm)를 메모 뒤에 "L=250 mm"로 옮긴다 (값을 잃지 않게) */
function migrateWireLength(raw: Record<string, unknown>): Record<string, unknown> {
  const wires = Array.isArray(raw.wires)
    ? raw.wires.map((w: unknown) => {
        if (!isObject(w) || w.length === undefined) return w
        const { length, ...rest } = w
        if (typeof length !== 'number' || !Number.isFinite(length)) return rest
        const memo = typeof rest.memo === 'string' && rest.memo.trim() ? `${rest.memo} · ` : ''
        return { ...rest, memo: `${memo}L=${length} mm` }
      })
    : raw.wires
  return { ...raw, wires, version: 7 }
}

function migrate(raw: unknown, errors: Errors): Record<string, unknown> | undefined {
  if (!isObject(raw)) {
    errors.push('파일 최상위가 객체가 아닙니다')
    return undefined
  }
  let version = raw.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    errors.push('version: 올바른 파일 버전이 아닙니다')
    return undefined
  }
  if (version > PROJECT_FILE_VERSION) {
    errors.push('이 파일은 더 새로운 버전(v{version})에서 만들어졌습니다. 프로그램을 업데이트하세요', { version })
    return undefined
  }
  let current = raw
  while (version < PROJECT_FILE_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) {
      errors.push('v{from} → v{to} 마이그레이션이 없습니다', { from: version, to: version + 1 })
      return undefined
    }
    current = step(current)
    version += 1
  }
  return current
}

// ---------------------------------------------------------------- 읽기/검증

function readProject(o: Record<string, unknown>, errors: Errors): Project | undefined {
  const name = str(o, 'name', '', errors)

  const parts: Record<string, PartDef> = {}
  if (!isObject(o.parts)) errors.push('{path}: 객체가 아닙니다', { path: 'parts' })
  else {
    for (const [key, value] of Object.entries(o.parts)) {
      const part = readPart(value, `parts.${key}.`, errors)
      if (!part) continue
      if (part.id !== key) errors.push("{path}: 키와 id가 다릅니다 ('{id}')", { path: `parts.${key}.id`, id: part.id })
      parts[key] = part
    }
  }

  const instances = list(o, 'instances', '', errors, (v, p) => readInstance(v, p, errors))
  checkUnique(instances, 'instances', errors)
  instances.forEach((inst, i) => {
    if (!parts[inst.partId]) errors.push("{path}: 존재하지 않는 부품 '{id}'", { path: `instances[${i}].partId`, id: inst.partId })
  })

  const wires = list(o, 'wires', '', errors, (v, p) => readWire(v, p, errors))
  checkUnique(wires, 'wires', errors)
  let junctions: Junction[] = []
  if (o.junctions !== undefined) {
    junctions = list(o, 'junctions', '', errors, (v, p) => readJunction(v, p, errors))
    checkUnique(junctions, 'junctions', errors)
  }

  let notes: Note[] = []
  if (o.notes !== undefined) {
    notes = list(o, 'notes', '', errors, (v, p) => readNote(v, p, errors))
    checkUnique(notes, 'notes', errors)
  }

  const junctionIds = new Set(junctions.map((j) => j.id))
  const instanceById = new Map(instances.map((i) => [i.id, i]))
  const endExists = (ref: WireEnd) => {
    if ('junctionId' in ref) return junctionIds.has(ref.junctionId)
    const inst = instanceById.get(ref.instanceId)
    return !!inst && !!parts[inst.partId]?.pins.some((p) => p.id === ref.pinId)
  }
  wires.forEach((w, i) => {
    if (!endExists(w.from)) errors.push('{path}: 존재하지 않는 핀을 가리킵니다', { path: `wires[${i}].from` })
    if (!endExists(w.to)) errors.push('{path}: 존재하지 않는 핀을 가리킵니다', { path: `wires[${i}].to` })
  })

  let meta: ProjectMeta | undefined
  if (o.meta !== undefined) {
    if (!isObject(o.meta)) errors.push('{path}: 객체가 아닙니다', { path: 'meta' })
    else {
      const m = { ...optStr(o.meta, 'author', 'meta.', errors), ...optStr(o.meta, 'notes', 'meta.', errors) }
      if (Object.keys(m).length > 0) meta = m
    }
  }

  const bom = o.bom === undefined ? undefined : readBom(o.bom, errors)

  const supplies: Record<string, Supply> = {}
  if (o.supplies !== undefined) {
    if (!isObject(o.supplies)) errors.push('{path}: 객체가 아닙니다', { path: 'supplies' })
    else {
      for (const [key, value] of Object.entries(o.supplies)) {
        const s = readSupply(value, `supplies.${key}.`, errors)
        if (!s) continue
        if (s.id !== key) errors.push("{path}: 키와 id가 다릅니다 ('{id}')", { path: `supplies.${key}.id`, id: s.id })
        supplies[key] = s
      }
    }
  }
  // 사본이 없는 부속 부품 참조는 오류 대신 뺀다 (전선 모양·연결은 그대로 열리게)
  const has = (id: string | undefined, kind: SupplyKind) => id !== undefined && supplies[id]?.kind === kind
  wires.forEach((w, i) => {
    if (w.supplyId !== undefined && !has(w.supplyId, 'wire')) delete w.supplyId
    if (w.tubes) {
      const tubes: WireTubes = {}
      if (has(w.tubes.ends, 'tube')) tubes.ends = w.tubes.ends
      if (has(w.tubes.middle, 'tube')) tubes.middle = w.tubes.middle
      if (tubes.ends || tubes.middle) wires[i] = { ...w, tubes }
      else delete w.tubes
    }
  })

  const schematic = o.schematic === undefined ? undefined : readSchematic(o.schematic, errors, { instances: instanceById, junctions: junctionIds, wires: new Set(wires.map((w) => w.id)) })

  if (name === undefined) return undefined
  return {
    version: PROJECT_FILE_VERSION, name, parts, instances, wires,
    ...(schematic && Object.keys(schematic).length > 0 ? { schematic } : {}),
    ...(junctions.length > 0 ? { junctions } : {}),
    ...(notes.length > 0 ? { notes } : {}),
    ...(meta ? { meta } : {}),
    ...(bom ? { bom } : {}),
    ...(Object.keys(supplies).length > 0 ? { supplies } : {})
  }
}

/** 회로도 (039). 없는 부품·접속점·전선을 가리키는 항목은 조용히 뺀다 (지운 뒤 남은 자리) */
function readSchematic(
  v: unknown,
  errors: Errors,
  known: { instances: ReadonlyMap<string, unknown>; junctions: ReadonlySet<string>; wires: ReadonlySet<string> }
): Schematic | undefined {
  if (!isObject(v)) return notObject('schematic', errors)
  const point = (o: unknown, path: string) => {
    if (!isObject(o)) return notObject(path, errors)
    const x = num(o, 'x', path + '.', errors, { min: -1e7, max: 1e7 })
    const y = num(o, 'y', path + '.', errors, { min: -1e7, max: 1e7 })
    return x === undefined || y === undefined ? undefined : { o, x, y }
  }
  const out: Schematic = {}
  if (v.symbols !== undefined) {
    if (!isObject(v.symbols)) errors.push('{path}: 객체가 아닙니다', { path: 'schematic.symbols' })
    else {
      const symbols: Record<string, SchPlacement> = {}
      for (const [id, raw] of Object.entries(v.symbols)) {
        const path = `schematic.symbols.${id}`
        const p = point(raw, path)
        if (!p) continue
        const rotation = p.o.rotation
        if (rotation !== undefined && !SCH_ROTATIONS.includes(rotation as SchRotation)) {
          errors.push('{path}: 범위를 벗어났습니다 ({value})', { path: `${path}.rotation`, value: String(rotation) })
          continue
        }
        const mirror = optBool(p.o, 'mirror', path + '.', errors)
        if (!known.instances.has(id)) continue
        symbols[id] = { x: p.x, y: p.y, ...(rotation ? { rotation: rotation as SchRotation } : {}), ...(mirror.mirror ? { mirror: true } : {}) }
      }
      if (Object.keys(symbols).length > 0) out.symbols = symbols
    }
  }
  if (v.junctions !== undefined) {
    if (!isObject(v.junctions)) errors.push('{path}: 객체가 아닙니다', { path: 'schematic.junctions' })
    else {
      const junctions: Record<string, { x: number; y: number }> = {}
      for (const [id, raw] of Object.entries(v.junctions)) {
        const p = point(raw, `schematic.junctions.${id}`)
        if (p && known.junctions.has(id)) junctions[id] = { x: p.x, y: p.y }
      }
      if (Object.keys(junctions).length > 0) out.junctions = junctions
    }
  }
  if (v.labeled !== undefined) {
    if (!Array.isArray(v.labeled) || !v.labeled.every((x) => typeof x === 'string')) errors.push('{path}: 배열이어야 합니다', { path: 'schematic.labeled' })
    else {
      const labeled = [...new Set(v.labeled as string[])].filter((id) => known.wires.has(id))
      if (labeled.length > 0) out.labeled = labeled
    }
  }
  return out
}

function readSupply(v: unknown, path: string, errors: Errors): Supply | undefined {
  if (!isObject(v)) return notObject(path || 'supply', errors)
  const id = str(v, 'id', path, errors)
  const name = str(v, 'name', path, errors)
  const kind = v.kind
  const kindOk = SUPPLY_KINDS.includes(kind as SupplyKind)
  if (!kindOk) errors.push("{path}: 'housing', 'terminal', 'tube', 'wire' 중 하나여야 합니다", { path: `${path}kind` })
  const unitPrice = optPrice(v, 'unitPrice', path, errors)
  const purchase = optStr(v, 'purchaseUrl', path, errors)
  if (purchase.purchaseUrl !== undefined && !isHttpUrl(purchase.purchaseUrl)) {
    errors.push('{path}: http:// 또는 https:// 주소여야 합니다', { path: `${path}purchaseUrl` })
  }
  const image = v.image === undefined ? undefined : readImage(v.image, `${path}image.`, errors)
  const drawing = v.drawing === undefined ? undefined : readDrawing(v.drawing, `${path}drawing.`, errors)
  const diameter = v.diameter === undefined ? undefined : num(v, 'diameter', path, errors, { min: Number.MIN_VALUE })
  const awg = v.awg === undefined ? undefined : num(v, 'awg', path, errors, { min: AWG_MIN, max: AWG_MAX })
  if (awg !== undefined && !Number.isInteger(awg)) errors.push('{path}: 정수여야 합니다', { path: `${path}awg` })
  if (id === undefined || name === undefined || !kindOk) return undefined
  return {
    id,
    kind: kind as SupplyKind,
    name,
    ...optStr(v, 'partNumber', path, errors),
    ...optStr(v, 'manufacturer', path, errors),
    ...purchase,
    ...optStr(v, 'supplier', path, errors),
    ...(unitPrice !== undefined ? { unitPrice } : {}),
    ...optCurrency(v, path, errors),
    ...optStr(v, 'memo', path, errors),
    ...(image ? { image } : {}),
    ...(drawing ? { drawing } : {}),
    ...optStr(v, 'connectorType', path, errors),
    ...optStr(v, 'terminalId', path, errors),
    ...(diameter !== undefined ? { diameter } : {}),
    ...optStr(v, 'color', path, errors),
    ...(awg !== undefined ? { awg } : {}),
    ...optStr(v, 'pack', path, errors)
  }
}

function readPart(v: unknown, path: string, errors: Errors): PartDef | undefined {
  if (!isObject(v)) {
    errors.push('{path}: 객체가 아닙니다', { path: path || 'part' })
    return undefined
  }
  const id = str(v, 'id', path, errors)
  const name = str(v, 'name', path, errors)
  const image = readImage(v.image, `${path}image.`, errors)
  const connectors = list(v, 'connectors', path, errors, (c, p) => readConnector(c, p, errors))
  checkUnique(connectors, `${path}connectors`, errors)
  const pins = list(v, 'pins', path, errors, (c, p) => readPin(c, p, errors))
  checkUnique(pins, `${path}pins`, errors)
  pins.forEach((pin, i) => {
    if (pin.connectorId !== undefined && !connectors.some((c) => c.id === pin.connectorId)) {
      errors.push("{path}: 존재하지 않는 커넥터 '{id}'", { path: `${path}pins[${i}].connectorId`, id: pin.connectorId! })
    }
  })
  const unitPrice = optPrice(v, 'unitPrice', path, errors)
  let attachments: Attachment[] | undefined
  if (v.attachments !== undefined) {
    attachments = list(v, 'attachments', path, errors, (a, p) => readAttachment(a, p, errors))
    checkUnique(attachments, `${path}attachments`, errors)
  }
  const purchase = optStr(v, 'purchaseUrl', path, errors)
  if (purchase.purchaseUrl !== undefined && !isHttpUrl(purchase.purchaseUrl)) {
    errors.push('{path}: http:// 또는 https:// 주소여야 합니다', { path: `${path}purchaseUrl` })
  }
  const drawing = v.drawing === undefined ? undefined : readDrawing(v.drawing, `${path}drawing.`, errors)
  const symbol = v.symbol === undefined ? undefined : readSymbol(v.symbol, `${path}symbol.`, pins, errors)
  if (id === undefined || name === undefined || !image) return undefined
  return {
    id,
    name,
    ...optStr(v, 'partNumber', path, errors),
    ...optStr(v, 'manufacturer', path, errors),
    ...optStr(v, 'memo', path, errors),
    ...optStr(v, 'refPrefix', path, errors),
    ...purchase,
    ...optStr(v, 'supplier', path, errors),
    ...(unitPrice !== undefined ? { unitPrice } : {}),
    ...optCurrency(v, path, errors),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    image,
    ...(drawing ? { drawing } : {}),
    ...(symbol ? { symbol } : {}),
    connectors,
    pins
  }
}

// ---- 회로도 기호 (038)

function optElectrical(o: Record<string, unknown>, path: string, errors: Errors): { electrical?: PinElectrical } {
  const v = o.electrical
  if (v === undefined) return {}
  if (PIN_ELECTRICALS.includes(v as PinElectrical)) return v === 'passive' ? {} : { electrical: v as PinElectrical }
  errors.push('{path}: 범위를 벗어났습니다 ({value})', { path: `${path}electrical`, value: String(v) })
  return {}
}

function readSymbol(v: unknown, path: string, pins: readonly Pin[], errors: Errors): PartSymbol | undefined {
  if (!isObject(v)) return notObject(path, errors)
  const drawing = readDrawing(v.drawing, `${path}drawing.`, errors)
  const ids = new Set(pins.map((p) => p.id))
  const seen = new Set<string>()
  const symbolPins = list(v, 'pins', path, errors, (sp, p): SymbolPin | undefined => {
    if (!isObject(sp)) return notObject(p, errors)
    const pinId = str(sp, 'pinId', p, errors)
    const x = num(sp, 'x', p, errors)
    const y = num(sp, 'y', p, errors)
    const side = sp.side
    if (!SYMBOL_SIDES.includes(side as SymbolSide)) errors.push('{path}: 범위를 벗어났습니다 ({value})', { path: `${p}side`, value: String(side) })
    const length = optNum(sp, 'length', p, errors, { min: 0, max: 1000 })
    if (pinId !== undefined && !ids.has(pinId)) errors.push('{path}: 존재하지 않는 핀을 가리킵니다', { path: `${p}pinId` })
    if (pinId !== undefined && seen.has(pinId)) errors.push("{path}: id '{id}'가 중복됩니다", { path: `${path}pins`, id: pinId })
    if (pinId !== undefined) seen.add(pinId)
    if (pinId === undefined || x === undefined || y === undefined || !SYMBOL_SIDES.includes(side as SymbolSide)) return undefined
    return { pinId, x, y, side: side as SymbolSide, ...length }
  })
  const flags = { ...optBoolFalse(v, 'showNumbers', path, errors), ...optBoolFalse(v, 'showNames', path, errors) }
  if (!drawing) return undefined
  return { drawing, pins: symbolPins, ...flags }
}

/** 기본값이 true인 칸: false일 때만 남긴다 */
function optBoolFalse(o: Record<string, unknown>, key: string, path: string, errors: Errors): { [k: string]: false } {
  const v = o[key]
  if (v === undefined || v === true) return {}
  if (v === false) return { [key]: false }
  errors.push('{path}: true/false여야 합니다', { path: path + key })
  return {}
}

// ---- 부품 그림 원본 (037b)

const COLOR = /^#[0-9a-f]{6}$/i
const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right']

function optColor(o: Record<string, unknown>, key: string, path: string, errors: Errors): { [k: string]: string } {
  const v = o[key]
  if (v === undefined) return {}
  if (typeof v === 'string' && COLOR.test(v)) return { [key]: v }
  errors.push('{path}: 색은 #rrggbb 형식이어야 합니다', { path: path + key })
  return {}
}

function optBool(o: Record<string, unknown>, key: string, path: string, errors: Errors): { [k: string]: true } {
  const v = o[key]
  if (v === undefined || v === false) return {}
  if (v === true) return { [key]: true }
  errors.push('{path}: true/false여야 합니다', { path: path + key })
  return {}
}

function optNum(o: Record<string, unknown>, key: string, path: string, errors: Errors, range: { min?: number; max?: number } = {}): { [k: string]: number } {
  if (o[key] === undefined) return {}
  const n = num(o, key, path, errors, range)
  return n === undefined ? {} : { [key]: n }
}

function readDrawing(v: unknown, path: string, errors: Errors): Drawing | undefined {
  if (!isObject(v)) return notObject(path, errors)
  const width = num(v, 'width', path, errors, { min: DRAWING_MIN, max: DRAWING_MAX })
  const height = num(v, 'height', path, errors, { min: DRAWING_MIN, max: DRAWING_MAX })
  const background = optColor(v, 'background', path, errors)
  const shapes = list(v, 'shapes', path, errors, (s, p) => readShape(s, p, errors))
  if (shapes.length > SHAPES_MAX) errors.push('{path}: 범위를 벗어났습니다 ({value})', { path: `${path}shapes`, value: shapes.length })
  checkUnique(shapes, `${path}shapes`, errors)
  if (width === undefined || height === undefined) return undefined
  return { width, height, ...background, shapes }
}

function readShape(v: unknown, path: string, errors: Errors): Shape | undefined {
  if (!isObject(v)) return notObject(path, errors)
  const id = str(v, 'id', path, errors)
  const x = num(v, 'x', path, errors)
  const y = num(v, 'y', path, errors)
  const base = {
    ...optNum(v, 'rotation', path, errors, { min: -360, max: 360 }),
    ...optNum(v, 'opacity', path, errors, { min: 0, max: 1 }),
    ...optBool(v, 'locked', path, errors)
  }
  const size = (key: 'w' | 'h') => num(v, key, path, errors, { min: 0, max: DRAWING_MAX * 4 })
  const paint = () => ({ ...optColor(v, 'fill', path, errors), ...optColor(v, 'stroke', path, errors), ...optNum(v, 'strokeWidth', path, errors, { min: 0, max: 200 }) })
  if (id === undefined || x === undefined || y === undefined) return undefined
  const head = { id, x, y, ...base }
  switch (v.type) {
    case 'rect': {
      const w = size('w')
      const h = size('h')
      const extra = { ...paint(), ...optNum(v, 'radius', path, errors, { min: 0, max: DRAWING_MAX }) }
      return w === undefined || h === undefined ? undefined : { ...head, type: 'rect', w, h, ...extra }
    }
    case 'ellipse': {
      const w = size('w')
      const h = size('h')
      const extra = paint()
      return w === undefined || h === undefined ? undefined : { ...head, type: 'ellipse', w, h, ...extra }
    }
    case 'line': {
      const points = v.points
      const ok = Array.isArray(points) && points.length >= 4 && points.length % 2 === 0 && points.every((n) => typeof n === 'number' && Number.isFinite(n))
      if (!ok) errors.push('{path}: 배열이어야 합니다', { path: `${path}points` })
      const stroke = typeof v.stroke === 'string' && COLOR.test(v.stroke) ? v.stroke : undefined
      if (!stroke) errors.push('{path}: 색은 #rrggbb 형식이어야 합니다', { path: `${path}stroke` })
      const strokeWidth = num(v, 'strokeWidth', path, errors, { min: 0, max: 200 })
      const extra = {
        ...optBool(v, 'arrowStart', path, errors),
        ...optBool(v, 'arrowEnd', path, errors),
        ...optBool(v, 'dashed', path, errors),
        ...optBool(v, 'closed', path, errors),
        ...optColor(v, 'fill', path, errors)
      }
      if (!ok || !stroke || strokeWidth === undefined) return undefined
      return { ...head, type: 'line', points: [...(points as number[])], stroke, strokeWidth, ...extra }
    }
    case 'text': {
      const w = size('w')
      const text = str(v, 'text', path, errors)
      const fontSize = num(v, 'fontSize', path, errors, { min: 1, max: 1000 })
      const color = typeof v.color === 'string' && COLOR.test(v.color) ? v.color : undefined
      if (!color) errors.push('{path}: 색은 #rrggbb 형식이어야 합니다', { path: `${path}color` })
      const align = v.align
      if (align !== undefined && !TEXT_ALIGNS.includes(align as TextAlign)) errors.push('{path}: 범위를 벗어났습니다 ({value})', { path: `${path}align`, value: String(align) })
      const extra = { ...optBool(v, 'bold', path, errors), ...(align !== undefined && TEXT_ALIGNS.includes(align as TextAlign) ? { align: align as TextAlign } : {}) }
      if (w === undefined || text === undefined || fontSize === undefined || !color) return undefined
      return { ...head, type: 'text', w, text, fontSize, color, ...extra }
    }
    case 'image': {
      const w = size('w')
      const h = size('h')
      const src = str(v, 'src', path, errors)
      if (src !== undefined && !src.startsWith('data:image/')) errors.push('{path}: 이미지 data URL이 아닙니다', { path: `${path}src` })
      if (w === undefined || h === undefined || src === undefined || !src.startsWith('data:image/')) return undefined
      return { ...head, type: 'image', w, h, src }
    }
    default:
      errors.push('{path}: 알 수 없는 도형입니다', { path: `${path}type` })
      return undefined
  }
}

function readAttachment(v: unknown, path: string, errors: Errors): Attachment | undefined {
  if (!isObject(v)) return notObject(path, errors)
  const id = str(v, 'id', path, errors)
  if (id !== undefined && !ATTACHMENT_ID.test(id)) errors.push('{path}: 첨부 id가 올바르지 않습니다', { path: `${path}id` })
  const name = str(v, 'name', path, errors)
  const type = v.type
  if (!isAttachmentType(type)) errors.push('{path}: 지원하지 않는 첨부 형식입니다', { path: `${path}type` })
  const size = num(v, 'size', path, errors, { min: 0 })
  if (id === undefined || !ATTACHMENT_ID.test(id) || name === undefined || !isAttachmentType(type) || size === undefined) return undefined
  return { id, name, type, size }
}

function readImage(v: unknown, path: string, errors: Errors): PartImage | undefined {
  if (!isObject(v)) {
    errors.push('{path}: 객체가 아닙니다', { path: path.slice(0, -1) })
    return undefined
  }
  const data = str(v, 'data', path, errors)
  if (data !== undefined && !data.startsWith('data:image/')) {
    errors.push('{path}: 이미지 data URL이 아닙니다', { path: `${path}data` })
  }
  const width = num(v, 'width', path, errors, { min: 1 })
  const height = num(v, 'height', path, errors, { min: 1 })
  if (data === undefined || width === undefined || height === undefined) return undefined
  return { data, width, height }
}

function readConnector(v: unknown, path: string, errors: Errors): Connector | undefined {
  if (!isObject(v)) return notObject(path, errors)
  const id = str(v, 'id', path, errors)
  const name = str(v, 'name', path, errors)
  const type = str(v, 'type', path, errors)
  return id !== undefined && name !== undefined && type !== undefined ? { id, name, type } : undefined
}

function readPin(v: unknown, path: string, errors: Errors): Pin | undefined {
  if (!isObject(v)) return notObject(path, errors)
  const id = str(v, 'id', path, errors)
  const number = str(v, 'number', path, errors)
  const x = num(v, 'x', path, errors, { min: 0, max: 1 })
  const y = num(v, 'y', path, errors, { min: 0, max: 1 })
  if (id === undefined || number === undefined || x === undefined || y === undefined) return undefined
  return {
    id,
    number,
    ...optStr(v, 'signal', path, errors),
    ...optStr(v, 'connectorId', path, errors),
    x,
    y,
    ...optElectrical(v, path, errors)
  }
}

function readInstance(v: unknown, path: string, errors: Errors): PartInstance | undefined {
  if (!isObject(v)) return notObject(path, errors)
  const id = str(v, 'id', path, errors)
  const partId = str(v, 'partId', path, errors)
  const refDes = str(v, 'refDes', path, errors)
  const x = num(v, 'x', path, errors)
  const y = num(v, 'y', path, errors)
  const rotation = num(v, 'rotation', path, errors)
  const scale = num(v, 'scale', path, errors, { min: Number.MIN_VALUE })
  if (
    id === undefined || partId === undefined || refDes === undefined ||
    x === undefined || y === undefined || rotation === undefined || scale === undefined
  ) return undefined
  const flipped = v.flipped
  if (flipped !== undefined && typeof flipped !== 'boolean') errors.push('{path}: true/false여야 합니다', { path: `${path}flipped` })
  return { id, partId, refDes, x, y, rotation, scale, ...(flipped === true ? { flipped: true } : {}) }
}

function readWire(v: unknown, path: string, errors: Errors): Wire | undefined {
  if (!isObject(v)) return notObject(path, errors)
  const id = str(v, 'id', path, errors)
  const from = readEnd(v.from, `${path}from.`, errors)
  const to = readEnd(v.to, `${path}to.`, errors)
  const color = str(v, 'color', path, errors)
  const width = num(v, 'width', path, errors, { min: Number.MIN_VALUE })
  let points: { x: number; y: number }[] | undefined
  if (v.points !== undefined) {
    if (!Array.isArray(v.points)) errors.push('{path}: 배열이어야 합니다', { path: `${path}points` })
    else {
      points = []
      v.points.forEach((p: unknown, i: number) => {
        if (!isObject(p)) return notObject(`${path}points[${i}]`, errors)
        const x = num(p, 'x', `${path}points[${i}].`, errors)
        const y = num(p, 'y', `${path}points[${i}].`, errors)
        if (x !== undefined && y !== undefined) points!.push({ x, y })
      })
    }
  }
  const orthogonal = v.orthogonal
  if (orthogonal !== undefined && typeof orthogonal !== 'boolean') errors.push('{path}: true/false여야 합니다', { path: `${path}orthogonal` })
  const awg = v.awg === undefined ? undefined : num(v, 'awg', path, errors, { min: AWG_MIN, max: AWG_MAX })
  if (awg !== undefined && !Number.isInteger(awg)) errors.push('{path}: 정수여야 합니다', { path: `${path}awg` })
  const direction = v.direction
  const directionOk = direction === undefined || WIRE_DIRECTIONS.includes(direction as WireDirection)
  if (!directionOk) errors.push("{path}: 'forward' 또는 'reverse'여야 합니다", { path: `${path}direction` })
  let tubes: WireTubes | undefined
  if (v.tubes !== undefined) {
    if (!isObject(v.tubes)) notObject(`${path}tubes`, errors)
    else {
      const tb = { ...optStr(v.tubes, 'ends', `${path}tubes.`, errors), ...optStr(v.tubes, 'middle', `${path}tubes.`, errors) }
      if (tb.ends !== undefined || tb.middle !== undefined) tubes = tb
    }
  }
  if (id === undefined || !from || !to || color === undefined || width === undefined) return undefined
  return {
    id, from, to, color, width,
    ...optStr(v, 'label', path, errors),
    ...(points && points.length > 0 ? { points } : {}),
    ...(orthogonal === true ? { orthogonal: true } : {}),
    ...(awg !== undefined ? { awg } : {}),
    ...optStr(v, 'memo', path, errors),
    ...(directionOk && direction !== undefined ? { direction: direction as WireDirection } : {}),
    ...optStr(v, 'supplyId', path, errors),
    ...(tubes ? { tubes } : {})
  }
}

/** 전선 끝: { junctionId } 또는 { instanceId, pinId } */
function readEnd(v: unknown, path: string, errors: Errors): WireEnd | undefined {
  if (isObject(v) && 'junctionId' in v) {
    const junctionId = str(v, 'junctionId', path, errors)
    return junctionId !== undefined ? { junctionId } : undefined
  }
  return readPinRef(v, path, errors)
}

function readJunction(v: unknown, path: string, errors: Errors): Junction | undefined {
  if (!isObject(v)) return notObject(path, errors)
  const id = str(v, 'id', path, errors)
  const label = str(v, 'label', path, errors)
  const x = num(v, 'x', path, errors)
  const y = num(v, 'y', path, errors)
  return id !== undefined && label !== undefined && x !== undefined && y !== undefined ? { id, label, x, y } : undefined
}

function readNote(v: unknown, path: string, errors: Errors): Note | undefined {
  if (!isObject(v)) return notObject(path, errors)
  const id = str(v, 'id', path, errors)
  const x = num(v, 'x', path, errors)
  const y = num(v, 'y', path, errors)
  const width = num(v, 'width', path, errors, { min: 1 })
  const text = str(v, 'text', path, errors)
  const fontSize = v.fontSize === undefined ? undefined : num(v, 'fontSize', path, errors, { min: 4, max: 200 })
  if (id === undefined || x === undefined || y === undefined || width === undefined || text === undefined) return undefined
  return { id, x, y, width, text, ...(fontSize !== undefined ? { fontSize } : {}), ...optStr(v, 'color', path, errors) }
}

function readPinRef(v: unknown, path: string, errors: Errors): PinRef | undefined {
  if (!isObject(v)) return notObject(path.slice(0, -1), errors)
  const instanceId = str(v, 'instanceId', path, errors)
  const pinId = str(v, 'pinId', path, errors)
  return instanceId !== undefined && pinId !== undefined ? { instanceId, pinId } : undefined
}

function readBom(v: unknown, errors: Errors): ProjectBom | undefined {
  if (!isObject(v)) return notObject('bom', errors)
  const bom: ProjectBom = {}
  if (v.overrides !== undefined) {
    if (!isObject(v.overrides)) errors.push('{path}: 객체가 아닙니다', { path: 'bom.overrides' })
    else {
      const overrides: Record<string, BomOverride> = {}
      for (const [key, o] of Object.entries(v.overrides)) {
        if (!isObject(o)) {
          notObject(`bom.overrides.${key}`, errors)
          continue
        }
        const p = `bom.overrides.${key}.`
        const unitPrice = optPrice(o, 'unitPrice', p, errors)
        overrides[key] = { ...(unitPrice !== undefined ? { unitPrice } : {}), ...optStr(o, 'memo', p, errors), ...optStr(o, 'supplier', p, errors) }
      }
      bom.overrides = overrides
    }
  }
  if (v.items !== undefined) {
    bom.items = list(v, 'items', 'bom.', errors, (it, p) => {
      if (!isObject(it)) return notObject(p, errors)
      const id = str(it, 'id', p, errors)
      const name = str(it, 'name', p, errors)
      const quantity = num(it, 'quantity', p, errors, { min: 0 })
      const unitPrice = optPrice(it, 'unitPrice', p, errors)
      const url = optStr(it, 'purchaseUrl', p, errors)
      if (url.purchaseUrl !== undefined && !isHttpUrl(url.purchaseUrl)) errors.push('{path}: http:// 또는 https:// 주소여야 합니다', { path: `${p}purchaseUrl` })
      if (id === undefined || name === undefined || quantity === undefined) return undefined
      const item: BomItem = {
        id, name, quantity,
        ...optStr(it, 'partNumber', p, errors),
        ...optStr(it, 'manufacturer', p, errors),
        ...(unitPrice !== undefined ? { unitPrice } : {}),
        ...url,
        ...optStr(it, 'memo', p, errors),
        ...optStr(it, 'supplier', p, errors)
      }
      return item
    })
    checkUnique(bom.items, 'bom.items', errors)
  }
  if (v.supplies !== undefined) {
    if (!isObject(v.supplies)) errors.push('{path}: 객체가 아닙니다', { path: 'bom.supplies' })
    else {
      const choices: Record<string, SupplyChoice> = {}
      for (const [key, c] of Object.entries(v.supplies)) {
        const p = `bom.supplies.${key}.`
        if (!isObject(c)) {
          notObject(p.slice(0, -1), errors)
          continue
        }
        if (typeof c.include !== 'boolean') {
          errors.push('{path}: true/false여야 합니다', { path: `${p}include` })
          continue
        }
        const quantity = c.quantity === undefined ? undefined : num(c, 'quantity', p, errors, { min: 0 })
        const unitPrice = optPrice(c, 'unitPrice', p, errors)
        choices[key] = {
          include: c.include,
          ...(quantity !== undefined ? { quantity } : {}),
          ...(unitPrice !== undefined ? { unitPrice } : {}),
          ...optStr(c, 'memo', p, errors),
          ...optStr(c, 'supplier', p, errors)
        }
      }
      if (Object.keys(choices).length > 0) bom.supplies = choices
    }
  }
  const { currency } = optCurrency(v, 'bom.', errors)
  if (currency && currency !== 'KRW') bom.currency = currency
  if (v.exchangeRate !== undefined) {
    const rate = num(v, 'exchangeRate', 'bom.', errors, { min: Number.MIN_VALUE })
    if (rate !== undefined) bom.exchangeRate = rate
  }
  return bom
}

/** 선택 통화 필드 (029): 'KRW' | 'USD' */
function optCurrency(o: Record<string, unknown>, path: string, errors: Errors): { currency?: Currency } {
  const c = o.currency
  if (c === undefined) return {}
  if (!CURRENCIES.includes(c as Currency)) {
    errors.push("{path}: 'KRW' 또는 'USD'여야 합니다", { path: `${path}currency` })
    return {}
  }
  return c === 'KRW' ? {} : { currency: c as Currency }
}

// ---------------------------------------------------------------- 도우미

/** 선택 금액 필드: 0 이상 숫자 */
function optPrice(o: Record<string, unknown>, key: string, path: string, errors: Errors): number | undefined {
  return o[key] === undefined ? undefined : num(o, key, path, errors, { min: 0 })
}

function parseJson(text: string, t: T): ParseResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    return { ok: false, errors: [t('JSON 형식이 아닙니다: {detail}', { detail: (e as Error).message })] }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function notObject(path: string, errors: Errors): undefined {
  errors.push('{path}: 객체가 아닙니다', { path: path.replace(/\.$/, '') })
  return undefined
}

function str(o: Record<string, unknown>, key: string, path: string, errors: Errors): string | undefined {
  const v = o[key]
  if (typeof v === 'string') return v
  errors.push('{path}: 문자열이어야 합니다', { path: path + key })
  return undefined
}

/** 선택 문자열 필드. 있으면 { key: 값 }, 없으면 {} 를 돌려줘 객체에 펼쳐 넣는다 */
function optStr(o: Record<string, unknown>, key: string, path: string, errors: Errors) {
  const v = o[key]
  if (v === undefined) return {}
  if (typeof v === 'string') return { [key]: v }
  errors.push('{path}: 문자열이어야 합니다', { path: path + key })
  return {}
}

function num(
  o: Record<string, unknown>,
  key: string,
  path: string,
  errors: Errors,
  range: { min?: number; max?: number } = {}
): number | undefined {
  const v = o[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    errors.push('{path}: 숫자여야 합니다', { path: path + key })
    return undefined
  }
  if ((range.min !== undefined && v < range.min) || (range.max !== undefined && v > range.max)) {
    errors.push('{path}: 범위를 벗어났습니다 ({value})', { path: path + key, value: v })
    return undefined
  }
  return v
}

function list<T>(
  o: Record<string, unknown>,
  key: string,
  path: string,
  errors: Errors,
  read: (v: unknown, path: string) => T | undefined
): T[] {
  const v = o[key]
  if (!Array.isArray(v)) {
    errors.push('{path}: 배열이어야 합니다', { path: path + key })
    return []
  }
  return v.flatMap((item, i) => {
    const r = read(item, `${path}${key}[${i}].`)
    return r === undefined ? [] : [r]
  })
}

function checkUnique(items: { id: string }[], path: string, errors: Errors) {
  const seen = new Set<string>()
  for (const { id } of items) {
    if (seen.has(id)) errors.push("{path}: id '{id}'가 중복됩니다", { path, id })
    seen.add(id)
  }
}
