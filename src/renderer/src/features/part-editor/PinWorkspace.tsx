import { useEffect, useState } from 'react'
import { nanoid } from 'nanoid'
import type { Connector, PartImage, Pin } from '@core/model'
import { addPin, movePin, removePin, type HasPins } from '@core/part'
import { evenPoints, pinsOnGuide, respacePins, type Guide, type Point } from '@core/guide'
import { PinCanvas, type PinTool } from './PinCanvas'
import { useT } from '@/i18n'

/** 핀·커넥터를 바꾸는 연산 (core/part.ts). 부품 초안·부속 부품 초안 어느 쪽에도 쓴다 */
export type PinEdit = <D extends HasPins>(d: D) => D

interface Props {
  image: PartImage
  pins: Pin[]
  connectors: Connector[]
  /** 새로 찍는 핀이 들어갈 커넥터 ('' = 없음) */
  activeConnectorId: string
  selectedPinId: string | null
  onSelectPin: (id: string | null) => void
  onChange: (edit: PinEdit) => void
}

/** 사진 위 핀 찍기 + 보조선 (026). 부품 편집기와 부속 부품 편집기가 같이 쓴다. 보조선은 편집하는 동안만 있고 저장하지 않는다 */
export function PinWorkspace({ image, pins, connectors, activeConnectorId, selectedPinId, onSelectPin, onChange }: Props) {
  const t = useT()
  const [tool, setTool] = useState<PinTool>('pin')
  const [guides, setGuides] = useState<Guide[]>([])
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null)
  const [snap, setSnap] = useState(true)
  const [evenCount, setEvenCount] = useState('4')
  const [preview, setPreview] = useState<Point[]>([])
  const selectedGuide = guides.find((g) => g.id === selectedGuideId)
  // 보조선 위 핀을 찾는 허용 거리: 사진 긴 변의 0.5% (붙여 찍은 핀은 거의 0)
  const imageScale = { x: image.width, y: image.height }
  const onGuideTolerance = Math.max(imageScale.x, imageScale.y) * 0.005
  const count = Math.min(200, Math.max(1, Math.floor(Number(evenCount)) || 1))

  // 핀을 고르면 보조선 선택은 푼다 (표에서 고른 경우 포함)
  useEffect(() => {
    if (selectedPinId) setSelectedGuideId(null)
  }, [selectedPinId])
  const selectGuide = (id: string | null) => {
    setSelectedGuideId(id)
    if (id) onSelectPin(null)
  }

  /** 고른 보조선에 핀 n개를 같은 간격으로 (양 끝 포함) */
  const placeEven = () => {
    if (!selectedGuide) return
    const points = evenPoints(selectedGuide.a, selectedGuide.b, count)
    onChange((d) => points.reduce((acc, p) => addPin(acc, { id: nanoid(), x: p.x, y: p.y, connectorId: activeConnectorId || undefined }), d))
    setPreview([])
  }
  /** 고른 보조선 위의 핀을 첫 핀 ~ 끝 핀 사이에 같은 간격으로 */
  const respace = () => {
    if (!selectedGuide) return
    onChange((d) => respacePins(d.pins, selectedGuide, onGuideTolerance, imageScale).reduce((acc, m) => movePin(acc, m.id, m.x, m.y), d))
  }
  const onGuidePins = selectedGuide ? pinsOnGuide(pins, selectedGuide, onGuideTolerance, imageScale).length : 0

  // 입력칸 밖에서 Delete/Backspace → 선택한 핀(또는 보조선) 삭제, Esc → 선택 해제
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPinId) {
        onChange((d) => removePin(d, selectedPinId))
        onSelectPin(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedGuideId) {
        setGuides((gs) => gs.filter((g) => g.id !== selectedGuideId))
        setSelectedGuideId(null)
      } else if (e.key === 'Escape') {
        onSelectPin(null)
        setSelectedGuideId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedPinId, selectedGuideId, onChange, onSelectPin])

  return (
    <>
      <div className="pin-tools">
        <div className="segmented" role="group" aria-label={t('도구')}>
          <button className={tool === 'pin' ? 'active' : ''} aria-pressed={tool === 'pin'} onClick={() => setTool('pin')}>
            {t('● 핀 찍기')}
          </button>
          <button className={tool === 'guide' ? 'active' : ''} aria-pressed={tool === 'guide'} onClick={() => setTool('guide')}>
            {t('╱ 보조선 긋기')}
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          {t('보조선에 붙이기')}
        </label>
        {guides.length > 0 && (
          <select aria-label={t('보조선 고르기')} value={selectedGuideId ?? ''} onChange={(e) => selectGuide(e.target.value || null)}>
            <option value="">{t('보조선 {n}개', { n: guides.length })}</option>
            {guides.map((g, i) => (
              <option key={g.id} value={g.id}>
                {t('보조선 {n}', { n: i + 1 })}
              </option>
            ))}
          </select>
        )}
        {selectedGuide && (
          <div className="guide-actions" role="group" aria-label={t('보조선 작업')}>
            <input
              className="narrow"
              type="number"
              min={1}
              max={200}
              aria-label={t('핀 개수')}
              value={evenCount}
              onChange={(e) => setEvenCount(e.target.value)}
            />
            <button
              onClick={placeEven}
              onMouseEnter={() => setPreview(evenPoints(selectedGuide.a, selectedGuide.b, count))}
              onMouseLeave={() => setPreview([])}
            >
              {t('개 고르게 놓기')}
            </button>
            <button onClick={respace} disabled={onGuidePins < 3} title={t('보조선 위 핀을 첫 핀과 끝 핀 사이에 같은 간격으로')}>
              {t('선 위 핀 간격 맞추기 ({n})', { n: onGuidePins })}
            </button>
            <button
              className="icon"
              aria-label={t('보조선 삭제')}
              title={t('보조선 삭제 (Delete)')}
              onClick={() => {
                setGuides((gs) => gs.filter((g) => g.id !== selectedGuide.id))
                setSelectedGuideId(null)
              }}
            >
              ✕
            </button>
          </div>
        )}
      </div>
      <PinCanvas
        image={image}
        pins={pins}
        connectors={connectors}
        selectedPinId={selectedPinId}
        onAddPin={(x, y) => {
          const id = nanoid()
          onChange((d) => addPin(d, { id, x, y, connectorId: activeConnectorId || undefined }))
          onSelectPin(id)
        }}
        onMovePin={(id, x, y) => onChange((d) => movePin(d, id, x, y))}
        onSelectPin={onSelectPin}
        tool={tool}
        guides={guides}
        selectedGuideId={selectedGuideId}
        snap={snap}
        preview={preview}
        onAddGuide={(a, b) => {
          const id = nanoid()
          setGuides((gs) => [...gs, { id, a, b }])
          selectGuide(id)
        }}
        onMoveGuide={(id, a, b) => setGuides((gs) => gs.map((g) => (g.id === id ? { ...g, a, b } : g)))}
        onSelectGuide={selectGuide}
      />
      <p className="hint">
        {tool === 'pin'
          ? t('사진을 클릭하면 핀이 추가됩니다 · 핀은 드래그로 이동 · 선택 후 Delete로 삭제 · 보조선 가까이 찍으면 선 위에 붙습니다')
          : t('사진 위를 끌어 보조선을 긋습니다 (수평·수직에 가까우면 곧게, Shift = 자유 각도) · 선을 끌어 옮기고 끝점 손잡이로 길이·방향 조절 · Delete로 삭제')}
      </p>
    </>
  )
}
