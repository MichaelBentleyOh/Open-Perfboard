// 최소한의 엑셀(xlsx) 파일 작성기. xlsx = XML 몇 개를 묶은 zip 파일이다.
// 지원: 여러 시트, 머리글 행(굵게·배경·틀 고정·필터), 숫자/글자, 수식(계산된 값 포함), 금액 서식, 굵게, 하이퍼링크, 열 너비
import { strToU8, zipSync } from 'fflate'

export type XlsxValue = string | number | undefined

export interface XlsxCellObject {
  /** 표시할 값. 수식이 있으면 수식의 계산 결과(엑셀이 다시 계산하기 전에 보이는 값) */
  v?: XlsxValue
  /** 수식 ('=' 없이, 예: SUM(E2:E9)) */
  f?: string
  /** http/https 링크 */
  link?: string
  bold?: boolean
  money?: boolean
}
export type XlsxCell = XlsxValue | XlsxCellObject

export interface XlsxColumn {
  header: string
  /** 글자 수 기준 너비 */
  width: number
}

export interface XlsxSheet {
  name: string
  columns: readonly XlsxColumn[]
  /** 머리글 다음 줄(2행)부터 */
  rows: readonly (readonly XlsxCell[])[]
  /** 금액 칸 표시 서식 (기본 #,##0) */
  moneyFormat?: string
  /** 맨 아래 합계 행 수 (필터 범위에서 뺀다) */
  footerRows?: number
}

/** A, B, …, Z, AA … (0부터) */
export function columnName(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** XML에 넣을 수 없는 제어 문자는 빼고 특수 문자는 바꾼다 */
export function xmlEscape(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 시트 이름 규칙: 31자 이하, []:*?/\ 금지, 비면 Sheet */
function sheetName(name: string, index: number, used: Set<string>): string {
  let s = name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${index + 1}`
  for (let k = 2; used.has(s.toLowerCase()); k++) s = `${s.slice(0, 28)} ${k}`
  used.add(s.toLowerCase())
  return s
}

const isHttp = (url: string) => /^https?:\/\//i.test(url)

// 스타일 번호 (styles.xml의 cellXfs 순서)
const STYLE = { none: 0, header: 1, money: 2, bold: 3, boldMoney: 4, link: 5 } as const

function styleOf(c: XlsxCellObject): number {
  if (c.link && isHttp(c.link)) return STYLE.link
  if (c.bold && c.money) return STYLE.boldMoney
  if (c.money) return STYLE.money
  if (c.bold) return STYLE.bold
  return STYLE.none
}

function cellXml(ref: string, cell: XlsxCell, style?: number): string {
  const c: XlsxCellObject = typeof cell === 'object' ? cell : { v: cell }
  const s = style ?? styleOf(c)
  const sAttr = s ? ` s="${s}"` : ''
  const v = c.v
  if (c.f) {
    const fx = `<f>${xmlEscape(c.f)}</f>`
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${sAttr}>${fx}<v>${v}</v></c>`
    if (typeof v === 'string') return `<c r="${ref}"${sAttr} t="str">${fx}<v>${xmlEscape(v)}</v></c>`
    return `<c r="${ref}"${sAttr}>${fx}</c>`
  }
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${sAttr}><v>${v}</v></c>`
  if (typeof v === 'string' && v !== '') {
    return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`
  }
  return s ? `<c r="${ref}"${sAttr}/>` : ''
}

function sheetXml(sheet: XlsxSheet): { xml: string; links: { ref: string; url: string }[] } {
  const links: { ref: string; url: string }[] = []
  const lastCol = columnName(Math.max(sheet.columns.length - 1, 0))
  const lastRow = sheet.rows.length + 1
  const filterLast = Math.max(1, lastRow - (sheet.footerRows ?? 0))
  const header = `<row r="1">${sheet.columns.map((col, i) => cellXml(`${columnName(i)}1`, col.header, STYLE.header)).join('')}</row>`
  const body = sheet.rows
    .map((row, r) => {
      const n = r + 2
      const cells = row
        .map((cell, i) => {
          const ref = `${columnName(i)}${n}`
          if (typeof cell === 'object' && cell.link && isHttp(cell.link)) links.push({ ref, url: cell.link })
          return cellXml(ref, cell)
        })
        .join('')
      return `<row r="${n}">${cells}</row>`
    })
    .join('')
  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('')
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    // 머리글 행 고정
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="16.5"/>` +
    (cols ? `<cols>${cols}</cols>` : '') +
    `<sheetData>${header}${body}</sheetData>` +
    `<autoFilter ref="A1:${lastCol}${filterLast}"/>` +
    (links.length ? `<hyperlinks>${links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join('')}</hyperlinks>` : '') +
    `<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="landscape" paperSize="9" fitToHeight="0"/>` +
    `</worksheet>`
  return { xml, links }
}

function stylesXml(moneyFormat: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="${xmlEscape(moneyFormat)}"/></numFmts>` +
    `<fonts count="3">` +
    `<font><sz val="11"/><name val="맑은 고딕"/><family val="2"/></font>` +
    `<font><b/><sz val="11"/><name val="맑은 고딕"/><family val="2"/></font>` +
    `<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="맑은 고딕"/><family val="2"/></font>` +
    `</fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left/><right/><top/><bottom style="thin"><color rgb="FF9CA3AF"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="6">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  )
}

/** 시트들을 xlsx 파일 바이트로 만든다 */
export function buildXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  const used = new Set<string>()
  const names = sheets.map((s, i) => sheetName(s.name, i, used))
  const files: Record<string, Uint8Array> = {}
  const put = (path: string, xml: string) => (files[path] = strToU8(xml))

  put(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('') +
      `</Types>`
  )
  put(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`
  )
  put(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
      // 필터 범위 (엑셀이 자동 필터를 알아보는 이름)
      `<definedNames>${sheets
        .map((s, i) => {
          const last = columnName(Math.max(s.columns.length - 1, 0))
          const lastRow = Math.max(1, s.rows.length + 1 - (s.footerRows ?? 0))
          const quoted = `'${names[i].replace(/'/g, "''")}'`
          return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlEscape(`${quoted}!$A$1:$${last}$${lastRow}`)}</definedName>`
        })
        .join('')}</definedNames>` +
      `<calcPr calcId="191029" fullCalcOnLoad="1"/>` +
      `</workbook>`
  )
  put(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`
  )
  put('xl/styles.xml', stylesXml(sheets.find((s) => s.moneyFormat)?.moneyFormat ?? '#,##0'))

  sheets.forEach((sheet, i) => {
    const { xml, links } = sheetXml(sheet)
    put(`xl/worksheets/sheet${i + 1}.xml`, xml)
    if (links.length) {
      put(
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          links
            .map(
              (l, k) =>
                `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(l.url)}" TargetMode="External"/>`
            )
            .join('') +
          `</Relationships>`
      )
    }
  })
  // mtime 고정 → 같은 내용이면 같은 파일 (테스트가 결정적)
  return zipSync(files, { level: 6, mtime: new Date(2020, 0, 1) })
}
