import type { CsvColumn } from './csv'
import type { Project, Wire, WireDirection, WireEnd } from './model'
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
  /** 전선 메모 */
  memo?: string
  /** 전선 종류 이름 (027 부속 부품) */
  wireType?: string
  /** 수축 튜브 이름: 양 끝 / 중간 (027) */
  tubeEnds?: string
  tubeMiddle?: string
  /** 이 행의 시작 → 끝 기준 신호 방향 */
  arrow: Arrow
  /** 행의 시작이 전선의 to 쪽이다 (정렬하느라 뒤집었다) → 방향을 바꿀 때 되돌린다 */
  reversed: boolean
}

export type Arrow = '->' | '<-' | '<->'

/** 전선 방향(from → to 기준)을 화살표로 */
export function wireArrow(w: Pick<Wire, 'direction'>): Arrow {
  return w.direction === 'forward' ? '->' : w.direction === 'reverse' ? '<-' : '<->'
}

export const REVERSED_ARROW: Record<Arrow, Arrow> = { '->': '<-', '<-': '->', '<->': '<->' }

/** 화면에 보인 화살표(보인 순서가 전선과 뒤집혔으면 reversed)를 전선에 저장할 방향으로 */
export function arrowToDirection(arrow: Arrow, reversed: boolean): WireDirection | undefined {
  const a = reversed ? REVERSED_ARROW[arrow] : arrow
  return a === '->' ? 'forward' : a === '<-' ? 'reverse' : undefined
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
      const reversed = naturalCompare(from.label, to.label) > 0
      if (reversed) [from, to] = [to, from]
      const arrow = reversed ? REVERSED_ARROW[wireArrow(w)] : wireArrow(w)
      const name = (id?: string) => (id ? project.supplies?.[id]?.name : undefined)
      return {
        wireId: w.id, from, to, color: w.color, label: w.label, awg: w.awg, memo: w.memo, arrow, reversed,
        wireType: name(w.supplyId),
        tubeEnds: name(w.tubes?.ends),
        tubeMiddle: name(w.tubes?.middle)
      }
    })
    .sort((a, b) => naturalCompare(a.from.label, b.from.label) || naturalCompare(a.to.label, b.to.label))
}

const FILE_ARROW: Record<Arrow, string> = { '->': '→', '<-': '←', '<->': '↔' }

export const NETLIST_COLUMNS: CsvColumn<NetlistRow>[] = [
  { header: msg('시작'), value: (r) => r.from.label },
  { header: msg('시작 신호'), value: (r) => r.from.signal },
  // 파일에는 → ← ↔ 로 쓴다 (엑셀은 -로 시작하는 칸을 수식으로 읽는다)
  { header: msg('방향'), value: (r) => FILE_ARROW[r.arrow] },
  { header: msg('끝'), value: (r) => r.to.label },
  { header: msg('끝 신호'), value: (r) => r.to.signal },
  { header: msg('색상'), value: (r) => r.color },
  { header: msg('규격(AWG)'), value: (r) => r.awg },
  { header: msg('전선 종류'), value: (r) => r.wireType },
  { header: msg('끝 튜브'), value: (r) => r.tubeEnds },
  { header: msg('중간 튜브'), value: (r) => r.tubeMiddle },
  { header: msg('라벨'), value: (r) => r.label },
  { header: msg('메모'), value: (r) => r.memo }
]
