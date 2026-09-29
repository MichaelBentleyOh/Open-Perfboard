// 부품 작업실(037a)이 고치는 부품·부속 부품 묶음. 내 부품함 또는 열어 둔 .opblib 파일 하나.
import type { PartDef, Supply } from './model'
import { attachmentIdsOf, type AttachmentData } from './attachment'
import { ko, type T } from './i18n'
import { naturalCompare } from './sort'

export interface Workset {
  parts: PartDef[]
  supplies: Supply[]
  /** 파일에 함께 실린 첨부 본문 (.opblib 저장 때 다시 싣는다) */
  attachmentData: AttachmentData
}

interface Named {
  id: string
  name: string
}

export const EMPTY_WORKSET: Workset = { parts: [], supplies: [], attachmentData: {} }

const byName = (a: Named, b: Named) => naturalCompare(a.name, b.name) || a.id.localeCompare(b.id)

/** 같은 id가 있으면 바꾸고 없으면 넣는다. 이름순 */
export function upsertItem<V extends Named>(list: readonly V[], item: V): V[] {
  return [...list.filter((v) => v.id !== item.id), item].sort(byName)
}

export function removeItem<V extends Named>(list: readonly V[], id: string): V[] {
  return list.filter((v) => v.id !== id)
}

/** 목록에 없는 이름: "이름 사본", "이름 사본 2" … */
export function copyName(name: string, taken: readonly string[], t: T = ko): string {
  const used = new Set(taken)
  const base = t('{name} 사본', { name })
  if (!used.has(base)) return base
  for (let i = 2; ; i++) {
    const n = `${base} ${i}`
    if (!used.has(n)) return n
  }
}

/** 새 id와 겹치지 않는 이름으로 복제 (핀·커넥터 id는 부품 안에서만 쓰이므로 그대로) */
export function duplicateItem<V extends Named>(list: readonly V[], id: string, newId: string, t: T = ko): { list: V[]; item: V } | undefined {
  const src = list.find((v) => v.id === id)
  if (!src) return undefined
  const item = { ...structuredClone(src), id: newId, name: copyName(src.name, list.map((v) => v.name), t) }
  return { list: upsertItem(list, item), item }
}

/** 파일에서 읽은 내용으로 작업 묶음을 만든다 (이름순, 쓰는 첨부 본문만) */
export function worksetOf(parts: readonly PartDef[], supplies: readonly Supply[] = [], data: AttachmentData = {}): Workset {
  return { parts: [...parts].sort(byName), supplies: [...supplies].sort(byName), attachmentData: usedAttachmentData(parts, data) }
}

/** 부품이 쓰는 첨부 본문만 남긴다 (지운 부품의 첨부가 파일에 계속 실리지 않게) */
export function usedAttachmentData(parts: readonly PartDef[], data: AttachmentData): AttachmentData {
  const ids = new Set(attachmentIdsOf(parts))
  return Object.fromEntries(Object.entries(data).filter(([id]) => ids.has(id)))
}
