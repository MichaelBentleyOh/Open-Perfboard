import { describe, expect, it } from 'vitest'
import { toCsv } from '@core/csv'
import { NETLIST_COLUMNS, buildNetlist } from '@core/netlist'
import { addInstance, connect, emptyProject, updateWires } from '@core/ops'
import { loadSample, makePart } from '../helpers'

describe('buildNetlist', () => {
  it('양 끝을 참조명.커넥터.핀번호와 신호로 풀어 쓴다', () => {
    const rows = buildNetlist(loadSample())
    expect(rows.map((r) => [r.from.label, r.from.signal, r.to.label, r.to.signal, r.label])).toEqual([
      ['CN1.P1.-', 'GND', 'U1.J1.2', 'GND', undefined],
      ['CN1.P1.+', '+12V', 'U1.J1.1', 'VIN', '+12V']
    ])
  })

  it('커넥터가 없는 핀은 참조명.핀번호로 쓴다', () => {
    const part = makePart('x')
    let p = addInstance(emptyProject('t'), part, { id: 'i1', x: 0, y: 0 })
    p = addInstance(p, part, { id: 'i2', x: 0, y: 0 })
    const r = connect(p, { id: 'w', from: { instanceId: 'i2', pinId: 'b' }, to: { instanceId: 'i1', pinId: 'a' }, color: '#000', width: 1 })
    if (!r.ok) throw new Error('setup')
    // 그린 방향(U2→U1)과 무관하게 정렬된 방향(U1→U2)으로 보여 준다
    expect(buildNetlist(r.project).map((x) => [x.from.label, x.to.label])).toEqual([['U1.1', 'U2.2']])
  })

  it('CSV로 내보낼 수 있다 (규격·메모는 없으면 빈 칸)', () => {
    const csv = toCsv(buildNetlist(loadSample()), NETLIST_COLUMNS)
    expect(csv.split('\r\n')[0]).toBe('﻿시작,시작 신호,방향,끝,끝 신호,색상,규격(AWG),전선 종류,끝 튜브,중간 튜브,라벨,메모')
    expect(csv).toContain('CN1.P1.+,+12V,↔,U1.J1.1,VIN,#e53935,,,,,+12V,')
  })

  it('방향은 파일에 → ← ↔ 로 쓴다 (-로 시작하면 엑셀이 수식으로 읽는다)', () => {
    const p = updateWires(loadSample(), ['w1'], { direction: 'forward' })
    const csv = toCsv(buildNetlist(p), NETLIST_COLUMNS)
    expect(csv).not.toContain(',->,')
    expect(csv).toMatch(/,[→←],/)
  })

  it('전선 규격(AWG)·메모가 결선표에 나온다', () => {
    const p = updateWires(loadSample(), ['w1'], { awg: 22, memo: 'L=350 mm' })
    const csv = toCsv(buildNetlist(p), NETLIST_COLUMNS)
    expect(csv).toContain(',22,,,,+12V,L=350 mm')
  })
})
