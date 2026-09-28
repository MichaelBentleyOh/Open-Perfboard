// 결선표 연결 라벨 (025): 전선마다 "제어 보드 -> IMU : SDA" 같은 이름을 붙인다.
// 같은 이름의 라벨이 두 부품에 하나씩 붙어, 선을 그리지 않고도 어디와 이어지는지 보여 준다.
// 방향은 전선에 저장한다(Wire.direction, 결선표에서만 바꾼다). 부품 정의는 건드리지 않는다.
import type { Project, WireEnd } from './model'
import { endLabel, findJunction, isJunctionEnd, resolvePin } from './ends'
import { REVERSED_ARROW, wireArrow, type Arrow } from './netlist'
import { naturalCompare } from './sort'

export type { Arrow }

export interface ConnectionEnd {
  /** 핀이면 부품 배치 id, 접속점이면 없음 */
  instanceId?: string
  pinId?: string
  junctionId?: string
  /** 라벨에 쓰는 부품 이름. 같은 이름이 여럿이면 "이름 (U2)", 접속점은 SP1 */
  name: string
  /** 핀 표시: J1.3 (커넥터가 없으면 핀 번호), 접속점은 SP1 */
  pinLabel: string
  /** 결선표와 같은 전체 표시: U1.J1.3 */
  fullLabel: string
  signal?: string
}

export interface ConnectionLabel {
  wireId: string
  /** 이름에 먼저 쓰는 쪽이 a (부품 쌍마다 같은 순서) */
  a: ConnectionEnd
  b: ConnectionEnd
  arrow: Arrow
  /** a가 전선의 from 쪽이다 → 화면에서 고른 화살표를 전선 방향으로 바꿀 때 쓴다 */
  aIsFrom: boolean
  /** 이름 끝의 신호 부분 */
  signal: string
  /** 양 끝에 같이 붙는 이름: "제어 보드 -> IMU : SDA" */
  name: string
  /** 전선 색 */
  color: string
}

function describe(project: Project, end: WireEnd, names: ReadonlyMap<string, string>): ConnectionEnd {
  if (isJunctionEnd(end)) {
    const label = findJunction(project, end.junctionId)?.label ?? '?'
    return { junctionId: end.junctionId, name: label, pinLabel: label, fullLabel: label }
  }
  const r = resolvePin(project, end)
  if (!r) return { instanceId: end.instanceId, pinId: end.pinId, name: '?', pinLabel: '?', fullLabel: '?' }
  const connector = r.part.connectors.find((c) => c.id === r.pin.connectorId)?.name
  return {
    instanceId: r.instance.id,
    pinId: r.pin.id,
    name: names.get(r.instance.id) ?? r.part.name,
    pinLabel: [connector, r.pin.number].filter(Boolean).join('.'),
    fullLabel: endLabel(project, end),
    ...(r.pin.signal ? { signal: r.pin.signal } : {})
  }
}

/** 부품 배치마다 라벨에 쓸 이름. 같은 부품 이름이 둘 이상이면 참조명을 붙인다 */
export function instanceNames(project: Project): Map<string, string> {
  const count = new Map<string, number>()
  for (const inst of project.instances) {
    const name = project.parts[inst.partId]?.name ?? '?'
    count.set(name, (count.get(name) ?? 0) + 1)
  }
  const names = new Map<string, string>()
  for (const inst of project.instances) {
    const name = project.parts[inst.partId]?.name ?? '?'
    names.set(inst.id, (count.get(name) ?? 0) > 1 ? `${name} (${inst.refDes})` : name)
  }
  return names
}

/** 전선의 한쪽 끝이 신호를 보내는지(goto), 받는지(from), 방향이 없는지(both). Simulink의 Goto/From 블록처럼 그린다 */
export type LabelRole = 'goto' | 'from' | 'both'

/**
 * 전선마다 연결 라벨. 양 끝에 같은 이름이 붙는다 (Simulink Goto/From의 태그처럼).
 * 이름의 앞뒤는 부품 쌍마다 한 번 정한다: 그 쌍에서 신호를 더 많이 보내는 부품이 앞 → 같은 쌍은 늘 같은 순서
 * ("제어 보드 -> IMU : SDA", "제어 보드 <- IMU : INT"). 같으면 전선이 더 많이 이어진 부품, 그다음 참조명 순(전선마다 달라지지 않게 핀이 아니라 부품으로). 접속점은 늘 뒤.
 * 신호 부분은 전선 라벨 → 보내는 쪽 핀 신호 → 받는 쪽 신호 → 핀 번호
 */
export function buildConnectionLabels(project: Project): ConnectionLabel[] {
  const names = instanceNames(project)
  const key = (e: WireEnd) => (isJunctionEnd(e) ? `j:${e.junctionId}` : `i:${e.instanceId}`)
  const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`)
  const ends = project.wires.map((w) => {
    const from = describe(project, w.from, names)
    const to = describe(project, w.to, names)
    return { w, from, to, arrow: wireArrow(w) }
  })
  // 부품별 전선 수, 부품 쌍 안에서 각자 보낸 전선 수
  const degree = new Map<string, number>()
  const sent = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  for (const { w, arrow } of ends) {
    const [kf, kt] = [key(w.from), key(w.to)]
    bump(degree, kf)
    bump(degree, kt)
    if (arrow === '->') bump(sent, `${pairKey(kf, kt)}>${kf}`)
    if (arrow === '<-') bump(sent, `${pairKey(kf, kt)}>${kt}`)
  }
  /** 쌍에서 x를 y보다 앞에 쓰면 음수 */
  const order = (x: WireEnd, y: WireEnd, xl: ConnectionEnd, yl: ConnectionEnd): number => {
    if (isJunctionEnd(x) !== isJunctionEnd(y)) return isJunctionEnd(x) ? 1 : -1
    const [kx, ky] = [key(x), key(y)]
    const pk = pairKey(kx, ky)
    return (
      (sent.get(`${pk}>${ky}`) ?? 0) - (sent.get(`${pk}>${kx}`) ?? 0) ||
      (degree.get(ky) ?? 0) - (degree.get(kx) ?? 0) ||
      naturalCompare(xl.fullLabel.split('.')[0], yl.fullLabel.split('.')[0])
    )
  }
  const labels = ends.map(({ w, from, to, arrow }): ConnectionLabel => {
    const swap = order(w.from, w.to, from, to) > 0
    const [a, b] = swap ? [to, from] : [from, to]
    const shown: Arrow = swap ? REVERSED_ARROW[arrow] : arrow
    const [source, sink] = shown === '<-' ? [b, a] : [a, b]
    const signal = w.label || source.signal || sink.signal || source.pinLabel
    return { wireId: w.id, a, b, arrow: shown, aIsFrom: !swap, signal, name: `${a.name} ${shown} ${b.name} : ${signal}`, color: w.color }
  })
  return labels.sort((x, y) => naturalCompare(x.name, y.name))
}

export interface InstanceLabel {
  label: ConnectionLabel
  /** 이 부품 쪽 끝 */
  end: ConnectionEnd
  /** 이 끝이 보내는지(goto) 받는지(from) */
  role: LabelRole
}

/** 부품 배치별 라벨 목록 (핀 순서). 접속점 끝은 부품 카드에 들어가지 않는다 */
export function labelsByInstance(labels: readonly ConnectionLabel[]): Map<string, InstanceLabel[]> {
  const map = new Map<string, InstanceLabel[]>()
  for (const label of labels) {
    for (const [end, first] of [[label.a, true], [label.b, false]] as const) {
      if (!end.instanceId) continue
      const role: LabelRole = label.arrow === '<->' ? 'both' : (label.arrow === '->') === first ? 'goto' : 'from'
      let list = map.get(end.instanceId)
      if (!list) map.set(end.instanceId, (list = []))
      list.push({ label, end, role })
    }
  }
  for (const list of map.values()) list.sort((x, y) => naturalCompare(x.end.pinLabel, y.end.pinLabel) || naturalCompare(x.label.name, y.label.name))
  return map
}
