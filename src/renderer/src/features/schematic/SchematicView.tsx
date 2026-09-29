import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Arrow, Circle, Ellipse, Group, Layer, Line, Rect, Shape as KShape, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import type { Project, WireEnd } from '@core/model'
import { buildSchematicScene, moveSchematicItems, SCH_GRID, type SchScene, type SchSymbolItem } from '@core/schematic'
import { fitView, nextZoomStep, zoomAround, type View } from '@core/zoom'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore, type Selection } from '@/stores/uiStore'
import { registerCanvasZoom } from '@/features/canvas/canvasZoom'
import { useT } from '@/i18n'
import { JUNCTION_R, labelPrims, SCH_COLORS, symbolPrims, wirePrim, type Prim } from './schematicPrims'

/** 이보다 작게(화면 px) 움직이면 끌기가 아니라 클릭 */
const CLICK_SLOP = 4
/** 격자선 간격 (회로도 단위, 250 mil) */
const GRID_LINE = SCH_GRID * 5

type Point = { x: number; y: number }
type KMouse = Konva.KonvaEventObject<MouseEvent>

/** 그리기 요소 하나 (react-konva) */
function PrimView({ p }: { p: Prim }) {
  switch (p.kind) {
    case 'group':
      return (
        <Group {...p.config}>
          {p.children.map((c, i) => (
            <PrimView key={i} p={c} />
          ))}
        </Group>
      )
    case 'rect':
      return <Rect {...p.config} perfectDrawEnabled={false} />
    case 'ellipse':
      return <Ellipse {...p.config} radiusX={p.config.radiusX ?? 0} radiusY={p.config.radiusY ?? 0} perfectDrawEnabled={false} />
    case 'line':
      return <Arrow {...p.config} points={p.config.points ?? []} perfectDrawEnabled={false} />
    case 'polyline':
      return <Line {...p.config} perfectDrawEnabled={false} />
    case 'text':
      return <Text {...p.config} perfectDrawEnabled={false} />
    case 'circle':
      return <Circle {...p.config} perfectDrawEnabled={false} />
  }
}

/** 기호 하나 (memo: 자리·기호·선택이 같으면 다시 그리지 않는다) */
const SymbolView = memo(
  function SymbolView({ item, selected, onDown }: { item: SchSymbolItem; selected: boolean; onDown: (e: KMouse, id: string) => void }) {
    const prims = useMemo(() => symbolPrims(item), [item])
    const b = item.box
    return (
      <Group>
        {prims.map((p, i) => (
          <PrimView key={i} p={p} />
        ))}
        <Rect
          name="sch-symbol"
          id={`sch-${item.instanceId}`}
          x={b.x - 4}
          y={b.y - 4}
          width={b.width + 8}
          height={b.height + 8}
          fill="rgba(0,0,0,0.001)"
          stroke={selected ? SCH_COLORS.selected : undefined}
          strokeWidth={selected ? 1.2 : 0}
          dash={[4, 3]}
          onMouseDown={(e) => onDown(e, item.instanceId)}
        />
      </Group>
    )
  },
  (a, b) =>
    a.selected === b.selected &&
    a.onDown === b.onDown &&
    a.item.placement === b.item.placement &&
    a.item.symbol === b.item.symbol &&
    a.item.part === b.item.part &&
    a.item.refDes === b.item.refDes
)

const EMPTY: Selection = { instances: [], wires: [], junctions: [], notes: [] }

/**
 * 회로도 (039). 배선도와 같은 부품·전선을 기호로 보여 준다. 기호 자리만 회로도에 저장하고 연결은 함께 쓴다.
 * 선택 모드: 누르기·Ctrl+누르기·빈 곳 끌기로 고르기, 끌어 옮기기(격자). 배선 모드: 핀 → 핀 잇기(배선도에도 전선).
 * 휠 = 확대/축소, 휠 버튼·Space+끌기 = 화면 이동
 */
export function SchematicView({ onZoomChange }: { onZoomChange?: (scale: number) => void }) {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const selection = useUiStore((s) => s.selection)
  const tool = useUiStore((s) => s.tool)
  const wireStart = useUiStore((s) => s.wireStart)
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setViewState] = useState<View | null>(null)
  const viewRef = useRef<View>({ x: 0, y: 0, scale: 1 })
  const [drag, setDragState] = useState<{ items: { instances: string[]; junctions: string[] }; dx: number; dy: number } | null>(null)
  const dragRef = useRef(drag)
  const setDrag = (d: typeof drag) => {
    dragRef.current = d
    setDragState(d)
  }
  const [band, setBand] = useState<{ a: Point; b: Point; additive: boolean } | null>(null)
  const [pointer, setPointer] = useState<Point | null>(null)
  const [hoverPin, setHoverPin] = useState<string | null>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const gesture = useRef<
    | { kind: 'pan'; clientX: number; clientY: number; view: View }
    | { kind: 'drag'; start: Point; screen: Point; items: { instances: string[]; junctions: string[] } }
    | { kind: 'band'; start: Point; screen: Point; additive: boolean }
    | null
  >(null)

  // 끄는 동안은 옮긴 모습으로 (선도 따라온다). 놓으면 한 번에 저장 → 실행 취소 1회
  const shown: Project = useMemo(() => (drag ? moveSchematicItems(project, drag.items, drag.dx, drag.dy) : project), [project, drag])
  const scene: SchScene = useMemo(() => buildSchematicScene(shown), [shown])
  const sceneRef = useRef(scene)
  sceneRef.current = scene

  // 창 크기
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const setView = (v: View) => {
    viewRef.current = v
    setViewState(v)
    onZoomChange?.(v.scale)
  }
  const fit = () => {
    const el = boxRef.current
    if (!el) return
    const b = sceneRef.current.bounds
    const vp = { width: el.clientWidth, height: el.clientHeight }
    setView(b ? fitView({ x: b.x - 20, y: b.y - 20, width: b.width + 40, height: b.height + 40 }, vp) : { scale: 2, x: vp.width / 2, y: vp.height / 2 })
  }
  // 처음 열면 전체가 보이게
  useEffect(() => {
    if (!view && size.width > 0) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height])
  const v = view ?? viewRef.current

  const toWorld = (clientX: number, clientY: number): Point => {
    const r = boxRef.current!.getBoundingClientRect()
    const cur = viewRef.current
    return { x: (clientX - r.left - cur.x) / cur.scale, y: (clientY - r.top - cur.y) / cur.scale }
  }

  // 배율 조작 (입력칸·단축키)
  useEffect(() => {
    const center = () => {
      const r = boxRef.current!.getBoundingClientRect()
      return { x: r.width / 2, y: r.height / 2 }
    }
    registerCanvasZoom(
      {
        setZoom: (scale) => setView(zoomAround(viewRef.current, scale, center())),
        step: (dir) => setView(zoomAround(viewRef.current, nextZoomStep(viewRef.current.scale, dir), center())),
        fit,
        center: () => {
          const c = center()
          const cur = viewRef.current
          return { x: (c.x - cur.x) / cur.scale, y: (c.y - cur.y) / cur.scale }
        },
        centerOn: (p) => {
          const c = center()
          const scale = Math.max(viewRef.current.scale, 1)
          setView({ scale, x: c.x - p.x * scale, y: c.y - p.y * scale })
        }
      },
      'schematic'
    )
    return () => registerCanvasZoom(null, 'schematic')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Space = 화면 이동
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(true)
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // 끌기·화면 이동·선택 사각형은 캔버스 밖에서 놓아도 끝나게 window에서
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const g = gesture.current
      if (!g) return
      if (g.kind === 'pan') {
        setView({ ...g.view, x: g.view.x + e.clientX - g.clientX, y: g.view.y + e.clientY - g.clientY })
        return
      }
      const at = toWorld(e.clientX, e.clientY)
      if (g.kind === 'band') {
        setBand({ a: g.start, b: at, additive: g.additive })
        return
      }
      if (Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) < CLICK_SLOP) return
      const dx = Math.round((at.x - g.start.x) / SCH_GRID) * SCH_GRID
      const dy = Math.round((at.y - g.start.y) / SCH_GRID) * SCH_GRID
      const d = dragRef.current
      if (!d || d.dx !== dx || d.dy !== dy) setDrag({ items: g.items, dx, dy })
    }
    const up = (e: MouseEvent) => {
      const g = gesture.current
      gesture.current = null
      if (!g) return
      if (g.kind === 'drag') {
        const d = dragRef.current
        setDrag(null)
        if (d && (d.dx || d.dy)) useProjectStore.getState().moveSchematic(d.items, d.dx, d.dy)
        return
      }
      if (g.kind !== 'band') return
      setBand(null)
      const ui = useUiStore.getState()
      if (Math.hypot(e.clientX - g.screen.x, e.clientY - g.screen.y) < CLICK_SLOP) {
        if (!g.additive) ui.clearSelection()
        return
      }
      const b = toWorld(e.clientX, e.clientY)
      const r = { x: Math.min(g.start.x, b.x), y: Math.min(g.start.y, b.y), x2: Math.max(g.start.x, b.x), y2: Math.max(g.start.y, b.y) }
      const inside = (p: Point) => p.x >= r.x && p.x <= r.x2 && p.y >= r.y && p.y <= r.y2
      const s = sceneRef.current
      const instances = s.symbols.filter((x) => inside(x.box) && inside({ x: x.box.x + x.box.width, y: x.box.y + x.box.height })).map((x) => x.instanceId)
      const junctions = s.junctions.filter(inside).map((j) => j.id)
      const wires = s.wires.filter((w) => w.points.every((_, i) => i % 2 || inside({ x: w.points[i]!, y: w.points[i + 1]! }))).map((w) => w.wireId)
      const hit = { ...EMPTY, instances, junctions, wires }
      const cur = ui.selection
      ui.select(
        g.additive
          ? {
              ...cur,
              instances: [...new Set([...cur.instances, ...instances])],
              junctions: [...new Set([...cur.junctions, ...junctions])],
              wires: [...new Set([...cur.wires, ...wires])]
            }
          : hit
      )
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 배선 모드가 아니면 그리던 선의 끝 표시를 지운다
  useEffect(() => {
    if (tool !== 'wire') setHoverPin(null)
  }, [tool])

  // E2E·디버깅용 읽기 전용 훅
  useEffect(() => {
    const worldToClient = (p: Point) => {
      const r = boxRef.current!.getBoundingClientRect()
      const cur = viewRef.current
      return { x: r.left + cur.x + p.x * cur.scale, y: r.top + cur.y + p.y * cur.scale }
    }
    window.__opbSchematic = {
      worldToClient,
      symbolClientCenter: (id) => {
        const s = sceneRef.current.symbols.find((x) => x.instanceId === id)
        return s ? worldToClient({ x: s.box.x + s.box.width / 2, y: s.box.y + s.box.height / 2 }) : null
      },
      pinClientPosition: (instanceId, pinId) => {
        const s = sceneRef.current.symbols.find((x) => x.instanceId === instanceId)
        const p = s?.pins.find((x) => x.pinId === pinId)
        return p ? worldToClient(p) : null
      },
      counts: () => ({ symbols: sceneRef.current.symbols.length, wires: sceneRef.current.wires.length, labels: sceneRef.current.labels.length })
    }
    return () => {
      delete window.__opbSchematic
    }
  }, [])

  /** 휠 버튼 또는 Space+왼쪽 버튼이면 화면 이동 */
  const tryPan = (e: MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault()
      gesture.current = { kind: 'pan', clientX: e.clientX, clientY: e.clientY, view: viewRef.current }
      return true
    }
    return false
  }

  const selectItem = (kind: 'instance' | 'wire' | 'junction', id: string, e: MouseEvent) => {
    const ui = useUiStore.getState()
    const additive = e.ctrlKey || e.shiftKey || e.metaKey
    const list = ui.selection[kind === 'instance' ? 'instances' : kind === 'wire' ? 'wires' : 'junctions']
    if (additive) ui.toggle(kind, id)
    else if (!list.includes(id)) ui.selectOne(kind, id)
  }

  /** 끝(핀·접속점)을 누름: 배선 모드에서 시작 또는 잇기 */
  const onEnd = (end: WireEnd) => {
    const ui = useUiStore.getState()
    const start = ui.wireStart
    if (!start) {
      ui.setWireStart(end)
      ui.clearSelection()
      return
    }
    ui.setWireStart(null)
    setPointer(null)
    const key = (x: typeof start) => ('instanceId' in x ? `${x.instanceId}/${x.pinId}` : 'junctionId' in x ? x.junctionId : '')
    if (key(start) === key(end)) return
    const r = useProjectStore.getState().connect(start, end, { color: ui.wireColor, orthogonal: ui.wireOrthogonal })
    if (r.ok && r.wireId) ui.selectOne('wire', r.wireId)
    else if (!r.ok && r.error === 'duplicate') ui.notify(t('이미 연결되어 있습니다'))
    else if (!r.ok && r.error === 'same-pin') ui.notify(t('같은 곳끼리는 이을 수 없습니다'))
  }

  const startDrag = (e: MouseEvent) => {
    const sel = useUiStore.getState().selection
    gesture.current = {
      kind: 'drag',
      start: toWorld(e.clientX, e.clientY),
      screen: { x: e.clientX, y: e.clientY },
      items: { instances: sel.instances, junctions: sel.junctions }
    }
  }

  // 핸들러는 매번 새로 만들지 않게 ref로 (memo 기호가 다시 그려지지 않게)
  const handlers = useRef({ symbolDown: (_e: KMouse, _id: string) => {} })
  handlers.current.symbolDown = (e, id) => {
    if (e.evt.button !== 0 || spaceHeld) return
    e.cancelBubble = true
    if (useUiStore.getState().tool !== 'select') return
    selectItem('instance', id, e.evt)
    startDrag(e.evt)
  }
  const symbolDown = useRef((e: KMouse, id: string) => handlers.current.symbolDown(e, id)).current

  const onStageDown = (e: KMouse) => {
    if (tryPan(e.evt)) return
    if (e.evt.button !== 0) return
    const target = e.target
    const name = target.name()
    const ui = useUiStore.getState()
    if (name === 'sch-pin') {
      const [instanceId, pinId] = target.id().slice(4).split('/')
      if (ui.tool === 'wire' && instanceId && pinId) onEnd({ instanceId, pinId })
      return
    }
    if (name === 'sch-junction') {
      const id = target.id().slice(4)
      if (ui.tool === 'wire') onEnd({ junctionId: id })
      else {
        selectItem('junction', id, e.evt)
        startDrag(e.evt)
      }
      return
    }
    if (name === 'sch-wire') {
      if (ui.tool === 'select') selectItem('wire', target.id().slice(4), e.evt)
      return
    }
    if (name === 'sch-label') {
      if (ui.tool !== 'select') return
      const ids = target.id().slice(4).split(',')
      if (e.evt.ctrlKey || e.evt.shiftKey) ui.select({ ...ui.selection, wires: [...new Set([...ui.selection.wires, ...ids])] })
      else ui.select({ ...EMPTY, wires: ids })
      return
    }
    if (ui.tool !== 'select') return
    const at = toWorld(e.evt.clientX, e.evt.clientY)
    gesture.current = { kind: 'band', start: at, screen: { x: e.evt.clientX, y: e.evt.clientY }, additive: e.evt.ctrlKey || e.evt.shiftKey }
  }

  const onStageMove = (e: KMouse) => {
    if (!useUiStore.getState().wireStart) return
    setPointer(toWorld(e.evt.clientX, e.evt.clientY))
  }

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const r = boxRef.current!.getBoundingClientRect()
    const anchor = { x: e.evt.clientX - r.left, y: e.evt.clientY - r.top }
    const cur = viewRef.current
    setView(zoomAround(cur, cur.scale * (e.evt.deltaY < 0 ? 1.15 : 1 / 1.15), anchor))
  }

  const selInst = useMemo(() => new Set(selection.instances), [selection.instances])
  const selWires = useMemo(() => new Set(selection.wires), [selection.wires])
  const selJunctions = useMemo(() => new Set(selection.junctions), [selection.junctions])
  const wireMode = tool === 'wire'

  // 그리던 선: 시작 끝 → 마우스
  const startPoint = useMemo(() => {
    if (!wireStart) return null
    if ('instanceId' in wireStart) {
      const s = scene.symbols.find((x) => x.instanceId === wireStart.instanceId)
      return s?.pins.find((p) => p.pinId === wireStart.pinId) ?? null
    }
    if ('junctionId' in wireStart) return scene.junctions.find((j) => j.id === wireStart.junctionId) ?? null
    return null
  }, [wireStart, scene])

  const pinR = Math.max(2.5, 5 / v.scale)

  return (
    <div
      ref={boxRef}
      className={`schematic-view${spaceHeld || gesture.current?.kind === 'pan' ? ' panning' : ''}${wireMode ? ' wiring' : ''}`}
      data-testid="schematic-canvas"
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <SchematicToolbar />
      {size.width > 0 && (
        <Stage width={size.width} height={size.height} onMouseDown={onStageDown} onMouseMove={onStageMove} onWheel={onWheel}>
          <Layer listening={false}>
            <KShape
              sceneFunc={(ctx) => {
                // 보이는 곳만 격자선
                const x0 = Math.floor(-v.x / v.scale / GRID_LINE) * GRID_LINE
                const y0 = Math.floor(-v.y / v.scale / GRID_LINE) * GRID_LINE
                const x1 = (size.width - v.x) / v.scale
                const y1 = (size.height - v.y) / v.scale
                ctx.beginPath()
                for (let x = x0; x <= x1; x += GRID_LINE) {
                  ctx.moveTo(x * v.scale + v.x, 0)
                  ctx.lineTo(x * v.scale + v.x, size.height)
                }
                for (let y = y0; y <= y1; y += GRID_LINE) {
                  ctx.moveTo(0, y * v.scale + v.y)
                  ctx.lineTo(size.width, y * v.scale + v.y)
                }
                ctx.strokeStyle = '#eef1f5'
                ctx.lineWidth = 1
                ctx.stroke()
              }}
            />
          </Layer>
          <Layer x={v.x} y={v.y} scaleX={v.scale} scaleY={v.scale}>
            {scene.wires.map((w) => (
              <Group key={w.wireId}>
                <PrimView p={wirePrim(w, selWires.has(w.wireId))} />
                <Line name="sch-wire" id={`sch-${w.wireId}`} points={w.points} stroke="transparent" strokeWidth={8 / v.scale} hitStrokeWidth={10 / v.scale} />
              </Group>
            ))}
            {scene.symbols.map((s) => (
              <SymbolView key={s.instanceId} item={s} selected={selInst.has(s.instanceId)} onDown={symbolDown} />
            ))}
            {scene.labels.map((l) => (
              <Group key={`${l.x},${l.y}`}>
                {labelPrims(l, l.wireIds.some((id) => selWires.has(id))).map((p, i) => (
                  <PrimView key={i} p={p} />
                ))}
                <Circle name="sch-label" id={`sch-${l.wireIds.join(',')}`} x={l.x} y={l.y} radius={6} fill="rgba(0,0,0,0.001)" />
              </Group>
            ))}
            {scene.dots.map((d) => (
              <Circle key={`${d.x},${d.y}`} x={d.x} y={d.y} radius={JUNCTION_R * 0.8} fill={SCH_COLORS.wire} listening={false} />
            ))}
            {scene.junctions.map((j) => (
              <Circle
                key={j.id}
                name="sch-junction"
                id={`sch-${j.id}`}
                x={j.x}
                y={j.y}
                radius={JUNCTION_R}
                fill={selJunctions.has(j.id) ? SCH_COLORS.selected : SCH_COLORS.wire}
                hitStrokeWidth={6}
              />
            ))}
            {wireMode &&
              scene.symbols.flatMap((s) =>
                s.pins.map((p) => {
                  const key = `${s.instanceId}/${p.pinId}`
                  return (
                    <Circle
                      key={key}
                      name="sch-pin"
                      id={`sch-${key}`}
                      x={p.x}
                      y={p.y}
                      radius={pinR}
                      stroke={SCH_COLORS.selected}
                      strokeWidth={1}
                      fill={hoverPin === key ? SCH_COLORS.selected : '#ffffff'}
                      onMouseEnter={() => setHoverPin(key)}
                      onMouseLeave={() => setHoverPin((h) => (h === key ? null : h))}
                    />
                  )
                })
              )}
            {startPoint && pointer && (
              <Line points={[startPoint.x, startPoint.y, pointer.x, pointer.y]} stroke={SCH_COLORS.selected} strokeWidth={1.5} dash={[4, 3]} listening={false} />
            )}
            {band && (
              <Rect
                x={Math.min(band.a.x, band.b.x)}
                y={Math.min(band.a.y, band.b.y)}
                width={Math.abs(band.b.x - band.a.x)}
                height={Math.abs(band.b.y - band.a.y)}
                stroke={SCH_COLORS.selected}
                strokeWidth={1 / v.scale}
                fill="rgba(30,136,229,0.08)"
                listening={false}
              />
            )}
          </Layer>
        </Stage>
      )}
      {scene.symbols.length === 0 && <p className="schematic-empty">{t('배선도에 부품을 놓으면 여기에 회로도 기호로 보입니다.')}</p>}
    </div>
  )
}

/** 회로도 도구 줄: 회전·반전(고른 기호), 넷 라벨(고른 전선의 넷), 전체 보기 */
function SchematicToolbar() {
  const t = useT()
  const selection = useUiStore((s) => s.selection)
  const labeled = useProjectStore((s) => s.project.schematic?.labeled)
  const ids = selection.instances
  const wires = selection.wires
  const allLabeled = wires.length > 0 && wires.every((id) => labeled?.includes(id))
  const store = useProjectStore.getState
  return (
    <div className="schematic-toolbar" role="toolbar" aria-label={t('회로도 도구')}>
      <button disabled={ids.length === 0} onClick={() => store().rotateSymbols(ids, 90)} title={t('기호 시계 방향 90° (R, 반대 방향 Shift+R)')}>
        {t('↻ 회전')}
      </button>
      <button disabled={ids.length === 0} onClick={() => store().mirrorSymbols(ids, 'horizontal')} title={t('기호 좌우 반전 (F, 상하 Shift+F)')}>
        {t('⇋ 반전')}
      </button>
      <button
        disabled={wires.length === 0}
        aria-pressed={allLabeled}
        className={allLabeled ? 'active' : ''}
        onClick={() => store().setNetLabels(wires, !allLabeled)}
        title={t('고른 전선의 넷을 선 대신 이름표로 보이기 (이름은 전선 라벨 → 전원·신호 이름)')}
      >
        {t('🏷 넷 라벨')}
      </button>
    </div>
  )
}
