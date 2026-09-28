import { describe, expect, it } from 'vitest'
import { bomXlsx, buildBom } from '@core/bom'
import { convertMoney, formatMoney, parseAmount, parseRate, projectCurrency } from '@core/money'
import { addBomItem, addInstance, emptyProject, replacePartDef, setBomCurrency, setBomOverride } from '@core/ops'
import { pasteClipboard, copySelection } from '@core/clipboard'
import { parseProject, serializeProject } from '@core/serialize'
import { translator } from '@core/i18n'
import { strFromU8, unzipSync } from 'fflate'

const en = translator('en')
import { makePart } from '../helpers'

const priced = () => {
  let p = addInstance(emptyProject('t'), makePart('m', { unitPrice: 13000 }), { id: 'i1', x: 0, y: 0 })
  p = addInstance(p, makePart('n', { unitPrice: 2600 }), { id: 'i2', x: 300, y: 0 })
  p = setBomOverride(p, 'n', { unitPrice: 3900, memo: '특가' })
  return addBomItem(p, { id: 'b1', name: '케이블 타이', quantity: 10, unitPrice: 65 })
}
const prices = (p: ReturnType<typeof priced>) => buildBom(p).map((r) => r.unitPrice)

describe('금액 표시·입력', () => {
  it('원·달러 표시', () => {
    expect(formatMoney(12500)).toBe('12,500원')
    expect(formatMoney(12500, en)).toBe('₩12,500')
    expect(formatMoney(12.5, en, 'USD')).toBe('$12.50')
    expect(formatMoney(1234.567, undefined, 'USD')).toBe('$1,234.57')
  })
  it('$ 기호도 입력으로 받는다', () => {
    expect(parseAmount('$1,200.5')).toBe(1200.5)
  })
  it('환율은 0보다 큰 숫자만', () => {
    expect(parseRate('1,300')).toBe(1300)
    expect(parseRate('1300.5')).toBe(1300.5)
    for (const bad of ['', 'abc', '0', '-5', '1e3', '12a', '1.2.3']) expect(parseRate(bad)).toBeUndefined()
  })
  it('환산: 원은 정수, 달러는 소수 둘째 자리, 환율이 없으면 못 함', () => {
    expect(convertMoney(13000, 'KRW', 'USD', 1300)).toBe(10)
    expect(convertMoney(1000, 'KRW', 'USD', 1300)).toBe(0.77)
    expect(convertMoney(0.77, 'USD', 'KRW', 1300)).toBe(1001)
    expect(convertMoney(5, 'USD', 'USD', undefined)).toBe(5)
    expect(convertMoney(5, 'USD', 'KRW', undefined)).toBeUndefined()
  })
})

describe('setBomCurrency', () => {
  it('통화를 바꾸면 부품 사본·수정값·직접 추가 단가를 모두 환산, 실행 취소용으로 입력은 그대로', () => {
    const p = priced()
    const snapshot = JSON.stringify(p)
    const usd = setBomCurrency(p, 'USD', 1300)
    expect(JSON.stringify(p)).toBe(snapshot)
    expect(projectCurrency(usd)).toBe('USD')
    expect(usd.bom?.exchangeRate).toBe(1300)
    expect(usd.parts.m).toMatchObject({ unitPrice: 10, currency: 'USD' })
    expect(prices(usd)).toEqual([10, 3, 0.05])
    expect(usd.bom?.overrides?.n.memo).toBe('특가')
    // 되돌리기: 원으로 → 원 정수
    const back = setBomCurrency(usd, 'KRW', 1300)
    expect(projectCurrency(back)).toBe('KRW')
    expect(prices(back)).toEqual([13000, 3900, 65])
    expect(back.parts.m).not.toHaveProperty('currency')
    expect(back.bom).not.toHaveProperty('currency')
  })
  it('같은 통화면 환율만, 환율이 올바르지 않으면 그대로', () => {
    const p = priced()
    const r = setBomCurrency(p, 'KRW', 1400)
    expect(prices(r)).toEqual(prices(p))
    expect(r.bom?.exchangeRate).toBe(1400)
    expect(setBomCurrency(r, 'KRW', 1400)).toBe(r)
    expect(setBomCurrency(p, 'USD', 0)).toBe(p)
    expect(setBomCurrency(p, 'USD', NaN)).toBe(p)
  })
  it('파일 저장·열기 왕복, 잘못된 통화·환율은 오류', () => {
    const usd = setBomCurrency(priced(), 'USD', 1350.5)
    const again = parseProject(serializeProject(usd))
    expect(again.ok && again.value.bom).toMatchObject({ currency: 'USD', exchangeRate: 1350.5 })
    expect(again.ok && again.value.parts.m.currency).toBe('USD')
    const raw = JSON.parse(serializeProject(usd))
    raw.bom.currency = 'EUR'
    raw.bom.exchangeRate = 0
    const bad = parseProject(JSON.stringify(raw))
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.errors.join('\n')).toMatch(/bom\.currency[\s\S]*bom\.exchangeRate|bom\.exchangeRate[\s\S]*bom\.currency/)
  })
})

describe('부품을 배선도에 넣을 때 통화 맞추기', () => {
  const usdProject = () => setBomCurrency(emptyProject('t'), 'USD', 1250)
  it('원화 부품을 달러 배선도에 놓으면 환산된 사본', () => {
    const p = addInstance(usdProject(), makePart('m', { unitPrice: 12500 }), { id: 'i', x: 0, y: 0 })
    expect(p.parts.m).toMatchObject({ unitPrice: 10, currency: 'USD' })
  })
  it('달러 부품을 환율 없는 원화 배선도에 놓으면 단가를 뺀다', () => {
    const p = addInstance(emptyProject('t'), makePart('m', { unitPrice: 3, currency: 'USD' }), { id: 'i', x: 0, y: 0 })
    expect(p.parts.m).not.toHaveProperty('unitPrice')
    expect(p.parts.m).not.toHaveProperty('currency')
  })
  it('부품함에서 새로 고칠 때·다른 배선도에서 붙여넣을 때도', () => {
    let p = addInstance(usdProject(), makePart('m', { unitPrice: 12500 }), { id: 'i', x: 0, y: 0 })
    p = replacePartDef(p, makePart('m', { unitPrice: 25000 })).project
    expect(p.parts.m.unitPrice).toBe(20)
    const other = addInstance(emptyProject('o'), makePart('k', { unitPrice: 2500 }), { id: 'k1', x: 0, y: 0 })
    const clip = copySelection(other, { instances: ['k1'], wires: [] })!
    let n = 0
    const pasted = pasteClipboard(p, clip, { x: 10, y: 10 }, () => `new${n++}`).project
    expect(pasted.parts.k).toMatchObject({ unitPrice: 2, currency: 'USD' })
  })
  it('달러 BOM 엑셀은 $ 서식', () => {
    const bytes = bomXlsx(buildBom(setBomCurrency(priced(), 'USD', 1300)), undefined, 'USD')
    expect(strFromU8(unzipSync(bytes)['xl/styles.xml'])).toContain('&quot;$&quot;#,##0.00')
  })
})
