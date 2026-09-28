import type { Currency, Project } from './model'
import { ko, type T } from './i18n'

/** 금액 계산은 소수 둘째 자리에서 반올림 (부동소수 오차 제거: 0.1 * 3 = 0.30000000000000004) */
export const roundMoney = (n: number): number => Math.round(n * 100) / 100 + 0

/** 배선도 통화 (없으면 원) */
export const projectCurrency = (project: Project): Currency => project.bom?.currency ?? 'KRW'

/** 통화 기호 (입력칸 옆 표시용) */
export const CURRENCY_SYMBOL: Record<Currency, string> = { KRW: '₩', USD: '$' }

/** 12500 → "12,500원" (영어: "₩12,500"), 달러 12.5 → "$12.50" */
export function formatMoney(n: number, t: T = ko, currency: Currency = 'KRW'): string {
  if (currency === 'USD') {
    const v = roundMoney(n)
    const text = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return `${v < 0 ? '-' : ''}$${text}`
  }
  return t('{amount}원', { amount: roundMoney(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) })
}

/** 사용자 입력 "12,500" / "12500원" / "$3.5" / " 3.5 " → 숫자. 비었으면 undefined, 잘못되거나 음수면 NaN */
export function parseAmount(text: string): number | undefined {
  const t = text.replace(/[,\s원₩$]/g, '')
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

/** 환율 입력: 0보다 큰 숫자만 (쉼표 허용). 아니면 undefined */
export function parseRate(text: string): number | undefined {
  const t = text.replace(/[,\s]/g, '')
  if (t === '' || !/^\d*\.?\d+$/.test(t)) return undefined
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** 단가와 통화 표시가 있는 것 (부품 정의, 부속 부품) */
export interface Priced {
  unitPrice?: number
  currency?: Currency
}

/**
 * 통화를 to로 맞춘 사본. 단가를 환율로 바꾸고 currency 표시를 맞춘다 (원이면 표시를 뺀다).
 * 환율이 없어 바꿀 수 없으면 단가를 뺀다 (BOM에 "단가 미입력"으로 보인다). 이미 같으면 같은 객체
 */
export function withCurrency<V extends Priced>(item: V, to: Currency, rate: number | undefined): V {
  const from = item.currency ?? 'KRW'
  if (from === to) return item
  const next: V = { ...item }
  if (to === 'KRW') delete next.currency
  else next.currency = to
  const price = item.unitPrice === undefined ? undefined : convertMoney(item.unitPrice, from, to, rate)
  if (price === undefined) delete next.unitPrice
  else next.unitPrice = price
  return next
}

/** 배선도 통화로 맞춘 사본 */
export const inProjectCurrency = <V extends Priced>(project: Project, item: V): V =>
  withCurrency(item, projectCurrency(project), project.bom?.exchangeRate)

/**
 * 통화 환산. rate = 1 USD의 원화 값. 원은 정수, 달러는 소수 둘째 자리로 반올림.
 * 같은 통화면 그대로, 환율이 없으면 undefined (환산할 수 없음)
 */
export function convertMoney(value: number, from: Currency, to: Currency, rate: number | undefined): number | undefined {
  if (from === to) return value
  if (!rate || !(rate > 0)) return undefined
  return to === 'USD' ? roundMoney(value / rate) : Math.round(value * rate) + 0
}
