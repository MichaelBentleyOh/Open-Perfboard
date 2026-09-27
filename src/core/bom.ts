import { csvLine, toCsv, type CsvColumn } from './csv'
import type { Project } from './model'
import { roundMoney } from './money'
import { naturalCompare } from './sort'
import { buildXlsx, type XlsxCell, type XlsxColumn } from './xlsx'
import { ko, msg, type T } from './i18n'

export interface BomRow {
  /** part: 배선도 부품에서 자동, item: 사용자가 직접 추가 */
  kind: 'part' | 'item'
  /** part면 부품 정의 id, item이면 항목 id */
  id: string
  name: string
  partNumber?: string
  manufacturer?: string
  purchaseUrl?: string
  quantity: number
  /** 이 부품을 쓰는 참조명 (자연 정렬). 직접 추가한 항목은 빈 배열 */
  refDes: string[]
  unitPrice?: number
  /** 금액 = 수량 × 단가 (단가가 없으면 undefined) */
  amount?: number
  memo?: string
}

export interface BomTotals {
  lines: number
  quantity: number
  /** 전체 총액 (단가가 있는 행의 금액 합) */
  total: number
  /** 단가가 없는 행 수 */
  unpriced: number
}

const withAmount = (row: Omit<BomRow, 'amount'>): BomRow =>
  row.unitPrice === undefined ? row : { ...row, amount: roundMoney(row.quantity * row.unitPrice) }

/** 배선도 부품(정의별 수량) + 직접 추가한 항목. 단가는 BOM 수정값 > 부품 기본 단가 */
export function buildBom(project: Project): BomRow[] {
  const byPart = new Map<string, string[]>()
  for (const inst of project.instances) {
    const list = byPart.get(inst.partId) ?? []
    list.push(inst.refDes)
    byPart.set(inst.partId, list)
  }
  const overrides = project.bom?.overrides ?? {}
  const rows: BomRow[] = []
  for (const [partId, refs] of byPart) {
    const part = project.parts[partId]
    if (!part) continue
    const o = overrides[partId] ?? {}
    rows.push(
      withAmount({
        kind: 'part',
        id: partId,
        name: part.name,
        partNumber: part.partNumber,
        manufacturer: part.manufacturer,
        purchaseUrl: part.purchaseUrl,
        quantity: refs.length,
        refDes: refs.sort(naturalCompare),
        unitPrice: o.unitPrice ?? part.unitPrice,
        memo: o.memo
      })
    )
  }
  rows.sort((a, b) => naturalCompare(a.refDes[0], b.refDes[0]))
  for (const item of project.bom?.items ?? []) {
    rows.push(
      withAmount({
        kind: 'item',
        id: item.id,
        name: item.name,
        partNumber: item.partNumber,
        manufacturer: item.manufacturer,
        purchaseUrl: item.purchaseUrl,
        quantity: item.quantity,
        refDes: [],
        unitPrice: item.unitPrice,
        memo: item.memo
      })
    )
  }
  return rows
}

export function bomTotals(rows: readonly BomRow[]): BomTotals {
  return {
    lines: rows.length,
    quantity: roundMoney(rows.reduce((s, r) => s + r.quantity, 0)),
    total: roundMoney(rows.reduce((s, r) => s + (r.amount ?? 0), 0)),
    unpriced: rows.filter((r) => r.unitPrice === undefined).length
  }
}

/** 합계 행 비고: 단가가 없는 행 수 */
export const unpricedNote = (n: number, t: T = ko) => t('단가 미입력 {n}건', { n })

export const BOM_COLUMNS: CsvColumn<BomRow>[] = [
  { header: msg('참조명'), value: (r) => r.refDes.join(', ') },
  { header: msg('이름'), value: (r) => r.name },
  { header: msg('품번'), value: (r) => r.partNumber },
  { header: msg('제조사'), value: (r) => r.manufacturer },
  { header: msg('수량'), value: (r) => r.quantity },
  { header: msg('단가'), value: (r) => r.unitPrice },
  { header: msg('금액'), value: (r) => r.amount },
  { header: msg('구매 링크'), value: (r) => r.purchaseUrl },
  { header: msg('비고'), value: (r) => r.memo }
]

/** BOM CSV: 행들 + 마지막 합계 행 (수량 합, 총액) */
export function bomCsv(rows: readonly BomRow[], tr: T = ko): string {
  const t = bomTotals(rows)
  const cells = BOM_COLUMNS.map((c) => {
    if (c.header === '참조명') return tr('합계')
    if (c.header === '수량') return t.quantity
    if (c.header === '금액') return t.total
    if (c.header === '비고') return t.unpriced ? unpricedNote(t.unpriced, tr) : undefined
    return undefined
  })
  return toCsv(rows, BOM_COLUMNS, tr) + csvLine(cells)
}

// ---------------------------------------------------------------- 엑셀(xlsx)

const XLSX_COLUMNS: XlsxColumn[] = [
  { header: msg('참조명'), width: 18 },
  { header: msg('이름'), width: 26 },
  { header: msg('품번'), width: 18 },
  { header: msg('제조사'), width: 14 },
  { header: msg('수량'), width: 8 },
  { header: msg('단가'), width: 12 },
  { header: msg('금액'), width: 14 },
  { header: msg('구매 링크'), width: 36 },
  { header: msg('비고'), width: 24 }
]

/**
 * BOM 엑셀 파일. 수량·단가는 숫자, 금액은 수식(=수량×단가), 마지막 합계 행도 수식(SUM)이라
 * 엑셀에서 값을 고치면 다시 계산된다. 구매 링크는 누르면 열리는 하이퍼링크.
 */
export function bomXlsx(rows: readonly BomRow[], tr: T = ko): Uint8Array {
  const t = bomTotals(rows)
  const body: XlsxCell[][] = rows.map((r, i) => {
    const n = i + 2
    return [
      r.refDes.join(', '),
      r.name,
      r.partNumber,
      r.manufacturer,
      r.quantity,
      r.unitPrice === undefined ? undefined : { v: r.unitPrice, money: true },
      r.amount === undefined ? undefined : { v: r.amount, f: `E${n}*F${n}`, money: true },
      r.purchaseUrl ? { v: r.purchaseUrl, link: r.purchaseUrl } : undefined,
      r.memo
    ]
  })
  const last = rows.length + 1
  const sum = (col: string) => (rows.length ? `SUM(${col}2:${col}${last})` : undefined)
  body.push([
    { v: tr('합계'), bold: true },
    undefined,
    undefined,
    undefined,
    { v: t.quantity, f: sum('E'), bold: true },
    undefined,
    { v: t.total, f: sum('G'), bold: true, money: true },
    undefined,
    t.unpriced ? unpricedNote(t.unpriced, tr) : undefined
  ])
  // 단가에 소수가 있으면 소수 둘째 자리까지, 아니면 정수 (원화)
  const decimals = rows.some((r) => [r.unitPrice, r.amount].some((v) => v !== undefined && !Number.isInteger(v)))
  return buildXlsx([
    { name: 'BOM', columns: XLSX_COLUMNS.map((c) => ({ ...c, header: tr(c.header) })), rows: body, footerRows: 1, moneyFormat: decimals ? '#,##0.00' : '#,##0' }
  ])
}