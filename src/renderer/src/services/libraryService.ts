// window.api.library 어댑터. 파일 내용 검증은 core가 한다.
import type { PartDef } from '@core/model'
import { parsePart, serializePart } from '@core/serialize'
import { t } from '@/i18n'

export interface LoadedLibrary {
  parts: PartDef[]
  /** 읽지 못한 파일에 대한 설명 */
  problems: string[]
}

export async function loadLibrary(): Promise<LoadedLibrary> {
  const texts = await window.api.library.list()
  const parts: PartDef[] = []
  const problems: string[] = []
  for (const text of texts) {
    const r = parsePart(text, t)
    if (r.ok) parts.push(r.value)
    else problems.push(r.errors[0] ?? t('알 수 없는 오류'))
  }
  return { parts, problems }
}

export function savePartToLibrary(part: PartDef): Promise<void> {
  return window.api.library.save(part.id, serializePart(part))
}

export function removePartFromLibrary(id: string): Promise<void> {
  return window.api.library.remove(id)
}
