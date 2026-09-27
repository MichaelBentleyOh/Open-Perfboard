// 선택 사각형 계산
import { endPosition } from './ends'
import { instanceBounds, rectContainsPoint, rectsIntersect, type Rect } from './geometry'
import type { Project, WireEnd } from './model'
import type { ItemIds } from './ops'

export interface SelectionIds {
  instances: string[]
  wires: string[]
  junctions: string[]
}

/**
 * 사각형(월드 좌표)으로 고른다.
 * - 부품: 사각형과 조금이라도 겹치면
 * - 전선: 양 끝과 모든 꺾임점이 사각형 안에 있으면
 * - 접속점: 사각형 안에 있으면
 */
export function selectInRect(project: Project, rect: Rect): SelectionIds {
  const instances = project.instances
    .filter((inst) => {
      const part = project.parts[inst.partId]
      return part && rectsIntersect(rect, instanceBounds(inst, part))
    })
    .map((i) => i.id)
  const inside = (ref: WireEnd) => {
    const p = endPosition(project, ref)
    return !!p && rectContainsPoint(rect, p)
  }
  const wires = project.wires
    .filter((w) => inside(w.from) && inside(w.to) && (w.points ?? []).every((p) => rectContainsPoint(rect, p)))
    .map((w) => w.id)
  const junctions = (project.junctions ?? []).filter((j) => rectContainsPoint(rect, j)).map((j) => j.id)
  return { instances, wires, junctions }
}

/** 두 선택을 합친다 (Ctrl+드래그) */
export function mergeSelection(a: ItemIds, b: ItemIds): SelectionIds {
  return {
    instances: [...new Set([...a.instances, ...b.instances])],
    wires: [...new Set([...a.wires, ...b.wires])],
    junctions: [...new Set([...(a.junctions ?? []), ...(b.junctions ?? [])])]
  }
}
