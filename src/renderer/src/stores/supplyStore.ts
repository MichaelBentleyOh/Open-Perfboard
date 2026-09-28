// 부품함의 부속 부품 (027): 하우징·단자·수축 튜브·전선
import { create } from 'zustand'
import type { Supply } from '@core/model'
import { naturalCompare } from '@core/sort'
import { loadSupplies, removeSupplyFromLibrary, saveSupplyToLibrary } from '@/services/supplyService'
import { t } from '@/i18n'

interface SupplyState {
  supplies: Supply[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  problems: string[]
  load: () => Promise<void>
  save: (s: Supply) => Promise<void>
  saveMany: (list: Supply[]) => Promise<void>
  remove: (id: string) => Promise<void>
}

const byName = (a: Supply, b: Supply) => naturalCompare(a.name, b.name)

export const useSupplyStore = create<SupplyState>((set, get) => ({
  supplies: [],
  status: 'idle',
  problems: [],

  load: async () => {
    set({ status: 'loading' })
    try {
      const { supplies, problems } = await loadSupplies()
      set({ supplies: supplies.sort(byName), problems, status: 'ready' })
    } catch (e) {
      set({ status: 'error', problems: [t('부속 부품을 읽지 못했습니다: {detail}', { detail: (e as Error).message })] })
    }
  },

  save: async (s) => {
    await saveSupplyToLibrary(s)
    set({ supplies: [...get().supplies.filter((x) => x.id !== s.id), s].sort(byName) })
  },

  saveMany: async (list) => {
    for (const s of list) await saveSupplyToLibrary(s)
    const ids = new Set(list.map((s) => s.id))
    set({ supplies: [...get().supplies.filter((x) => !ids.has(x.id)), ...list].sort(byName) })
  },

  remove: async (id) => {
    await removeSupplyFromLibrary(id)
    set({ supplies: get().supplies.filter((s) => s.id !== id) })
  }
}))
