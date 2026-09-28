// window.api.supplies 어댑터 (027 부속 부품). 파일 내용 검증은 core가 한다.
import type { Supply } from '@core/model'
import { parseSupply, serializeSupply } from '@core/serialize'
import { t } from '@/i18n'

export async function loadSupplies(): Promise<{ supplies: Supply[]; problems: string[] }> {
  const texts = await window.api.supplies.list()
  const supplies: Supply[] = []
  const problems: string[] = []
  for (const text of texts) {
    const r = parseSupply(text, t)
    if (r.ok) supplies.push(r.value)
    else problems.push(r.errors[0] ?? t('알 수 없는 오류'))
  }
  return { supplies, problems }
}

export const saveSupplyToLibrary = (s: Supply): Promise<void> => window.api.supplies.save(s.id, serializeSupply(s))

export const removeSupplyFromLibrary = (id: string): Promise<void> => window.api.supplies.remove(id)
