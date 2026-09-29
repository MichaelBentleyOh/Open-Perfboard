import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Circle, Group, Image as KImage, Label, Layer, Line, Rect, Shape, Stage, Tag, Text } from 'react-konva'
import Konva from 'konva'
import type { Junction, Note, PartDef, PartInstance, Project, Wire } from '@core/model'
import { NOTE_DEFAULT_COLOR, NOTE_PADDING, noteFont, resizedNote } from '@core/note'
import { instanceBounds, partSize, pinWorldPosition, rectContainsPoint, rectFromPoints, rectsIntersect, snapTo, type Point, type Rect as WorldRect } from '@core/geometry'
import { endPosition, findJunction, isPinEnd } from '@core/ends'
import { clampScale, isSplitTarget, type WireTarget } from '@core/ops'
import { hopDrawOps, type DrawOp, type Hop } from '@core/crossing'
import { junctionColors, sceneWires, wireShape, wiresTouching, type SceneWires, type WireShape } from '@core/scene'
import { mergeSelection, selectInRect } from '@core/selection'
import { flatten, nearestSegment, pathMidpoint, projectOnPath, snapPoint, wirePath } from '@core/wire'
import { useProjectStore } from '@/stores/projectStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { selectionCount, useUiStore } from '@/stores/uiStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { loadHtmlImage } from '@/features/part-editor/image'
import { connectorColor } from '@/features/part-editor/connectorColor'
import { PART_DRAG_TYPE } from './dragTypes'
import { registerCanvasExporter } from './canvasExport'
import { registerCanvasPointer } from './canvasPointer'
import { registerCanvasZoom } from './canvasZoom'
import { contentBounds, fitView, nextZoomStep, zoomAround, type View } from '@core/zoom'
import { t } from '@/i18n'

const GRID = 20
const PIN_R = 6
const JUNCTION_R = 4.5
/** 이보다 작게(화면 px) 움직이면 선택 사각형이 아니라 클릭으로 본다 */
const CLICK_SLOP = 4
/** 전선 위에서 이만큼(화면 px) 끌면 분기를 시작한다 */
const BRANCH_SLOP = 6
/** 화면 밖이라도 이만큼(화면 px) 안쪽은 미리 그린다 (참조명·점프 반원·굵은 선이 잘리지 않게) */
const CULL_MARGIN = 60
/** 이 배율보다 작으면 핀·참조명·라벨을 그리지 않는다 (핀이 2px보다 작아 보이지 않음) */
const DETAIL_SCALE = 0.3
/** 이 배율보다 작으면 부품 그림자를 그리지 않는다 (그림자는 그리기가 비싸다) */
const SHADOW_SCALE = 0.5
const NO_HOPS: Hop[] = []
const NO_IDS: ReadonlySet<string> = new Set()

/** 여러 부품(과 접속점)을 함께 끄는 중: 대상 id와 이동량 */
interface GroupDrag {
  ids: Set<string>
  junctions: Set<string>
  /** 함께 옮기는 글 상자 (032) */
  notes: Set<string>
  dx: number
  dy: number
}

/** 선택 사각형 (월드 좌표) */
interface Band {
  start: Point
  end: Point
  additive: boolean
}

type ItemKind = 'instance' | 'wire' | 'junction' | 'note'
type KMouse = Konva.KonvaEventObject<MouseEvent>
type KDrag = Konva.KonvaEventObject<DragEvent>

/**
 * 부품·전선·핀·접속점 도형이 부르는 동작. 도형 컴포넌트는 memo로 다시 그리기를 줄이므로
 * 동작은 매번 새로 만든 함수를 ref에 넣어 두고 ref로 부른다 (늘 최신 상태를 본다).
 */
interface CanvasApi {
  itemMouseDown: (kind: ItemKind, id: string, e: KMouse) => void
  itemClick: (kind: ItemKind, id: string, e: KMouse) => void
  partDragStart: (inst: PartInstance) => void
  partDragMove: (inst: PartInstance, e: KDrag) => void
  partDragEnd: (inst: PartInstance, e: KDrag) => void
  wireMouseDown: (w: Wire, e: KMouse) => void
  wireMouseMove: (path: Point[], e: KMouse) => void
  wireMouseLeave: (e: KMouse) => void
  wireClick: (w: Wire, e: KMouse) => void
  wireDblClick: (w: Wire, nodes: Point[], e: KMouse) => void
  bendDragMove: (wireId: string, index: number, e: KDrag) => void
  bendDragEnd: () => void
  bendDblClick: (wireId: string, index: number, e: KMouse) => void
  pinMouseDown: (e: KMouse) => void
  pinClick: (target: WireTarget, e: KMouse) => void
  pinEnter: (target: WireTarget, text: string, at: Point, e: KMouse) => void
  pinLeave: (e: KMouse) => void
  junctionMouseDown: (id: string, e: KMouse) => void
  junctionClick: (id: string, e: KMouse) => void
  junctionDragMove: (id: string, e: KDrag) => void
  junctionDragEnd: () => void
  junctionEnter: (id: string, e: KMouse) => void
  noteDragStart: (note: Note) => void
  noteDragMove: (note: Note, e: KDrag) => void
  noteDragEnd: (note: Note, e: KDrag) => void
  noteDblClick: (note: Note, e: KMouse) => void
}
type Api = RefObject<CanvasApi>

interface Props {
  onZoomChange?: (scale: number) => void
}

/** 부품 사진을 HTMLImageElement로 캐시한다 */
function useImages(parts: Record<string, PartDef>): Record<string, HTMLImageElement> {
  const [images, setImages] = useState<Record<string, HTMLImageElement>>({})
  useEffect(() => {
    for (const part of Object.values(parts)) {
      if (images[part.id]?.src === part.image.data) continue
      loadHtmlImage(part.image.data).then((img) => setImages((m) => ({ ...m, [part.id]: img })))
    }
  }, [parts]) // images는 의도적으로 제외: 새 부품이 생길 때만 로드
  return images
}

/** 드래그 중이면 임시 위치(중심)를, 아니면 저장된 위치를 쓴다 */
function centerOf(inst: { id: string; x: number; y: number }, drag: GroupDrag | null): Point {
  return drag?.ids.has(inst.id) ? { x: inst.x + drag.dx, y: inst.y + drag.dy } : inst
}

/** 전선 끝(핀·접속점) → 월드 좌표. 끄는 중인 부품·접속점은 임시 위치로 */
function makeEndPos(project: Project, drag: GroupDrag | null, junctionDrag: { id: string; p: Point } | null) {
  return (end: Wire['from']): Point | undefined =>
    endPosition(project, end, {
      centers: (id) => {
        if (!drag?.ids.has(id)) return undefined
        const inst = project.instances.find((i) => i.id === id)
        return inst && centerOf(inst, drag)
      },
      junctions: (id) => {
        if (junctionDrag?.id === id) return junctionDrag.p
        const j = findJunction(project, id)
        return j && drag?.junctions.has(id) ? { x: j.x + drag.dx, y: j.y + drag.dy } : undefined
      }
    })
}

/** 점프가 들어간 전선 경로를 캔버스에 그린다 */
function traceOps(ctx: Konva.Context, ops: readonly DrawOp[]) {
  ctx.beginPath()
  for (const op of ops) {
    if (op.kind === 'move') ctx.moveTo(op.p.x, op.p.y)
    else if (op.kind === 'line') ctx.lineTo(op.p.x, op.p.y)
    else ctx.arc(op.center.x, op.center.y, op.r, op.start, op.end, op.anticlockwise)
  }
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')

const targetKey = (t: WireTarget | null) =>
  !t ? '' : isSplitTarget(t) ? `w:${t.wireId}` : isPinEnd(t) ? `p:${t.instanceId}:${t.pinId}` : `j:${t.junctionId}`

/** 크기 손잡이 대상 (034): 이 점(anchor)을 그대로 두고 손잡이 쪽으로 늘리고 줄인다 */
interface ResizeTarget {
  items: { instances?: string[]; notes?: string[] }
  anchor: Point
  rect: WorldRect
  corners: Point[]
  /** 원하는 비율 → 범위 안에서 실제로 되는 비율 */
  limit: (factor: number) => number
}
/** 손잡이 크기 (화면 px) */
const RESIZE_HANDLE = 9

/** 글 상자의 실제 크기 (Konva가 줄을 바꿔 그린 높이) */
function noteSize(n: Note): { width: number; height: number } {
  const text = new Konva.Text({ text: n.text || ' ', width: n.width, padding: NOTE_PADDING, fontSize: noteFont(n), lineHeight: 1.3, wrap: 'char' })
  const height = text.height()
  text.destroy()
  return { width: n.width, height }
}

const scaleRect = (r: WorldRect, a: Point, f: number): WorldRect => ({
  x: a.x + (r.x - a.x) * f,
  y: a.y + (r.y - a.y) * f,
  width: r.width * f,
  height: r.height * f
})

const setCursor = (e: KMouse, cursor: string) => {
  e.target.getStage()!.container().style.cursor = cursor
}

/**
 * 배선도 캔버스.
 * - 휠: 확대/축소 · 휠 버튼 드래그 또는 Space+드래그: 화면 이동
 * - 빈 곳 드래그: 선택 사각형 (Ctrl/Shift: 기존 선택에 추가) · 빈 곳 클릭: 선택 해제
 * - 부품 클릭: 선택 (Ctrl/Shift+클릭: 추가/제외) · 선택된 부품 끌기: 선택 전체 이동
 * - 핀·접속점 클릭 → (빈 곳 클릭으로 꺾기) → 핀·접속점·전선 클릭: 전선 연결
 * - 전선 위에서 끌기: 그 자리에 접속점을 만들며 분기 시작
 * - 교차하는 전선은 점프(반원)로 표시
 *
 * 큰 배선도에서도 빠르도록: 화면 밖 도형은 그리지 않고, 도형 컴포넌트는 바뀐 것만 다시 그린다.
 * 끄는 중에는 움직이는 전선만 다시 계산하고, 교차 점프는 놓은 뒤에 계산한다.
 */
export function CanvasView({ onZoomChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  /** PNG 내보내기 중에는 화면 밖 도형도 그린다 */
  const [renderAll, setRenderAll] = useState(false)
  const [drag, setDrag] = useState<GroupDrag | null>(null)
  /** 함께 끄는 대상 id (dragEnd가 렌더보다 먼저 올 수 있어 ref로도 보관) */
  const dragIdsRef = useRef<{ instances: string[]; junctions: string[]; notes: string[] }>({ instances: [], junctions: [], notes: [] })
  const [junctionDrag, setJunctionDrag] = useState<{ id: string; p: Point } | null>(null)
  const junctionDragRef = useRef<{ id: string; p: Point } | null>(null)
  const [band, setBand] = useState<Band | null>(null)
  const [pointer, setPointer] = useState<Point | null>(null)
  const [hoverPin, setHoverPin] = useState<{ text: string; at: Point } | null>(null)
  /** 배선 중 전선 위에 올린 마우스: 여기서 끝내면 생길 접속점 위치 */
  const [hoverSplit, setHoverSplit] = useState<Point | null>(null)
  /** 배선 중이 아닐 때 전선 위에 올린 마우스: 여기서 끌면 분기된다는 표시 */
  const [hoverBranch, setHoverBranch] = useState<Point | null>(null)
  /** 마우스 아래의 핀·접속점 (전선에서 끌어 온 분기를 그 위에서 놓으면 바로 연결) */
  const hoverTargetRef = useRef<WireTarget | null>(null)
  /** 전선에서 끌어서 분기 중 (마우스를 아직 놓지 않음) */
  const branchDraggingRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const panRef = useRef<{ clientX: number; clientY: number; view: View } | null>(null)
  /** 전선 위에서 누른 채: 충분히 끌면 분기 시작 */
  const branchRef = useRef<{ wireId: string; clientX: number; clientY: number; at: Point } | null>(null)
  /** 분기를 끌어서 시작한 직후의 click 이벤트는 무시 */
  const suppressClickRef = useRef(false)
  // 선택 사각형의 최신 값. 화면 갱신(렌더)보다 마우스 이벤트가 빠를 수 있어서
  // 이벤트 처리는 state가 아니라 이 ref를 기준으로 한다 (빠르게 끌고 놓아도 마지막 위치 반영)
  const bandRef = useRef<Band | null>(null)
  const updateBand = (next: Band | null) => {
    bandRef.current = next
    setBand(next)
  }

  const project = useProjectStore((s) => s.project)
  const { tool, selection, wireStart, wirePoints, wireOrthogonal, wireColor } = useUiStore()
  const wireMode = tool === 'wire'
  const [handleDrag, setHandleDrag] = useState<{ wireId: string; index: number; p: Point } | null>(null)
  const handleDragRef = useRef<{ wireId: string; index: number; p: Point } | null>(null)
  /** 크기 손잡이를 끄는 중 (034): 몇 번째 손잡이, 원래 크기 대비 비율 */
  const [resize, setResize] = useState<{ corner: number; factor: number } | null>(null)
  const resizeRef = useRef<{ corner: number; factor: number } | null>(null)
  const images = useImages(project.parts)
  const endPos = useMemo(() => makeEndPos(project, drag, junctionDrag), [project, drag, junctionDrag])
  const selectedInstances = useMemo(() => new Set(selection.instances), [selection.instances])
  const selectedWires = useMemo(() => new Set(selection.wires), [selection.wires])
  const selectedJunctions = useMemo(() => new Set(selection.junctions), [selection.junctions])
  const selectedNotes = useMemo(() => new Set(selection.notes), [selection.notes])
  const editingNote = useUiStore((s) => s.editingNote)
  const gridSnap = useSettingsStore((s) => s.gridSnap)
  const gridSize = useSettingsStore((s) => s.gridSize)
  const gridStep = gridSnap ? gridSize : GRID

  const viewRef = useRef(view)
  viewRef.current = view

  // 배선도(아래 탭)마다 화면 위치를 기억한다 (030). 처음 보는 배선도는 전체 보기
  const activeSheet = useWorkspaceStore((s) => s.activeId)
  const sheetViews = useRef(new Map<string, View>())
  const shownSheet = useRef(activeSheet)
  useEffect(() => {
    if (shownSheet.current === activeSheet) return
    sheetViews.current.set(shownSheet.current, viewRef.current)
    shownSheet.current = activeSheet
    const saved = sheetViews.current.get(activeSheet)
    const r = containerRef.current!.getBoundingClientRect()
    const bounds = contentBounds(useProjectStore.getState().project)
    setView(saved ?? (bounds ? fitView(bounds, { width: r.width, height: r.height }) : { scale: 1, x: r.width / 2, y: r.height / 2 }))
  }, [activeSheet])

  useEffect(() => {
    const el = containerRef.current!
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
      // 처음 한 번은 월드 원점을 화면 가운데로
      setView((v) => (v.x === 0 && v.y === 0 ? { ...v, x: width / 2, y: height / 2 } : v))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => onZoomChange?.(view.scale), [view.scale, onZoomChange])

  const toWorld = (clientX: number, clientY: number, v: View = viewRef.current): Point => {
    const rect = containerRef.current!.getBoundingClientRect()
    return { x: (clientX - rect.left - v.x) / v.scale, y: (clientY - rect.top - v.y) / v.scale }
  }

  // ---------------------------------------------------------------- 전선 경로 + 교차 점프

  /** 배선도가 바뀔 때만: 모든 전선 모양과 교차 점프 (바뀌지 않은 전선은 직전 객체를 다시 써서 다시 그리지 않는다) */
  const sceneRef = useRef<SceneWires | undefined>(undefined)
  const scene = useMemo(() => (sceneRef.current = sceneWires(project, sceneRef.current)), [project])
  const jColors = useMemo(() => junctionColors(project), [project])

  /** 끄는 중 다시 계산할 전선: 움직이는 부품·접속점에 닿은 전선, 꺾임점을 끄는 전선 */
  const dragInstances = drag?.ids
  const dragJunctions = drag?.junctions
  const junctionDragId = junctionDrag?.id
  const handleDragWire = handleDrag?.wireId
  const movingWires = useMemo(() => {
    if (!dragInstances && !junctionDragId && !handleDragWire) return NO_IDS
    const junctions = new Set(dragJunctions ?? [])
    if (junctionDragId) junctions.add(junctionDragId)
    const ids = wiresTouching(project, dragInstances ?? NO_IDS, junctions)
    if (handleDragWire) ids.add(handleDragWire)
    return ids
  }, [project, dragInstances, dragJunctions, junctionDragId, handleDragWire])

  /** 화면에 그릴 꺾임점: 함께 끄는 중이면 이동량만큼, 손잡이를 끄는 중이면 그 위치로 */
  const livePoints = (w: Wire): Point[] => {
    let pts = w.points ?? []
    const moving = (e: Wire['from']) => (isPinEnd(e) ? drag?.ids.has(e.instanceId) : drag?.junctions.has(e.junctionId))
    if (drag && moving(w.from) && moving(w.to)) pts = pts.map((p) => ({ x: p.x + drag.dx, y: p.y + drag.dy }))
    if (handleDrag?.wireId === w.id) pts = pts.map((p, i) => (i === handleDrag.index ? handleDrag.p : p))
    return pts
  }

  /** 지금 그릴 전선 모양: 움직이지 않는 전선은 배선도 계산 결과를 그대로 (같은 객체라 다시 그리지 않는다) */
  const shapes = useMemo(() => {
    if (movingWires.size === 0) return scene.list
    return scene.list.map((s) => {
      if (!movingWires.has(s.wire.id)) return s
      const a = endPos(s.wire.from)
      const b = endPos(s.wire.to)
      return a && b ? wireShape(s.wire, a, b, livePoints(s.wire)) : s
    })
    // livePoints는 drag(endPos에 포함)·handleDrag에만 의존한다
  }, [scene, movingWires, endPos, handleDrag])

  /** 그릴 영역 (월드 좌표). null이면 전부 */
  const visible: WorldRect | null = useMemo(() => {
    if (renderAll || size.width === 0) return null
    const m = CULL_MARGIN / view.scale
    return { x: -view.x / view.scale - m, y: -view.y / view.scale - m, width: size.width / view.scale + 2 * m, height: size.height / view.scale + 2 * m }
  }, [renderAll, size, view])

  // ---------------------------------------------------------------- Space 누름 상태 (화면 이동 모드)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTyping(e.target) || document.querySelector('.modal-backdrop')) return
      e.preventDefault() // 포커스된 버튼이 눌리거나 스크롤되지 않게
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false)
    const blur = () => setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // ---------------------------------------------------------------- 화면 이동 / 선택 사각형 / 분기 시작 (캔버스 밖에서 놓아도 끝나도록 window에서 처리)
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const pan = panRef.current
      if (pan) {
        setView({ ...pan.view, x: pan.view.x + e.clientX - pan.clientX, y: pan.view.y + e.clientY - pan.clientY })
        return
      }
      const br = branchRef.current
      if (br && Math.hypot(e.clientX - br.clientX, e.clientY - br.clientY) > BRANCH_SLOP) {
        // 전선 위에서 끌기 → 그 자리에서 분기 시작 (접속점은 연결을 끝낼 때 만든다)
        branchRef.current = null
        branchDraggingRef.current = true
        suppressClickRef.current = true
        setHoverBranch(null)
        const ui = useUiStore.getState()
        ui.setWireStart({ wireId: br.wireId, point: br.at })
        ui.clearSelection()
        setPointer(toWorld(e.clientX, e.clientY))
        return
      }
      if (bandRef.current) updateBand({ ...bandRef.current, end: toWorld(e.clientX, e.clientY) })
    }
    const up = () => {
      branchRef.current = null
      if (branchDraggingRef.current) {
        // 끌어 온 분기를 핀·접속점 위에서 놓으면 바로 연결. 다른 곳이면 배선 모드를 유지해 클릭으로 끝낸다
        branchDraggingRef.current = false
        suppressClickRef.current = false
        const target = hoverTargetRef.current
        if (target) handleTargetRef.current(target)
        return
      }
      if (panRef.current) {
        panRef.current = null
        setPanning(false)
      }
      const b = bandRef.current
      if (!b) return
      updateBand(null)
      const ui = useUiStore.getState()
      const scale = viewRef.current.scale
      const tiny = Math.abs(b.end.x - b.start.x) * scale < CLICK_SLOP && Math.abs(b.end.y - b.start.y) * scale < CLICK_SLOP
      if (tiny) {
        if (!b.additive) ui.clearSelection()
        return
      }
      const hit = selectInRect(useProjectStore.getState().project, rectFromPoints(b.start, b.end))
      ui.select(b.additive ? mergeSelection(ui.selection, hit) : hit)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  // ---------------------------------------------------------------- 마지막 마우스 위치 (붙여넣기 위치)
  useEffect(() => {
    let last: Point | null = null
    const move = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const inside = !!rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
      last = inside ? toWorld(e.clientX, e.clientY) : null
    }
    window.addEventListener('mousemove', move)
    registerCanvasPointer(() => last)
    return () => {
      window.removeEventListener('mousemove', move)
      registerCanvasPointer(null)
    }
  }, [])

  // ---------------------------------------------------------------- 배율 조작 (입력칸·단축키): 캔버스 가운데 기준
  useEffect(() => {
    const center = () => {
      const r = containerRef.current!.getBoundingClientRect()
      return { x: r.width / 2, y: r.height / 2 }
    }
    registerCanvasZoom({
      setZoom: (scale) => setView(zoomAround(viewRef.current, scale, center())),
      step: (dir) => setView(zoomAround(viewRef.current, nextZoomStep(viewRef.current.scale, dir), center())),
      fit: () => {
        const r = containerRef.current!.getBoundingClientRect()
        const bounds = contentBounds(useProjectStore.getState().project)
        setView(bounds ? fitView(bounds, { width: r.width, height: r.height }) : { scale: 1, x: r.width / 2, y: r.height / 2 })
      },
      center: () => {
        const c = center()
        const v = viewRef.current
        return { x: (c.x - v.x) / v.scale, y: (c.y - v.y) / v.scale }
      },
      centerOn: (p) => {
        const c = center()
        const scale = Math.max(viewRef.current.scale, 0.8)
        setView({ scale, x: c.x - p.x * scale, y: c.y - p.y * scale })
      }
    })
    return () => registerCanvasZoom(null)
  }, [])

  // ---------------------------------------------------------------- E2E·디버깅용 읽기 전용 훅
  useEffect(() => {
    const worldToClient = (p: Point) => {
      const rect = containerRef.current!.getBoundingClientRect()
      const v = viewRef.current
      return { x: rect.left + v.x + p.x * v.scale, y: rect.top + v.y + p.y * v.scale }
    }
    window.__opbCanvas = {
      getProject: () => useProjectStore.getState().project,
      getSelection: () => useUiStore.getState().selection,
      worldToClient: (p) => worldToClient(p),
      pinClientPosition: (instanceId, pinId) => {
        const p = endPosition(useProjectStore.getState().project, { instanceId, pinId })
        return p ? worldToClient(p) : null
      },
      instanceClientPosition: (instanceId) => {
        const inst = useProjectStore.getState().project.instances.find((i) => i.id === instanceId)
        return inst ? worldToClient(inst) : null
      },
      wirePathClient: (wireId) => {
        const project = useProjectStore.getState().project
        const w = project.wires.find((x) => x.id === wireId)
        const a = w && endPosition(project, w.from)
        const b = w && endPosition(project, w.to)
        return w && a && b ? wirePath(a, w.points, b, w.orthogonal).map(worldToClient) : null
      }
    }
    return () => {
      delete window.__opbCanvas
    }
  }, [])

  // ---------------------------------------------------------------- PNG 내보내기: 내용 영역만, 흰 배경, 선택·격자 없이, 월드 1단위 = 2px
  useEffect(() => {
    registerCanvasExporter(async () => {
      const stage = stageRef.current
      if (!stage || useProjectStore.getState().project.instances.length === 0) return null
      const ui = useUiStore.getState()
      const prevSelection = ui.selection
      ui.clearSelection()
      ui.setWireStart(null)
      setHoverPin(null)
      setHoverSplit(null)
      setHoverBranch(null)
      setRenderAll(true) // 화면 밖 도형까지
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

      const [grid, ...content] = stage.getLayers()
      try {
        const boxes = content.map((l) => l.getClientRect()).filter((b) => b.width > 0 && b.height > 0)
        if (boxes.length === 0) return null
        const scale = viewRef.current.scale
        const pad = 30 * scale
        const x = Math.min(...boxes.map((b) => b.x)) - pad
        const y = Math.min(...boxes.map((b) => b.y)) - pad
        const width = Math.max(...boxes.map((b) => b.x + b.width)) + pad - x
        const height = Math.max(...boxes.map((b) => b.y + b.height)) + pad - y
        // 너무 큰 이미지가 되지 않도록 긴 변 8000px로 제한
        const pixelRatio = Math.min(2 / scale, 8000 / Math.max(width, height))

        const inv = stage.getAbsoluteTransform().copy().invert()
        const tl = inv.point({ x, y })
        const bg = new Konva.Layer({ listening: false })
        bg.add(new Konva.Rect({ x: tl.x, y: tl.y, width: width / scale, height: height / scale, fill: '#ffffff' }))
        stage.add(bg)
        bg.moveToBottom()
        grid.hide()
        try {
          return stage.toDataURL({ x, y, width, height, pixelRatio, mimeType: 'image/png' })
        } finally {
          bg.destroy()
          grid.show()
        }
      } finally {
        setRenderAll(false)
        ui.select(prevSelection)
      }
    })
    return () => registerCanvasExporter(null)
  }, [])

  // ---------------------------------------------------------------- 이벤트

  /** 휠 버튼 또는 Space+왼쪽 버튼이면 화면 이동을 시작하고 true */
  const tryStartPan = (evt: MouseEvent): boolean => {
    if (evt.button !== 1 && !(evt.button === 0 && spaceHeld)) return false
    evt.preventDefault() // 휠 버튼 자동 스크롤 방지
    panRef.current = { clientX: evt.clientX, clientY: evt.clientY, view: viewRef.current }
    setPanning(true)
    return true
  }

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = e.target.getStage()!
    const p = stage.getPointerPosition()!
    const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1
    setView(zoomAround(view, view.scale * factor, p))
  }

  const handleStageMouseDown = (e: KMouse) => {
    if (tryStartPan(e.evt)) return
    if (e.target !== e.target.getStage() || e.evt.button !== 0) return
    const ui = useUiStore.getState()
    if (ui.wireStart) {
      // 배선 중 빈 곳(배선 모드에서는 부품 사진 위도) 클릭 = 꺾임점 추가 (10단위 격자에 맞춤)
      ui.addWirePoint(snapPoint(toWorld(e.evt.clientX, e.evt.clientY)))
      return
    }
    if (ui.tool === 'wire') {
      // 배선 모드의 빈 곳 클릭은 선택 해제만 (선택 사각형은 선택 모드에서)
      ui.clearSelection()
      return
    }
    const at = toWorld(e.evt.clientX, e.evt.clientY)
    updateBand({ start: at, end: at, additive: e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey })
  }

  const handleMouseMove = (e: KMouse) => {
    if (!useUiStore.getState().wireStart) return
    setPointer(toWorld(e.evt.clientX, e.evt.clientY))
  }

  /** 배선 시작 또는 끝내기. 대상: 핀, 접속점, 기존 전선 위의 점 */
  const handleTarget = (target: WireTarget) => {
    const ui = useUiStore.getState()
    const start = ui.wireStart
    if (!start) {
      ui.setWireStart(target)
      ui.clearSelection()
      return
    }
    const points = ui.wirePoints
    ui.setWireStart(null)
    setPointer(null)
    setHoverSplit(null)
    if (!isSplitTarget(target) && targetKey(start) === targetKey(target)) return // 같은 핀 다시 클릭 = 취소
    const r = useProjectStore.getState().connect(start, target, { color: ui.wireColor, points, orthogonal: ui.wireOrthogonal })
    if (r.ok && r.wireId) ui.selectOne('wire', r.wireId)
    else if (!r.ok && r.error === 'duplicate') ui.notify(t('이미 연결되어 있습니다'))
    else if (!r.ok && r.error === 'same-pin') ui.notify(t('같은 곳끼리는 이을 수 없습니다'))
  }
  const handleTargetRef = useRef(handleTarget)
  handleTargetRef.current = handleTarget

  /** 부품·전선·접속점 공통: 휠 버튼/Space면 화면 이동, Ctrl/Shift면 선택 토글 */
  const itemMouseDown = (kind: ItemKind, id: string, e: KMouse) => {
    if (tryStartPan(e.evt)) {
      e.cancelBubble = true
      return
    }
    if (e.evt.button !== 0) return
    e.cancelBubble = true
    const ui = useUiStore.getState()
    const additive = e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey
    const list = kind === 'instance' ? ui.selection.instances : kind === 'wire' ? ui.selection.wires : kind === 'junction' ? ui.selection.junctions : ui.selection.notes
    if (additive) ui.toggle(kind, id)
    else if (!list.includes(id)) ui.selectOne(kind, id) // 이미 선택된 것을 누르면 선택 유지 → 함께 끌기
  }

  /** 드래그 없이 클릭만 했으면 그것 하나만 선택 */
  const itemClick = (kind: ItemKind, id: string, e: KMouse) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (e.evt.button !== 0 || e.evt.ctrlKey || e.evt.metaKey || e.evt.shiftKey) return
    if (useUiStore.getState().wireStart) return
    useUiStore.getState().selectOne(kind, id)
  }

  /**
   * 부품·글 상자를 끌기 시작: 잡은 것이 선택돼 있으면 선택한 부품·접속점·글 상자를 모두 함께, 아니면 그것만
   */
  const startGroupDrag = (kind: 'instance' | 'note', id: string) => {
    const sel = useUiStore.getState().selection
    const together = kind === 'instance' ? sel.instances.includes(id) : sel.notes.includes(id)
    const ids = together ? sel.instances : kind === 'instance' ? [id] : []
    const junctions = together ? sel.junctions : []
    const notes = together ? sel.notes : kind === 'note' ? [id] : []
    dragIdsRef.current = { instances: ids, junctions, notes }
    setDrag({ ids: new Set(ids), junctions: new Set(junctions), notes: new Set(notes), dx: 0, dy: 0 })
  }
  const endGroupDrag = (dx: number, dy: number) => {
    const { instances, junctions, notes } = dragIdsRef.current
    dragIdsRef.current = { instances: [], junctions: [], notes: [] }
    setDrag(null)
    useProjectStore.getState().moveInstances(instances, dx, dy, junctions, notes)
  }
  /**
   * 끄는 도형의 이동량. 격자 맞춤이 켜져 있으면(Alt를 누르면 반대로) 잡은 도형의 기준점을 격자에 맞춘다 (033).
   * 함께 옮기는 나머지는 같은 만큼 → 모양 유지
   */
  const snappedDelta = (origin: Point, e: KDrag) => {
    const { gridSnap, gridSize } = useSettingsStore.getState()
    let p = { x: e.target.x(), y: e.target.y() }
    if (gridSnap !== e.evt.altKey) {
      p = snapTo(p, gridSize)
      e.target.position(p)
    }
    return { dx: p.x - origin.x, dy: p.y - origin.y }
  }

  const apiRef = useRef<CanvasApi>(null!)
  apiRef.current = {
    itemMouseDown,
    itemClick,

    partDragStart: (inst) => startGroupDrag('instance', inst.id),
    partDragMove: (inst, e) => {
      const { dx, dy } = snappedDelta(inst, e)
      setDrag((d) => (d ? { ...d, dx, dy } : d))
    },
    partDragEnd: (inst, e) => {
      const { dx, dy } = snappedDelta(inst, e)
      endGroupDrag(dx, dy)
    },
    noteDragStart: (note) => startGroupDrag('note', note.id),
    noteDragMove: (note, e) => {
      const { dx, dy } = snappedDelta(note, e)
      setDrag((d) => (d ? { ...d, dx, dy } : d))
    },
    noteDragEnd: (note, e) => {
      const { dx, dy } = snappedDelta(note, e)
      endGroupDrag(dx, dy)
    },
    noteDblClick: (note, e) => {
      e.cancelBubble = true
      useUiStore.getState().selectOne('note', note.id)
      useUiStore.getState().setEditingNote(note.id)
    },

    wireMouseDown: (w, e) => {
      const ui = useUiStore.getState()
      if (ui.tool === 'select') {
        itemMouseDown('wire', w.id, e)
        return
      }
      if (tryStartPan(e.evt)) {
        e.cancelBubble = true
        return
      }
      if (e.evt.button !== 0) return
      e.cancelBubble = true
      if (ui.wireStart) {
        // 배선 중 전선을 클릭 = 그 자리에서 분기하며 연결 끝내기
        suppressClickRef.current = true
        handleTarget({ wireId: w.id, point: toWorld(e.evt.clientX, e.evt.clientY) })
        return
      }
      // 끌면 분기 시작(핀 위에서 놓으면 연결), 그냥 클릭해도 분기 시작
      const at = toWorld(e.evt.clientX, e.evt.clientY)
      branchRef.current = { wireId: w.id, clientX: e.evt.clientX, clientY: e.evt.clientY, at }
    },
    wireMouseMove: (path, e) => {
      const ui = useUiStore.getState()
      if (ui.tool !== 'wire') return
      const at = projectOnPath(path, toWorld(e.evt.clientX, e.evt.clientY)).point
      if (ui.wireStart) setHoverSplit(at)
      else if (!spaceHeld && e.evt.buttons === 0) setHoverBranch(at)
    },
    wireMouseLeave: (e) => {
      setCursor(e, '')
      setHoverSplit(null)
      setHoverBranch(null)
    },
    wireClick: (w, e) => {
      if (useUiStore.getState().tool === 'select') {
        itemClick('wire', w.id, e)
        return
      }
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      if (e.evt.button !== 0 || spaceHeld || useUiStore.getState().wireStart) return
      // 배선 모드에서 전선 클릭 = 그 자리에서 분기 시작
      branchRef.current = null
      setHoverBranch(null)
      handleTarget({ wireId: w.id, point: toWorld(e.evt.clientX, e.evt.clientY) })
      setPointer(toWorld(e.evt.clientX, e.evt.clientY))
    },
    wireDblClick: (w, nodes, e) => {
      // 선택 모드에서 선택된 전선을 더블클릭 = 그 자리에 꺾임점 추가
      if (useUiStore.getState().tool !== 'select') return
      if (!useUiStore.getState().selection.wires.includes(w.id)) return
      const at = toWorld(e.evt.clientX, e.evt.clientY)
      const index = nearestSegment(nodes, at)
      useProjectStore.getState().insertWirePoint(w.id, index, snapPoint(at))
    },
    bendDragMove: (wireId, index, e) => {
      const snapped = snapPoint({ x: e.target.x(), y: e.target.y() })
      e.target.position(snapped)
      handleDragRef.current = { wireId, index, p: snapped }
      setHandleDrag(handleDragRef.current)
    },
    bendDragEnd: () => {
      const h = handleDragRef.current
      handleDragRef.current = null
      setHandleDrag(null)
      if (h) useProjectStore.getState().moveWirePoint(h.wireId, h.index, h.p)
    },
    bendDblClick: (wireId, index, e) => {
      e.cancelBubble = true
      useProjectStore.getState().removeWirePoint(wireId, index)
    },

    pinMouseDown: (e) => {
      e.cancelBubble = true
      tryStartPan(e.evt)
    },
    pinClick: (target, e) => {
      e.cancelBubble = true
      if (e.evt.button === 0 && !spaceHeld) handleTarget(target)
    },
    pinEnter: (target, text, at, e) => {
      setCursor(e, 'pointer')
      hoverTargetRef.current = target
      setHoverPin({ text, at })
    },
    pinLeave: (e) => {
      setCursor(e, '')
      hoverTargetRef.current = null
      setHoverPin(null)
    },

    junctionMouseDown: (id, e) => {
      if (useUiStore.getState().tool === 'select') {
        itemMouseDown('junction', id, e)
        return
      }
      e.cancelBubble = true
      tryStartPan(e.evt)
    },
    junctionClick: (id, e) => {
      e.cancelBubble = true
      if (useUiStore.getState().tool === 'select') {
        itemClick('junction', id, e)
        return
      }
      if (e.evt.button !== 0 || spaceHeld) return
      handleTarget({ junctionId: id })
    },
    junctionDragMove: (id, e) => {
      const snapped = snapPoint({ x: e.target.x(), y: e.target.y() })
      e.target.position(snapped)
      junctionDragRef.current = { id, p: snapped }
      setJunctionDrag(junctionDragRef.current)
    },
    junctionDragEnd: () => {
      const d = junctionDragRef.current
      junctionDragRef.current = null
      setJunctionDrag(null)
      if (d) useProjectStore.getState().moveJunction(d.id, d.p)
    },
    junctionEnter: (id, e) => {
      setCursor(e, 'pointer')
      hoverTargetRef.current = { junctionId: id }
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    const partId = e.dataTransfer.getData(PART_DRAG_TYPE)
    const part = useLibraryStore.getState().parts.find((p) => p.id === partId)
    if (!part) return
    e.preventDefault()
    const raw = toWorld(e.clientX, e.clientY)
    const { gridSnap, gridSize } = useSettingsStore.getState()
    const at = gridSnap !== e.altKey ? snapTo(raw, gridSize) : raw
    const id = useProjectStore.getState().addPart(part, at.x, at.y)
    useUiStore.getState().selectOne('instance', id)
  }

  // ---------------------------------------------------------------- 그리기

  /** 그리는 중인 전선의 시작점 (분기면 기존 전선 위로 옮긴 점) */
  const startPos = (() => {
    if (!wireStart) return undefined
    if (!isSplitTarget(wireStart)) return endPos(wireStart)
    const g = shapes.find((x) => x.wire.id === wireStart.wireId)
    return g ? projectOnPath(g.path, wireStart.point).point : undefined
  })()
  /** 꺾임점 손잡이를 보여 줄 전선: 선택 모드에서 전선 하나만 선택했을 때 */
  const editableWireId =
    !wireMode && selection.wires.length === 1 && selection.instances.length === 0 && selection.junctions.length === 0 ? selection.wires[0] : null
  const bandRect = band && rectFromPoints(band.start, band.end)
  const cursorClass = panning ? ' panning' : spaceHeld ? ' pan-ready' : wireStart || wireMode ? ' wiring' : ''
  const startKey = targetKey(wireStart)

  /** 화면에 보이는 부품 (끄는 중인 부품은 늘 그린다) + 그 중심 */
  /** 크기 손잡이: 선택 모드에서 부품 하나 또는 글 상자 하나만 골랐을 때 */
  const resizeTarget = ((): ResizeTarget | null => {
    if (wireMode || drag || selectionCount(selection) !== 1) return null
    if (selection.instances.length === 1) {
      const inst = project.instances.find((i) => i.id === selection.instances[0])
      const part = inst && project.parts[inst.partId]
      if (!inst || !part) return null
      const b = instanceBounds(inst, part)
      // 선택 점선(부품 둘레 4) 모서리에 둔다
      const corners = [
        { x: b.x - 4, y: b.y - 4 },
        { x: b.x + b.width + 4, y: b.y - 4 },
        { x: b.x + b.width + 4, y: b.y + b.height + 4 },
        { x: b.x - 4, y: b.y + b.height + 4 }
      ]
      return { items: { instances: [inst.id] }, anchor: { x: inst.x, y: inst.y }, rect: b, corners, limit: (f) => clampScale(inst.scale * f) / inst.scale }
    }
    const n = selection.notes.length === 1 ? project.notes?.find((x) => x.id === selection.notes[0]) : undefined
    if (!n || editingNote === n.id) return null
    const { width, height } = noteSize(n)
    return {
      items: { notes: [n.id] },
      anchor: { x: n.x, y: n.y },
      rect: { x: n.x, y: n.y, width, height },
      corners: [{ x: n.x + width, y: n.y + height }],
      limit: (f) => resizedNote(n, f).width / n.width
    }
  })()
  const resizeFactor = resize?.factor ?? 1
  const resizingInstance = resize && resizeTarget?.items.instances?.[0]
  const resizingNote = resize && resizeTarget?.items.notes?.[0]

  const resizeMove = (corner: number, k: Point, e: KDrag) => {
    if (!resizeTarget) return
    const p = e.target.position()
    const a = resizeTarget.anchor
    const d = { x: k.x - a.x, y: k.y - a.y }
    // 손잡이를 anchor→모서리 방향으로 얼마나 옮겼나 (대각선에 투영)
    const raw = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (d.x * d.x + d.y * d.y)
    resizeRef.current = { corner, factor: resizeTarget.limit(Math.max(0.01, raw)) }
    setResize(resizeRef.current)
  }
  const resizeEnd = (k: Point, e: KDrag) => {
    e.target.position(k)
    const r = resizeRef.current
    resizeRef.current = null
    setResize(null)
    if (resizeTarget && r && Math.abs(r.factor - 1) > 1e-3) useProjectStore.getState().resizeItems(resizeTarget.items, r.factor)
  }

  const shownInstances = project.instances.flatMap((raw) => {
    // 크기 손잡이를 끄는 중이면 그 부품은 바뀔 크기로 그린다
    const inst = resizingInstance === raw.id ? { ...raw, scale: clampScale(raw.scale * resizeFactor) } : raw
    const part = project.parts[inst.partId]
    if (!part) return []
    const center = centerOf(inst, drag)
    const dragging = drag?.ids.has(inst.id) ?? false
    if (visible && !dragging && !rectsIntersect(visible, instanceBounds(inst, part))) return []
    return [{ inst, part, center }]
  })
  // 멀리서 볼 때 작은 것들은 생략 (내보내기는 늘 전부)
  const detail = renderAll || view.scale >= DETAIL_SCALE
  const shadow = renderAll || view.scale >= SHADOW_SCALE
  const shownWires = visible ? shapes.filter((s) => movingWires.has(s.wire.id) || rectsIntersect(visible, s.bounds)) : shapes

  return (
    <div
      ref={containerRef}
      className={`canvas${cursorClass}`}
      data-testid="diagram-canvas"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PART_DRAG_TYPE)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={handleDrop}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
    >
      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          onWheel={handleWheel}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleMouseMove}
        >
          <Layer listening={false}>
            <Grid view={view} width={size.width} height={size.height} step={gridStep} />
          </Layer>

          {/* 1. 부품 사진 (배선 모드에서는 누를 수 없음 → 클릭이 빈 곳처럼 꺾임점이 된다) */}
          <Layer listening={!wireMode}>
            {shownInstances.map(({ inst, part, center }) => (
              <PartNode
                key={inst.id}
                inst={inst}
                part={part}
                image={images[part.id]}
                center={center}
                selected={selectedInstances.has(inst.id)}
                draggable={!spaceHeld}
                shadow={shadow}
                api={apiRef}
              />
            ))}
          </Layer>

          {/* 2. 전선 (교차 점프 포함) + 선택된 전선의 꺾임점 손잡이 + 그리는 중인 전선.
              부품·접속점을 끄는 동안에는 클릭 판정용 그림(hit canvas)을 다시 그리지 않는다 (전선이 많으면 비싸다) */}
          <Layer listening={!drag && !junctionDrag}>
            {shownWires.map((s) => (
              <WireNode
                key={s.wire.id}
                shape={s}
                // 움직이는 전선의 점프는 놓은 뒤에 다시 계산한다
                hops={movingWires.has(s.wire.id) ? NO_HOPS : (scene.hops[s.wire.id] ?? NO_HOPS)}
                selected={selectedWires.has(s.wire.id)}
                editable={editableWireId === s.wire.id}
                handlesDraggable={editableWireId === s.wire.id && !spaceHeld}
                showLabel={detail}
                api={apiRef}
              />
            ))}
            {startPos && (pointer || wirePoints.length > 0) && (
              <>
                <Line
                  points={flatten(wirePath(startPos, wirePoints, pointer ?? wirePoints[wirePoints.length - 1], wireOrthogonal))}
                  stroke={wireColor}
                  strokeWidth={2}
                  dash={[6, 4]}
                  lineJoin="round"
                  listening={false}
                />
                {wirePoints.map((p, i) => (
                  <Circle key={i} x={p.x} y={p.y} radius={3.5} fill={wireColor} stroke="#fff" strokeWidth={1} listening={false} />
                ))}
              </>
            )}
          </Layer>

          {/* 2-1. 글 상자 (선택 모드에서 끌어 옮기고, 두 번 누르면 글 고치기) */}
          <Layer listening={!wireMode}>
            {(project.notes ?? []).map((n) => (
              <NoteNode
                key={n.id}
                note={resizingNote === n.id ? resizedNote(n, resizeFactor) : n}
                at={drag?.notes.has(n.id) ? { x: n.x + drag.dx, y: n.y + drag.dy } : n}
                selected={selectedNotes.has(n.id)}
                editing={editingNote === n.id}
                draggable={!spaceHeld && !wireMode && editingNote !== n.id}
                api={apiRef}
              />
            ))}
          </Layer>

          {/* 3. 핀, 접속점, 참조명, 선택 사각형 */}
          <Layer>
            {detail &&
              shownInstances.map(({ inst, part, center }) => (
                <PinsNode
                  key={inst.id}
                  inst={inst}
                  part={part}
                  center={center}
                  listening={wireMode}
                  startPinId={wireStart && !isSplitTarget(wireStart) && isPinEnd(wireStart) && wireStart.instanceId === inst.id ? wireStart.pinId : null}
                  api={apiRef}
                />
              ))}

            {/* 접속점: 선택 모드 = 클릭 선택·끌어서 이동, 배선 모드 = 클릭으로 배선 시작/끝 */}
            {(project.junctions ?? []).map((j) => {
              const p = endPos({ junctionId: j.id }) ?? j
              if (visible && !rectContainsPoint(visible, p) && junctionDragId !== j.id) return null
              return (
                <JunctionNode
                  key={j.id}
                  junction={j}
                  at={p}
                  selected={selectedJunctions.has(j.id)}
                  isStart={startKey === `j:${j.id}`}
                  color={jColors.get(j.id) ?? '#111'}
                  draggable={!spaceHeld && !wireMode}
                  showLabel={detail}
                  api={apiRef}
                />
              )
            })}

            {/* 분기 시작점 표시 (끝낼 때 여기에 접속점이 생긴다) */}
            {wireStart && isSplitTarget(wireStart) && startPos && (
              <Circle x={startPos.x} y={startPos.y} radius={JUNCTION_R + 1.5} fill={wireColor} stroke="#facc15" strokeWidth={3} listening={false} />
            )}
            {/* 배선 중 전선 위: 여기서 끝내면 생길 접속점 */}
            {wireStart && hoverSplit && (
              <Circle x={hoverSplit.x} y={hoverSplit.y} radius={JUNCTION_R + 1} stroke={wireColor} strokeWidth={2} fill="#fff" listening={false} />
            )}

            {/* 배선 모드, 그리는 중이 아닐 때 전선 위: 여기서 클릭·끌면 분기 */}
            {wireMode && !wireStart && hoverBranch && !drag && (
              <Group x={hoverBranch.x} y={hoverBranch.y} listening={false}>
                <Circle radius={JUNCTION_R + 1} stroke="#2563eb" strokeWidth={2} fill="#fff" />
                <Label y={-JUNCTION_R - 4}>
                  <Tag fill="#111827" opacity={0.9} cornerRadius={3} pointerDirection="down" pointerWidth={8} pointerHeight={5} />
                  <Text text={t('클릭·끌어서 분기')} fontSize={11} padding={4} fill="#fff" />
                </Label>
              </Group>
            )}
            {hoverPin && !drag && (
              <Label x={hoverPin.at.x} y={hoverPin.at.y - PIN_R - 4} listening={false}>
                <Tag fill="#111827" opacity={0.9} cornerRadius={3} pointerDirection="down" pointerWidth={8} pointerHeight={5} />
                <Text text={hoverPin.text} fontSize={12} padding={4} fill="#fff" />
              </Label>
            )}
            {resizeTarget && (
              <>
                {resize && (
                  <Rect
                    {...scaleRect(resizeTarget.rect, resizeTarget.anchor, resizeFactor)}
                    stroke="#2563eb"
                    strokeWidth={1 / view.scale}
                    dash={[4 / view.scale, 3 / view.scale]}
                    listening={false}
                  />
                )}
                {resizeTarget.corners.map((k, i) =>
                  resize && resize.corner !== i ? null : (
                    <Rect
                      key={i}
                      name="resize-handle"
                      x={k.x}
                      y={k.y}
                      width={RESIZE_HANDLE / view.scale}
                      height={RESIZE_HANDLE / view.scale}
                      offsetX={RESIZE_HANDLE / view.scale / 2}
                      offsetY={RESIZE_HANDLE / view.scale / 2}
                      fill="#fff"
                      stroke="#2563eb"
                      strokeWidth={1.5 / view.scale}
                      draggable={!spaceHeld}
                      onMouseDown={(e) => apiRef.current.pinMouseDown(e)}
                      onMouseEnter={(e) =>
                        setCursor(e, (k.x - resizeTarget.anchor.x) * (k.y - resizeTarget.anchor.y) > 0 ? 'nwse-resize' : 'nesw-resize')
                      }
                      onMouseLeave={(e) => setCursor(e, '')}
                      onDragMove={(e) => resizeMove(i, k, e)}
                      onDragEnd={(e) => resizeEnd(k, e)}
                    />
                  )
                )}
              </>
            )}
            {bandRect && (
              <Rect
                {...bandRect}
                fill="rgba(37, 99, 235, 0.08)"
                stroke="#2563eb"
                strokeWidth={1 / view.scale}
                dash={[4 / view.scale, 3 / view.scale]}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      )}
      {editingNote && <NoteEditor id={editingNote} view={view} />}
    </div>
  )
}

/** 글 상자 글 고치기: 그 자리에 여러 줄 입력칸. Enter는 줄바꿈, Ctrl+Enter·다른 곳 누르기 = 적용, Esc = 취소. 비우면 글 상자를 지운다 */
function NoteEditor({ id, view }: { id: string; view: View }) {
  const note = useProjectStore((s) => s.project.notes?.find((n) => n.id === id))
  const [text, setText] = useState(note?.text ?? '')
  const done = useRef(false)
  if (!note) return null
  const finish = (apply: boolean) => {
    if (done.current) return
    done.current = true
    const ui = useUiStore.getState()
    ui.setEditingNote(null)
    if (!apply) return
    if (!text.trim()) {
      useProjectStore.getState().removeItems({ instances: [], wires: [], notes: [id] })
      ui.clearSelection()
    } else useProjectStore.getState().updateNote(id, { text })
  }
  const font = noteFont(note) * view.scale
  return (
    <textarea
      className="note-editor"
      aria-label={t('글 상자 글')}
      autoFocus
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') finish(false)
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true)
      }}
      style={{
        left: view.x + note.x * view.scale,
        top: view.y + note.y * view.scale,
        width: note.width * view.scale,
        minHeight: font * 1.3 + 2 * NOTE_PADDING * view.scale,
        fontSize: font,
        padding: NOTE_PADDING * view.scale,
        color: note.color ?? NOTE_DEFAULT_COLOR
      }}
    />
  )
}

// ---------------------------------------------------------------- 도형 (바뀐 것만 다시 그리도록 memo)

/** 부품 사진 한 장 */
const PartNode = memo(function PartNode(props: {
  inst: PartInstance
  part: PartDef
  image: HTMLImageElement | undefined
  center: Point
  selected: boolean
  draggable: boolean
  shadow: boolean
  api: Api
}) {
  const { inst, part, image, center, selected, draggable, shadow, api } = props
  const { width, height } = partSize(part, inst.scale)
  return (
    <Group
      x={center.x}
      y={center.y}
      offsetX={width / 2}
      offsetY={height / 2}
      rotation={inst.rotation}
      scaleX={inst.flipped ? -1 : 1}
      draggable={draggable}
      onMouseDown={(e) => api.current.itemMouseDown('instance', inst.id, e)}
      onClick={(e) => api.current.itemClick('instance', inst.id, e)}
      onDragStart={() => api.current.partDragStart(inst)}
      onDragMove={(e) => api.current.partDragMove(inst, e)}
      onDragEnd={(e) => api.current.partDragEnd(inst, e)}
    >
      <Rect
        width={width}
        height={height}
        fill="#fff"
        shadowEnabled={shadow}
        shadowBlur={4}
        shadowOpacity={0.15}
        shadowForStrokeEnabled={false}
        perfectDrawEnabled={false}
      />
      {image && <KImage image={image} width={width} height={height} perfectDrawEnabled={false} />}
      {selected && <Rect x={-4} y={-4} width={width + 8} height={height + 8} stroke="#2563eb" strokeWidth={2} dash={[6, 4]} />}
    </Group>
  )
})

/** 전선 하나 (선택 표시·라벨·꺾임점 손잡이 포함) */
const WireNode = memo(function WireNode(props: {
  shape: WireShape
  hops: Hop[]
  selected: boolean
  editable: boolean
  handlesDraggable: boolean
  showLabel: boolean
  api: Api
}) {
  const { shape, hops, selected, editable, handlesDraggable, showLabel, api } = props
  const { wire: w, a, b, pts, path } = shape
  const ops = useMemo(() => hopDrawOps(path, hops), [path, hops])
  const mid = useMemo(() => pathMidpoint(path), [path])
  return (
    <Group>
      {selected && (
        <Shape
          sceneFunc={(ctx, s) => {
            traceOps(ctx, ops)
            ctx.strokeShape(s)
          }}
          stroke="#2563eb"
          strokeWidth={w.width + 6}
          opacity={0.35}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}
      <Shape
        name="wire"
        sceneFunc={(ctx, s) => {
          traceOps(ctx, ops)
          ctx.strokeShape(s)
        }}
        stroke={w.color}
        strokeWidth={w.width}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={Math.max(12, w.width + 8)}
        shadowColor="#000"
        shadowBlur={w.color === '#f5f5f5' ? 2 : 0}
        onMouseDown={(e) => api.current.wireMouseDown(w, e)}
        onMouseMove={(e) => api.current.wireMouseMove(path, e)}
        onMouseEnter={(e) => setCursor(e, useUiStore.getState().tool === 'wire' ? 'crosshair' : 'pointer')}
        onMouseLeave={(e) => api.current.wireMouseLeave(e)}
        onClick={(e) => api.current.wireClick(w, e)}
        onDblClick={(e) => api.current.wireDblClick(w, [a, ...pts, b], e)}
      />
      {w.label && showLabel && (
        <Label x={mid.x} y={mid.y} listening={false}>
          <Tag fill="#fff" stroke={w.color} cornerRadius={3} pointerDirection="down" pointerWidth={6} pointerHeight={4} />
          <Text text={w.label} fontSize={11} padding={3} fill="#111" />
        </Label>
      )}
      {editable &&
        pts.map((p, index) => (
          <Rect
            key={index}
            name="bend-handle"
            x={p.x}
            y={p.y}
            width={10}
            height={10}
            offsetX={5}
            offsetY={5}
            fill="#fff"
            stroke="#2563eb"
            strokeWidth={2}
            draggable={handlesDraggable}
            onMouseDown={(e) => api.current.pinMouseDown(e)}
            onDragMove={(e) => api.current.bendDragMove(w.id, index, e)}
            onDragEnd={() => api.current.bendDragEnd()}
            onDblClick={(e) => api.current.bendDblClick(w.id, index, e)}
            onMouseEnter={(e) => setCursor(e, 'move')}
            onMouseLeave={(e) => setCursor(e, '')}
          />
        ))}
    </Group>
  )
})

/** 부품 하나의 참조명과 핀들 */
const PinsNode = memo(function PinsNode(props: {
  inst: PartInstance
  part: PartDef
  center: Point
  listening: boolean
  /** 배선을 이 부품의 이 핀에서 시작했으면 그 핀 id */
  startPinId: string | null
  api: Api
}) {
  const { inst, part, center, listening, startPinId, api } = props
  const { width, height } = partSize(part, inst.scale)
  const r = (inst.rotation * Math.PI) / 180
  const halfH = Math.abs(Math.sin(r)) * (width / 2) + Math.abs(Math.cos(r)) * (height / 2)
  return (
    <Group>
      <Text
        text={inst.refDes}
        x={center.x - 60}
        y={center.y - halfH - 20}
        width={120}
        align="center"
        fontSize={14}
        fontStyle="bold"
        fill="#1f2328"
        listening={false}
      />
      {part.pins.map((pin) => {
        const p = pinWorldPosition(inst, part, pin, center)
        const ref = { instanceId: inst.id, pinId: pin.id }
        const isStart = startPinId === pin.id
        return (
          <Circle
            key={pin.id}
            name="pin"
            x={p.x}
            y={p.y}
            radius={isStart ? PIN_R + 2 : PIN_R}
            fill={connectorColor(part.connectors, pin.connectorId)}
            stroke={isStart ? '#facc15' : '#fff'}
            strokeWidth={isStart ? 3 : 1.5}
            hitStrokeWidth={8}
            perfectDrawEnabled={false}
            // 선택 모드에서는 핀을 누르면 부품을 누른 것과 같다 (고르기·끌기)
            listening={listening}
            onMouseDown={(e) => api.current.pinMouseDown(e)}
            onClick={(e) => api.current.pinClick(ref, e)}
            onMouseEnter={(e) => {
              const conn = part.connectors.find((c) => c.id === pin.connectorId)
              const text = `${inst.refDes}.${conn ? `${conn.name}.` : ''}${pin.number}${pin.signal ? ` ${pin.signal}` : ''}`
              api.current.pinEnter(ref, text, p, e)
            }}
            onMouseLeave={(e) => api.current.pinLeave(e)}
          />
        )
      })}
    </Group>
  )
})

/** 접속점 하나 */
const JunctionNode = memo(function JunctionNode(props: {
  junction: Junction
  at: Point
  selected: boolean
  isStart: boolean
  color: string
  draggable: boolean
  showLabel: boolean
  api: Api
}) {
  const { junction: j, at, selected, isStart, color, draggable, showLabel, api } = props
  return (
    <Group
      name="junction"
      x={at.x}
      y={at.y}
      draggable={draggable}
      onMouseDown={(e) => api.current.junctionMouseDown(j.id, e)}
      onClick={(e) => api.current.junctionClick(j.id, e)}
      onDragMove={(e) => api.current.junctionDragMove(j.id, e)}
      onDragEnd={() => api.current.junctionDragEnd()}
      onMouseEnter={(e) => api.current.junctionEnter(j.id, e)}
      onMouseLeave={(e) => api.current.pinLeave(e)}
    >
      {selected && <Circle radius={JUNCTION_R + 5} stroke="#2563eb" strokeWidth={2} dash={[3, 2]} listening={false} />}
      <Circle
        radius={isStart ? JUNCTION_R + 1.5 : JUNCTION_R}
        fill={color}
        stroke={isStart ? '#facc15' : '#fff'}
        strokeWidth={isStart ? 3 : 1.2}
        hitStrokeWidth={10}
      />
      {showLabel && <Text text={j.label} x={6} y={-15} fontSize={10} fill="#555" listening={false} />}
    </Group>
  )
})

/** 현재 보이는 영역에만 점 격자를 그린다 */
/** 글 상자: 연한 노랑 바탕에 글. 너비는 고정, 높이는 글에 맞춘다 (Label이 Text 크기를 따라간다) */
const NoteNode = memo(function NoteNode(props: { note: Note; at: Point; selected: boolean; editing: boolean; draggable: boolean; api: Api }) {
  const { note, at, selected, editing, draggable, api } = props
  return (
    <Group
      x={at.x}
      y={at.y}
      draggable={draggable}
      opacity={editing ? 0 : 1}
      onMouseDown={(e) => api.current.itemMouseDown('note', note.id, e)}
      onClick={(e) => api.current.itemClick('note', note.id, e)}
      onDblClick={(e) => api.current.noteDblClick(note, e)}
      onDragStart={() => api.current.noteDragStart(note)}
      onDragMove={(e) => api.current.noteDragMove(note, e)}
      onDragEnd={(e) => api.current.noteDragEnd(note, e)}
    >
      <Label>
        <Tag fill="#fff8c5" stroke={selected ? '#2563eb' : '#e3c84b'} strokeWidth={selected ? 2 : 1} dash={selected ? [6, 4] : undefined} cornerRadius={4} />
        <Text
          text={note.text || ' '}
          width={note.width}
          padding={NOTE_PADDING}
          fontSize={noteFont(note)}
          lineHeight={1.3}
          fill={note.color ?? NOTE_DEFAULT_COLOR}
          wrap="char"
        />
      </Label>
    </Group>
  )
})

function Grid({ view, width, height, step: base }: { view: View; width: number; height: number; step: number }) {
  return (
    <Shape
      sceneFunc={(ctx) => {
        let step = base
        while (step * view.scale < 10) step *= 5
        const left = -view.x / view.scale
        const top = -view.y / view.scale
        const right = left + width / view.scale
        const bottom = top + height / view.scale
        const r = 1 / view.scale
        ctx.fillStyle = '#c3c8d0'
        for (let x = Math.floor(left / step) * step; x <= right; x += step) {
          for (let y = Math.floor(top / step) * step; y <= bottom; y += step) {
            ctx.fillRect(x - r, y - r, r * 2, r * 2)
          }
        }
      }}
    />
  )
}
