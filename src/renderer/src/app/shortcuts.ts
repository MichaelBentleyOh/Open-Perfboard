import { useEffect, useRef } from 'react'
import { SHORTCUTS, matchCombo, type ShortcutId } from '@core/keymap'
import { redo, undo, useProjectStore } from '@/stores/projectStore'
import { selectionCount, useUiStore } from '@/stores/uiStore'
import { canvasZoom } from '@/features/canvas/canvasZoom'
import { newDocument, openDocument, saveDocument } from './fileCommands'
import { copy, cut, paste } from './editCommands'

/** 동작. false를 돌려주면 "할 일 없음" → 같은 키의 다음 항목으로 넘어간다 */
type Handler = () => void | false

function handlers(onPdf: () => void): Record<ShortcutId, Handler> {
  const ui = () => useUiStore.getState()
  const store = () => useProjectStore.getState()
  const instances = () => ui().selection.instances
  const withParts = (fn: (ids: string[]) => void): Handler => () => {
    if (instances().length === 0) return false
    fn(instances())
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
    copy,
    cut,
    paste,
    selectAll: () => {
      const { instances, wires, junctions = [] } = store().project
      ui().select({ instances: instances.map((i) => i.id), wires: wires.map((w) => w.id), junctions: junctions.map((j) => j.id) })
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
    rotate: withParts((ids) => store().rotateInstances(ids, 90)),
    rotateBack: withParts((ids) => store().rotateInstances(ids, -90)),
    flipH: withParts((ids) => store().flipInstances(ids, 'horizontal')),
    flipV: withParts((ids) => store().flipInstances(ids, 'vertical')),
    zoom100: zoom((z) => z.setZoom(1)),
    zoomIn: zoom((z) => z.step(1)),
    zoomOut: zoom((z) => z.step(-1)),
    fit: zoom((z) => z.fit()),
    help: () => ui().setHelpOpen(true)
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
