import { create } from 'zustand'
import type { PartDef } from '@core/model'
import { naturalCompare } from '@core/sort'
import { loadLibrary, removePartFromLibrary, savePartToLibrary } from '@/services/libraryService'
import { t } from '@/i18n'

interface LibraryState {
  parts: PartDef[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** 읽지 못한 부품 파일, 불러오기 실패 등 사용자에게 알릴 내용 */
  problems: string[]
  load: () => Promise<void>
  save: (part: PartDef) => Promise<void>
  /** 여러 부품 저장 (가져오기). 목록은 한 번만 갱신 */
  saveMany: (parts: PartDef[]) => Promise<void>
  remove: (id: string) => Promise<void>
}

const byName = (a: PartDef, b: PartDef) => naturalCompare(a.name, b.name)

export const useLibraryStore = create<LibraryState>((set, get) => ({
  parts: [],
  status: 'idle',
  problems: [],

  load: async () => {
    set({ status: 'loading' })
    try {
      const { parts, problems } = await loadLibrary()
      set({ parts: parts.sort(byName), problems, status: 'ready' })
    } catch (e) {
      set({ status: 'error', problems: [t('부품함을 읽지 못했습니다: {detail}', { detail: (e as Error).message })] })
    }
  },

  save: async (part) => {
    await savePartToLibrary(part)
    const others = get().parts.filter((p) => p.id !== part.id)
    set({ parts: [...others, part].sort(byName) })
  },

  saveMany: async (parts) => {
    for (const part of parts) await savePartToLibrary(part)
    const ids = new Set(parts.map((p) => p.id))
    set({ parts: [...get().parts.filter((p) => !ids.has(p.id)), ...parts].sort(byName) })
  },

  remove: async (id) => {
    await removePartFromLibrary(id)
    set({ parts: get().parts.filter((p) => p.id !== id) })
  }
}))
