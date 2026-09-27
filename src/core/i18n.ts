// 화면 언어. 한국어 원문이 곧 번역 키다 → 코드는 한국어로 읽히고, 한국어는 사전 없이 동작한다.
// 영어는 i18n-en.ts 사전에서 찾고, 없으면 한국어 원문을 그대로 쓴다.
// 원문에 {n}처럼 변수를 넣고 t('전선 {n}개', { n: 3 })로 채운다. 번역문도 같은 변수 이름을 써야 한다(테스트가 검사).
import { EN } from './i18n-en'

export type Locale = 'ko' | 'en'
export const LOCALES: readonly Locale[] = ['ko', 'en']

export type Params = Record<string, string | number>
export type T = (text: string, params?: Params) => string

export const isLocale = (v: unknown): v is Locale => v === 'ko' || v === 'en'

/** {이름}을 값으로 바꾼다. 값이 없는 변수는 그대로 둔다 */
export function fill(text: string, params: Params = {}): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

export function translator(locale: Locale): T {
  if (locale === 'ko') return (text, params) => fill(text, params)
  return (text, params) => fill(EN[text] ?? text, params)
}

/** 한국어 (core 함수의 기본값) */
export const ko: T = translator('ko')

/**
 * 나중에 t()로 번역할 원문 표시. 값은 그대로 돌려준다.
 * 표의 열 머리글처럼 변수에 담아 두었다가 번역하는 문자열에 붙여, 사전 검사 테스트가 찾을 수 있게 한다.
 */
export const msg = (text: string): string => text
