import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { bomXlsx, buildBom, type BomRow } from '@core/bom'
import { buildXlsx, columnName, xmlEscape } from '@core/xlsx'
import { addBomItem, setBomOverride } from '@core/ops'
import { loadSample } from '../helpers'

const files = (bytes: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]))

describe('xlsx 작성기', () => {
  it('열 이름', () => {
    expect([0, 25, 26, 51, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA'])
  })

  it('XML 특수 문자는 바꾸고 제어 문자는 뺀다', () => {
    expect(xmlEscape('a<b>&"c"\u0001\u0008d\te\n')).toBe('a&lt;b&gt;&amp;&quot;c&quot;d\te\n')
  })

  it('엑셀이 요구하는 파일들, 머리글·숫자·글자·수식·링크', () => {
    const f = files(
      buildXlsx([
        {
          name: '표/1',
          columns: [
            { header: '이름', width: 10 },
            { header: '값', width: 8 },
            { header: '링크', width: 20 }
          ],
          rows: [
            ['<저항>', 3, { v: 'https://a.example/x?y=1&z=2', link: 'https://a.example/x?y=1&z=2' }],
            [{ v: '합계', bold: true }, { v: 3, f: 'SUM(B2:B2)', bold: true, money: true }, { v: 'javascript:x', link: 'javascript:x' }]
          ],
          footerRows: 1
        }
      ])
    )
    expect(Object.keys(f).sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/_rels/workbook.xml.rels',
        'xl/styles.xml',
        'xl/workbook.xml',
        'xl/worksheets/_rels/sheet1.xml.rels',
        'xl/worksheets/sheet1.xml'
      ].sort()
    )
    expect(f['xl/workbook.xml']).toContain('<sheet name="표 1"') // '/'는 시트 이름에 못 쓴다
    const sheet = f['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">이름</t></is></c>')
    expect(sheet).toContain('<t xml:space="preserve">&lt;저항&gt;</t>')
    expect(sheet).toContain('<c r="B2"><v>3</v></c>')
    expect(sheet).toContain('<c r="B3" s="4"><f>SUM(B2:B2)</f><v>3</v></c>')
    expect(sheet).toContain('<autoFilter ref="A1:C2"/>') // 합계 행은 필터에서 뺀다
    expect(sheet).toContain('<pane ySplit="1"')
    // http(s)만 하이퍼링크
    expect(sheet).toContain('<hyperlink ref="C2" r:id="rId1"/>')
    expect(sheet).not.toContain('ref="C3" r:id')
    expect(f['xl/worksheets/_rels/sheet1.xml.rels']).toContain('Target="https://a.example/x?y=1&amp;z=2" TargetMode="External"')
  })

  it('같은 내용이면 같은 바이트 (결정적)', () => {
    const sheet = { name: 'A', columns: [{ header: 'x', width: 5 }], rows: [[1]] }
    expect(buildXlsx([sheet])).toEqual(buildXlsx([sheet]))
  })
})

describe('BOM 엑셀', () => {
  const sheetOf = (bytes: Uint8Array) => files(bytes)['xl/worksheets/sheet1.xml']

  it('행마다 금액 수식, 합계 행은 SUM, 단가 없는 행 수를 비고에', () => {
    let p = setBomOverride(loadSample(), Object.keys(loadSample().parts)[0], { unitPrice: 1500 })
    p = addBomItem(p, { id: 'i1', name: '수축 튜브', quantity: 2, unitPrice: 300, purchaseUrl: 'https://shop.example/tube' })
    const rows: BomRow[] = buildBom(p)
    const sheet = sheetOf(bomXlsx(rows))
    const priced = rows.map((r, i) => ({ r, n: i + 2 })).filter(({ r }) => r.amount !== undefined)
    expect(priced.length).toBeGreaterThan(0)
    for (const { r, n } of priced) expect(sheet).toContain(`<f>E${n}*F${n}</f><v>${r.amount}</v>`)
    const last = rows.length + 1
    expect(sheet).toContain(`<f>SUM(G2:G${last})</f>`)
    expect(sheet).toContain(`<f>SUM(E2:E${last})</f>`)
    expect(sheet).toContain('수축 튜브')
    const unpriced = rows.filter((r) => r.unitPrice === undefined).length
    if (unpriced) expect(sheet).toContain(`단가 미입력 ${unpriced}건`)
    expect(files(bomXlsx(rows))['xl/styles.xml']).toContain('formatCode="#,##0"')
  })

  it('소수 단가가 있으면 소수 둘째 자리 서식, 빈 BOM도 파일이 된다', () => {
    const p = addBomItem(loadSample(), { id: 'i1', name: '핀', quantity: 3, unitPrice: 0.35 })
    expect(files(bomXlsx(buildBom(p)))['xl/styles.xml']).toContain('formatCode="#,##0.00"')
    const empty = sheetOf(bomXlsx([]))
    expect(empty).toContain('합계')
    expect(empty).not.toContain('SUM(')
  })
})
