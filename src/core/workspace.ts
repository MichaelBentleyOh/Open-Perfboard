// 여러 배선도 (030): 파일(.opb 하나 또는 .zip 묶음)과 여러 배선도를 합친 BOM·결선표.
// - .zip = manifest.json + 배선도마다 .opb(지금 형식 그대로) + library.opblib(부품함·부속 부품·첨부 본문)
// - 자동 저장(복구)은 문자열이라 같은 내용을 JSON 하나로 쓴다
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { AttachmentData } from './attachment'
import { buildBom, numberRows, type BomRow } from './bom'
import { roundMoney } from './money'
import { carriedParts, readLibraryFile, serializeLibrary } from './library'
import type { PartDef, Project, Supply } from './model'
import { NETLIST_COLUMNS, buildNetlist, type NetlistRow } from './netlist'
import type { CsvColumn } from './csv'
import { parseProjectFile, serializeProject, type ParseResult } from './serialize'
import { naturalCompare } from './sort'
import { supplyUsage, type MissingHousing, type SupplyUse } from './supply'
import { ko, msg, type T } from './i18n'

export const WORKSPACE_FORMAT = 'open-perfboard-workspace'
export const WORKSPACE_VERSION = 1

/** 열어 낸 문서: 배선도 목록 + 함께 저장된 부품함·부속 부품·첨부 본문 */
export interface OpenedDocument {
  projects: Project[]
  /** 처음 보여 줄 배선도 (projects 번호) */
  active: number
  /** BOM·결선표에 넣을 배선도 번호. 없으면 모두 */
  scope?: number[]
  /** 함께 저장된 부품 (라이브러리 + 부품 사본) */
  library: PartDef[]
  supplies: Supply[]
  attachmentData: AttachmentData
}

export interface WorkspaceMeta {
  active: number
  scope?: number[]
}

/** 파일 이름으로 쓸 수 있게 (Windows 금지 문자) */
const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'diagram'

/** 배선도 파일 이름: 01-배선도 1.opb (같은 이름이 있어도 번호로 구분) */
export const sheetFileName = (index: number, name: string) => `${String(index + 1).padStart(2, '0')}-${safeName(name)}.opb`

interface Manifest {
  format: typeof WORKSPACE_FORMAT
  version: number
  sheets: { file: string }[]
  active: number
  scope?: number[]
}

/** .zip 묶음. library·supplies·attachmentData는 library.opblib 하나에 (배선도마다 중복되지 않게) */
export function serializeWorkspaceZip(
  projects: readonly Project[],
  meta: WorkspaceMeta,
  shared: { library?: readonly PartDef[]; supplies?: readonly Supply[]; attachmentData?: AttachmentData } = {}
): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const sheets = projects.map((p, i) => {
    const file = sheetFileName(i, p.name)
    files[file] = strToU8(serializeProject(p))
    return { file }
  })
  const manifest: Manifest = { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, sheets, active: meta.active, ...(meta.scope ? { scope: meta.scope } : {}) }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  const library = shared.library ?? []
  const supplies = shared.supplies ?? []
  const data = shared.attachmentData ?? {}
  if (library.length > 0 || supplies.length > 0 || Object.keys(data).length > 0) {
    files['library.opblib'] = strToU8(serializeLibrary(library, data, supplies))
  }
  return zipSync(files, { level: 6, mtime: new Date(2020, 0, 1) })
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 번호 목록 검사: 배선도 수 안의 정수만, 중복 제거 */
function readIndexes(v: unknown, count: number): number[] | undefined {
  if (!Array.isArray(v)) return undefined
  return [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < count))]
}

function readActive(v: unknown, count: number): number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < count ? (v as number) : 0
}

/** .zip 묶음을 연다. 배선도 하나라도 읽지 못하면 실패 (어느 파일인지 알려 준다) */
export function parseWorkspaceZip(bytes: Uint8Array, t: T = ko): ParseResult<OpenedDocument> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    return { ok: false, errors: [t('zip 파일을 풀지 못했습니다')] }
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : undefined)
  let manifest: unknown
  try {
    manifest = JSON.parse(text('manifest.json') ?? '')
  } catch {
    return { ok: false, errors: [t('Open Perfboard 배선도 묶음이 아닙니다 (manifest.json 없음)')] }
  }
  if (!isObject(manifest) || manifest.format !== WORKSPACE_FORMAT || !Array.isArray(manifest.sheets)) {
    return { ok: false, errors: [t('Open Perfboard 배선도 묶음이 아닙니다 (manifest.json 없음)')] }
  }
  if (typeof manifest.version !== 'number' || manifest.version > WORKSPACE_VERSION) {
    return { ok: false, errors: [t('이 파일은 더 새로운 버전에서 만들어졌습니다. 프로그램을 업데이트하세요')] }
  }
  const projects: Project[] = []
  const library: PartDef[] = []
  const errors: string[] = []
  for (const s of manifest.sheets) {
    const file = isObject(s) && typeof s.file === 'string' ? s.file : undefined
    const content = file ? text(file) : undefined
    if (!file || content === undefined) {
      errors.push(t('묶음 안에 배선도 파일이 없습니다: {file}', { file: file ?? '?' }))
      continue
    }
    const r = parseProjectFile(content, t)
    if (!r.ok) {
      errors.push(...r.errors.slice(0, 3).map((e) => `${file}: ${e}`))
      continue
    }
    projects.push(r.value.project)
    library.push(...carriedParts(r.value))
  }
  if (errors.length > 0) return { ok: false, errors }
  if (projects.length === 0) return { ok: false, errors: [t('묶음에 배선도가 없습니다')] }
  const lib = text('library.opblib')
  const shared = lib === undefined ? undefined : readLibraryFile(lib, 'library.opblib', t)
  return {
    ok: true,
    value: {
      projects,
      active: readActive(manifest.active, projects.length),
      scope: readIndexes(manifest.scope, projects.length),
      // 같은 id면 library.opblib 쪽 (내 부품함 원본)
      library: dedupe([...(shared?.parts ?? []), ...library]),
      supplies: shared?.supplies ?? [],
      attachmentData: shared?.attachmentData ?? {}
    }
  }
}

const dedupe = <V extends { id: string }>(list: V[]): V[] => {
  const seen = new Set<string>()
  return list.filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)))
}

/** 자동 저장용 JSON (여러 배선도). 하나뿐이면 .opb 내용을 그대로 쓴다 */
export function serializeWorkspaceJson(projects: readonly Project[], meta: WorkspaceMeta): string {
  if (projects.length === 1 && !meta.scope) return serializeProject(projects[0])
  return JSON.stringify({ format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, sheets: projects, active: meta.active, ...(meta.scope ? { scope: meta.scope } : {}) })
}

/** 문자열 문서: .opb 하나 또는 자동 저장 JSON 묶음 */
export function parseDocumentText(text: string, t: T = ko): ParseResult<OpenedDocument> {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    raw = undefined
  }
  if (isObject(raw) && raw.format === WORKSPACE_FORMAT && Array.isArray(raw.sheets)) {
    const projects: Project[] = []
    const errors: string[] = []
    const library: PartDef[] = []
    raw.sheets.forEach((s, i) => {
      const r = parseProjectFile(JSON.stringify(s), t)
      if (r.ok) {
        projects.push(r.value.project)
        library.push(...carriedParts(r.value))
      } else errors.push(...r.errors.slice(0, 3).map((e) => t('{n}번째 배선도: {error}', { n: i + 1, error: e })))
    })
    if (errors.length > 0) return { ok: false, errors }
    if (projects.length === 0) return { ok: false, errors: [t('묶음에 배선도가 없습니다')] }
    return {
      ok: true,
      value: { projects, active: readActive(raw.active, projects.length), scope: readIndexes(raw.scope, projects.length), library: dedupe(library), supplies: [], attachmentData: {} }
    }
  }
  const r = parseProjectFile(text, t)
  if (!r.ok) return r
  return {
    ok: true,
    value: {
      projects: [r.value.project],
      active: 0,
      library: carriedParts(r.value),
      supplies: Object.values(r.value.project.supplies ?? {}),
      attachmentData: r.value.attachmentData
    }
  }
}

// ---------------------------------------------------------------- 여러 배선도를 합친 BOM·결선표

export interface SheetRef {
  id: string
  name: string
  project: Project
}

/** 합친 BOM 행이 어느 배선도의 어느 행에서 왔는지 (고칠 때 모두에 적용) */
export interface ScopedBomRow extends BomRow {
  sources: { sheetId: string; quantity: number; unitPrice?: number }[]
}

/**
 * 고른 배선도들의 BOM. 같은 부품·같은 부속 부품은 한 행으로 합친다 (수량은 더하고, 참조명 앞에 배선도 이름).
 * 배선도마다 단가가 다르면 단가는 비우고(mixedPrice) 금액은 배선도별 금액의 합. 조달처·비고는 먼저 나온 배선도 값.
 * 직접 추가 항목은 배선도마다 따로. 배선도가 하나면 이름을 붙이지 않는다
 */
export function buildScopedBom(sheets: readonly SheetRef[]): ScopedBomRow[] {
  const many = sheets.length > 1
  const merged = new Map<string, ScopedBomRow>()
  const items: ScopedBomRow[] = []
  for (const s of sheets) {
    for (const r of buildBom(s.project)) {
      const refDes = many ? r.refDes.map((ref) => `${s.name}: ${ref}`) : r.refDes
      const source = { sheetId: s.id, quantity: r.quantity, unitPrice: r.unitPrice }
      if (r.kind === 'item') {
        items.push({ ...r, refDes: many ? [s.name] : [], sources: [source] })
        continue
      }
      const key = `${r.kind}\u0000${r.id}`
      const prev = merged.get(key)
      if (!prev) {
        merged.set(key, { ...r, refDes, sources: [source] })
        continue
      }
      merged.set(key, {
        ...prev,
        quantity: prev.quantity + r.quantity,
        suggested: prev.suggested === undefined ? undefined : prev.suggested + (r.suggested ?? 0),
        refDes: [...prev.refDes, ...refDes],
        supplier: prev.supplier ?? r.supplier,
        memo: prev.memo ?? r.memo,
        sources: [...prev.sources, source]
      })
    }
  }
  const order = { part: 0, supply: 1, item: 2 }
  const rows = [...merged.values()].sort(
    (a, b) => order[a.kind] - order[b.kind] || (a.kind === 'part' ? naturalCompare(a.refDes[0] ?? '', b.refDes[0] ?? '') : 0)
  )
  const priced = (r: ScopedBomRow): ScopedBomRow => {
    const prices = new Set(r.sources.map((x) => x.unitPrice))
    if (prices.size === 1) {
      const unitPrice = r.sources[0].unitPrice
      return { ...r, unitPrice, amount: unitPrice === undefined ? undefined : roundMoney(r.quantity * unitPrice) }
    }
    // 배선도마다 단가가 다르다: 단가 없는 배선도가 있으면 금액도 비운다
    const unknown = r.sources.some((x) => x.unitPrice === undefined)
    return {
      ...r,
      unitPrice: undefined,
      mixedPrice: true,
      amount: unknown ? undefined : roundMoney(r.sources.reduce((sum, x) => sum + x.quantity * x.unitPrice!, 0))
    }
  }
  return numberRows([...rows, ...items].map(priced)) as ScopedBomRow[]
}

export interface ScopedNetlistRow extends NetlistRow {
  sheetId: string
  sheetName: string
}

/** 결선표 칸: 배선도가 여럿이면 맨 앞에 배선도 이름 */
export function netlistColumns<R extends NetlistRow & { sheetName?: string }>(many: boolean): CsvColumn<R>[] {
  const base = NETLIST_COLUMNS as CsvColumn<R>[]
  return many ? [{ header: msg('배선도'), value: (r) => r.sheetName }, ...base] : base
}

/** 고른 배선도들의 결선표 (배선도 순서대로, 행마다 배선도 이름) */
export function buildScopedNetlist(sheets: readonly SheetRef[]): ScopedNetlistRow[] {
  return sheets.flatMap((s) => buildNetlist(s.project).map((r) => ({ ...r, sheetId: s.id, sheetName: s.name })))
}

/** 여러 배선도에 쓰인 부속 부품 하나 (합친 양) + 어느 배선도에서 아직 묻는 중/뺐는지 */
export interface ScopedSupplyUse extends SupplyUse {
  /** 아직 넣을지 정하지 않은 배선도 */
  pendingIn: string[]
  /** 뺀 배선도 */
  excludedIn: string[]
}

/**
 * BOM 위 "넣을까요?" 목록을 고른 배선도 전체로 (030). 같은 부속 부품은 합쳐서 한 줄.
 * pending = 한 배선도라도 아직 묻는 중, excluded = 쓰인 배선도 모두에서 뺀 것
 */
export function scopedSupplyQuestions(
  sheets: readonly SheetRef[],
  library: readonly Supply[] = []
): { pending: ScopedSupplyUse[]; excluded: ScopedSupplyUse[]; missing: MissingHousing[] } {
  const many = sheets.length > 1
  const uses = new Map<string, ScopedSupplyUse & { includedIn: number }>()
  const missing = new Map<string, string[]>()
  for (const s of sheets) {
    const report = supplyUsage(s.project, library)
    const choices = s.project.bom?.supplies ?? {}
    const prefix = (refs: string[]) => (many ? refs.map((r) => `${s.name}: ${r}`) : refs)
    for (const u of report.uses) {
      const c = choices[u.supply.id]
      const prev = uses.get(u.supply.id) ?? { ...u, count: 0, suggested: 0, refs: [], ends: undefined, middle: undefined, pendingIn: [], excludedIn: [], includedIn: 0 }
      prev.count += u.count
      prev.suggested += u.suggested
      prev.refs = [...prev.refs, ...prefix(u.refs)]
      if (u.ends !== undefined) prev.ends = (prev.ends ?? 0) + u.ends
      if (u.middle !== undefined) prev.middle = (prev.middle ?? 0) + u.middle
      if (!c) prev.pendingIn.push(s.id)
      else if (c.include) prev.includedIn++
      else prev.excludedIn.push(s.id)
      uses.set(u.supply.id, prev)
    }
    for (const m of report.missing) missing.set(m.type, [...(missing.get(m.type) ?? []), ...prefix(m.refs)])
  }
  const all = [...uses.values()]
  return {
    pending: all.filter((u) => u.pendingIn.length > 0),
    excluded: all.filter((u) => u.pendingIn.length === 0 && u.includedIn === 0 && u.excludedIn.length > 0),
    missing: [...missing].map(([type, refs]) => ({ type, refs })).sort((a, b) => naturalCompare(a.type, b.type))
  }
}

/** 새 배선도 이름: "배선도 N" 중 쓰지 않은 가장 작은 N */
export function nextSheetName(names: readonly string[], base: string): string {
  const used = new Set(names)
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`
    if (!used.has(name)) return name
  }
}
