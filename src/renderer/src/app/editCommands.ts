// 편집 명령: 복사, 잘라내기, 붙여넣기, 배선 정리
import { nanoid } from 'nanoid'
import { copySelection, type ClipboardData } from '@core/clipboard'
import type { Point } from '@core/geometry'
import type { WireEnd } from '@core/model'
import { endInstanceId, endJunctionId } from '@core/ends'
import { routeJob } from '@core/ops'
import { useProjectStore } from '@/stores/projectStore'
import { selectionCount, useUiStore } from '@/stores/uiStore'
import { getCanvasPointer } from '@/features/canvas/canvasPointer'
import { canvasZoom } from '@/features/canvas/canvasZoom'
import { NOTE_DEFAULT_WIDTH } from '@core/note'
import { RouteCancelled, runRouteJob } from '@/services/routeService'
import { t } from '@/i18n'

/** 마우스가 캔버스 밖일 때 붙여넣기마다 비켜 가는 거리 */
const PASTE_STEP = 30

const notify = (m: string) => useUiStore.getState().notify(m)

function copyCurrent(): ClipboardData | null {
  const ui = useUiStore.getState()
  const clip = copySelection(useProjectStore.getState().project, ui.selection)
  if (!clip) notify(selectionCount(ui.selection) > 0 ? t('전선만으로는 복사할 수 없습니다. 부품을 함께 선택하세요') : t('복사할 부품을 선택하세요'))
  return clip
}

function pasteWith(clip: ClipboardData, delta: Point): void {
  const r = useProjectStore.getState().paste(clip, delta, nanoid)
  useUiStore.getState().select({ instances: r.instances, wires: r.wires, junctions: r.junctions, notes: r.notes })
  notify(
    r.wires.length
      ? t('부품 {parts}개, 전선 {wires}개를 붙여넣었습니다', { parts: r.instances.length, wires: r.wires.length })
      : t('부품 {parts}개를 붙여넣었습니다', { parts: r.instances.length })
  )
}

export function copy(): void {
  const clip = copyCurrent()
  if (!clip) return
  useUiStore.getState().setClipboard(clip)
  notify(
    clip.wires.length
      ? t('부품 {parts}개, 전선 {wires}개를 복사했습니다', { parts: clip.instances.length, wires: clip.wires.length })
      : t('부품 {parts}개를 복사했습니다', { parts: clip.instances.length })
  )
}

export function cut(): void {
  const clip = copyCurrent()
  if (!clip) return
  const ui = useUiStore.getState()
  ui.setClipboard(clip)
  useProjectStore.getState().removeItems(ui.selection)
  ui.clearSelection()
  notify(t('부품 {parts}개를 잘라냈습니다', { parts: clip.instances.length }))
}

/** 마우스가 캔버스 위에 있으면 그 위치에, 아니면 원래 자리에서 비스듬히 비켜서 (반복하면 계속 비켜 감) */
export function paste(): void {
  const ui = useUiStore.getState()
  const clip = ui.clipboard
  if (!clip) {
    notify(t('복사한 부품이 없습니다'))
    return
  }
  const at = getCanvasPointer()
  if (at) {
    pasteWith(clip, { x: at.x - clip.center.x, y: at.y - clip.center.y })
    return
  }
  // 비켜 가는 거리는 "캔버스 밖에서 붙여넣은 횟수"만 센다
  const n = ui.nextPasteSerial()
  pasteWith(clip, { x: PASTE_STEP * n, y: PASTE_STEP * n })
}

/** 글 상자를 화면 가운데에 만들고 바로 글을 고친다 (032) */
export function addTextBox(): void {
  const c = canvasZoom()?.center() ?? { x: 0, y: 0 }
  const id = nanoid()
  useProjectStore.getState().addNote({ id, x: Math.round(c.x - NOTE_DEFAULT_WIDTH / 2), y: Math.round(c.y - 20), width: NOTE_DEFAULT_WIDTH, text: t('메모') })
  const ui = useUiStore.getState()
  ui.setTool('select')
  ui.selectOne('note', id)
  ui.setEditingNote(id)
}

/**
 * 배선 정리: 부품을 피하고 서로 겹치지 않는 직각 경로로 다시 그린다.
 * 선택한 전선(또는 선택한 부품·접속점에 연결된 전선)만, 선택이 없으면 전체
 */
/**
 * 배선 정리. 경로 찾기는 작업자에서 돌리고 그동안 진행 창을 띄운다 (전선이 많아도 화면이 멈추지 않는다).
 * 끝나면 한 번에 넣는다 → 실행 취소 1회.
 */
export async function tidyWiring(): Promise<void> {
  if (useUiStore.getState().busy) return
  const { project } = useProjectStore.getState()
  const sel = useUiStore.getState().selection
  let ids: string[]
  if (selectionCount(sel) === 0) ids = project.wires.map((w) => w.id)
  else {
    const inst = new Set(sel.instances)
    const junc = new Set(sel.junctions)
    const touches = (e: WireEnd) => inst.has(endInstanceId(e) ?? '') || junc.has(endJunctionId(e) ?? '')
    ids = project.wires.filter((w) => sel.wires.includes(w.id) || touches(w.from) || touches(w.to)).map((w) => w.id)
  }
  if (ids.length === 0) {
    notify(t('정리할 전선이 없습니다'))
    return
  }
  const ui = useUiStore.getState()
  const run = runRouteJob(routeJob(project, ids), (done, total) => useUiStore.getState().setBusyProgress(done, total))
  ui.setBusy({ label: t('배선 정리 중'), done: 0, total: ids.length, cancel: run.cancel })
  let routes
  try {
    routes = await run.result
  } catch (e) {
    notify(e instanceof RouteCancelled ? t('배선 정리를 취소했습니다') : t('배선 정리에 실패했습니다: {error}', { error: (e as Error).message }))
    return
  } finally {
    useUiStore.getState().setBusy(null)
  }
  // 진행 창이 다른 조작을 막지만, 그 사이 배선도가 바뀌었다면 옛 배선도로 찾은 경로는 넣지 않는다
  if (useProjectStore.getState().project !== project) {
    notify(t('배선도가 바뀌어 정리 결과를 넣지 않았습니다'))
    return
  }
  const changed = useProjectStore.getState().applyRoutes(routes)
  notify(changed ? t('전선 {n}개를 정리했습니다', { n: ids.length }) : t('이미 정리된 배선입니다'))
}
