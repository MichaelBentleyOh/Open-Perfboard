import { useEffect, useRef } from 'react'
import { SHORTCUTS, matchCombo, type ShortcutId } from '@core/keymap'
import { redo, undo, useProjectStore } from '@/stores/projectStore'
import { selectionCount, useUiStore } from '@/stores/uiStore'
import { RESIZE_STEP } from '@core/ops'
import { canvasZoom } from '@/features/canvas/canvasZoom'
import { newDocument, openDocument, saveDocument } from './fileCommands'
import { addTextBox, copy, cut, paste } from './editCommands'

/** 동작. false를 돌려주면 "할 일 없음" → 같은 키의 다음 항목으로 넘어간다 */
type Handler = () => void | false

function handlers(onPdf: () => void): Record<ShortcutId, Handler> {
  const ui = () => useUiStore.getState()
  const store = () => useProjectStore.getState()
  const instances = () => ui().selection.instances
  const onSchematic = () => ui().view === 'schematic'
  /** 회로도 탭에서는 하지 않는 배선도 전용 동작 (복사·붙여넣기·글 상자·크기) */
  const diagramOnly = (fn: Handler): Handler => () => (onSchematic() ? false : fn())
  const withParts = (fn: (ids: string[]) => void): Handler => () => {
    if (instances().length === 0) return false
    fn(instances())
  }
  const resize = (factor: number): Handler => () => {
    const { instances, notes } = ui().selection
    if (instances.length === 0 && notes.length === 0) return false
    store().resizeItems({ instances, notes }, factor)
  }
  const zoom = (fn: (z: NonNullable<ReturnType<typeof canvasZoom>>) => void): Handler => () => {
    const z = canvasZoom()
    if (!z) return false
    fn(z)
  }
  return {
    new: newDocument,
    open: () => void openDocument(),
    save: () => void saveDocument(),
    saveAs: () => void saveDocument(true),
    pdf: onPdf,
    undo,
    redo,
    copy: diagramOnly(copy),
    cut: diagramOnly(cut),
    paste: diagramOnly(paste),
    selectAll: () => {
      const { instances, wires, junctions = [], notes = [] } = store().project
      ui().select({ instances: instances.map((i) => i.id), wires: wires.map((w) => w.id), junctions: junctions.map((j) => j.id), notes: notes.map((n) => n.id) })
    },
    wireBack: () => {
      if (!ui().wireStart) return false
      ui().popWirePoint()
    },
    delete: () => {
      const sel = ui().selection
      if (selectionCount(sel) === 0) return false
      store().removeItems(sel)
      ui().clearSelection()
    },
    selectMode: () => ui().setTool('select'),
    wireMode: () => ui().setTool('wire'),
    escape: () => {
      // 그리는 중이면 그 전선만 취소, 아니면 선택 모드로 돌아가며 선택 해제
      if (ui().wireStart) ui().setWireStart(null)
      else {
        ui().setTool('select')
        ui().clearSelection()
      }
    },
    // 회로도 탭(039)에서는 기호를 돌리고 뒤집는다 (배선도의 부품 자세는 그대로)
    rotate: withParts((ids) => (onSchematic() ? store().rotateSymbols(ids, 90) : store().rotateInstances(ids, 90))),
    rotateBack: withParts((ids) => (onSchematic() ? store().rotateSymbols(ids, -90) : store().rotateInstances(ids, -90))),
    flipH: withParts((ids) => (onSchematic() ? store().mirrorSymbols(ids, 'horizontal') : store().flipInstances(ids, 'horizontal'))),
    flipV: withParts((ids) => (onSchematic() ? store().mirrorSymbols(ids, 'vertical') : store().flipInstances(ids, 'vertical'))),
    grow: diagramOnly(resize(RESIZE_STEP)),
    shrink: diagramOnly(resize(1 / RESIZE_STEP)),
    zoom100: zoom((z) => z.setZoom(1)),
    zoomIn: zoom((z) => z.step(1)),
    zoomOut: zoom((z) => z.step(-1)),
    fit: zoom((z) => z.fit()),
    help: () => ui().setHelpOpen(true),
    textBox: diagramOnly(() => addTextBox()),
    search: () => ui().setSearchOpen(true)
  }
}

const isTyping = (target: EventTarget | null) => {
  const tag = (target as HTMLElement | null)?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * 전역 단축키. 무엇이 어떤 키인지는 core/keymap.ts의 목록이 정한다 (도움말도 같은 목록).
 * 모달이 열려 있으면 무시, 입력칸 안에서는 파일 명령만, BOM·결선표 탭에서는 배선도 전용 명령을 무시한다.
 */
export function useCanvasShortcuts({ onPdf }: { onPdf: () => void }): void {
  const pdfRef = useRef(onPdf)
  pdfRef.current = onPdf
  useEffect(() => {
    const run = handlers(() => pdfRef.current())
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.modal-backdrop')) return
      const typing = isTyping(e.target)
      const onDiagram = !document.querySelector('.report-overlay')
      for (const s of SHORTCUTS) {
        if (!s.combos.some((c) => matchCombo(e, c))) continue
        if (typing && s.scope !== 'always') continue
        if (s.scope === 'diagram' && !onDiagram) continue
        if (run[s.id]() === false) continue
        e.preventDefault()
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
