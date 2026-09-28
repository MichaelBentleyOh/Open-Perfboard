import { describe, expect, it } from 'vitest'
import { buildBom } from '@core/bom'
import { PROJECT_FILE_VERSION } from '@core/model'
import { updatePartDef, updateWires } from '@core/ops'
import { parseProject, serializeProject } from '@core/serialize'
import { loadSample } from '../helpers'

const errorsOf = (r: ReturnType<typeof parseProject>) => (r.ok ? [] : r.errors)

describe('부품 사본 스펙 편집 (이 배선도만)', () => {
  const p = loadSample()
  const [partId] = Object.keys(p.parts)

  it('이름·품번·단가를 바꾸면 사본과 BOM에 반영, 입력은 그대로', () => {
    const next = updatePartDef(p, partId, { name: ' 새 이름 ', partNumber: 'PN-2', unitPrice: 1200 })
    expect(next.parts[partId]).toMatchObject({ name: '새 이름', partNumber: 'PN-2', unitPrice: 1200 })
    expect(buildBom(next).find((r) => r.id === partId)).toMatchObject({ name: '새 이름', unitPrice: 1200 })
    expect(p.parts[partId].name).not.toBe('새 이름')
  })

  it('비우면 필드를 지운다, 빈 이름은 무시, 바뀐 게 없으면 같은 객체', () => {
    const withPn = updatePartDef(p, partId, { partNumber: 'X' })
    expect('partNumber' in updatePartDef(withPn, partId, { partNumber: '  ' }).parts[partId]).toBe(false)
    expect(updatePartDef(p, partId, { name: '' })).toBe(p)
    expect(updatePartDef(p, partId, { name: p.parts[partId].name })).toBe(p)
    expect(updatePartDef(p, 'nope', { name: 'x' })).toBe(p)
    const priced = updatePartDef(p, partId, { unitPrice: 10 })
    expect('unitPrice' in updatePartDef(priced, partId, { unitPrice: undefined }).parts[partId]).toBe(false)
  })
})

describe('v6 → v7: 전선 길이(mm)는 메모로 옮긴다', () => {
  const v6 = () => {
    const raw = JSON.parse(serializeProject(loadSample()))
    raw.version = 6
    return raw
  }
  it('길이만 있으면 메모 = "L=250 mm", 메모가 있으면 뒤에 붙인다', () => {
    const raw = v6()
    raw.wires[0].length = 250
    raw.wires[1].length = 120.5
    raw.wires[1].memo = '꼬아서'
    const r = parseProject(JSON.stringify(raw))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.version).toBe(PROJECT_FILE_VERSION)
    expect(r.value.wires[0].memo).toBe('L=250 mm')
    expect(r.value.wires[1].memo).toBe('꼬아서 · L=120.5 mm')
    expect(r.value.wires.some((w) => 'length' in w)).toBe(false)
  })
  it('길이가 숫자가 아니면 버리고 파일은 열린다', () => {
    const raw = v6()
    raw.wires[0].length = 'abc'
    const r = parseProject(JSON.stringify(raw))
    expect(r.ok && r.value.wires[0].memo).toBe(undefined)
  })
})

describe('전선 규격(AWG)·메모', () => {
  it('저장·열기 왕복, 비우면 필드 삭제', () => {
    const p = updateWires(loadSample(), ['w1'], { awg: 22, memo: 'L=350.5 mm' })
    const again = parseProject(serializeProject(p))
    expect(again.ok && again.value.wires.find((w) => w.id === 'w1')).toMatchObject({ awg: 22, memo: 'L=350.5 mm' })
    const cleared = updateWires(p, ['w1'], { awg: undefined, memo: '' }).wires.find((w) => w.id === 'w1')!
    expect('awg' in cleared || 'memo' in cleared).toBe(false)
    expect(PROJECT_FILE_VERSION).toBeGreaterThanOrEqual(4)
  })

  it('범위 밖·소수 AWG는 거부', () => {
    const raw = JSON.parse(serializeProject(loadSample()))
    raw.wires[0].awg = 40
    expect(errorsOf(parseProject(JSON.stringify(raw)))).toContain('wires[0].awg: 범위를 벗어났습니다 (40)')
    raw.wires[0].awg = 22.5
    expect(errorsOf(parseProject(JSON.stringify(raw)))).toContain('wires[0].awg: 정수여야 합니다')
  })
})
