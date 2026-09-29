// 부품 작업실 (037a) 상태. 실행 취소 대상이 아니다.
// 대상이 "내 부품함"이면 항목마다 바로 libraryStore·supplyStore에 저장하고,
// .opblib 파일이면 메모리에서 고치다가 "저장"할 때 파일에 한 번에 쓴다.
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { PartDef, Supply, SupplyKind } from '@core/model'
import { attachmentIdsOf } from '@core/attachment'
import { planImport, readLibraryFile, serializeLibrary } from '@core/library'
import { duplicateItem, EMPTY_WORKSET, removeItem, upsertItem, worksetOf, type Workset } from '@core/workset'
import { useLibraryStore } from './libraryStore'
import { useSupplyStore } from './supplyStore'
import { useUiStore } from './uiStore'
import { collectAttachmentData, putAttachmentData } from '@/services/attachmentService'
import { t } from '@/i18n'

export type StudioTab = 'parts' | 'supplies'
export type ItemKind = 'part' | 'supply'

/** 편집 영역에 열린 항목. isNew면 아직 목록에 없다 */
export interface StudioSelection {
  kind: ItemKind
  id: string
  isNew?: boolean
  /** 새 부속 부품의 종류 */
  supplyKind?: SupplyKind
}

/** 고치는 대상: 내 부품함, 또는 .opblib 파일 (path가 null이면 아직 저장 안 한 새 부품함) */
export type StudioTarget = { kind: 'mine' } | { kind: 'file'; path: string | null; name: string }

interface StudioState {
  target: StudioTarget
  /** 파일 대상일 때의 내용 */
  file: Workset
  /** 파일 대상에 저장하지 않은 변경이 있다 */
  dirty: boolean
  tab: StudioTab
  setTab: (tab: StudioTab) => void
  /** 편집 영역에 열린 항목 */
  selected: StudioSelection | null
  /** 편집 영역에서 고치고 아직 저장하지 않았다 */
  editorDirty: boolean
  setEditorDirty: (dirty: boolean) => void
  /** 편집 영역을 다시 시작하게 하는 번호 (저장·되돌리기 뒤) */
  editorKey: number
  /** 부품 편집기에서 보던 탭 (저장해 다시 열려도 그대로, 다른 항목을 열면 처음으로) */
  partView: PartView | null
  setPartView: (v: PartView) => void
  /** 다른 항목을 연다. 고치던 게 있으면 묻고, 취소하면 false */
  select: (sel: StudioSelection | null) => boolean
  /** 편집 영역의 변경을 버린다 (새 항목이면 닫는다) */
  revert: () => void
  saveItem: (kind: ItemKind, item: PartDef | Supply) => Promise<void>
  removeItem: (kind: ItemKind, id: string) => Promise<void>
  duplicate: (kind: ItemKind, id: string) => Promise<void>
  useMine: () => boolean
  newFile: () => boolean
  openFile: () => Promise<void>
  saveFile: (saveAs?: boolean) => Promise<boolean>
  /** 고른 항목(없으면 전부)을 내 부품함에 넣기: 가져오기 대화상자로 */
  addToMine: (ids?: string[]) => Promise<void>
}

/** 지금 대상의 부품·부속 부품 목록 */
export function studioItems(s: Pick<StudioState, 'target' | 'file'>): { parts: PartDef[]; supplies: Supply[] } {
  if (s.target.kind === 'file') return s.file
  return { parts: useLibraryStore.getState().parts, supplies: useSupplyStore.getState().supplies }
}

const notify = (m: string) => useUiStore.getState().notify(m)

export type PartView = 'draw' | 'pins' | 'symbol'

export const useStudioStore = create<StudioState>((set, get) => {
  /** 편집 중인 내용·파일 변경을 버려도 되는지 묻는다 */
  const confirmEditor = () => !get().editorDirty || window.confirm(t('고치던 내용을 저장하지 않았습니다.\n버리고 계속할까요?'))
  const confirmFile = () => !get().dirty || window.confirm(t('부품함 파일에 저장하지 않은 변경이 있습니다.\n버리고 계속할까요?'))
  const reset = () => ({ selected: null, editorDirty: false, editorKey: get().editorKey + 1 })

  return {
    target: { kind: 'mine' },
    file: EMPTY_WORKSET,
    dirty: false,
    tab: 'parts',
    setTab: (tab) => set({ tab }),
    selected: null,
    editorDirty: false,
    setEditorDirty: (editorDirty) => set({ editorDirty }),
    editorKey: 0,
    partView: null,
    setPartView: (partView) => set({ partView }),

    select: (sel) => {
      const cur = get().selected
      if (sel && cur && sel.id === cur.id && sel.kind === cur.kind && !sel.isNew) return true
      if (!confirmEditor()) return false
      set({ selected: sel, editorDirty: false, editorKey: get().editorKey + 1, partView: null })
      return true
    },

    revert: () => set({ selected: get().selected?.isNew ? null : get().selected, editorDirty: false, editorKey: get().editorKey + 1 }),

    saveItem: async (kind, item) => {
      const s = get()
      if (s.target.kind === 'mine') {
        if (kind === 'part') await useLibraryStore.getState().save(item as PartDef)
        else await useSupplyStore.getState().save(item as Supply)
      } else {
        const file =
          kind === 'part' ? { ...s.file, parts: upsertItem(s.file.parts, item as PartDef) } : { ...s.file, supplies: upsertItem(s.file.supplies, item as Supply) }
        set({ file, dirty: true })
      }
      set({ selected: { kind, id: item.id }, editorDirty: false, editorKey: get().editorKey + 1 })
      notify(t('저장했습니다: {name}', { name: item.name }))
    },

    removeItem: async (kind, id) => {
      const s = get()
      const item = (kind === 'part' ? studioItems(s).parts : studioItems(s).supplies).find((v) => v.id === id)
      if (!item) return
      const where = s.target.kind === 'mine' ? t('내 부품함') : s.target.name
      if (!window.confirm(t("'{name}'을(를) {where}에서 지울까요?\n이미 저장된 배선도에는 영향이 없습니다.", { name: item.name, where }))) return
      if (s.target.kind === 'mine') {
        if (kind === 'part') await useLibraryStore.getState().remove(id)
        else await useSupplyStore.getState().remove(id)
      } else {
        const file = kind === 'part' ? { ...s.file, parts: removeItem(s.file.parts, id) } : { ...s.file, supplies: removeItem(s.file.supplies, id) }
        set({ file, dirty: true })
      }
      if (get().selected?.id === id) set(reset())
    },

    duplicate: async (kind, id) => {
      if (!confirmEditor()) return
      const s = get()
      const items = studioItems(s)
      const r = kind === 'part' ? duplicateItem(items.parts, id, nanoid(), t) : duplicateItem(items.supplies, id, nanoid(), t)
      if (!r) return
      set({ editorDirty: false })
      await get().saveItem(kind, r.item)
    },

    useMine: () => {
      if (get().target.kind === 'mine') return true
      if (!confirmEditor() || !confirmFile()) return false
      set({ target: { kind: 'mine' }, file: EMPTY_WORKSET, dirty: false, ...reset() })
      return true
    },

    newFile: () => {
      if (!confirmEditor() || !confirmFile()) return false
      set({ target: { kind: 'file', path: null, name: t('새 부품함') }, file: EMPTY_WORKSET, dirty: false, ...reset() })
      return true
    },

    openFile: async () => {
      if (!confirmEditor() || !confirmFile()) return
      try {
        const opened = await window.api.libfile.open()
        if (!opened) return
        const fileName = opened.path.split(/[\\/]/).pop() ?? opened.path
        const r = readLibraryFile(opened.content, fileName, t)
        if (r.kind === 'unknown' || (r.parts.length === 0 && (r.supplies?.length ?? 0) === 0 && r.problems.length > 0)) {
          window.alert(`${t('부품함 파일을 열 수 없습니다.')}\n${r.problems.slice(0, 5).join('\n')}`)
          return
        }
        const isLib = fileName.toLowerCase().endsWith('.opblib')
        const file = worksetOf(r.parts, r.supplies ?? [], r.attachmentData ?? {})
        // 첨부를 바로 볼 수 있게 이 PC 첨부 폴더에도 넣는다
        await putAttachmentData(file.attachmentData)
        set({
          target: { kind: 'file', path: isLib ? opened.path : null, name: fileName.replace(/\.[^.]+$/, '') },
          file,
          // .opblib가 아닌 파일(.json·.opb)은 .opblib로 저장해야 한다
          dirty: !isLib,
          tab: file.parts.length === 0 && file.supplies.length > 0 ? 'supplies' : 'parts',
          ...reset()
        })
        if (r.problems.length) window.alert(`${t('일부 항목을 읽지 못했습니다.')}\n${r.problems.slice(0, 5).join('\n')}`)
      } catch (e) {
        window.alert(`${t('부품함 파일을 열 수 없습니다.')}\n${(e as Error).message}`)
      }
    },

    saveFile: async (saveAs = false) => {
      const s = get()
      if (s.target.kind !== 'file') return false
      try {
        // 편집기에서 새로 붙인 첨부는 이 PC 첨부 폴더에만 있다 → 파일에 싣는다
        const ids = attachmentIdsOf(s.file.parts)
        const missing = ids.filter((id) => !(id in s.file.attachmentData))
        const data = { ...s.file.attachmentData, ...(await collectAttachmentData(missing)) }
        const content = serializeLibrary(s.file.parts, data, s.file.supplies)
        const saved = await window.api.libfile.save(saveAs ? null : s.target.path, content, s.target.name)
        if (!saved) return false
        const name = (saved.split(/[\\/]/).pop() ?? saved).replace(/\.opblib$/i, '')
        set({ target: { kind: 'file', path: saved, name }, file: { ...get().file, attachmentData: data }, dirty: false })
        notify(t('저장했습니다: {name}', { name }))
        return true
      } catch (e) {
        window.alert(`${t('저장하지 못했습니다: {detail}', { detail: (e as Error).message })}`)
        return false
      }
    },

    addToMine: async (ids) => {
      const s = get()
      if (s.target.kind !== 'file') return
      const pick = <V extends { id: string }>(list: V[]) => (ids ? list.filter((v) => ids.includes(v.id)) : list)
      const parts = pick(s.file.parts)
      const supplies = pick(s.file.supplies)
      if (parts.length + supplies.length === 0) return
      useUiStore.getState().setImportRequest({
        files: [s.target.name],
        plan: planImport(useLibraryStore.getState().parts, parts),
        supplyPlan: planImport(useSupplyStore.getState().supplies, supplies),
        problems: [],
        attachmentData: s.file.attachmentData,
        note: t('고른 항목을 내 부품함에 넣습니다.')
      })
    }
  }
})
