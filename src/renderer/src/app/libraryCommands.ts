// 부품함 가져오기 적용 (배선도 부품함 창과 부품 작업실이 함께 쓴다)
import type { PartDef, Supply } from '@core/model'
import { attachmentIdsOf } from '@core/attachment'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSupplyStore } from '@/stores/supplyStore'
import { useUiStore, type ImportRequest } from '@/stores/uiStore'
import { putAttachmentData } from '@/services/attachmentService'
import { t } from '@/i18n'

/** 가져오기 대화상자에서 고른 것을 내 부품함에 저장하고 알린다. 대화상자는 닫는다 */
export async function applyImport(request: ImportRequest, parts: PartDef[], supplies: Supply[]): Promise<void> {
  const ui = useUiStore.getState()
  try {
    await useLibraryStore.getState().saveMany(parts)
    await useSupplyStore.getState().saveMany(supplies)
    await putAttachmentData(request.attachmentData, attachmentIdsOf(parts))
    ui.notify(
      supplies.length
        ? t('부품 {n}개, 부속 부품 {m}개를 가져왔습니다', { n: parts.length, m: supplies.length })
        : t('부품 {n}개를 가져왔습니다', { n: parts.length })
    )
  } catch (e) {
    window.alert(`${t('가져오지 못했습니다.')}\n${(e as Error).message}`)
  }
  ui.setImportRequest(null)
}
