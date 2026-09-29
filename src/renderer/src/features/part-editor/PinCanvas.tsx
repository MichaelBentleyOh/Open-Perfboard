import { useEffect, useRef, useState } from 'react'
import { Circle, Group, Image as KImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import type { Connector, PartImage, Pin } from '@core/model'
import { snapToGuides, straighten, type Guide, type Point } from '@core/guide'
import { loadHtmlImage } from './image'
import { connectorColor } from './connectorColor'

const PADDING = 24
const PIN_R = 9
/** 보조선에 붙는 거리 (화면 px) */
const SNAP_PX = 10
/** 수평·수직에서 이 각도 안이면 보조선을 곧게 맞춘다 (Shift = 자유 각도) */
const STRAIGHTEN_DEG = 8
const GUIDE_COLOR = '#0ea5e9'
const GUIDE_SELECTED = '#0369a1'

/** 핀 찍기(기본) / 보조선 긋기 */
export type PinTool = 'pin' | 'guide'

interface Props {
  image: PartImage
  pins: Pin[]
  connectors: Connector[]
  selectedPinId: string | null
  onAddPin: (x: number, y: number) => void
  onMovePin: (id: string, x: number, y: number) => void
  onSelectPin: (id: string | null) => void
  tool?: PinTool
  guides?: Guide[]
  selectedGuideId?: string | null
  /** 핀을 찍거나 끌 때 가까운 보조선 위로 붙인다 */
  snap?: boolean
  /** 미리 보기로 흐리게 그릴 핀 자리 (고르게 놓기 단추 위에 마우스를 올렸을 때) */
  preview?: Point[]
  onAddGuide?: (a: Point, b: Point) => void
  onMoveGuide?: (id: string, a: Point, b: Point) => void
  onSelectGuide?: (id: string | null) => void
}

/** 부품 사진 위에 핀을 찍고 옮기는 캔버스. 좌표는 사진 기준 0~1로 주고받는다. 보조선을 긋고 핀을 그 위에 붙일 수 있다 (026) */
export function PinCanvas({
  image,
  pins,
  connectors,
  selectedPinId,
  onAddPin,
  onMovePin,
  onSelectPin,
  tool = 'pin',
  guides = [],
  selectedGuideId = null,
  snap = true,
  preview = [],
  onAddGuide,
  onMoveGuide,
  onSelectGuide
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  /** 긋는 중인 보조선 (사진 기준 0~1) */
  const [drawing, setDrawing] = useState<{ a: Point; b: Point } | null>(null)

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(containerRef.current!)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    let alive = true
    loadHtmlImage(image.data).then((el) => alive && setImg(el))
    return () => {
      alive = false
    }
  }, [image.data])

  // 사진을 영역에 맞춰 가운데 배치
  const scale = Math.max(
    0.01,
    Math.min((size.width - PADDING * 2) / image.width, (size.height - PADDING * 2) / image.height)
  )
  const w = image.width * scale
  const h = image.height * scale
  const ox = (size.width - w) / 2
  const oy = (size.height - h) / 2
  const px = { x: w, y: h } // 0~1 좌표를 화면 px로 재는 배율
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
  const toNorm = (p: { x: number; y: number }) => ({ x: clamp01((p.x - ox) / w), y: clamp01((p.y - oy) / h) })
  const toScreen = (p: Point) => ({ x: ox + p.x * w, y: oy + p.y * h })
  /** 붙이기가 켜져 있으면 가까운 보조선 위로 */
  const snapped = (n: Point) => (snap && guides.length ? (snapToGuides(n, guides, SNAP_PX, px) ?? n) : n)

  const pointer = (e: Konva.KonvaEventObject<MouseEvent>) => toNorm(e.target.getStage()!.getPointerPosition()!)

  const handleImageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0 || tool !== 'pin') return
    const n = snapped(pointer(e))
    onAddPin(n.x, n.y)
  }

  // 보조선 긋기: 누른 자리 → 뗀 자리. 수평·수직에 가까우면 곧게 (Shift = 자유)
  const startGuide = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'guide' || e.evt.button !== 0) return
    const a = pointer(e)
    setDrawing({ a, b: a })
  }
  const moveGuide = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!drawing) return
    const raw = pointer(e)
    setDrawing({ a: drawing.a, b: e.evt.shiftKey ? raw : straighten(drawing.a, raw, STRAIGHTEN_DEG, px) })
  }
  const endGuide = () => {
    if (!drawing) return
    const len = Math.hypot((drawing.b.x - drawing.a.x) * w, (drawing.b.y - drawing.a.y) * h)
    if (len > 6) onAddGuide?.(drawing.a, drawing.b)
    setDrawing(null)
  }

  const cursor = (e: Konva.KonvaEventObject<MouseEvent>, c: string) => (e.target.getStage()!.container().style.cursor = c)

  return (
    <div ref={containerRef} className="pin-canvas" data-testid="pin-canvas">
      {size.width > 0 && (
        <Stage width={size.width} height={size.height} onMouseDown={startGuide} onMouseMove={moveGuide} onMouseUp={endGuide} onMouseLeave={endGuide}>
          <Layer>
            <Rect x={ox} y={oy} width={w} height={h} fill="#fff" shadowBlur={6} shadowOpacity={0.15} />
            {img && (
              <KImage
                image={img}
                x={ox}
                y={oy}
                width={w}
                height={h}
                onClick={handleImageClick}
                onMouseEnter={(e) => cursor(e, 'crosshair')}
                onMouseLeave={(e) => cursor(e, 'default')}
              />
            )}
            {guides.map((g, i) => {
              const a = toScreen(g.a)
              const b = toScreen(g.b)
              const selected = g.id === selectedGuideId
              return (
                <Group key={g.id}>
                  <Line
                    points={[a.x, a.y, b.x, b.y]}
                    stroke={selected ? GUIDE_SELECTED : GUIDE_COLOR}
                    strokeWidth={selected ? 2.5 : 1.5}
                    dash={selected ? undefined : [8, 5]}
                    hitStrokeWidth={12}
                    // 핀 찍기에서는 선 위를 눌러도 핀이 선 위에 찍힌다. 보조선 긋기에서는 선을 고른다
                    onClick={(e) => {
                      if (tool === 'pin') handleImageClick(e)
                      else {
                        e.cancelBubble = true
                        onSelectGuide?.(g.id)
                      }
                    }}
                    onMouseDown={(e) => tool === 'guide' && (e.cancelBubble = true)}
                    onMouseEnter={(e) => cursor(e, tool === 'pin' ? 'crosshair' : 'pointer')}
                    onMouseLeave={(e) => cursor(e, 'default')}
                  />
                  <Text
                    text={String(i + 1)}
                    x={a.x - 16}
                    y={a.y - 16}
                    fontSize={12}
                    fontStyle="bold"
                    fill={selected ? GUIDE_SELECTED : GUIDE_COLOR}
                    listening={false}
                  />
                  {/* 고른 보조선의 끝점 손잡이: 끌어서 길이·방향 조절 */}
                  {selected &&
                    (['a', 'b'] as const).map((end) => {
                      const p = end === 'a' ? a : b
                      return (
                        <Rect
                          key={end}
                          x={p.x - 5}
                          y={p.y - 5}
                          width={10}
                          height={10}
                          fill="#fff"
                          stroke={GUIDE_SELECTED}
                          strokeWidth={2}
                          draggable
                          onMouseDown={(e) => (e.cancelBubble = true)}
                          onDragEnd={(e) => {
                            const n = toNorm({ x: e.target.x() + 5, y: e.target.y() + 5 })
                            onMoveGuide?.(g.id, end === 'a' ? n : g.a, end === 'b' ? n : g.b)
                          }}
                          onMouseEnter={(e) => cursor(e, 'move')}
                          onMouseLeave={(e) => cursor(e, 'default')}
                        />
                      )
                    })}
                </Group>
              )
            })}
            {drawing && (
              <Line
                points={[toScreen(drawing.a).x, toScreen(drawing.a).y, toScreen(drawing.b).x, toScreen(drawing.b).y]}
                stroke={GUIDE_SELECTED}
                strokeWidth={2}
                dash={[6, 4]}
                listening={false}
              />
            )}
            {preview.map((p, i) => {
              const s = toScreen(p)
              return <Circle key={i} x={s.x} y={s.y} radius={PIN_R} stroke={GUIDE_SELECTED} strokeWidth={2} dash={[3, 3]} listening={false} />
            })}
            {pins.map((pin) => {
              const selected = pin.id === selectedPinId
              const color = connectorColor(connectors, pin.connectorId)
              return (
                <Group
                  key={pin.id}
                  x={ox + pin.x * w}
                  y={oy + pin.y * h}
                  draggable={tool === 'pin'}
                  listening={tool === 'pin'}
                  // 끄는 동안에도 사진 안, 가까운 보조선 위로
                  dragBoundFunc={(p) => toScreen(snapped(toNorm(p)))}
                  onMouseDown={(e) => {
                    e.cancelBubble = true
                    onSelectPin(pin.id)
                  }}
                  onDragEnd={(e) => {
                    const n = toNorm({ x: e.target.x(), y: e.target.y() })
                    onMovePin(pin.id, n.x, n.y)
                  }}
                  onMouseEnter={(e) => cursor(e, 'move')}
                  onMouseLeave={(e) => cursor(e, 'default')}
                >
                  <Circle
                    radius={selected ? PIN_R + 3 : PIN_R}
                    fill={color}
                    stroke={selected ? '#ffeb3b' : '#fff'}
                    strokeWidth={selected ? 4 : 2}
                    shadowBlur={3}
                    shadowOpacity={0.4}
                  />
                  <Text
                    text={pin.number}
                    x={PIN_R + 4}
                    y={-PIN_R - 10}
                    fontSize={14}
                    fontStyle="bold"
                    fill="#111"
                    stroke="#fff"
                    strokeWidth={3}
                    fillAfterStrokeEnabled
                    listening={false}
                  />
                </Group>
              )
            })}
          </Layer>
        </Stage>
      )}
    </div>
  )
}
