// 열려 있는 파일 정보. "저장하지 않은 변경"은 지금 Project가 마지막 저장 시점의 Project와
// 같은 객체인지로 판단한다 (core 연산은 바뀔 때마다 새 객체를 만든다).
// 실행 취소로 저장 시점까지 되돌리면 같은 객체가 돌아오므로 다시 깨끗한 상태가 된다.
import { create } from 'zustand'
import type { Project } from '@core/model'
import { useProjectStore } from './projectStore'
import { t } from '@/i18n'

interface DocumentState {
  filePath: string | null
  /** 마지막으로 저장(또는 열기)한 Project. null이면 파일과 같은 적이 없는 상태 (복구한 배선도) */
  saved: Project | null
  markSaved: (project: Project, filePath: string | null) => void
  /** 복구한 배선도: 경로는 원래 파일, 상태는 "저장 안 됨" */
  markRecovered: (filePath: string | null) => void
}

export const useDocumentStore = create<DocumentState>((set) => ({
  filePath: null,
  saved: useProjectStore.getState().project,
  markSaved: (saved, filePath) => set({ saved, filePath }),
  markRecovered: (filePath) => set({ saved: null, filePath })
}))

/** 파일 경로 → 문서 이름 (확장자 제외). 경로가 없으면 새 배선도 */
export function documentName(filePath: string | null): string {
  if (!filePath) return t('새 배선도')
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  return base.replace(/\.opb$/i, '')
}

export const isDirtyNow = (): boolean =>
  useProjectStore.getState().project !== useDocumentStore.getState().saved

export function useIsDirty(): boolean {
  const project = useProjectStore((s) => s.project)
  const saved = useDocumentStore((s) => s.saved)
  return project !== saved
}
