// PDF용 보고서 HTML. 순수 함수: 입력 → HTML 문자열.
// main이 JavaScript를 끈 숨은 창에서 이 HTML을 PDF로 인쇄한다.
// 사용자 입력(제목, 부품 이름, 비고 …)은 모두 이스케이프한다.
import { bomColumns, bomTotals, unpricedNote, type BomRow } from './bom'

/** PDF 표는 # 열을 따로 그리므로 번호 칸은 뺀다 */
const pdfBomColumns = (t: T) => bomColumns(t).filter((c) => c.header !== '번호')
import { formatMoney } from './money'
import type { Currency } from './model'
import type { CsvColumn } from './csv'
import { NETLIST_COLUMNS, type NetlistRow } from './netlist'
import { isHttpUrl } from './url'
import { ko, type T } from './i18n'

export type PaperSize = 'A4' | 'A3'

export interface ReportOptions {
  title: string
  author?: string
  notes?: string
  /** 호출하는 쪽에서 형식을 정한 날짜 (순수 함수 유지) */
  date: string
  fileName?: string
  paper: PaperSize
  landscape: boolean
  /** 배선도 이미지. data:image/png;base64 만 받는다 */
  diagramPng?: string
  /** 회로도 이미지 (039). data:image/png;base64 만 받는다 */
  schematicPng?: string
  bom?: BomRow[]
  /** BOM 금액 통화 (029, 기본 원) */
  currency?: Currency
  netlist?: NetlistRow[]
  counts: { parts: number; wires: number }
  /** 전선 색 이름 (#e53935 → 빨강) */
  colorName?: (hex: string) => string
  /** 언어 (기본 한국어) */
  t?: T
  lang?: string
}

/** 용지 크기 (mm, 세로 기준) */
const PAPER_MM: Record<PaperSize, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 }
}
const MARGIN_MM = 12
const HEADER_MM = 26
const NOTES_MM = 24

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const esc = (v: string | number | undefined) => escapeHtml(v === undefined ? '' : String(v))
const isPngDataUrl = (s: string) => /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)

function table<R>(
  rows: R[],
  columns: readonly CsvColumn<R>[],
  t: T,
  cell?: Partial<Record<string, (row: R) => string>>,
  footer?: string
): string {
  const head = `<tr><th class="num">#</th>${columns.map((c) => `<th>${esc(t(c.header))}</th>`).join('')}</tr>`
  const body = rows
    .map(
      (row, i) =>
        `<tr><td class="num">${i + 1}</td>${columns
          .map((c) => `<td>${cell?.[c.header]?.(row) ?? esc(c.value(row))}</td>`)
          .join('')}</tr>`
    )
    .join('')
  return `<table><thead>${head}</thead><tbody>${body}</tbody>${footer ? `<tfoot>${footer}</tfoot>` : ''}</table>`
}

/** BOM 합계 행: 수량 합, 전체 총액, 단가 미입력 안내 */
function bomFooter(rows: BomRow[], tr: T, currency: Currency): string {
  const t = bomTotals(rows)
  const cells = pdfBomColumns(tr).map((c) => {
    if (c.header === '분류') return `<td><b>${esc(tr('합계'))}</b></td>`
    if (c.header === '수량') return `<td>${t.quantity}</td>`
    if (c.header === '예상 총액') return `<td class="money"><b>${esc(formatMoney(t.total, tr, currency))}</b></td>`
    if (c.header === '비고') return `<td>${t.unpriced ? esc(unpricedNote(t.unpriced, tr)) : ''}</td>`
    return '<td></td>'
  })
  return `<tr class="total"><td class="num"></td>${cells.join('')}</tr>`
}

export function buildReportHtml(o: ReportOptions): string {
  const t = o.t ?? ko
  const paper = PAPER_MM[o.paper]
  const page = o.landscape ? { w: paper.h, h: paper.w } : paper
  const notes = o.notes?.trim()
  const diagramMaxH = page.h - MARGIN_MM * 2 - HEADER_MM - (notes ? NOTES_MM : 0) - 4

  const titleBlock = (subtitle: string) => `
    <header class="title-block">
      <div class="title">${esc(o.title)}<span class="subtitle">${esc(subtitle)}</span></div>
      <dl>
        <dt>${esc(t('작성자'))}</dt><dd>${esc(o.author || '-')}</dd>
        <dt>${esc(t('날짜'))}</dt><dd>${esc(o.date)}</dd>
        <dt>${esc(t('파일'))}</dt><dd>${esc(o.fileName || '-')}</dd>
        <dt>${esc(t('규모'))}</dt><dd>${esc(t('부품 {parts}개 · 전선 {wires}개', o.counts))}</dd>
      </dl>
    </header>`

  const sections: string[] = []

  if (o.diagramPng !== undefined && isPngDataUrl(o.diagramPng)) {
    sections.push(`
    <section class="page diagram">
      ${titleBlock(t('배선도'))}
      <div class="diagram-box"><img src="${o.diagramPng}" style="max-height:${diagramMaxH}mm" alt="${esc(t('배선도'))}"></div>
      ${notes ? `<div class="notes" style="height:${NOTES_MM - 4}mm"><b>${esc(t('비고'))}</b><p>${esc(notes).replace(/\n/g, '<br>')}</p></div>` : ''}
    </section>`)
  }

  if (o.schematicPng !== undefined && isPngDataUrl(o.schematicPng)) {
    sections.push(`
    <section class="page diagram">
      ${titleBlock(t('회로도'))}
      <div class="diagram-box"><img src="${o.schematicPng}" style="max-height:${diagramMaxH}mm" alt="${esc(t('회로도'))}"></div>
    </section>`)
  }

  if (o.bom) {
    const link = (r: BomRow) =>
      r.purchaseUrl && isHttpUrl(r.purchaseUrl) ? `<a href="${esc(r.purchaseUrl)}">${esc(r.purchaseUrl)}</a>` : ''
    const money = (k: 'unitPrice' | 'amount') => (r: BomRow) =>
      r[k] === undefined ? '' : `<span class="money">${esc(formatMoney(r[k]!, t, o.currency))}</span>`
    sections.push(`
    <section class="page">
      ${titleBlock('BOM')}
      ${o.bom.length ? table(o.bom, pdfBomColumns(t), t, { 구매사이트: link, '예상 단가': money('unitPrice'), '예상 총액': money('amount') }, bomFooter(o.bom, t, o.currency ?? 'KRW')) : `<p class="empty">${esc(t('배치된 부품이 없습니다.'))}</p>`}
    </section>`)
  }

  if (o.netlist) {
    const color = (r: NetlistRow) =>
      `<span class="swatch" style="background:${/^#[0-9a-fA-F]{3,8}$/.test(r.color) ? r.color : '#999'}"></span>${esc(o.colorName?.(r.color) ?? r.color)}`
    sections.push(`
    <section class="page">
      ${titleBlock(t('결선표'))}
      ${o.netlist.length ? table(o.netlist, NETLIST_COLUMNS, t, { 색상: color }) : `<p class="empty">${esc(t('연결된 전선이 없습니다.'))}</p>`}
    </section>`)
  }

  return `<!doctype html>
<html lang="${esc(o.lang ?? 'ko')}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${esc(o.title)}</title>
<style>
  @page { size: ${o.paper} ${o.landscape ? 'landscape' : 'portrait'}; margin: ${MARGIN_MM}mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Malgun Gothic', 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif; font-size: 9pt; color: #111; }
  .page { break-after: page; }
  .page:last-child { break-after: auto; }
  .title-block { display: flex; justify-content: space-between; align-items: flex-end; height: ${HEADER_MM - 4}mm;
    border-bottom: 2px solid #111; margin-bottom: 4mm; padding-bottom: 2mm; }
  .title { font-size: 16pt; font-weight: 700; }
  .subtitle { font-size: 10pt; font-weight: 400; color: #555; margin-left: 4mm; }
  .title-block dl { display: grid; grid-template-columns: auto auto; gap: 0.5mm 3mm; margin: 0; font-size: 8pt; }
  .title-block dt { color: #666; }
  .title-block dd { margin: 0; }
  .diagram-box { display: flex; justify-content: center; }
  .diagram-box img { max-width: 100%; object-fit: contain; }
  .notes { border: 1px solid #999; padding: 2mm 3mm; margin-top: 3mm; overflow: hidden; font-size: 8.5pt; }
  .notes p { margin: 1mm 0 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #bbb; padding: 1.2mm 2mm; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  td.num, th.num { width: 8mm; color: #666; }
  a { color: #1d4ed8; word-break: break-all; }
  .swatch { display: inline-block; width: 3mm; height: 3mm; border-radius: 50%; border: 1px solid #888; margin-right: 1.5mm; vertical-align: -0.3mm; }
  .empty { color: #666; }
  .money { white-space: nowrap; }
  tfoot td { background: #f7f7f7; border-top: 2px solid #111; }
</style>
</head>
<body>
${sections.join('\n')}
</body>
</html>`
}
