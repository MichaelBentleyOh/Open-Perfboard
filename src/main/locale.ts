// main이 띄우는 대화상자(열기·저장·닫기 확인)의 언어. 렌더러가 app:set-locale로 알려 준다.
import { ipcMain } from 'electron'
import { isLocale, translator, type Locale, type Params } from '../core/i18n'

let current: Locale = 'ko'
let translate = translator(current)

/** 지금 언어로 번역 (원문은 한국어) */
export const mt = (text: string, params?: Params): string => translate(text, params)

export function registerLocaleIpc(): void {
  ipcMain.on('app:set-locale', (_e, locale: unknown) => {
    if (!isLocale(locale)) return
    current = locale
    translate = translator(locale)
  })
}
