// 화면 언어 상태. 컴포넌트는 useT()(언어가 바뀌면 다시 그림), 컴포넌트 밖에서는 t()를 쓴다.
// 고른 언어는 이 컴퓨터의 localStorage에 기억한다 (배선도 파일과 무관, 실행 취소 대상 아님).
import { create } from 'zustand'
import { isLocale, translator, type Locale, type Params, type T } from '@core/i18n'

const KEY = 'opb.locale'

function load(): Locale {
  try {
    const v = localStorage.getItem(KEY)
    return isLocale(v) ? v : 'ko'
  } catch {
    return 'ko'
  }
}

interface LocaleState {
  locale: Locale
  t: T
  setLocale: (locale: Locale) => void
}

const initial = load()

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initial,
  t: translator(initial),
  setLocale: (locale) => {
    try {
      localStorage.setItem(KEY, locale)
    } catch {
      // 저장하지 못해도 이번 실행 동안은 바뀐 언어로 동작한다
    }
    set({ locale, t: translator(locale) })
  }
}))

/** 컴포넌트 밖(명령, 알림)에서 쓰는 번역 */
export const t: T = (text: string, params?: Params) => useLocaleStore.getState().t(text, params)

/** 컴포넌트에서 쓰는 번역. 언어가 바뀌면 다시 그린다 */
export const useT = (): T => useLocaleStore((s) => s.t)
