// 부품 라이브러리 파일 가져오기/내보내기
import type { PartDef, Supply } from './model'
import { parseAttachmentData, parsePart, parseProjectFile, readPartValue, readSupplyValue, type ProjectFile } from './serialize'
import type { AttachmentData } from './attachment'
import type { Project } from './model'
import { ko, type T } from './i18n'

export const LIBRARY_FORMAT = 'open-perfboard-library'
export const LIBRARY_VERSION = 1

/** 라이브러리 파일 이름으로 쓸 수 있는 부품 id (main/repositories/library.ts와 같은 규칙) */
export const SAFE_PART_ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * 라이브러리 묶음 파일. attachmentData = 첨부 본문, supplies = 부속 부품 (027), 부품·부속 부품의 drawing = 그림 원본 (037b).
 * 모두 덧붙이는 칸이라 예전 버전 앱은 무시하고 부품(구운 사진)만 가져간다 (파일 버전 그대로)
 */
export function serializeLibrary(parts: readonly PartDef[], attachmentData: AttachmentData = {}, supplies: readonly Supply[] = []): string {
  const data = Object.keys(attachmentData).length > 0 ? { attachmentData } : {}
  const sup = supplies.length > 0 ? { supplies } : {}
  return JSON.stringify({ format: LIBRARY_FORMAT, version: LIBRARY_VERSION, parts, ...sup, ...data }, null, 2)
}

export interface LibraryFileResult {
  /** 이 파일에서 읽은 부품 */
  parts: PartDef[]
  /** 읽지 못한 부품·파일에 대한 설명 */
  problems: string[]
  kind: 'library' | 'part' | 'project' | 'unknown'
  /** 파일에 들어 있던 첨부 본문 (없으면 빈 객체) */
  attachmentData?: AttachmentData
  /** 파일에 들어 있던 부속 부품 (027) */
  supplies?: Supply[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 파일 내용을 보고 형식을 판별해 부품을 꺼낸다.
 * - 라이브러리 묶음(.opblib): 부품마다 검증, 잘못된 부품만 건너뛴다
 * - 부품 하나(.json)
 * - 배선도(.opb): 그 안에 쓰인 부품 정의 사본들
 */
export function readLibraryFile(text: string, fileName = 'file', t: T = ko): LibraryFileResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { parts: [], problems: [t('{file}: JSON 형식이 아닙니다', { file: fileName })], kind: 'unknown' }
  }
  if (!isObject(raw)) return { parts: [], problems: [t('{file}: 알 수 없는 형식입니다', { file: fileName })], kind: 'unknown' }

  if (raw.format === LIBRARY_FORMAT) {
    if (typeof raw.version !== 'number' || raw.version > LIBRARY_VERSION) {
      return { parts: [], problems: [t('{file}: 더 새로운 버전의 부품함 파일입니다', { file: fileName })], kind: 'library' }
    }
    if (!Array.isArray(raw.parts)) return { parts: [], problems: [t('{file}: parts가 배열이 아닙니다', { file: fileName })], kind: 'library' }
    const parts: PartDef[] = []
    const problems: string[] = []
    raw.parts.forEach((p, i) => {
      const r = readPartValue(p, t)
      if (r.ok) parts.push(r.value)
      else {
        const name = isObject(p) && typeof p.name === 'string' ? p.name : t('{n}번째 부품', { n: i + 1 })
        problems.push(`${fileName} · ${name}: ${r.errors[0]}`)
      }
    })
    const att = parseAttachmentData(raw.attachmentData, t)
    problems.push(...att.problems.map((p) => `${fileName}: ${p}`))
    const supplies: Supply[] = []
    if (Array.isArray(raw.supplies)) {
      raw.supplies.forEach((s, i) => {
        const r = readSupplyValue(s, t)
        if (r.ok) supplies.push(r.value)
        else {
          const name = isObject(s) && typeof s.name === 'string' ? s.name : t('{n}번째 부속 부품', { n: i + 1 })
          problems.push(`${fileName} · ${name}: ${r.errors[0]}`)
        }
      })
    }
    return { parts, problems, kind: 'library', attachmentData: att.data, supplies }
  }

  if ('instances' in raw && 'parts' in raw) {
    const r = parseProjectFile(text, t)
    if (!r.ok) return { parts: [], problems: [`${fileName}: ${r.errors[0]}`], kind: 'project' }
    return {
      parts: carriedParts(r.value),
      problems: [],
      kind: 'project',
      attachmentData: r.value.attachmentData,
      supplies: Object.values(r.value.project.supplies ?? {})
    }
  }

  const r = parsePart(text, t)
  if (r.ok) return { parts: [r.value], problems: [], kind: 'part' }
  return { parts: [], problems: [t('{file}: 부품 파일이 아닙니다 ({detail})', { file: fileName, detail: r.errors[0] })], kind: 'unknown' }
}

const sameContent = <V>(a: V, b: V) => JSON.stringify(a) === JSON.stringify(b)

/**
 * 배선도 파일에 함께 넣을 라이브러리. 배선도의 부품 사본과 똑같은 부품은 빼서 파일 크기를 줄인다
 * (열 때 carriedParts가 사본까지 합쳐 돌려준다).
 */
export function embedLibrary(project: Project, library: readonly PartDef[]): PartDef[] {
  return library.filter((p) => {
    const copy = project.parts[p.id]
    return !copy || !sameContent(copy, p)
  })
}

/** 배선도 파일이 가진 부품 전체: 함께 저장된 라이브러리 + 부품 사본. 같은 id면 라이브러리 쪽 */
export function carriedParts(file: ProjectFile): PartDef[] {
  const ids = new Set(file.library.map((p) => p.id))
  return [...file.library, ...Object.values(file.project.parts).filter((p) => !ids.has(p.id))]
}

export type ImportStatus = 'new' | 'same' | 'changed'

/** 가져올 것 하나 (부품 또는 부속 부품) */
export interface ImportEntry<V extends Named = PartDef> {
  part: V
  status: ImportStatus
  /** changed일 때 내 라이브러리의 같은 id 항목 */
  existing?: V
}

interface Named {
  id: string
  name: string
}

/** 들어올 부품(또는 부속 부품)을 내 부품함과 비교해 분류한다. 같은 id가 여러 번 오면 처음 것만 */
export function planImport<V extends Named>(existing: readonly V[], incoming: readonly V[]): ImportEntry<V>[] {
  const mine = new Map(existing.map((p) => [p.id, p]))
  const seen = new Set<string>()
  const plan: ImportEntry<V>[] = []
  for (const part of incoming) {
    if (seen.has(part.id)) continue
    seen.add(part.id)
    const e = mine.get(part.id)
    if (!e) plan.push({ part, status: 'new' })
    else if (sameContent(e, part)) plan.push({ part, status: 'same' })
    else plan.push({ part, status: 'changed', existing: e })
  }
  return plan
}

export type ConflictChoice = 'overwrite' | 'copy' | 'skip'

/** 실제로 저장할 목록. 사본은 새 id와 "(가져옴)"이 붙은 이름 */
export function resolveImport<V extends Named>(plan: readonly ImportEntry<V>[], choice: ConflictChoice, newId: () => string, t: T = ko): V[] {
  const out: V[] = []
  for (const e of plan) {
    // 파일 이름으로 쓸 수 없는 id(다른 곳에서 만든 부품 등)는 새 id로 바꾼다
    if (e.status === 'new') out.push(SAFE_PART_ID.test(e.part.id) ? e.part : { ...e.part, id: newId() })
    else if (e.status === 'changed') {
      if (choice === 'overwrite') out.push(e.part)
      else if (choice === 'copy') out.push({ ...e.part, id: newId(), name: t('{name} (가져옴)', { name: e.part.name }) })
    }
  }
  return out
}

export function importSummary<V extends Named>(plan: readonly ImportEntry<V>[]): Record<ImportStatus, number> {
  return {
    new: plan.filter((e) => e.status === 'new').length,
    same: plan.filter((e) => e.status === 'same').length,
    changed: plan.filter((e) => e.status === 'changed').length
  }
}
