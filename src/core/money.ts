import { ko, type T } from './i18n'

/** 금액 계산은 소수 둘째 자리에서 반올림 (부동소수 오차 제거: 0.1 * 3 = 0.30000000000000004) */
export const roundMoney = (n: number): number => Math.round(n * 100) / 100 + 0

/** 12500 → "12,500원" (영어: "₩12,500") */
export function formatMoney(n: number, t: T = ko): string {
  return t('{amount}원', { amount: roundMoney(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) })
}

/** 사용자 입력 "12,500" / "12500원" / " 3.5 " → 숫자. 비었으면 undefined, 잘못되거나 음수면 NaN */
export function parseAmount(text: string): number | undefined {
  const t = text.replace(/[,\s원₩]/g, '')
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : NaN
}
