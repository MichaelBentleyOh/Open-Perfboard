import { describe, expect, it } from 'vitest'
import { buildBom } from '@core/bom'
import { buildNetlist } from '@core/netlist'
import { buildReportHtml, escapeHtml, type ReportOptions } from '@core/report'
import { loadSample } from '../helpers'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

function options(o: Partial<ReportOptions> = {}): ReportOptions {
  const p = loadSample()
  return {
    title: '로봇 하네스',
    date: '2026. 9. 26.',
    paper: 'A4',
    landscape: true,
    diagramPng: PNG,
    bom: buildBom(p),
    netlist: buildNetlist(p),
    counts: { parts: 2, wires: 2 },
    ...o
  }
}

const sectionCount = (html: string) => (html.match(/<section class="page/g) ?? []).length

describe('buildReportHtml', () => {
  it('배선도·BOM·결선표 세 쪽과 용지 설정', () => {
    const html = buildReportHtml(options())
    expect(sectionCount(html)).toBe(3)
    expect(html).toContain('@page { size: A4 landscape;')
    expect(html).toContain(`<img src="${PNG}"`)
    expect(html).toContain('<td>제어 보드 CB-100</td>')
    expect(html).toContain('<td>CN1.P1.+</td>')
    expect(html).toContain('부품 2개 · 전선 2개')
  })

  it('포함하지 않은 항목은 빠진다', () => {
    const html = buildReportHtml(options({ diagramPng: undefined, netlist: undefined, paper: 'A3', landscape: false }))
    expect(sectionCount(html)).toBe(1)
    expect(html).toContain('@page { size: A3 portrait;')
    expect(html).not.toContain('<img')
  })

  it('사용자 입력은 모두 이스케이프한다', () => {
    const p = loadSample()
    p.parts['part-ctrl'] = { ...p.parts['part-ctrl'], name: '<script>alert(1)</script>' }
    const html = buildReportHtml(
      options({ title: 'A & B <x>', author: '"홍"', notes: '줄1\n<b>줄2</b>', bom: buildBom(p) })
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('A &amp; B &lt;x&gt;')
    expect(html).toContain('&quot;홍&quot;')
    expect(html).toContain('줄1<br>&lt;b&gt;줄2&lt;/b&gt;')
  })

  it('PNG data URL이 아닌 이미지는 넣지 않는다', () => {
    expect(buildReportHtml(options({ diagramPng: 'javascript:alert(1)' }))).not.toContain('<img')
    expect(buildReportHtml(options({ diagramPng: 'data:image/png;base64,AA"onerror="x' }))).not.toContain('<img')
  })

  it('구매 링크는 http/https만 링크로 만든다', () => {
    const p = loadSample()
    p.parts['part-ctrl'] = { ...p.parts['part-ctrl'], purchaseUrl: 'https://shop.example/a?b=1&c=2' }
    const html = buildReportHtml(options({ bom: buildBom(p) }))
    expect(html).toContain('<a href="https://shop.example/a?b=1&amp;c=2">')
  })

  it('비고가 있으면 비고 칸, 없으면 없음', () => {
    expect(buildReportHtml(options({ notes: '퓨즈 5A' }))).toContain('<b>비고</b>')
    expect(buildReportHtml(options({ notes: '  ' }))).not.toContain('<b>비고</b>')
  })

  it('전선 색 이름을 쓸 수 있다', () => {
    const html = buildReportHtml(options({ colorName: (hex) => (hex === '#e53935' ? '빨강' : hex) }))
    expect(html).toContain('빨강</td>')
  })

  it('escapeHtml', () => {
    expect(escapeHtml(`<a href='x'>&"`)).toBe('&lt;a href=&#39;x&#39;&gt;&amp;&quot;')
  })
})

describe('BOM 금액 (PDF)', () => {
  it('단가·금액을 원 단위로, 합계 행에 총액', async () => {
    const { addBomItem, setBomOverride } = await import('@core/ops')
    let p = setBomOverride(loadSample(), 'part-ctrl', { unitPrice: 12500 })
    p = addBomItem(p, { id: 't', name: '열수축 튜브', quantity: 3, unitPrice: 300 })
    const html = buildReportHtml(options({ bom: buildBom(p) }))
    expect(html).toContain('<span class="money">12,500원</span>')
    expect(html).toContain('<span class="money">900원</span>')
    expect(html).toContain('<tr class="total">')
    expect(html).toContain('<b>13,400원</b>')
    expect(html).toContain('단가 미입력 1건') // 전원 커넥터
  })
})
