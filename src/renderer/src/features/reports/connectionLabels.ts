import { buildConnectionLabels, labelsByInstance, type ConnectionLabel, type InstanceLabel } from '@core/connection'
import type { Project } from '@core/model'
import { arrowToDirection, type Arrow } from '@core/netlist'
import { useProjectStore } from '@/stores/projectStore'

export interface ConnectionLabelData {
  labels: ConnectionLabel[]
  byWire: ReadonlyMap<string, ConnectionLabel>
  byInstance: ReadonlyMap<string, InstanceLabel[]>
}

// 결선표 보기와 선택 항목 패널이 같은 계산을 나눠 쓴다 (배선도가 바뀔 때만 다시)
const cache = new WeakMap<Project, ConnectionLabelData>()

export function connectionLabelsOf(project: Project): ConnectionLabelData {
  let data = cache.get(project)
  if (!data) {
    const labels = buildConnectionLabels(project)
    data = { labels, byWire: new Map(labels.map((l) => [l.wireId, l])), byInstance: labelsByInstance(labels) }
    cache.set(project, data)
  }
  return data
}

/**
 * 결선표(표·연결 라벨)에서 고른 화살표를 전선에 저장한다. 신호 방향은 여기서만 바꾼다(부품 정의는 그대로).
 * reversed = 화면에 보인 순서의 앞쪽이 전선의 to 쪽. 실행 취소 1회
 */
export function setDirection(target: { wireId: string; reversed: boolean }, arrow: Arrow) {
  useProjectStore.getState().updateWires([target.wireId], { direction: arrowToDirection(arrow, target.reversed) })
}
