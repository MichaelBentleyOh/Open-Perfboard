import { useEffect, useRef, useState } from 'react'
import { Circle, Group, Image as KImage, Layer, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import type { Connector, PartImage, Pin } from '@core/model'
import { loadHtmlImage } from './image'

const PADDING = 24
const PIN_R = 9
/** 커넥터별 핀 색상 (커넥터 없음은 회색) */
const CONNECTOR_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b']
export const NO_CONNECTOR_COLOR = '#616161'

export function connectorColor(connectors: readonly Connector[], connectorId?: string): string {
  const i = connectors.findIndex((c) => c.id === connectorId)
  return i < 0 ? NO_CONNECTOR_COLOR : CONNECTOR_COLORS[i % CONNECTOR_COLORS.length]
}

interface Props {
  image: PartImage
  pins: Pin[]
  connectors: Connector[]
  selectedPinId: string | null
  onAddPin: (x: number, y: number) => void
  onMovePin: (id: string, x: number, y: number) => void
  onSelectPin: (id: string | null) => void
}

/** 부품 사진 위에 핀을 찍고 옮기는 캔버스. 좌표는 사진 기준 0~1로 주고받는다 */
export function PinCanvas({ image, pins, connectors, selectedPinId, onAddPin, onMovePin, onSelectPin }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [img, setImg] = useState<HTMLImageElement | null>(null)

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
  const toNorm = (p: { x: number; y: number }) => ({ x: (p.x - ox) / w, y: (p.y - oy) / h })

  const handleImageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return
    const pos = e.target.getStage()!.getPointerPosition()!
    const n = toNorm(pos)
    onAddPin(n.x, n.y)
  }

  return (
    <div ref={containerRef} className="pin-canvas" data-testid="pin-canvas">
      {size.width > 0 && (
        <Stage width={size.width} height={size.height}>
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
                onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = 'crosshair')}
                onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = 'default')}
              />
            )}
            {pins.map((pin) => {
              const selected = pin.id === selectedPinId
              const color = connectorColor(connectors, pin.connectorId)
              return (
                <Group
                  key={pin.id}
                  x={ox + pin.x * w}
                  y={oy + pin.y * h}
                  draggable
                  dragBoundFunc={(p) => ({
                    x: Math.min(ox + w, Math.max(ox, p.x)),
                    y: Math.min(oy + h, Math.max(oy, p.y))
                  })}
                  onMouseDown={(e) => {
                    e.cancelBubble = true
                    onSelectPin(pin.id)
                  }}
                  onDragEnd={(e) => {
                    const n = toNorm({ x: e.target.x(), y: e.target.y() })
                    onMovePin(pin.id, n.x, n.y)
                  }}
                  onMouseEnter={(e) => (e.target.getStage()!.container().style.cursor = 'move')}
                  onMouseLeave={(e) => (e.target.getStage()!.container().style.cursor = 'default')}
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
