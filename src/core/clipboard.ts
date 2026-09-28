// 복사/붙여넣기. 클립보드 내용은 붙여넣을 배선도가 달라도 쓸 수 있게 부품 정의까지 담는다.
import { endInstanceId, endJunctionId, isPinEnd } from './ends'
import type { Point } from './geometry'
import { DEFAULT_REF_PREFIX, type Junction, type Note, type PartDef, type PartInstance, type Project, type Supply, type Wire, type WireEnd } from './model'
import { inProjectCurrency } from './money'
import { nextJunctionLabel, nextRefDes, partForProject, type ItemIds } from './ops'

export interface ClipboardData {
  parts: Record<string, PartDef>
  instances: PartInstance[]
  wires: Wire[]
  junctions: Junction[]
  /** 글 상자 (032) */
  notes?: Note[]
  /** 전선이 쓰는 부속 부품 사본 (027, 전선 종류·수축 튜브) */
  supplies?: Record<string, Supply>
  /** 복사한 부품들의 중심 (마우스 위치에 붙여넣을 때 기준) */
  center: Point
}

/**
 * 선택한 부품·접속점과, 양 끝이 모두 복사되는 것에 붙은 전선을 복사한다.
 * 부품이 하나도 없으면 null (전선·접속점만으로는 붙여넣을 수 없다)
 */
export function copySelection(project: Project, selection: ItemIds): ClipboardData | null {
  const ids = new Set(selection.instances)
  const instances = project.instances.filter((i) => ids.has(i.id))
  const nids = new Set(selection.notes ?? [])
  const notes = (project.notes ?? []).filter((n) => nids.has(n.id))
  if (instances.length === 0 && notes.length === 0) return null
  const jids = new Set(selection.junctions ?? [])
  const junctions = (project.junctions ?? []).filter((j) => jids.has(j.id))
  const parts: Record<string, PartDef> = {}
  for (const inst of instances) {
    const part = project.parts[inst.partId]
    if (part) parts[part.id] = part
  }
  const copied = (e: WireEnd) => (isPinEnd(e) ? ids.has(e.instanceId) : jids.has(e.junctionId))
  const wires = project.wires.filter((w) => copied(w.from) && copied(w.to))
  const supplies: Record<string, Supply> = {}
  for (const w of wires) {
    for (const id of [w.supplyId, w.tubes?.ends, w.tubes?.middle]) {
      const s = id ? project.supplies?.[id] : undefined
      if (s) supplies[s.id] = s
    }
  }
  const xs = [...instances.map((i) => i.x), ...notes.map((n) => n.x)]
  const ys = [...instances.map((i) => i.y), ...notes.map((n) => n.y)]
  const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
  return structuredClone({ parts, instances, wires, junctions, center, ...(notes.length > 0 ? { notes } : {}), ...(Object.keys(supplies).length > 0 ? { supplies } : {}) })
}

/** 원래 참조명의 접두사를 유지한다 (J3 → J). 없으면 부품 설정, 그것도 없으면 U */
function prefixOf(inst: PartInstance, part: PartDef | undefined): string {
  return /^[A-Za-z]+/.exec(inst.refDes)?.[0] ?? part?.refPrefix ?? DEFAULT_REF_PREFIX
}

export interface PasteResult {
  project: Project
  /** 새로 생긴 부품·전선·접속점 id (붙여넣은 뒤 선택용) */
  instances: string[]
  wires: string[]
  junctions: string[]
  notes: string[]
}

/** 클립보드 내용을 delta만큼 옮겨 붙여넣는다. 입력 프로젝트는 바꾸지 않는다 */
export function pasteClipboard(project: Project, clip: ClipboardData, delta: Point, newId: () => string): PasteResult {
  let parts = project.parts
  for (const part of Object.values(clip.parts)) {
    if (!parts[part.id]) parts = { ...parts, [part.id]: partForProject(project, part) }
  }

  const idMap = new Map<string, string>()
  let next: Project = { ...project, parts }
  const newInstances: PartInstance[] = []
  for (const inst of clip.instances) {
    const id = newId()
    idMap.set(inst.id, id)
    const refDes = nextRefDes({ ...next, instances: [...next.instances, ...newInstances] }, prefixOf(inst, parts[inst.partId]))
    newInstances.push({ ...inst, id, refDes, x: inst.x + delta.x, y: inst.y + delta.y })
  }
  next = { ...next, instances: [...next.instances, ...newInstances] }

  const newJunctions: Junction[] = []
  for (const j of clip.junctions ?? []) {
    const id = newId()
    idMap.set(j.id, id)
    const label = nextJunctionLabel({ ...next, junctions: [...(next.junctions ?? []), ...newJunctions] })
    newJunctions.push({ id, label, x: j.x + delta.x, y: j.y + delta.y })
  }
  if (newJunctions.length > 0) next = { ...next, junctions: [...(next.junctions ?? []), ...newJunctions] }

  // 붙여넣을 배선도의 부품 정의에 그 핀이 있는 전선만 (같은 id라도 정의가 다를 수 있다)
  const remap = (e: WireEnd): WireEnd | undefined => {
    const jid = endJunctionId(e)
    if (jid !== undefined) return idMap.has(jid) ? { junctionId: idMap.get(jid)! } : undefined
    const iid = endInstanceId(e)!
    const inst = newInstances.find((i) => i.id === idMap.get(iid))
    const pinId = (e as { pinId: string }).pinId
    return inst && parts[inst.partId]?.pins.some((p) => p.id === pinId) ? { instanceId: inst.id, pinId } : undefined
  }
  const newWires: Wire[] = []
  for (const w of clip.wires) {
    const from = remap(w.from)
    const to = remap(w.to)
    if (!from || !to) continue
    const wire: Wire = { ...w, id: newId(), from, to }
    if (w.points) wire.points = w.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }))
    newWires.push(wire)
  }
  next = { ...next, wires: [...next.wires, ...newWires] }
  // 글 상자
  const newNotes: Note[] = (clip.notes ?? []).map((n) => ({ ...n, id: newId(), x: n.x + delta.x, y: n.y + delta.y }))
  if (newNotes.length > 0) next = { ...next, notes: [...(next.notes ?? []), ...newNotes] }
  // 전선이 쓰는 부속 부품 사본 (없는 것만, 배선도 통화로)
  for (const s of Object.values(clip.supplies ?? {})) {
    if (!next.supplies?.[s.id] && newWires.some((w) => [w.supplyId, w.tubes?.ends, w.tubes?.middle].includes(s.id))) {
      next = { ...next, supplies: { ...next.supplies, [s.id]: inProjectCurrency(next, s) } }
    }
  }

  return {
    project: next,
    instances: newInstances.map((i) => i.id),
    wires: newWires.map((w) => w.id),
    junctions: newJunctions.map((j) => j.id),
    notes: newNotes.map((n) => n.id)
  }
}
