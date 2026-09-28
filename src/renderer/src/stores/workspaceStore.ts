// 여러 배선도 (030): 아래 탭 줄의 배선도 목록.
// 지금 보고 있는 배선도는 projectStore(실행 취소 이력 포함)에 있고, 나머지는 여기에 Project와 이력(past/future)을 보관한다.
// 탭을 바꾸면 둘을 바꿔 끼운다 → 실행 취소는 배선도마다 따로.
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { Project } from '@core/model'
import { emptyProject, setBomCurrency } from '@core/ops'
import { projectCurrency } from '@core/money'
import type { SheetRef } from '@core/workspace'
import { nextSheetName } from '@core/workspace'
import { useProjectStore } from './projectStore'
import { useUiStore } from './uiStore'
import { t } from '@/i18n'

type History = ReturnType<typeof useProjectStore.temporal.getState>['pastStates']
const HISTORY_LIMIT = 200

export interface Sheet {
  id: string
  /** 보고 있지 않은 배선도의 내용. 보고 있는 배선도는 projectStore가 원본 (이 값은 오래됐을 수 있다) */
  project: Project
  past: History
  future: History
}

interface WorkspaceState {
  sheets: Sheet[]
  activeId: string
  /** BOM·결선표에 넣을 배선도 id. null = 모두 */
  scope: string[] | null
  setScope: (ids: string[] | null) => void
  /** 새 배선도를 만들어 그 탭으로 간다. 통화·환율은 지금 배선도를 따른다 */
  addSheet: () => string
  switchTo: (id: string) => void
  renameSheet: (id: string, name: string) => void
  /** 배선도를 지운다 (마지막 하나는 지울 수 없다) */
  removeSheet: (id: string) => void
  /** 파일을 열었을 때: 배선도 목록을 통째로 바꾸고 이력을 비운다 */
  load: (projects: Project[], active: number, scope?: number[]) => void
  /**
   * 여러 배선도를 한꺼번에 고친다 (BOM에서 합친 행 고치기 등). 보고 있는 배선도는 projectStore의 set 한 번,
   * 나머지는 각자의 이력에 쌓는다 → 각 배선도에서 실행 취소 1회
   */
  applyTo: (ids: readonly string[], fn: (p: Project) => Project) => void
}

const temporal = () => useProjectStore.temporal.getState()

/** 보고 있는 배선도를 projectStore에서 꺼내 목록에 반영한 사본 */
function withActiveSynced(s: Pick<WorkspaceState, 'sheets' | 'activeId'>): Sheet[] {
  const project = useProjectStore.getState().project
  const { pastStates, futureStates } = temporal()
  return s.sheets.map((sh) => (sh.id === s.activeId ? { ...sh, project, past: pastStates, future: futureStates } : sh))
}

/** projectStore에 배선도를 넣는다 (이력에 남기지 않고, 그 배선도의 이력으로 바꾼다) */
function mount(sheet: Sheet): void {
  const tp = temporal()
  tp.pause()
  useProjectStore.setState({ project: sheet.project })
  tp.resume()
  useProjectStore.temporal.setState({ pastStates: sheet.past, futureStates: sheet.future })
  const ui = useUiStore.getState()
  ui.clearSelection()
  ui.setWireStart(null)
}

const firstId = nanoid()

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  sheets: [{ id: firstId, project: useProjectStore.getState().project, past: [], future: [] }],
  activeId: firstId,
  scope: null,

  setScope: (scope) => set({ scope }),

  addSheet: () => {
    const cur = useProjectStore.getState().project
    const names = currentSheets().map((s) => s.name)
    let project = emptyProject(nextSheetName(names, t('배선도')))
    const rate = cur.bom?.exchangeRate
    if (projectCurrency(cur) !== 'KRW' || rate !== undefined) project = setBomCurrency(project, projectCurrency(cur), rate ?? 1)
    const sheet: Sheet = { id: nanoid(), project, past: [], future: [] }
    const sheets = [...withActiveSynced(get()), sheet]
    mount(sheet)
    set({ sheets, activeId: sheet.id, scope: get().scope && [...get().scope!, sheet.id] })
    return sheet.id
  },

  switchTo: (id) => {
    const s = get()
    if (id === s.activeId) return
    const sheets = withActiveSynced(s)
    const target = sheets.find((sh) => sh.id === id)
    if (!target) return
    mount(target)
    set({ sheets, activeId: id })
  },

  renameSheet: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    get().applyTo([id], (p) => (p.name === trimmed ? p : { ...p, name: trimmed }))
  },

  removeSheet: (id) => {
    const s = get()
    if (s.sheets.length <= 1) return
    const index = s.sheets.findIndex((sh) => sh.id === id)
    if (index < 0) return
    const sheets = withActiveSynced(s).filter((sh) => sh.id !== id)
    let activeId = s.activeId
    if (id === s.activeId) {
      const next = sheets[Math.min(index, sheets.length - 1)]
      mount(next)
      activeId = next.id
    }
    set({ sheets, activeId, scope: s.scope && s.scope.filter((x) => x !== id) })
  },

  load: (projects, active, scope) => {
    const sheets: Sheet[] = projects.map((project) => ({ id: nanoid(), project, past: [], future: [] }))
    const a = sheets[Math.min(Math.max(active, 0), sheets.length - 1)]
    useProjectStore.getState().reset(a.project)
    const ui = useUiStore.getState()
    ui.clearSelection()
    ui.setWireStart(null)
    set({ sheets, activeId: a.id, scope: scope && scope.length < sheets.length ? scope.map((i) => sheets[i].id) : null })
  },

  applyTo: (ids, fn) => {
    const s = get()
    const want = new Set(ids)
    let changed = false
    const sheets = s.sheets.map((sh) => {
      if (!want.has(sh.id) || sh.id === s.activeId) return sh
      const next = fn(sh.project)
      if (next === sh.project) return sh
      changed = true
      return { ...sh, project: next, past: [...sh.past, { project: sh.project }].slice(-HISTORY_LIMIT), future: [] }
    })
    if (want.has(s.activeId)) useProjectStore.getState().apply(fn)
    if (changed) set({ sheets })
  }
}))

/** 지금 배선도 목록 (보고 있는 배선도는 최신 내용). 이름 = Project.name */
export function currentSheets(): SheetRef[] {
  const { sheets, activeId } = useWorkspaceStore.getState()
  const active = useProjectStore.getState().project
  return sheets.map((sh) => {
    const project = sh.id === activeId ? active : sh.project
    return { id: sh.id, name: project.name, project }
  })
}

/** 화면용: 배선도 목록 (보고 있는 배선도가 바뀌면 다시 그린다) */
export function useSheets(): SheetRef[] {
  const sheets = useWorkspaceStore((s) => s.sheets)
  const activeId = useWorkspaceStore((s) => s.activeId)
  const active = useProjectStore((s) => s.project)
  return sheets.map((sh) => {
    const project = sh.id === activeId ? active : sh.project
    return { id: sh.id, name: project.name, project }
  })
}

/** BOM·결선표 범위의 배선도 (목록 순서) */
export function scopedSheets(sheets: readonly SheetRef[], scope: readonly string[] | null): SheetRef[] {
  if (!scope) return [...sheets]
  const set = new Set(scope)
  return sheets.filter((s) => set.has(s.id))
}
