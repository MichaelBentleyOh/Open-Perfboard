import type { CsvColumn } from './csv'
import type { Project, WireEnd } from './model'
import { endLabel, isJunctionEnd, resolvePin } from './ends'
import { naturalCompare } from './sort'
import { msg } from './i18n'

export interface NetlistEnd {
  refDes: string
  connector?: string
  pin: string
  signal?: string
  /** 표시용: U1.J1.3, 접속점은 SP1 */
  label: string
}

export interface NetlistRow {
  wireId: string
  from: NetlistEnd
  to: NetlistEnd
  color: string
  label?: string
  /** 전선 규격 (AWG) */
  awg?: number
  /** 전선 길이 (mm) */
  length?: number
}

/** 전선 끝을 풀어 쓴다. 접속점은 SP1처럼 이름만 */
function describe(project: Project, ref: WireEnd): NetlistEnd {
  if (isJunctionEnd(ref)) {
    const label = endLabel(project, ref)
    return { refDes: label, pin: '', label }
  }
  const r = resolvePin(project, ref)
  if (!r) return { refDes: '?', pin: '?', label: '?' }
  const connector = r.part.connectors.find((c) => c.id === r.pin.connectorId)?.name
  return {
    refDes: r.instance.refDes,
    connector,
    pin: r.pin.number,
    signal: r.pin.signal,
    label: [r.instance.refDes, connector, r.pin.number].filter(Boolean).join('.')
  }
}

/** 전선마다 양 끝을 "참조명.커넥터.핀번호"로 풀어 쓴다. 시작점 기준 자연 정렬 */
export function buildNetlist(project: Project): NetlistRow[] {
  return project.wires
    .map((w) => {
      let from = describe(project, w.from)
      let to = describe(project, w.to)
      // 같은 연결이 방향에 따라 다르게 보이지 않도록 앞쪽 끝을 정규화한다
      if (naturalCompare(from.label, to.label) > 0) [from, to] = [to, from]
      return { wireId: w.id, from, to, color: w.color, label: w.label, awg: w.awg, length: w.length }
    })
    .sort((a, b) => naturalCompare(a.from.label, b.from.label) || naturalCompare(a.to.label, b.to.label))
}

export const NETLIST_COLUMNS: CsvColumn<NetlistRow>[] = [
  { header: msg('시작'), value: (r) => r.from.label },
  { header: msg('시작 신호'), value: (r) => r.from.signal },
  { header: msg('끝'), value: (r) => r.to.label },
  { header: msg('끝 신호'), value: (r) => r.to.signal },
  { header: msg('색상'), value: (r) => r.color },
  { header: msg('규격(AWG)'), value: (r) => r.awg },
  { header: msg('길이(mm)'), value: (r) => r.length },
  { header: msg('라벨'), value: (r) => r.label }
]
