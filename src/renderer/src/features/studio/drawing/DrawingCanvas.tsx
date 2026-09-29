import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Arrow, Circle, Ellipse, Group, Image as KImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva'
import Konva from 'konva'
import type { Drawing, Pin, Shape } from '@core/model'
import { shapesInBox, updateShape } from '@core/drawing'
import { ellipseConfig, imageConfig, lineConfig, loadDrawingImages, rectConfig, textConfig } from './shapeNodes'
import { useT } from '@/i18n'

export type DrawTool = 'select' | 'rect' | 'ellipse' | 'line' | 'text'

/** 그림판 둘레 여백 (화면 px) */
const PAD = 32
/** 이만큼 안 움직였으면 끌기가 아니라 클릭 */
const CLICK_PX = 4
const GRID = 10

interface Point {
  x: number
  y: number
}

interface Props {
  drawing: Drawing
  pins: readonly Pin[]
  tool: DrawTool
  selected: readonly string[]
  grid: boolean
  /** 한 동작이 끝났을 때 (실행 취소 1회) */
  onCommit: (next: Drawing) => void
  onSelect: (ids: string[]) => void
  /** 도형을 하나 만들었으니 선택 도구로 */
  onToolDone: () => void
  /** 글상자 글을 고치고 싶다 (만들었거나 두 번 눌렀음) */
  onEditText: (id: string) => void
  /** 새 도형 id */
  makeId: () => string
  /** 꺾은선을 끝내라는 신호 (Enter, 바뀔 때마다 번호가 오름) */
  finishLineSignal: number
  cancelSignal: number
}

/** 투명 배경을 나타내는 바둑판 무늬 */
function checkerPattern(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 16, 16)
  g.fillStyle = '#eceff1'
  g.fillRect(0, 0, 8, 8)
  g.fillRect(8, 8, 8, 8)
  return c
}

const snapTo = (v: number, on: boolean) => (on ? Math.round(v / GRID) * GRID : v)

/** 45° 단위로 꺾기 (Shift) */
function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len }
}

const DEFAULT_FILL = '#e0e0e0'
const DEFAULT_STROKE = '#424242'

/** 새 상자·원 (시작점 a, 끝점 b) */
function boxShape(type: 'rect' | 'ellipse', id: string, a: Point, b: Point, square: boolean): Shape {
  let w = Math.abs(b.x - a.x)
  let h = Math.abs(b.y - a.y)
  if (square) w = h = Math.max(w, h)
  const x = b.x < a.x ? a.x - w : a.x
  const y = b.y < a.y ? a.y - h : a.y
  return { id, type, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), fill: DEFAULT_FILL, stroke: DEFAULT_STROKE, strokeWidth: 2 }
}

function lineShape(id: string, pts: readonly Point[]): Shape {
  const o = pts[0]!
  return {
    id,
    type: 'line',
    x: Math.round(o.x),
    y: Math.round(o.y),
    points: pts.flatMap((p) => [Math.round(p.x - o.x), Math.round(p.y - o.y)]),
    stroke: DEFAULT_STROKE,
    strokeWidth: 3
  }
}

/** 도형 하나 (memo: 다른 도형이 바뀌어도 다시 그리지 않는다) */
const ShapeView = memo(function ShapeView({
  shape,
  image,
  interactive,
  onDown,
  onDblClick
}: {
  shape: Shape
  image: HTMLImageElement | undefined
  interactive: boolean
  onDown: (e: Konva.KonvaEventObject<MouseEvent>, id: string) => void
  onDblClick: (id: string) => void
}) {
  const common = {
    id: `s-${shape.id}`,
    name: 'shape',
    listening: interactive,
    draggable: interactive,
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => onDown(e, shape.id),
    onDblClick: () => onDblClick(shape.id),
    perfectDrawEnabled: false
  }
  switch (shape.type) {
    case 'rect':
      return <Rect {...rectConfig(shape)} {...common} />
    case 'ellipse':
      return <Ellipse {...ellipseConfig(shape)} {...common} />
    case 'line':
      return <Arrow {...lineConfig(shape)} {...common} />
    case 'text':
      return <Text {...textConfig(shape)} {...common} />
    case 'image':
      return <KImage {...imageConfig(shape, image)} {...common} />
  }
})

/**
 * 그림판 (037b): 도형 그리기·고르기·옮기기·크기·회전.
 * 마우스 제스처 중 읽는 값은 ref로 둔다 (이벤트가 렌더보다 빨리 올 수 있다, 005)
 */
export function DrawingCanvas(p: Props) {
  const t = useT()
  const boxRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const [size, setSize] = useState({ width: 600, height: 400 })
  const [zoom, setZoom] = useState<{ scale: number; x: number; y: number } | null>(null)
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map())
  const [preview, setPreview] = useState<Shape | null>(null)
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null)
  const [linePts, setLinePts] = useState<Point[] | null>(null)
  const [hover, setHover] = useState<Point | null>(null)
  const checker = useMemo(checkerPattern, [])

  const props = useRef(p)
  props.current = p
  /** 누르고 있는 동안의 제스처 */
  const gesture = useRef<{ kind: 'create' | 'marquee' | 'line'; start: Point; screen: Point } | null>(null)
  /** 끌기: 잡은 도형 id와 같이 움직일 노드들의 처음 자리 */
  const dragStart = useRef<{ lead: string; nodes: Map<string, { node: Konva.Node; x: number; y: number }> } | null>(null)
  const lineRef = useRef<Point[] | null>(null)
  lineRef.current = linePts

  const d = p.drawing
  // 창 크기
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // 사진 도형의 그림 읽기 (사진 목록이 바뀔 때만)
  const imageSrcs = d.shapes.flatMap((s) => (s.type === 'image' ? [s.src] : []))
  const imageKey = imageSrcs.map((s) => s.length + s.slice(-32)).join('|')
  const drawingRef = useRef(d)
  drawingRef.current = d
  useEffect(() => {
    let cancelled = false
    loadDrawingImages(drawingRef.current).then((m) => !cancelled && setImages(m), () => {})
    return () => {
      cancelled = true
    }
  }, [imageKey])

  // 그림판을 화면에 맞추는 배율 (사용자가 휠로 바꾸기 전까지)
  const fit = useMemo(() => {
    const scale = Math.min((size.width - PAD * 2) / d.width, (size.height - PAD * 2) / d.height, 4)
    return { scale, x: (size.width - d.width * scale) / 2, y: (size.height - d.height * scale) / 2 }
  }, [size, d.width, d.height])
  const view = zoom ?? fit
  const viewRef = useRef(view)
  viewRef.current = view

  /** 화면 포인터 → 그림판 좌표 */
  const toBoard = (): Point | null => {
    const pos = stageRef.current?.getPointerPosition()
    if (!pos) return null
    const v = viewRef.current
    return { x: (pos.x - v.x) / v.scale, y: (pos.y - v.y) / v.scale }
  }

  // 변형 손잡이: 고른 도형 중 잠기지 않은 것
  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    // 노드를 한 번에 모아 id로 찾는다 (고른 것마다 findOne을 부르면 도형 수의 제곱)
    const byId = new Map(stage.find('.shape').map((n) => [n.id().slice(2), n] as const))
    const locked = new Set(d.shapes.filter((s) => s.locked).map((s) => s.id))
    const nodes = p.tool === 'select' ? p.selected.flatMap((id) => (locked.has(id) ? [] : [byId.get(id)].filter((n) => n !== undefined))) : []
    tr.nodes(nodes)
    // 글상자는 너비만 (글자 크기는 속성 칸에서)
    const onlyText = nodes.length === 1 && d.shapes.find((x) => x.id === p.selected[0])?.type === 'text'
    tr.enabledAnchors(onlyText ? ['middle-left', 'middle-right'] : ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center', 'middle-left', 'middle-right'])
    tr.getLayer()?.batchDraw()
  }, [p.selected, p.tool, d])

  // 꺾은선 끝내기 (Enter) / 취소 (Esc)
  const finishLine = () => {
    const pts = lineRef.current
    setLinePts(null)
    setHover(null)
    if (!pts || pts.length < 2) return
    const shape = lineShape(props.current.makeId(), pts)
    props.current.onCommit({ ...props.current.drawing, shapes: [...props.current.drawing.shapes, shape] })
    props.current.onSelect([shape.id])
    props.current.onToolDone()
  }
  const finishRef = useRef(finishLine)
  finishRef.current = finishLine
  useEffect(() => {
    if (p.finishLineSignal) finishRef.current()
  }, [p.finishLineSignal])
  useEffect(() => {
    setLinePts(null)
    setPreview(null)
    setMarquee(null)
    gesture.current = null
  }, [p.cancelSignal, p.tool])

  const onShapeDown = (e: Konva.KonvaEventObject<MouseEvent>, id: string) => {
    const cur = props.current
    if (cur.tool !== 'select' || e.evt.button !== 0) return
    e.cancelBubble = true
    const shift = e.evt.shiftKey || e.evt.ctrlKey
    if (shift) cur.onSelect(cur.selected.includes(id) ? cur.selected.filter((x) => x !== id) : [...cur.selected, id])
    else if (!cur.selected.includes(id)) cur.onSelect([id])
  }

  const onShapeDblClick = (id: string) => {
    const s = props.current.drawing.shapes.find((x) => x.id === id)
    if (s?.type === 'text') props.current.onEditText(id)
  }

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const cur = props.current
    if (e.evt.button !== 0) return
    const b = toBoard()
    if (!b) return
    const screen = { x: e.evt.clientX, y: e.evt.clientY }
    const at = { x: snapTo(b.x, cur.grid), y: snapTo(b.y, cur.grid) }
    // 변형 손잡이를 잡은 것은 Transformer가 처리
    if (e.target.getParent()?.className === 'Transformer') return
    switch (cur.tool) {
      case 'select':
        gesture.current = { kind: 'marquee', start: b, screen }
        setMarquee({ a: b, b })
        return
      case 'rect':
      case 'ellipse':
        gesture.current = { kind: 'create', start: at, screen }
        setPreview(boxShape(cur.tool, 'preview', at, at, false))
        return
      case 'text': {
        const id = cur.makeId()
        const shape: Shape = { id, type: 'text', x: Math.round(at.x), y: Math.round(at.y), w: 160, text: t('글자'), fontSize: 18, color: '#212121' }
        cur.onCommit({ ...cur.drawing, shapes: [...cur.drawing.shapes, shape] })
        cur.onSelect([id])
        cur.onToolDone()
        cur.onEditText(id)
        return
      }
      case 'line': {
        const pts = lineRef.current
        if (!pts) {
          gesture.current = { kind: 'line', start: at, screen }
          setLinePts([at])
        } else {
          const last = pts[pts.length - 1]!
          const next = e.evt.shiftKey ? snapAngle(last, at) : at
          setLinePts([...pts, next])
        }
        return
      }
    }
  }

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const cur = props.current
    const b = toBoard()
    if (!b) return
    const at = { x: snapTo(b.x, cur.grid), y: snapTo(b.y, cur.grid) }
    const g = gesture.current
    if (lineRef.current) {
      const last = lineRef.current[lineRef.current.length - 1]!
      setHover(e.evt.shiftKey ? snapAngle(last, at) : at)
    }
    if (!g) return
    if (g.kind === 'marquee') setMarquee({ a: g.start, b })
    else if (g.kind === 'create' && (cur.tool === 'rect' || cur.tool === 'ellipse')) setPreview(boxShape(cur.tool, 'preview', g.start, at, e.evt.shiftKey))
  }

  const onMouseUp = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const cur = props.current
    const g = gesture.current
    gesture.current = null
    if (!g) return
    const b = toBoard() ?? g.start
    const at = { x: snapTo(b.x, cur.grid), y: snapTo(b.y, cur.grid) }
    const moved = Math.hypot(e.evt.clientX - g.screen.x, e.evt.clientY - g.screen.y) > CLICK_PX
    if (g.kind === 'marquee') {
      setMarquee(null)
      const box = { x: Math.min(g.start.x, b.x), y: Math.min(g.start.y, b.y), width: Math.abs(b.x - g.start.x), height: Math.abs(b.y - g.start.y) }
      const shift = e.evt.shiftKey || e.evt.ctrlKey
      if (!moved) {
        if (!shift) cur.onSelect([])
        return
      }
      const inside = shapesInBox(cur.drawing, box)
      cur.onSelect(shift ? [...new Set([...cur.selected, ...inside])] : inside)
      return
    }
    if (g.kind === 'create' && (cur.tool === 'rect' || cur.tool === 'ellipse')) {
      setPreview(null)
      // 클릭만 했으면 기본 크기
      const end = moved ? at : { x: g.start.x + (cur.tool === 'rect' ? 100 : 80), y: g.start.y + (cur.tool === 'rect' ? 60 : 80) }
      const shape = boxShape(cur.tool, cur.makeId(), g.start, end, moved && e.evt.shiftKey)
      if ((shape.type === 'rect' || shape.type === 'ellipse') && (shape.w < 1 || shape.h < 1)) return
      cur.onCommit({ ...cur.drawing, shapes: [...cur.drawing.shapes, shape] })
      cur.onSelect([shape.id])
      cur.onToolDone()
      return
    }
    if (g.kind === 'line' && moved) {
      // 끌어서 그은 직선은 바로 끝
      const end = e.evt.shiftKey ? snapAngle(g.start, at) : at
      lineRef.current = [g.start, end]
      finishLine()
    }
  }

  const onDblClick = () => {
    const pts = lineRef.current
    if (!pts) return
    // 두 번 클릭하면 같은 자리 점이 하나 더 찍혔다 → 빼고 끝낸다
    const last = pts[pts.length - 1]!
    const prev = pts[pts.length - 2]
    if (prev && Math.hypot(last.x - prev.x, last.y - prev.y) < 1) lineRef.current = pts.slice(0, -1)
    finishLine()
  }

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const pos = stageRef.current?.getPointerPosition()
    if (!pos) return
    const v = viewRef.current
    const scale = Math.min(20, Math.max(0.05, v.scale * (e.evt.deltaY < 0 ? 1.15 : 1 / 1.15)))
    const bx = (pos.x - v.x) / v.scale
    const by = (pos.y - v.y) / v.scale
    setZoom({ scale, x: pos.x - bx * scale, y: pos.y - by * scale })
  }

  // ---- 끌어 옮기기: 고른 것 모두 같이, 격자에 맞춤, 놓으면 한 번에 반영
  const onDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target
    if (node.name() !== 'shape') return
    const id = node.id().slice(2)
    const cur = props.current
    const ids = cur.selected.includes(id) ? cur.selected : [id]
    const want = new Set(ids)
    // 끄는 동안 쓸 노드와 처음 자리를 한 번만 모은다
    const nodes = new Map<string, { node: Konva.Node; x: number; y: number }>()
    for (const n of stageRef.current!.find('.shape')) {
      const nid = n.id().slice(2)
      if (want.has(nid)) nodes.set(nid, { node: n, x: n.x(), y: n.y() })
    }
    dragStart.current = { lead: id, nodes }
  }
  const onDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target
    const g = dragStart.current
    // 변형 손잡이가 같이 움직이는 다른 도형에도 dragmove가 온다 → 잡은 도형 것만 처리
    if (!g || node.name() !== 'shape' || node.id().slice(2) !== g.lead) return
    const s0 = g.nodes.get(g.lead)
    if (!s0) return
    const grid = props.current.grid
    const x = snapTo(node.x(), grid)
    const y = snapTo(node.y(), grid)
    node.position({ x, y })
    const dx = x - s0.x
    const dy = y - s0.y
    for (const [other, o] of g.nodes) if (other !== g.lead) o.node.position({ x: o.x + dx, y: o.y + dy })
  }
  const onDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target
    const g = dragStart.current
    if (!g || node.name() !== 'shape' || node.id().slice(2) !== g.lead) return
    dragStart.current = null
    const starts = g.nodes
    const s0 = starts.get(g.lead)
    if (!s0) return
    const dx = Math.round(node.x() - s0.x)
    const dy = Math.round(node.y() - s0.y)
    if (!dx && !dy) return
    const cur = props.current
    const set = new Set(starts.keys())
    cur.onCommit({ ...cur.drawing, shapes: cur.drawing.shapes.map((s) => (set.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s)) })
  }

  // ---- 크기·회전 (Transformer): 비율을 도형 크기로 바꾸고 배율은 1로
  const onTransformEnd = () => {
    const cur = props.current
    let next = cur.drawing
    for (const node of trRef.current?.nodes() ?? []) {
      const id = node.id().slice(2)
      const s = next.shapes.find((x) => x.id === id)
      if (!s) continue
      const sx = node.scaleX()
      const sy = node.scaleY()
      node.scale({ x: 1, y: 1 })
      const base = { x: Math.round(node.x()), y: Math.round(node.y()), rotation: Math.round(node.rotation() * 10) / 10 || undefined }
      switch (s.type) {
        case 'line':
          next = updateShape(next, id, { ...base, points: s.points.map((v, i) => Math.round(v * (i % 2 ? sy : sx))) })
          break
        case 'text':
          next = updateShape(next, id, { ...base, w: Math.max(10, Math.round(s.w * sx)) })
          break
        default:
          next = updateShape(next, id, { ...base, w: Math.max(1, Math.round(s.w * sx)), h: Math.max(1, Math.round(s.h * sy)) })
      }
    }
    if (next !== cur.drawing) cur.onCommit(next)
  }

  const interactive = p.tool === 'select'
  const pinR = 5 / view.scale
  const linePreview = linePts ? [...linePts, ...(hover ? [hover] : [])] : null

  return (
    <div ref={boxRef} className="drawing-canvas" data-testid="drawing-canvas" data-tool={p.tool}>
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDblClick={onDblClick}
        onWheel={onWheel}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      >
        <Layer>
          <Group x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
            <Rect
              name="artboard"
              width={d.width}
              height={d.height}
              fill={d.background}
              fillPatternImage={d.background ? undefined : (checker as unknown as HTMLImageElement)}
              shadowColor="#000"
              shadowOpacity={0.15}
              shadowBlur={12}
              listening={false}
            />
            {d.shapes.map((s) => (
              <ShapeView
                key={s.id}
                shape={s}
                image={s.type === 'image' ? images.get(s.src) : undefined}
                interactive={interactive && !s.locked}
                onDown={onShapeDown}
                onDblClick={onShapeDblClick}
              />
            ))}
            {/* 그림판 테두리 (밖으로 나간 부분은 PNG에 들어가지 않는다) */}
            <Rect width={d.width} height={d.height} stroke="#90a4ae" strokeWidth={1 / view.scale} dash={[4 / view.scale, 4 / view.scale]} listening={false} />
            {p.pins.map((pin) => (
              <Circle key={pin.id} x={pin.x * d.width} y={pin.y * d.height} radius={pinR} fill="#e53935" stroke="#fff" strokeWidth={1.5 / view.scale} opacity={0.85} listening={false} />
            ))}
            {preview && (preview.type === 'rect' ? <Rect {...rectConfig(preview)} listening={false} opacity={0.7} /> : preview.type === 'ellipse' ? <Ellipse {...ellipseConfig(preview)} listening={false} opacity={0.7} /> : null)}
            {linePreview && linePreview.length > 0 && (
              <Line points={linePreview.flatMap((q) => [q.x, q.y])} stroke={DEFAULT_STROKE} strokeWidth={3} dash={[6, 4]} lineCap="round" listening={false} />
            )}
            {marquee && (
              <Rect
                x={Math.min(marquee.a.x, marquee.b.x)}
                y={Math.min(marquee.a.y, marquee.b.y)}
                width={Math.abs(marquee.b.x - marquee.a.x)}
                height={Math.abs(marquee.b.y - marquee.a.y)}
                fill="rgba(37, 99, 235, 0.08)"
                stroke="#2563eb"
                strokeWidth={1 / view.scale}
                listening={false}
              />
            )}
          </Group>
          <Transformer ref={trRef} rotateEnabled keepRatio={false} flipEnabled={false} onTransformEnd={onTransformEnd} ignoreStroke />
        </Layer>
      </Stage>
      <div className="drawing-zoom">
        <span>{Math.round(view.scale * 100)}%</span>
        {zoom && (
          <button className="small" onClick={() => setZoom(null)}>
            {t('화면에 맞춤')}
          </button>
        )}
      </div>
    </div>
  )
}
