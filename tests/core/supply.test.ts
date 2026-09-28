import { describe, expect, it } from 'vitest'
import { buildBom } from '@core/bom'
import { copySelection, pasteClipboard } from '@core/clipboard'
import { readLibraryFile, serializeLibrary } from '@core/library'
import { PROJECT_FILE_VERSION, type PartDef, type Project, type Supply, type Wire } from '@core/model'
import { buildNetlist } from '@core/netlist'
import { emptyProject, removeItems, setBomCurrency } from '@core/ops'
import { parseProject, serializeProject } from '@core/serialize'
import {
  checkSupply,
  chooseSupply,
  finalizeSupply,
  pruneSupplies,
  setSupplyChoice,
  setWireSupplies,
  supplyDecisions,
  supplyUsage
} from '@core/supply'
import { makePart } from '../helpers'

// 보드: J1(JST-XH 4P) 핀 4개, J2(JST-XH 4P) 핀 1개, J3(종류 없음) 핀 1개, 커넥터 없는 핀 1개
const board: PartDef = makePart('board', {
  connectors: [
    { id: 'j1', name: 'J1', type: 'JST-XH 4P' },
    { id: 'j2', name: 'J2', type: ' jst-xh 4p ' },
    { id: 'j3', name: 'J3', type: '' },
    { id: 'j4', name: 'J4', type: 'Molex 2P' }
  ],
  pins: [
    { id: 'a1', number: '1', connectorId: 'j1', x: 0, y: 0 },
    { id: 'a2', number: '2', connectorId: 'j1', x: 0.1, y: 0 },
    { id: 'a3', number: '3', connectorId: 'j1', x: 0.2, y: 0 },
    { id: 'a4', number: '4', connectorId: 'j1', x: 0.3, y: 0 },
    { id: 'b1', number: '1', connectorId: 'j2', x: 0.4, y: 0 },
    { id: 'c1', number: '1', connectorId: 'j3', x: 0.5, y: 0 },
    { id: 'd1', number: '1', connectorId: 'j4', x: 0.6, y: 0 },
    { id: 'n1', number: 'X', x: 0.7, y: 0 }
  ]
})
const terminal: Supply = { id: 'sxh', kind: 'terminal', name: 'SXH-001T', unitPrice: 30 }
const housing: Supply = { id: 'xhp4', kind: 'housing', name: 'XHP-4', connectorType: 'JST-XH 4P', terminalId: 'sxh', unitPrice: 100 }
const tube: Supply = { id: 't3', kind: 'tube', name: '수축 튜브 Ø3', diameter: 3, pack: '1 m 롤', unitPrice: 2000 }
const red: Supply = { id: 'ul22r', kind: 'wire', name: 'UL1007 AWG22 빨강', awg: 22, color: '#e53935', pack: '10 m 릴', unitPrice: 5000 }
const library = [terminal, housing, tube, red]

const wire = (id: string, a: [string, string], b: [string, string]): Wire => ({
  id, from: { instanceId: a[0], pinId: a[1] }, to: { instanceId: b[0], pinId: b[1] }, color: '#000', width: 2
})

/** U1 J1 핀 3개, J2 핀 1개, J3·J4·커넥터 없는 핀 각 1개가 U2로 연결 */
function diagram(): Project {
  return {
    version: PROJECT_FILE_VERSION,
    name: 't',
    parts: { board },
    instances: [
      { id: 'u1', partId: 'board', refDes: 'U1', x: 0, y: 0, rotation: 0, scale: 1 },
      { id: 'u2', partId: 'board', refDes: 'U2', x: 500, y: 0, rotation: 0, scale: 1 }
    ],
    wires: [
      wire('w1', ['u1', 'a1'], ['u2', 'n1']),
      wire('w2', ['u1', 'a2'], ['u2', 'c1']),
      wire('w3', ['u1', 'a3'], ['u2', 'd1']),
      wire('w4', ['u1', 'b1'], ['u1', 'n1'])
    ]
  }
}

describe('supplyUsage (제안 수량)', () => {
  it('하우징 = 전선이 연결된 커넥터 수, 단자 = 연결된 핀 수 (종류는 대소문자·공백 무시)', () => {
    const r = supplyUsage(diagram(), library)
    const h = r.uses.find((u) => u.supply.id === 'xhp4')!
    const tm = r.uses.find((u) => u.supply.id === 'sxh')!
    expect(h).toMatchObject({ count: 2, suggested: 2, refs: ['U1.J1', 'U1.J2'] })
    expect(tm).toMatchObject({ count: 4, suggested: 4 })
    // 종류가 빈 J3, 커넥터 없는 핀은 셈하지 않고, 하우징이 없는 Molex 2P는 안내
    expect(r.missing).toEqual([{ type: 'Molex 2P', refs: ['U2.J4'] }])
  })

  it('수축 튜브는 양 끝 2 + 중간 1 조각, 전선은 가닥 수. 제안은 묶음 1개', () => {
    let p = setWireSupplies(diagram(), ['w1', 'w2'], { wire: red, tubeEnds: tube })
    p = setWireSupplies(p, ['w3'], { tubeMiddle: tube })
    const r = supplyUsage(p, library)
    expect(r.uses.find((u) => u.supply.id === 't3')).toMatchObject({ count: 5, ends: 4, middle: 1, suggested: 1 })
    expect(r.uses.find((u) => u.supply.id === 'ul22r')).toMatchObject({ count: 2, suggested: 1 })
    // 종류 순서: 하우징, 단자, 수축 튜브, 전선
    expect(r.uses.map((u) => u.supply.kind)).toEqual(['housing', 'terminal', 'tube', 'wire'])
  })

  it('부품함에 없어도 배선도 사본이 있으면 센다, 사본이 우선', () => {
    const p = chooseSupply(diagram(), { ...housing, name: '사본 하우징' }, true, library)
    const r = supplyUsage(p, [{ ...housing, id: 'other', name: 'A 먼저' }])
    expect(r.uses[0].supply.name).toBe('사본 하우징')
  })
})

describe('전선 종류·수축 튜브', () => {
  it('전선 종류를 고르면 색·AWG가 들어가고 사본이 생긴다, 빼면 사본도 정리', () => {
    const p = setWireSupplies(diagram(), ['w1'], { wire: red, tubeEnds: tube, tubeMiddle: tube })
    expect(p.wires[0]).toMatchObject({ supplyId: 'ul22r', color: '#e53935', awg: 22, tubes: { ends: 't3', middle: 't3' } })
    expect(Object.keys(p.supplies!)).toEqual(['ul22r', 't3'])
    const cleared = setWireSupplies(p, ['w1'], { wire: null, tubeEnds: null, tubeMiddle: null })
    expect(cleared.wires[0]).not.toHaveProperty('supplyId')
    expect(cleared.wires[0]).not.toHaveProperty('tubes')
    expect(cleared.wires[0].color).toBe('#e53935') // 색은 그대로
    expect(cleared).not.toHaveProperty('supplies')
  })

  it('전선을 지우면 쓰지 않는 사본도 지운다', () => {
    const p = setWireSupplies(diagram(), ['w1'], { wire: red })
    expect(removeItems(p, { instances: [], wires: ['w1'] })).not.toHaveProperty('supplies')
  })

  it('결선표에 전선 종류·튜브 이름', () => {
    const p = setWireSupplies(diagram(), ['w1'], { wire: red, tubeEnds: tube })
    const row = buildNetlist(p).find((r) => r.wireId === 'w1')!
    expect(row).toMatchObject({ wireType: 'UL1007 AWG22 빨강', tubeEnds: '수축 튜브 Ø3', tubeMiddle: undefined })
  })

  it('복사해서 다른 배선도에 붙여넣으면 사본도 따라간다', () => {
    const p = setWireSupplies(diagram(), ['w1'], { wire: red })
    const clip = copySelection(p, { instances: ['u1', 'u2'], wires: [] })!
    let n = 0
    const pasted = pasteClipboard(emptyProject('o'), clip, { x: 0, y: 0 }, () => `n${n++}`).project
    const w = pasted.wires.find((x) => x.supplyId)!
    expect(pasted.supplies?.[w.supplyId!]).toEqual(red)
    expect(parseProject(serializeProject(pasted)).ok).toBe(true)
  })
})

describe('BOM: 넣을지 묻기', () => {
  it('처음에는 모두 묻는 중, 넣으면 행(제안 수량), 빼면 뺀 목록', () => {
    let p = setWireSupplies(diagram(), ['w1'], { tubeEnds: tube })
    const report = () => supplyUsage(p, library)
    expect(supplyDecisions(p, report()).pending.map((u) => u.supply.id)).toEqual(['xhp4', 'sxh', 't3'])
    expect(buildBom(p).filter((r) => r.kind === 'supply')).toEqual([])

    p = chooseSupply(p, housing, true, library)
    // 하우징의 단자 사본도 함께 (단자 행은 따로 묻는다)
    expect(Object.keys(p.supplies!).sort()).toEqual(['sxh', 't3', 'xhp4'])
    p = chooseSupply(p, terminal, true, library)
    p = chooseSupply(p, tube, false, library)
    const rows = buildBom(p).filter((r) => r.kind === 'supply')
    expect(rows.map((r) => [r.name, r.quantity, r.refDes.join(','), r.amount])).toEqual([
      ['XHP-4', 2, 'U1.J1,U1.J2', 200],
      ['SXH-001T', 4, 'U1.J1,U1.J2', 120]
    ])
    expect(supplyDecisions(p, report())).toMatchObject({ pending: [], excluded: [{ supply: { id: 't3' } }] })
  })

  it('수량·단가·비고를 고치면 그 값, null이면 제안 수량·기본 단가로', () => {
    let p = chooseSupply(diagram(), housing, true, library)
    p = setSupplyChoice(p, 'xhp4', { quantity: 10, unitPrice: 80, memo: '예비 포함' })
    expect(buildBom(p).find((r) => r.id === 'xhp4')).toMatchObject({ quantity: 10, unitPrice: 80, amount: 800, memo: '예비 포함', suggested: 2 })
    p = setSupplyChoice(p, 'xhp4', { quantity: null, unitPrice: null, memo: null })
    expect(buildBom(p).find((r) => r.id === 'xhp4')).toMatchObject({ quantity: 2, unitPrice: 100 })
    expect(p.bom?.supplies?.xhp4).toEqual({ include: true })
    // 되돌려 다시 묻기 → 선택값과 사본이 사라진다
    const again = chooseSupply(p, housing, undefined)
    expect(again.bom).toBeUndefined()
    expect(again).not.toHaveProperty('supplies')
  })

  it('통화를 바꾸면 사본·수정 단가도 환산', () => {
    let p = chooseSupply(diagram(), housing, true, library)
    p = setSupplyChoice(p, 'xhp4', { unitPrice: 1300 })
    const usd = setBomCurrency(p, 'USD', 1300)
    expect(usd.supplies?.xhp4).toMatchObject({ unitPrice: 0.08, currency: 'USD' })
    expect(usd.bom?.supplies?.xhp4.unitPrice).toBe(1)
    // 달러 배선도에 원화 부속 부품을 넣으면 환산된 사본
    const t2 = chooseSupply(usd, terminal, true, library)
    expect(t2.supplies?.sxh).toMatchObject({ unitPrice: 0.02, currency: 'USD' })
  })
})

describe('파일', () => {
  it('배선도 저장·열기 왕복 (사본, 전선 참조, BOM 선택값)', () => {
    let p = setWireSupplies(diagram(), ['w1'], { wire: red, tubeEnds: tube })
    p = chooseSupply(p, housing, true, library)
    p = setSupplyChoice(p, 'xhp4', { quantity: 3 })
    const r = parseProject(serializeProject(p))
    expect(r.ok && r.value).toEqual(p)
  })

  it('사본이 없는 참조는 빼고 열린다, 잘못된 부속 부품은 오류', () => {
    const raw = JSON.parse(serializeProject(setWireSupplies(diagram(), ['w1'], { wire: red, tubeEnds: tube })))
    delete raw.supplies.ul22r
    const r = parseProject(JSON.stringify(raw))
    expect(r.ok && r.value.wires[0]).not.toHaveProperty('supplyId')
    expect(r.ok && r.value.wires[0].tubes).toEqual({ ends: 't3' })
    raw.supplies.t3.kind = 'glue'
    const bad = parseProject(JSON.stringify(raw))
    expect(!bad.ok && bad.errors.join()).toContain('supplies.t3.kind')
  })

  it('.opblib에 부속 부품을 함께 쓰고 읽는다 (버전 그대로), 잘못된 것만 건너뜀', () => {
    const text = serializeLibrary([board], {}, library)
    expect(JSON.parse(text).version).toBe(1)
    expect(readLibraryFile(text, 'my.opblib').supplies).toEqual(library)
    const raw = JSON.parse(text)
    raw.supplies[1].kind = 'glue'
    const r = readLibraryFile(JSON.stringify(raw), 'my.opblib')
    expect(r.supplies!.map((s) => s.id)).toEqual(['sxh', 't3', 'ul22r'])
    expect(r.problems[0]).toContain('XHP-4')
    // 예전 파일(부속 부품 없음)
    expect(readLibraryFile(serializeLibrary([board]), 'old.opblib').supplies).toEqual([])
  })
})

describe('부속 부품 편집', () => {
  it('검사: 이름, 링크, 지름', () => {
    expect(checkSupply({ id: 'x', kind: 'tube', name: ' ' })).toContain('이름을 입력하세요')
    expect(checkSupply({ id: 'x', kind: 'tube', name: 'a', purchaseUrl: 'ftp://x' })).toHaveLength(1)
    expect(checkSupply({ id: 'x', kind: 'tube', name: 'a', diameter: 0 })).toContain('지름은 0보다 큰 숫자여야 합니다')
  })
  it('정리: 공백, 종류에 맞지 않는 칸 삭제', () => {
    const s = finalizeSupply({ id: 'x', kind: 'terminal', name: ' 단자 ', connectorType: 'XH', diameter: 3, pack: ' ', partNumber: ' P1 ' })
    expect(s).toEqual({ id: 'x', kind: 'terminal', name: '단자', partNumber: 'P1' })
  })
  it('pruneSupplies: 하우징이 고른 단자 사본은 남긴다', () => {
    const p = chooseSupply(diagram(), housing, true, library)
    expect(Object.keys(pruneSupplies(p).supplies!).sort()).toEqual(['sxh', 'xhp4'])
  })
})
