import { describe, expect, it } from 'vitest'
import { BOM_COLUMNS, bomCsv, bomTotals, buildBom } from '@core/bom'
import { toCsv } from '@core/csv'
import { translator } from '@core/i18n'
import { formatMoney, parseAmount, roundMoney } from '@core/money'
import {
  addBomItem,
  addInstance,
  emptyProject,
  removeBomItem,
  removeInstance,
  setBomOverride,
  updateBomItem
} from '@core/ops'
import { parseProject, serializeProject } from '@core/serialize'
import { loadSample, makePart } from '../helpers'

describe('buildBom', () => {
  it('부품 정의별로 수량을 센다', () => {
    const rows = buildBom(loadSample())
    expect(rows.map((r) => [r.kind, r.id, r.name, r.quantity, r.refDes])).toEqual([
      ['part', 'part-pwr', '전원 커넥터 PWR-2P', 1, ['CN1']],
      ['part', 'part-ctrl', '제어 보드 CB-100', 1, ['U1']]
    ])
    expect(rows[1]).toMatchObject({ partNumber: 'CB-100', manufacturer: 'OPB Labs' })
  })

  it('참조명을 자연 정렬한다 (U2 < U10)', () => {
    const part = makePart('r')
    let p = emptyProject('t')
    for (let i = 0; i < 10; i++) p = addInstance(p, part, { id: `i${i}`, x: 0, y: 0 })
    const [row] = buildBom(p)
    expect(row.quantity).toBe(10)
    expect(row.refDes.slice(-3)).toEqual(['U8', 'U9', 'U10'])
  })

  it('배치가 없으면 빈 목록', () => {
    expect(buildBom(emptyProject('t'))).toEqual([])
  })

  it('CSV: 번호·분류·품명·세부사항(품번·제조사·참조명)… 칸과 합계 행', () => {
    expect(bomCsv(buildBom(loadSample()))).toBe(
      '﻿번호,분류,품명,세부사항,수량,예상 단가,예상 총액,조달처,구매사이트,비고\r\n' +
        '1,부품,전원 커넥터 PWR-2P,CN1,1,,,,,\r\n' +
        '2,부품,제어 보드 CB-100,CB-100 · OPB Labs · U1,1,,,,,\r\n' +
        '합계,,,,2,,0,,,단가 미입력 2건\r\n'
    )
  })

  it('조달처: 부품 기본값 < BOM 수정값, 직접 추가 항목, 영어 분류', () => {
    let p = loadSample()
    p.parts['part-ctrl'] = { ...p.parts['part-ctrl'], supplier: '디바이스마트' }
    expect(buildBom(p)[1].supplier).toBe('디바이스마트')
    p = setBomOverride(p, 'part-ctrl', { supplier: '엘레파츠' })
    p = addBomItem(p, { id: 'x', name: '케이블 타이', quantity: 1, supplier: '다이소' })
    const rows = buildBom(p)
    expect(rows.map((r) => [r.no, r.category, r.supplier])).toEqual([
      [1, '부품', undefined],
      [2, '부품', '엘레파츠'],
      [3, '직접 추가', '다이소']
    ])
    expect(bomCsv(rows, translator('en'))).toContain('3,Added,케이블 타이,,1,,,다이소,,')
    const again = parseProject(serializeProject(p))
    expect(again.ok && again.value.bom?.overrides?.['part-ctrl'].supplier).toBe('엘레파츠')
  })

  it('구매 링크가 행과 CSV에 들어간다', () => {
    const p = loadSample()
    p.parts['part-ctrl'] = { ...p.parts['part-ctrl'], purchaseUrl: 'https://shop.example/esp32?id=1,2' }
    const rows = buildBom(p)
    expect(rows[1].purchaseUrl).toBe('https://shop.example/esp32?id=1,2')
    expect(toCsv(rows, BOM_COLUMNS)).toContain('"https://shop.example/esp32?id=1,2"')
  })
})

describe('금액 자동 계산', () => {
  it('금액 = 수량 × 단가, 총액 = 금액 합, 단가 없는 행 수', () => {
    const part = makePart('led', { name: 'LED', unitPrice: 150 })
    let p = emptyProject('t')
    for (let i = 0; i < 4; i++) p = addInstance(p, part, { id: `i${i}`, x: 0, y: 0 })
    p = addBomItem(p, { id: 'b1', name: '열수축 튜브', quantity: 3, unitPrice: 300 })
    p = addBomItem(p, { id: 'b2', name: '나사', quantity: 10 }) // 단가 없음
    const rows = buildBom(p)
    expect(rows.map((r) => [r.name, r.quantity, r.unitPrice, r.amount])).toEqual([
      ['LED', 4, 150, 600],
      ['열수축 튜브', 3, 300, 900],
      ['나사', 10, undefined, undefined]
    ])
    expect(bomTotals(rows)).toEqual({ lines: 3, quantity: 17, total: 1500, unpriced: 1 })
  })

  it('BOM 수정 단가가 부품 기본 단가보다 우선, 지우면 기본 단가로', () => {
    const part = makePart('m', { unitPrice: 1000 })
    let p = addInstance(emptyProject('t'), part, { id: 'i1', x: 0, y: 0 })
    p = setBomOverride(p, 'm', { unitPrice: 1200, memo: '특가' })
    expect(buildBom(p)[0]).toMatchObject({ unitPrice: 1200, amount: 1200, memo: '특가' })
    p = setBomOverride(p, 'm', { unitPrice: null })
    expect(buildBom(p)[0]).toMatchObject({ unitPrice: 1000, memo: '특가' })
    p = setBomOverride(p, 'm', { memo: null })
    expect(p).not.toHaveProperty('bom') // 빈 BOM 정보는 남기지 않는다
  })

  it('소수 수량·단가도 오차 없이 (0.1 × 3)', () => {
    let p = addBomItem(emptyProject('t'), { id: 'w', name: '전선(m)', quantity: 3, unitPrice: 0.1 })
    p = addBomItem(p, { id: 'w2', name: '전선2(m)', quantity: 2.5, unitPrice: 1200 })
    expect(buildBom(p).map((r) => r.amount)).toEqual([0.3, 3000])
    expect(bomTotals(buildBom(p)).total).toBe(3000.3)
  })

  it('money: 형식, 입력 해석, 반올림', () => {
    expect(formatMoney(1234567)).toBe('1,234,567원')
    expect(formatMoney(0.1 * 3)).toBe('0.3원')
    expect(parseAmount('12,500')).toBe(12500)
    expect(parseAmount(' 3.5원 ')).toBe(3.5)
    expect(parseAmount('')).toBeUndefined()
    expect(parseAmount('abc')).toBeNaN()
    expect(parseAmount('-5')).toBeNaN()
    expect(Object.is(roundMoney(-0.001), 0)).toBe(true)
  })
})

describe('BOM 편집 연산', () => {
  it('직접 추가 항목: 추가·수정·삭제, 빈 필드는 저장하지 않음', () => {
    let p = addBomItem(emptyProject('t'), { id: 'a', name: '타이', quantity: 20, memo: '' })
    expect(p.bom?.items?.[0]).toEqual({ id: 'a', name: '타이', quantity: 20 })
    p = updateBomItem(p, 'a', { unitPrice: 50, manufacturer: 'HellermannTyton' })
    expect(buildBom(p)[0]).toMatchObject({ kind: 'item', amount: 1000, manufacturer: 'HellermannTyton' })
    p = updateBomItem(p, 'a', { manufacturer: undefined })
    expect(p.bom?.items?.[0]).not.toHaveProperty('manufacturer')
    p = removeBomItem(p, 'a')
    expect(p).not.toHaveProperty('bom')
  })

  it('부품이 배선도에서 모두 빠지면 그 수정값도 지운다', () => {
    let p = setBomOverride(loadSample(), 'part-pwr', { unitPrice: 45000 })
    p = removeInstance(p, 'i2')
    expect(p.bom?.overrides?.['part-pwr']).toBeUndefined()
  })

  it('파일 왕복, 잘못된 값은 거부', () => {
    let p = setBomOverride(loadSample(), 'part-ctrl', { unitPrice: 9900, memo: '2개 묶음' })
    p = addBomItem(p, { id: 'x', name: '케이블 타이', quantity: 30, unitPrice: 20, purchaseUrl: 'https://a.com/t' })
    const again = parseProject(serializeProject(p))
    expect(again.ok && again.value.bom).toEqual(p.bom)

    const raw = JSON.parse(serializeProject(p))
    raw.bom.items[0].unitPrice = -1
    raw.bom.overrides['part-ctrl'].unitPrice = '9900'
    const bad = parseProject(JSON.stringify(raw))
    expect(bad.ok ? [] : bad.errors).toEqual(
      expect.arrayContaining(['bom.overrides.part-ctrl.unitPrice: 숫자여야 합니다', 'bom.items[0].unitPrice: 범위를 벗어났습니다 (-1)'])
    )
  })
})
