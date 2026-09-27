// 문서 상태(Project). 이 스토어만 실행 취소 이력(zundo)에 들어간다.
// 편집 로직은 core/ops에 있고, 여기서는 ID를 만들어 넘기고 결과를 저장만 한다.
// 액션 한 번 = set 한 번 = 실행 취소 1회
// 전선 모양이 바뀌는 동작은 같은 set 안에서 경로 자동 정리(tidyWires)와 부품 피하기(avoidParts)까지 한다 → 실행 취소도 함께
import { create } from 'zustand'
import { temporal } from 'zundo'
import { nanoid } from 'nanoid'
import type { PartDef, Project, ProjectMeta } from '@core/model'
import type { Point } from '@core/geometry'
import { pasteClipboard, type ClipboardData, type PasteResult } from '@core/clipboard'
import { avoidParts } from '@core/avoid'
import { t } from '@/i18n'
import {
  addInstance,
  connectEnds,
  moveJunction,
  type WireTarget,
  flipInstances,
  setMeta,
  moveWirePoint,
  insertWirePoint,
  removeWirePoint,
  tidyWires,
  applyRoutes,
  wiresOf,
  setBomOverride,
  addBomItem,
  updateBomItem,
  removeBomItem,
  type BomOverridePatch,
  type BomItemPatch,
  emptyProject,
  moveInstances,
  removeItems,
  replacePartDef,
  rotateInstances,
  updateInstance,
  updateWires,
  updatePartDef,
  type PartSpecPatch,
  type ConnectResult,
  type InstancePatch,
  type ItemIds,
  type WirePatch
} from '@core/ops'

interface ProjectState {
  project: Project
  /** 부품을 배치하고 새 배치 id를 돌려준다 */
  addPart: (part: PartDef, x: number, y: number) => string
  moveInstances: (ids: readonly string[], dx: number, dy: number, junctionIds?: readonly string[]) => void
  moveJunction: (id: string, p: Point) => void
  rotateInstances: (ids: readonly string[], delta: number) => void
  flipInstances: (ids: readonly string[], axis: 'horizontal' | 'vertical') => void
  setMeta: (meta: ProjectMeta) => void
  updateInstance: (id: string, patch: InstancePatch) => void
  removeItems: (items: ItemIds) => void
  /** 두 끝을 잇는다. 끝이 기존 전선 위의 점이면 그 자리에서 분기(접속점) */
  connect: (
    from: WireTarget,
    to: WireTarget,
    style: { color: string; points?: Point[]; orthogonal?: boolean }
  ) => ConnectResult & { wireId?: string }
  moveWirePoint: (wireId: string, index: number, p: Point) => void
  insertWirePoint: (wireId: string, index: number, p: Point) => void
  removeWirePoint: (wireId: string, index: number) => void
  /** 배선 정리(자동 경로). 바뀐 것이 있으면 true */
  /** 배선 정리 결과(전선 id → 경로)를 넣는다. 바뀌었으면 true */
  applyRoutes: (routes: Readonly<Record<string, Point[]>>) => boolean
  /** 붙여넣기. 새로 생긴 부품·전선 id를 돌려준다 */
  paste: (clip: ClipboardData, delta: Point, newId: () => string) => Omit<PasteResult, 'project'>
  /** BOM: 배선도 부품 행의 단가·비고 */
  setBomOverride: (partId: string, patch: BomOverridePatch) => void
  /** BOM: 직접 추가 항목. 새 id를 돌려준다 */
  addBomItem: (name: string) => string
  updateBomItem: (id: string, patch: BomItemPatch) => void
  removeBomItem: (id: string) => void
  updateWires: (ids: readonly string[], patch: WirePatch) => void
  /** 이 배선도의 부품 사본 스펙 (라이브러리는 그대로) */
  updatePartDef: (partId: string, patch: PartSpecPatch) => void
  /** 라이브러리의 최신 부품 정의로 사본을 바꾼다. 지워진 전선 수를 돌려준다 */
  refreshPart: (part: PartDef) => number
  /** 새 문서/열기. 실행 취소 이력도 비운다 */
  reset: (project: Project) => void
}

/** 부품·접속점이 움직이면 연결된 전선의 경로를 정리한다 */
const withTidy = (project: Project, instanceIds: readonly string[], junctionIds: readonly string[] = []) => {
  const jset = new Set(junctionIds)
  const atJunction = project.wires
    .filter((w) => [w.from, w.to].some((e) => 'junctionId' in e && jset.has(e.junctionId)))
    .map((w) => w.id)
  return tidyWires(project, [...wiresOf(project, instanceIds), ...atJunction])
}

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set, get) => ({
      project: emptyProject(t('새 배선도')),

      addPart: (part, x, y) => {
        const id = nanoid()
        // 전선 위에 놓으면 그 전선이 비킨다
        set({ project: avoidParts(addInstance(get().project, part, { id, x, y }), { instances: [id] }) })
        return id
      },
      moveInstances: (ids, dx, dy, junctionIds = []) =>
        set({
          project: avoidParts(withTidy(moveInstances(get().project, ids, dx, dy, junctionIds), ids, junctionIds), {
            instances: ids,
            junctions: junctionIds
          })
        }),
      moveJunction: (id, p) => set({ project: avoidParts(withTidy(moveJunction(get().project, id, p), [], [id]), { junctions: [id] }) }),
      rotateInstances: (ids, delta) =>
        set({ project: avoidParts(withTidy(rotateInstances(get().project, ids, delta), ids), { instances: ids }) }),
      flipInstances: (ids, axis) => set({ project: avoidParts(withTidy(flipInstances(get().project, ids, axis), ids), { instances: ids }) }),
      setMeta: (meta) => set({ project: setMeta(get().project, meta) }),
      // 배율·회전을 바꾸면 사진 크기·핀 위치가 바뀐다
      updateInstance: (id, patch) => set({ project: avoidParts(updateInstance(get().project, id, patch), { instances: [id] }) }),
      removeItems: (items) => set({ project: removeItems(get().project, items) }),

      connect: (from, to, { color, points, orthogonal }) => {
        const style = {
          color, width: 2,
          ...(points && points.length > 0 ? { points } : {}),
          ...(orthogonal ? { orthogonal: true } : {})
        }
        const r = connectEnds(get().project, from, to, style, nanoid)
        // 새 전선이 부품을 가로지르면 그 자리에서 피해 간다
        if (r.ok) set({ project: r.wireId ? avoidParts(r.project, { wires: [r.wireId] }) : r.project })
        return r
      },
      moveWirePoint: (wireId, index, p) =>
        set({ project: avoidParts(tidyWires(moveWirePoint(get().project, wireId, index, p), [wireId]), { wires: [wireId] }) }),
      // 추가한 점은 보통 일직선 위라 정리하면 바로 사라진다 → 추가할 때는 정리하지 않고, 옮길 때 정리
      insertWirePoint: (wireId, index, p) => set({ project: insertWirePoint(get().project, wireId, index, p) }),
      removeWirePoint: (wireId, index) =>
        set({ project: avoidParts(tidyWires(removeWirePoint(get().project, wireId, index), [wireId]), { wires: [wireId] }) }),
      applyRoutes: (routes) => {
        const before = get().project
        const next = applyRoutes(before, routes)
        if (next === before) return false
        set({ project: next })
        return true
      },
      paste: (clip, delta, newId) => {
        const { project, instances, wires, junctions } = pasteClipboard(get().project, clip, delta, newId)
        set({ project: avoidParts(project, { instances, wires, junctions }) })
        return { instances, wires, junctions }
      },
      setBomOverride: (partId, patch) => set({ project: setBomOverride(get().project, partId, patch) }),
      addBomItem: (name) => {
        const id = nanoid()
        set({ project: addBomItem(get().project, { id, name, quantity: 1 }) })
        return id
      },
      updateBomItem: (id, patch) => set({ project: updateBomItem(get().project, id, patch) }),
      removeBomItem: (id) => set({ project: removeBomItem(get().project, id) }),
      updateWires: (ids, patch) => {
        const next = updateWires(get().project, ids, patch)
        set({ project: patch.orthogonal !== undefined ? avoidParts(tidyWires(next, ids), { wires: ids }) : next })
      },

      updatePartDef: (partId, patch) => {
        const next = updatePartDef(get().project, partId, patch)
        if (next !== get().project) set({ project: next })
      },

      refreshPart: (part) => {
        const r = replacePartDef(get().project, part)
        // 사진 크기·핀 위치가 바뀌었을 수 있다
        const instances = r.project.instances.filter((i) => i.partId === part.id).map((i) => i.id)
        set({ project: avoidParts(r.project, { instances }) })
        return r.removedWires
      },

      reset: (project) => {
        set({ project })
        useProjectStore.temporal.getState().clear()
      }
    }),
    {
      partialize: (s) => ({ project: s.project }),
      // 값이 실제로 바뀐 경우만 이력에 남긴다
      equality: (a, b) => a.project === b.project,
      limit: 200
    }
  )
)

export const undo = () => useProjectStore.temporal.getState().undo()
export const redo = () => useProjectStore.temporal.getState().redo()
