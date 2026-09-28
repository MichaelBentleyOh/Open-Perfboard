import { describe, expect, it } from 'vitest'
import { buildConnectionLabels, instanceNames, labelsByInstance } from '@core/connection'
import type { PartDef, Pin, Project, WireDirection } from '@core/model'
import { arrowToDirection, buildNetlist, wireArrow } from '@core/netlist'
import { addInstance, connect, emptyProject, splitWire, updateWires } from '@core/ops'
import { parseProject, serializeProject } from '@core/serialize'
import { makePart } from '../helpers'

const pin = (id: string, number: string, signal: string): Pin => ({ id, number, signal, connectorId: 'j1', x: 0.5, y: 0.5 })
const board: PartDef = makePart('board', {
  name: '제어 보드',
  connectors: [{ id: 'j1', name: 'J1', type: '' }],
  pins: [pin('sda', '1', 'SDA'), pin('tx', '2', 'TX'), pin('rx', '3', 'RX'), pin('gnd', '4', 'GND')]
})
const imu: PartDef = makePart('imu', {
  name: 'IMU',
  connectors: [{ id: 'j1', name: 'J1', type: '' }],
  pins: [pin('sda', '1', 'SDA'), pin('rx', '2', 'RX'), pin('tx', '3', 'TX'), pin('int', '4', 'INT')]
})

/**
 * parts를 i0, i1 … 로 놓고 잇는다. "i0.tx>i1.rx" = 앞에서 뒤로 신호(forward), "<" = 반대(reverse), "-" = 양방향
 */
function project(links: string[], parts: PartDef[] = [board, imu]): Project {
  let p = emptyProject('t')
  parts.forEach((part, i) => (p = addInstance(p, part, { id: `i${i}`, x: i * 100, y: 0 })))
  links.forEach((link, n) => {
    const [from, op, to] = link.split(/([<>-])/)
    const [fi, fp] = from.split('.')
    const [ti, tp] = to.split('.')
    const direction: WireDirection | undefined = op === '>' ? 'forward' : op === '<' ? 'reverse' : undefined
    const r = connect(p, {
      id: `w${n}`, from: { instanceId: fi, pinId: fp }, to: { instanceId: ti, pinId: tp }, color: '#000', width: 1,
      ...(direction ? { direction } : {})
    })
    if (!r.ok) throw new Error(r.error)
    p = r.project
  })
  return p
}

describe('전선 방향', () => {
  it('wireArrow: forward = from → to, reverse = to → from, 없으면 양방향', () => {
    expect(wireArrow({ direction: 'forward' })).toBe('->')
    expect(wireArrow({ direction: 'reverse' })).toBe('<-')
    expect(wireArrow({})).toBe('<->')
  })

  it('arrowToDirection: 보인 순서가 뒤집혔으면 되돌려 저장한다', () => {
    expect(arrowToDirection('->', false)).toBe('forward')
    expect(arrowToDirection('->', true)).toBe('reverse')
    expect(arrowToDirection('<-', true)).toBe('forward')
    expect(arrowToDirection('<->', true)).toBeUndefined()
  })

  it('결선표 행: 정렬로 시작·끝이 뒤집혀도 화살표는 실제 신호 방향', () => {
    // i1(U2).tx → i0(U1).rx 를 그렸지만 결선표는 U1이 앞 → "U1.J1.3 <- U2.J1.3"
    const [row] = buildNetlist(project(['i1.tx>i0.rx']))
    expect([row.from.label, row.arrow, row.to.label, row.reversed]).toEqual(['U1.J1.3', '<-', 'U2.J1.3', true])
  })

  it('updateWires로 바꾸고 양방향으로 되돌리면 필드를 지운다 (부품 정의는 그대로)', () => {
    let p = project(['i0.sda-i1.sda'])
    p = updateWires(p, ['w0'], { direction: 'forward' })
    expect(p.wires[0].direction).toBe('forward')
    p = updateWires(p, ['w0'], { direction: undefined })
    expect('direction' in p.wires[0]).toBe(false)
    expect(p.parts.board.pins).toEqual(board.pins)
  })

  it('파일로 저장했다 읽어도 방향이 남고, 잘못된 값은 오류, v5 파일은 양방향', () => {
    const p = project(['i0.tx>i1.rx'])
    const r = parseProject(serializeProject(p))
    expect(r.ok && r.value.wires[0].direction).toBe('forward')
    const rb = parseProject(serializeProject(p).replace('"direction": "forward"', '"direction": "sideways"'))
    expect(rb.ok).toBe(false)
    expect(!rb.ok && rb.errors.join()).toContain('direction')
    const v5 = serializeProject(project(['i0.sda-i1.sda'])).replace(/"version": 6/, '"version": 5')
    expect(v5).toContain('"version": 5')
    const r5 = parseProject(v5)
    expect(r5.ok && r5.value.version).toBe(6)
    expect(r5.ok && buildConnectionLabels(r5.value)[0].arrow).toBe('<->')
  })

  it('분기하면 두 전선 모두 원래 방향을 이어받는다', () => {
    const s = splitWire(project(['i0.tx>i1.rx']), 'w0', { x: 50, y: 0 }, { junction: 'sp', wire2: 'w9' })!
    expect(s.project.wires.map((w) => w.direction)).toEqual(['forward', 'forward'])
  })
})

describe('buildConnectionLabels', () => {
  it('"A -> B : 신호" 이름을 양 끝에 같이 붙이고, 같은 부품 쌍은 그린 방향과 무관하게 같은 순서로 쓴다', () => {
    const p = project(['i1.sda-i0.sda', 'i0.tx>i1.rx', 'i1.int>i0.rx', 'i0.gnd-i1.sda'])
    expect(buildConnectionLabels(p).map((l) => l.name).sort()).toEqual([
      '제어 보드 -> IMU : TX',
      '제어 보드 <-> IMU : GND',
      '제어 보드 <-> IMU : SDA',
      '제어 보드 <- IMU : INT'
    ].sort())
    const int = buildConnectionLabels(p).find((l) => l.wireId === 'w2')!
    // 보낸 수가 같으면(1:1) 전선 수, 그다음 참조명 → 제어 보드(U1)가 앞. 신호는 보내는 쪽(IMU.INT)
    expect([int.a.name, int.arrow, int.b.name, int.a.pinLabel, int.b.pinLabel, int.aIsFrom]).toEqual(['제어 보드', '<-', 'IMU', 'J1.3', 'J1.4', false])
    // 받는 제어 보드 쪽은 From, 보내는 IMU 쪽은 Goto
    const byInst = labelsByInstance(buildConnectionLabels(p))
    expect(byInst.get('i0')!.find((x) => x.label.wireId === 'w2')!.role).toBe('from')
    expect(byInst.get('i1')!.find((x) => x.label.wireId === 'w2')!.role).toBe('goto')
    expect(byInst.get('i0')!.find((x) => x.label.wireId === 'w0')!.role).toBe('both')
  })

  it('쌍 안에서 더 많이 보내는 부품을 앞에 쓴다', () => {
    // IMU가 두 개를 보내고(TX, INT) 제어 보드가 하나를 보냄 → 그 쌍은 모두 IMU가 앞
    const p = project(['i0.tx>i1.rx', 'i1.tx>i0.rx', 'i1.int>i0.sda'])
    expect(buildConnectionLabels(p).map((l) => l.name).sort()).toEqual(
      ['IMU <- 제어 보드 : TX', 'IMU -> 제어 보드 : TX', 'IMU -> 제어 보드 : INT'].sort()
    )
  })

  it('방향이 없으면 전선이 더 많이 이어진 부품을 앞에 쓴다', () => {
    // IMU 두 개(i0, i2)가 제어 보드(i1) 하나에 이어짐 → 제어 보드가 앞
    const p = project(['i1.sda-i0.sda', 'i1.gnd-i2.sda'], [imu, board, imu])
    expect(buildConnectionLabels(p).every((l) => l.a.instanceId === 'i1')).toBe(true)
  })

  it('전선 라벨이 있으면 신호 대신 쓴다', () => {
    let p = project(['i0.tx>i1.rx'])
    p = { ...p, wires: p.wires.map((w) => ({ ...w, label: 'UART' })) }
    expect(buildConnectionLabels(p)[0].name).toBe('제어 보드 -> IMU : UART')
  })

  it('같은 부품이 여럿이면 참조명을 붙여 구분한다', () => {
    const p = project(['i0.tx>i1.rx', 'i2.tx>i0.rx'], [board, imu, imu])
    expect(instanceNames(p).get('i1')).toBe('IMU (U2)')
    expect(buildConnectionLabels(p).map((l) => l.name).sort()).toEqual(['제어 보드 -> IMU (U2) : TX', 'IMU (U3) -> 제어 보드 : TX'].sort())
  })

  it('접속점 끝은 SP 이름을 쓰고 부품 카드에는 들어가지 않는다', () => {
    const s = splitWire(project(['i0.tx>i1.rx']), 'w0', { x: 50, y: 0 }, { junction: 'sp', wire2: 'w9' })!
    const labels = buildConnectionLabels(s.project)
    expect(labels.map((l) => l.name).sort()).toEqual(['제어 보드 -> SP1 : TX', 'IMU <- SP1 : RX'].sort())
    const byInst = labelsByInstance(labels)
    expect(byInst.get('i0')!.map((x) => x.end.pinLabel)).toEqual(['J1.2'])
    expect(byInst.get('i1')!.map((x) => [x.label.name, x.role])).toEqual([['IMU <- SP1 : RX', 'from']])
  })

  it('labelsByInstance: 부품마다 핀 순서로 모은다', () => {
    const byInst = labelsByInstance(buildConnectionLabels(project(['i0.gnd-i1.sda', 'i0.sda-i1.sda', 'i0.tx>i1.rx'])))
    expect(byInst.get('i0')!.map((x) => x.end.pinLabel)).toEqual(['J1.1', 'J1.2', 'J1.4'])
    expect(byInst.get('i1')!.map((x) => x.end.pinLabel)).toEqual(['J1.1', 'J1.1', 'J1.2'])
  })
})
