// 열려 있는 파일 정보. "저장하지 않은 변경"은 배선도마다 지금 Project가 마지막 저장 시점의 Project와
// 같은 객체인지, 그리고 탭 구성(배선도 추가·삭제·순서)이 같은지로 판단한다 (core 연산은 바뀔 때마다 새 객체를 만든다).
// 실행 취소로 저장 시점까지 되돌리면 같은 객체가 돌아오므로 다시 깨끗한 상태가 된다.
import { create } from 'zustand'
import type { Project } from '@core/model'
import { useProjectStore } from './projectStore'
import { currentSheets, useWorkspaceStore } from './workspaceStore'
import { t } from '@/i18n'

interface Snapshot {
  /** 배선도 id → 저장 시점 Project */
  projects: Record<string, Project>
  /** 탭 순서 */
  order: string
}

interface DocumentState {
  filePath: string | null
  /** 마지막으로 저장(또는 열기)한 상태. null이면 파일과 같은 적이 없는 상태 (복구한 배선도) */
  saved: Snapshot | null
  /** 지금 상태를 저장된 것으로 (저장·열기·새로 만들기 뒤) */
  markSaved: (filePath: string | null) => void
  /** 복구한 배선도: 경로는 원래 파일, 상태는 "저장 안 됨" */
  markRecovered: (filePath: string | null) => void
}

function snapshot(): Snapshot {
  const sheets = currentSheets()
  return { projects: Object.fromEntries(sheets.map((s) => [s.id, s.project])), order: sheets.map((s) => s.id).join('|') }
}

export const useDocumentStore = create<DocumentState>((set) => ({
  filePath: null,
  saved: snapshot(),
  markSaved: (filePath) => set({ saved: snapshot(), filePath }),
  markRecovered: (filePath) => set({ saved: null, filePath })
}))

/** 파일 경로 → 문서 이름 (확장자 제외). 경로가 없으면 새 배선도 */
export function documentName(filePath: string | null): string {
  if (!filePath) return t('새 배선도')
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  return base.replace(/\.(opb|zip)$/i, '')
}

/** 여러 배선도로 저장해야 하는지: 배선도가 둘 이상이거나 이미 .zip 파일 */
export const isBundle = (filePath: string | null, sheetCount: number) => sheetCount > 1 || /\.zip$/i.test(filePath ?? '')

function dirty(saved: Snapshot | null): boolean {
  if (!saved) return true
  const sheets = currentSheets()
  if (sheets.map((s) => s.id).join('|') !== saved.order) return true
  return sheets.some((s) => saved.projects[s.id] !== s.project)
}

export const isDirtyNow = (): boolean => dirty(useDocumentStore.getState().saved)

export function useIsDirty(): boolean {
  useProjectStore((s) => s.project)
  useWorkspaceStore((s) => s.sheets)
  const saved = useDocumentStore((s) => s.saved)
  return dirty(saved)
}
