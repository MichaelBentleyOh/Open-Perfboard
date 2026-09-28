// 자동 저장: 저장하지 않은 변경이 있으면 정해진 간격(기본 1분)마다 복구용 사본을 쓴다.
// 원래 파일은 사용자가 "저장"할 때만 바뀐다. 변경이 없어지면(저장·열기·새로 만들기·실행 취소) 사본을 지운다.
// 배선도가 여럿이면 묶음 JSON 하나로 쓴다 (030)
import type { Project } from '@core/model'
import { serializeWorkspaceJson } from '@core/workspace'
import { useProjectStore } from '@/stores/projectStore'
import { documentName, isDirtyNow, useDocumentStore } from '@/stores/documentStore'
import { currentSheets, useWorkspaceStore } from '@/stores/workspaceStore'

/** 마지막으로 사본에 쓴 배선도들 (같으면 다시 쓰지 않는다). 사본이 없으면 null */
let written: Project[] | null = null
let writing = false

const same = (a: readonly Project[] | null, b: readonly Project[]) => !!a && a.length === b.length && a.every((p, i) => p === b[i])

/** 지금 배선도들과 묶음 정보 (저장·자동 저장 공통) */
export function workspaceMeta(): { projects: Project[]; active: number; scope?: number[] } {
  const sheets = currentSheets()
  const { activeId, scope } = useWorkspaceStore.getState()
  const index = new Map(sheets.map((s, i) => [s.id, i]))
  return {
    projects: sheets.map((s) => s.project),
    active: Math.max(0, index.get(activeId) ?? 0),
    ...(scope ? { scope: scope.map((id) => index.get(id)).filter((i): i is number => i !== undefined) } : {})
  }
}

/** 지금 필요하면 사본을 쓴다 (간격마다 부른다) */
export async function autosaveNow(): Promise<void> {
  const meta = workspaceMeta()
  if (writing || !isDirtyNow() || same(written, meta.projects)) return
  writing = true
  try {
    const { filePath } = useDocumentStore.getState()
    const name = documentName(filePath)
    await window.api.recovery.write(serializeWorkspaceJson(meta.projects, meta), filePath, name)
    written = meta.projects
  } catch {
    // 사본을 못 써도 편집은 계속된다. 다음 간격에 다시 시도
  } finally {
    writing = false
  }
}

async function clearIfClean(): Promise<void> {
  if (written === null || isDirtyNow()) return
  written = null
  try {
    await window.api.recovery.clear()
  } catch {
    // 남은 사본은 다음 실행에서 복구 목록에 보일 뿐이다
  }
}

/** 자동 저장 시작. 해제 함수를 돌려준다 */
export function startAutosave(intervalMs: number): () => void {
  const timer = setInterval(() => void autosaveNow(), intervalMs)
  const unsubs = [
    useProjectStore.subscribe(() => void clearIfClean()),
    useDocumentStore.subscribe(() => void clearIfClean()),
    useWorkspaceStore.subscribe(() => void clearIfClean())
  ]
  return () => {
    clearInterval(timer)
    unsubs.forEach((u) => u())
  }
}
