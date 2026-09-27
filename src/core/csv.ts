import { ko, type T as Translate } from './i18n'

export interface CsvColumn<T> {
  /** 한국어 원문 (내보낼 때 고른 언어로 번역) */
  header: string
  value: (row: T) => string | number | undefined
}

/** Excel이 한글을 깨뜨리지 않도록 UTF-8 BOM을 붙인다 */
const UTF8_BOM = '﻿'

function escapeCell(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 값 목록 → CSV 한 줄 (줄바꿈 포함). 합계 행처럼 열 정의 밖의 줄을 붙일 때 */
export function csvLine(cells: readonly (string | number | undefined)[]): string {
  return cells.map(escapeCell).join(',') + '\r\n'
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[], t: Translate = ko): string {
  return UTF8_BOM + csvLine(columns.map((c) => t(c.header))) + rows.map((row) => csvLine(columns.map((c) => c.value(row)))).join('')
}
