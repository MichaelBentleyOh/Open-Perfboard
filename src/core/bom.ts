import { csvLine, toCsv, type CsvColumn } from './csv'
import type { Currency, Project, SupplyKind } from './model'
import { SUPPLY_KIND_LABEL, supplyUsage } from './supply'
import { roundMoney } from './money'
import { naturalCompare } from './sort'
import { buildXlsx, type XlsxCell, type XlsxColumn } from './xlsx'
import { ko, msg, type T } from './i18n'

export interface BomRow {
  /** part: 배선도 부품에서 자동, item: 사용자가 직접 추가, supply: BOM에 넣기로 한 부속 부품 (027) */
  kind: 'part' | 'item' | 'supply'
  /** part면 부품 정의 id, item이면 항목 id, supply면 부속 부품 id */
  id: string
  /** supply: 부속 부품 종류 */
  supplyKind?: SupplyKind
  /** supply: 제안 수량 (배선도에서 계산) */
  suggested?: number
  /** 번호 (1부터, 표 순서) */
  no: number
  /** 분류 (번역 전 원문): 부품·하우징·단자·수축 튜브·전선·직접 추가 */
  category: string
  name: string
  partNumber?: string
  manufacturer?: string
  purchaseUrl?: string
  /** 조달처 (031) */
  supplier?: string
  quantity: number
  /** 이 부품을 쓰는 참조명 (자연 정렬). 직접 추가한 항목은 빈 배열 */
  refDes: string[]
  unitPrice?: number
  /** 여러 배선도를 합친 행에서 배선도마다 단가가 다름 (단가 칸은 비고, 금액은 배선도별 합, 030) */
  mixedPrice?: boolean
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

const withAmount = (row: Omit<BomRow, 'amount' | 'no'>): BomRow => {
  const r = { ...row, no: 0 }
  return row.unitPrice === undefined ? r : { ...r, amount: roundMoney(row.quantity * row.unitPrice) }
}

/** 분류 원문 */
export const CATEGORY_PART = msg('부품')
export const CATEGORY_ITEM = msg('직접 추가')

/** 세부사항 = 품번 · 제조사 · 참조명 */
export const bomDetails = (r: Pick<BomRow, 'partNumber' | 'manufacturer' | 'refDes'>): string =>
  [r.partNumber, r.manufacturer, r.refDes.join(', ')].filter(Boolean).join(' · ')

/** 번호를 표 순서대로 다시 매긴다 */
export const numberRows = (rows: readonly BomRow[]): BomRow[] => rows.map((r, i) => (r.no === i + 1 ? r : { ...r, no: i + 1 }))

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
        category: CATEGORY_PART,
        name: part.name,
        partNumber: part.partNumber,
        manufacturer: part.manufacturer,
        purchaseUrl: part.purchaseUrl,
        supplier: o.supplier ?? part.supplier,
        quantity: refs.length,
        refDes: refs.sort(naturalCompare),
        unitPrice: o.unitPrice ?? part.unitPrice,
        memo: o.memo
      })
    )
  }
  rows.sort((a, b) => naturalCompare(a.refDes[0], b.refDes[0]))
  // 부속 부품: BOM에 넣기로 한 것만. 수량은 고친 값 > 제안 수량
  const choices = project.bom?.supplies ?? {}
  if (Object.values(choices).some((c) => c.include)) {
    const uses = new Map(supplyUsage(project).uses.map((u) => [u.supply.id, u]))
    for (const [id, c] of Object.entries(choices)) {
      const s = project.supplies?.[id]
      if (!c.include || !s) continue
      const u = uses.get(id)
      const suggested = u?.suggested ?? 0
      rows.push(
        withAmount({
          kind: 'supply',
          id,
          supplyKind: s.kind,
          suggested,
          category: SUPPLY_KIND_LABEL[s.kind],
          name: s.name,
          partNumber: s.partNumber,
          manufacturer: s.manufacturer,
          purchaseUrl: s.purchaseUrl,
          supplier: c.supplier ?? s.supplier,
          quantity: c.quantity ?? suggested,
          refDes: u && (s.kind === 'housing' || s.kind === 'terminal') ? u.refs : [],
          unitPrice: c.unitPrice ?? s.unitPrice,
          memo: c.memo
        })
      )
    }
  }
  for (const item of project.bom?.items ?? []) {
    rows.push(
      withAmount({
        kind: 'item',
        id: item.id,
        category: CATEGORY_ITEM,
        name: item.name,
        partNumber: item.partNumber,
        manufacturer: item.manufacturer,
        purchaseUrl: item.purchaseUrl,
        supplier: item.supplier,
        quantity: item.quantity,
        refDes: [],
        unitPrice: item.unitPrice,
        memo: item.memo
      })
    )
  }
  return numberRows(rows)
}

export function bomTotals(rows: readonly BomRow[]): BomTotals {
  return {
    lines: rows.length,
    quantity: roundMoney(rows.reduce((s, r) => s + r.quantity, 0)),
    total: roundMoney(rows.reduce((s, r) => s + (r.amount ?? 0), 0)),
    unpriced: rows.filter((r) => r.unitPrice === undefined && !(r.mixedPrice && r.amount !== undefined)).length
  }
}

/** 합계 행 비고: 단가가 없는 행 수 */
export const unpricedNote = (n: number, t: T = ko) => t('단가 미입력 {n}건', { n })

/** BOM 칸 (031): 번호 / 분류 / 품명 / 세부사항 / 수량 / 예상 단가 / 예상 총액 / 조달처 / 구매사이트 / 비고. 분류는 고른 언어로 */
export function bomColumns(tr: T = ko): CsvColumn<BomRow>[] {
  return [
    { header: msg('번호'), value: (r) => r.no },
    { header: msg('분류'), value: (r) => tr(r.category) },
    { header: msg('품명'), value: (r) => r.name },
    { header: msg('세부사항'), value: (r) => bomDetails(r) },
    { header: msg('수량'), value: (r) => r.quantity },
    { header: msg('예상 단가'), value: (r) => r.unitPrice },
    { header: msg('예상 총액'), value: (r) => r.amount },
    { header: msg('조달처'), value: (r) => r.supplier },
    { header: msg('구매사이트'), value: (r) => r.purchaseUrl },
    { header: msg('비고'), value: (r) => r.memo }
  ]
}
export const BOM_COLUMNS = bomColumns()

/** BOM CSV: 행들 + 마지막 합계 행 (수량 합, 총액) */
export function bomCsv(rows: readonly BomRow[], tr: T = ko): string {
  const t = bomTotals(rows)
  const columns = bomColumns(tr)
  const cells = columns.map((c) => {
    if (c.header === '번호') return tr('합계')
    if (c.header === '수량') return t.quantity
    if (c.header === '예상 총액') return t.total
    if (c.header === '비고') return t.unpriced ? unpricedNote(t.unpriced, tr) : undefined
    return undefined
  })
  return toCsv(rows, columns, tr) + csvLine(cells)
}

// ---------------------------------------------------------------- 엑셀(xlsx)

// 수량·예상 단가·예상 총액이 E·F·G열 (수식이 이 열을 쓴다)
const XLSX_COLUMNS: XlsxColumn[] = [
  { header: msg('번호'), width: 6 },
  { header: msg('분류'), width: 10 },
  { header: msg('품명'), width: 26 },
  { header: msg('세부사항'), width: 34 },
  { header: msg('수량'), width: 8 },
  { header: msg('예상 단가'), width: 12 },
  { header: msg('예상 총액'), width: 14 },
  { header: msg('조달처'), width: 14 },
  { header: msg('구매사이트'), width: 36 },
  { header: msg('비고'), width: 24 }
]

/**
 * BOM 엑셀 파일. 수량·단가는 숫자, 금액은 수식(=수량×단가), 마지막 합계 행도 수식(SUM)이라
 * 엑셀에서 값을 고치면 다시 계산된다. 구매 링크는 누르면 열리는 하이퍼링크.
 */
export function bomXlsx(rows: readonly BomRow[], tr: T = ko, currency: Currency = 'KRW'): Uint8Array {
  const t = bomTotals(rows)
  const body: XlsxCell[][] = rows.map((r, i) => {
    const n = i + 2
    return [
      r.no,
      tr(r.category),
      r.name,
      bomDetails(r) || undefined,
      r.quantity,
      r.unitPrice === undefined ? undefined : { v: r.unitPrice, money: true },
      // 단가가 섞인 합친 행은 수식 없이 값만 (수량 × 한 단가가 아니다)
      r.amount === undefined ? undefined : r.mixedPrice ? { v: r.amount, money: true } : { v: r.amount, f: `E${n}*F${n}`, money: true },
      r.supplier,
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
    undefined,
    t.unpriced ? unpricedNote(t.unpriced, tr) : undefined
  ])
  // 달러는 소수 둘째 자리까지. 원화는 단가에 소수가 있을 때만
  const decimals = currency === 'USD' || rows.some((r) => [r.unitPrice, r.amount].some((v) => v !== undefined && !Number.isInteger(v)))
  const moneyFormat = (currency === 'USD' ? '"$"' : '') + (decimals ? '#,##0.00' : '#,##0')
  return buildXlsx([
    { name: 'BOM', columns: XLSX_COLUMNS.map((c) => ({ ...c, header: tr(c.header) })), rows: body, footerRows: 1, moneyFormat }
  ])
}