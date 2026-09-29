import { describe, expect, it } from 'vitest'
import {
  addConnector,
  addPin,
  checkDraft,
  emptyPartDraft,
  finalizeDraft,
  movePin,
  nextPinNumber,
  removeConnector,
  removePin,
  updatePin,
  type PartDraft
} from '@core/part'

const image = { data: 'data:image/png;base64,AA==', width: 10, height: 10 }

function draftWithPins(...pins: { id: string; connectorId?: string }[]): PartDraft {
  let d: PartDraft = emptyPartDraft('p')
  for (const p of pins) d = addPin(d, { ...p, x: 0.5, y: 0.5 })
  return d
}

describe('핀 자동 번호', () => {
  it('1, 2, 3 순서로 붙는다', () => {
    expect(draftWithPins({ id: 'a' }, { id: 'b' }, { id: 'c' }).pins.map((p) => p.number)).toEqual(['1', '2', '3'])
  })

  it('커넥터마다 따로 센다', () => {
    const d = draftWithPins({ id: 'a', connectorId: 'j1' }, { id: 'b', connectorId: 'j1' }, { id: 'c', connectorId: 'j2' })
    expect(d.pins.map((p) => p.number)).toEqual(['1', '2', '1'])
  })

  it('사용자가 바꾼 번호 다음부터 이어 간다 (숫자가 아닌 번호는 무시)', () => {
    let d = draftWithPins({ id: 'a' }, { id: 'b' })
    d = updatePin(d, 'b', { number: '10' })
    d = updatePin(d, 'a', { number: 'VCC' })
    expect(nextPinNumber(d.pins)).toBe('11')
  })
})

describe('핀 편집', () => {
  it('좌표를 0~1로 제한한다', () => {
    let d = addPin(emptyPartDraft('p'), { id: 'a', x: -0.2, y: 1.4 })
    expect(d.pins[0]).toMatchObject({ x: 0, y: 1 })
    d = movePin(d, 'a', 0.3, 2)
    expect(d.pins[0]).toMatchObject({ x: 0.3, y: 1 })
  })

  it('빈 신호와 null 커넥터는 필드를 지운다', () => {
    let d = draftWithPins({ id: 'a', connectorId: 'j1' })
    d = updatePin(d, 'a', { signal: 'SDA' })
    expect(d.pins[0]).toMatchObject({ signal: 'SDA', connectorId: 'j1' })
    d = updatePin(d, 'a', { signal: '', connectorId: null })
    expect(d.pins[0]).not.toHaveProperty('signal')
    expect(d.pins[0]).not.toHaveProperty('connectorId')
  })

  it('removePin', () => {
    expect(removePin(draftWithPins({ id: 'a' }, { id: 'b' }), 'a').pins.map((p) => p.id)).toEqual(['b'])
  })
})

describe('커넥터', () => {
  it('J1, J2 순서로 이름을 붙인다', () => {
    let d = addConnector(emptyPartDraft('p'), { id: 'c1', type: 'JST-XH 4P' })
    d = addConnector(d, { id: 'c2' })
    expect(d.connectors.map((c) => c.name)).toEqual(['J1', 'J2'])
  })

  it('지우면 소속 핀의 커넥터 연결만 풀린다', () => {
    let d = addConnector(emptyPartDraft('p'), { id: 'c1' })
    d = addPin(d, { id: 'a', x: 0, y: 0, connectorId: 'c1' })
    d = removeConnector(d, 'c1')
    expect(d.connectors).toEqual([])
    expect(d.pins[0]).not.toHaveProperty('connectorId')
  })
})

describe('저장 전 검사', () => {
  it('이름과 사진이 없으면 오류', () => {
    expect(checkDraft(emptyPartDraft('p')).errors).toEqual(['이름을 입력하세요', '사진을 불러오거나 그림을 그리세요'])
  })

  it('같은 커넥터 안 중복 번호는 경고', () => {
    let d: PartDraft = { ...draftWithPins({ id: 'a' }, { id: 'b' }), name: 'x', image }
    d = updatePin(d, 'b', { number: '1' })
    expect(checkDraft(d)).toEqual({ errors: [], warnings: ["핀 번호 '1'가 2번 쓰였습니다"] })
  })

  it('빈 핀 번호는 오류', () => {
    const d: PartDraft = { ...updatePin(draftWithPins({ id: 'a' }), 'a', { number: ' ' }), name: 'x', image }
    expect(checkDraft(d).errors).toEqual(['비어 있는 핀 번호가 있습니다'])
  })

  it('finalizeDraft는 공백을 정리하고 빈 선택 필드를 뺀다', () => {
    const d: PartDraft = { ...draftWithPins({ id: 'a' }), name: '  ESP32 ', partNumber: ' ', manufacturer: 'Espressif', image }
    const part = finalizeDraft(d)
    expect(part).toMatchObject({ name: 'ESP32', manufacturer: 'Espressif' })
    expect(part).not.toHaveProperty('partNumber')
    expect(finalizeDraft(emptyPartDraft('p'))).toBeUndefined()
  })
})

describe('구매 링크 입력', () => {
  it('형식이 틀리면 저장 오류, 맞으면 finalizeDraft에 포함', () => {
    const base: PartDraft = { ...emptyPartDraft('p'), name: 'x', image }
    expect(checkDraft({ ...base, purchaseUrl: 'naver.com' }).errors).toEqual(['구매 링크는 http:// 또는 https://로 시작해야 합니다'])
    expect(finalizeDraft({ ...base, purchaseUrl: ' https://a.com/x ' })?.purchaseUrl).toBe('https://a.com/x')
    expect(finalizeDraft({ ...base, purchaseUrl: '' })).not.toHaveProperty('purchaseUrl')
  })
})
