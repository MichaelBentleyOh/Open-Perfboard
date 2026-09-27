// 프로젝트/부품 파일 직렬화와 검증.
// 파일 내용은 외부 입력이므로 필드 하나하나 검사하고, 알려진 필드만 골라 새 객체를 만든다.
import {
  type Attachment,
  AWG_MAX,
  AWG_MIN,
  PROJECT_FILE_VERSION,
  type Connector,
  type PartDef,
  type PartImage,
  type PartInstance,
  type Pin,
  type PinRef,
  type BomItem,
  type BomOverride,
  type Junction,
  type WireEnd,
  type Project,
  type ProjectBom,
  type ProjectMeta,
  type Wire
} from './model'
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
  4: (raw) => ({ ...raw, version: 5 })
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

  if (name === undefined) return undefined
  return {
    version: PROJECT_FILE_VERSION, name, parts, instances, wires,
    ...(junctions.length > 0 ? { junctions } : {}),
    ...(meta ? { meta } : {}),
    ...(bom ? { bom } : {})
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
  if (id === undefined || name === undefined || !image) return undefined
  return {
    id,
    name,
    ...optStr(v, 'partNumber', path, errors),
    ...optStr(v, 'manufacturer', path, errors),
    ...optStr(v, 'memo', path, errors),
    ...optStr(v, 'refPrefix', path, errors),
    ...purchase,
    ...(unitPrice !== undefined ? { unitPrice } : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    image,
    connectors,
    pins
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
    y
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
  const length = v.length === undefined ? undefined : num(v, 'length', path, errors, { min: 0 })
  if (id === undefined || !from || !to || color === undefined || width === undefined) return undefined
  return {
    id, from, to, color, width,
    ...optStr(v, 'label', path, errors),
    ...(points && points.length > 0 ? { points } : {}),
    ...(orthogonal === true ? { orthogonal: true } : {}),
    ...(awg !== undefined ? { awg } : {}),
    ...(length !== undefined ? { length } : {})
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
        overrides[key] = { ...(unitPrice !== undefined ? { unitPrice } : {}), ...optStr(o, 'memo', p, errors) }
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
        ...optStr(it, 'memo', p, errors)
      }
      return item
    })
    checkUnique(bom.items, 'bom.items', errors)
  }
  return bom
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
