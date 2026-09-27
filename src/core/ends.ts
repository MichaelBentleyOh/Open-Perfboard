// 전선 끝(핀 또는 접속점) 다루기
import { pinWorldPosition, type Point } from './geometry'
import type { Junction, JunctionRef, PartDef, PartInstance, Pin, PinRef, Project, WireEnd } from './model'
import { byId } from './lookup'

export const isPinEnd = (e: WireEnd): e is PinRef => 'instanceId' in e
export const isJunctionEnd = (e: WireEnd): e is JunctionRef => 'junctionId' in e

/** 핀 끝이면 부품 배치 id, 접속점이면 undefined */
export const endInstanceId = (e: WireEnd): string | undefined => (isPinEnd(e) ? e.instanceId : undefined)
export const endJunctionId = (e: WireEnd): string | undefined => (isJunctionEnd(e) ? e.junctionId : undefined)

export function sameEnd(a: WireEnd, b: WireEnd): boolean {
  if (isPinEnd(a) && isPinEnd(b)) return a.instanceId === b.instanceId && a.pinId === b.pinId
  if (isJunctionEnd(a) && isJunctionEnd(b)) return a.junctionId === b.junctionId
  return false
}

/** 핀 참조를 실제 배치/핀으로 찾는다. 없으면 undefined */
export function resolvePin(
  project: Project,
  ref: PinRef
): { instance: PartInstance; part: PartDef; pin: Pin } | undefined {
  const instance = byId(project.instances).get(ref.instanceId)
  const part = instance && project.parts[instance.partId]
  const pin = part?.pins.find((p) => p.id === ref.pinId)
  return instance && part && pin ? { instance, part, pin } : undefined
}

export const findJunction = (project: Project, id: string): Junction | undefined =>
  project.junctions && byId(project.junctions).get(id)

/** 전선 끝이 가리키는 대상이 있는지 */
export function endExists(project: Project, end: WireEnd): boolean {
  return isPinEnd(end) ? !!resolvePin(project, end) : !!findJunction(project, end.junctionId)
}

/**
 * 전선 끝의 월드 좌표.
 * centers: 드래그 중인 부품의 임시 중심, junctions: 드래그 중인 접속점의 임시 위치
 */
export function endPosition(
  project: Project,
  end: WireEnd,
  override?: { centers?: (instanceId: string) => Point | undefined; junctions?: (junctionId: string) => Point | undefined }
): Point | undefined {
  if (isPinEnd(end)) {
    const r = resolvePin(project, end)
    return r && pinWorldPosition(r.instance, r.part, r.pin, override?.centers?.(r.instance.id))
  }
  const j = findJunction(project, end.junctionId)
  return j && (override?.junctions?.(j.id) ?? { x: j.x, y: j.y })
}

/** 결선표·툴팁 표시용 이름: U1.J1.3 또는 SP1 */
export function endLabel(project: Project, end: WireEnd): string {
  if (isJunctionEnd(end)) return findJunction(project, end.junctionId)?.label ?? '?'
  const r = resolvePin(project, end)
  if (!r) return '?'
  const connector = r.part.connectors.find((c) => c.id === r.pin.connectorId)?.name
  return [r.instance.refDes, connector, r.pin.number].filter(Boolean).join('.')
}
