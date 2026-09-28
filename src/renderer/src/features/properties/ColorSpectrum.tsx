import { useEffect, useRef, useState } from 'react'
import { hexToRgb, hsvToRgb, parseColor, rgbToHex, rgbToHsv, type Hsv, type Rgb } from '@core/color'
import { useT } from '@/i18n'

const FALLBACK: Rgb = { r: 229, g: 57, b: 53 }

/**
 * 사용자 색 고르기 (026): 채도·밝기 판 + 색상 띠 + R·G·B 숫자 + HEX.
 * 끄는 동안은 여기서만 미리 보고, 놓거나 Enter·칸을 벗어날 때 onCommit → 전선에는 한 번만 들어간다(실행 취소 1회)
 */
export function ColorSpectrum({ value, onCommit, onClose }: { value: string; onCommit: (hex: string) => void; onClose: () => void }) {
  const t = useT()
  const boxRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLDivElement>(null)
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(hexToRgb(value) ?? FALLBACK))
  const rgb = hsvToRgb(hsv)
  const hex = rgbToHex(rgb)
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const [channelDraft, setChannelDraft] = useState<Partial<Record<keyof Rgb, string>>>({})

  // 밖에서 색이 바뀌면(기본 색을 누름 등) 따라간다. 같은 색이면 색상(h)을 지킨다 (회색에서 색상이 0으로 튀지 않게)
  useEffect(() => {
    if (parseColor(value) && parseColor(value) !== rgbToHex(hsvToRgb(hsv))) setHsv(rgbToHsv(hexToRgb(value)!))
  }, [value]) // hsv는 일부러 뺀다: value가 바뀔 때만 맞춘다

  // 바깥을 누르면 닫는다
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.swatch-btn.custom')) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])

  const commit = (next: Hsv = hsv) => {
    const out = rgbToHex(hsvToRgb(next))
    if (out !== value) onCommit(out)
  }

  /** 채도·밝기 판: 누른 자리에서부터 끌기. 놓을 때 적용 */
  const dragArea = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = areaRef.current!
    el.setPointerCapture(e.pointerId)
    const at = (ev: { clientX: number; clientY: number }): Hsv => {
      const r = el.getBoundingClientRect()
      const s = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      const v = 1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))
      return { h: hsv.h, s, v }
    }
    let last = at(e)
    setHsv(last)
    const move = (ev: PointerEvent) => setHsv((last = at(ev)))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      commit(last)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const setChannel = (key: keyof Rgb, text: string) => {
    setChannelDraft((d) => ({ ...d, [key]: text }))
    const n = Number(text)
    if (text !== '' && Number.isInteger(n) && n >= 0 && n <= 255) setHsv(rgbToHsv({ ...rgb, [key]: n }))
  }
  /** R·G·B 칸을 고친 경우에만 적용 (스펙트럼을 누르느라 칸을 벗어난 것은 적용하지 않는다) */
  const commitChannels = () => {
    if (Object.keys(channelDraft).length === 0) return
    setChannelDraft({})
    commit()
  }
  const commitHex = () => {
    const parsed = hexDraft === null ? undefined : parseColor(hexDraft)
    setHexDraft(null)
    if (parsed) {
      const next = rgbToHsv(hexToRgb(parsed)!)
      setHsv(next)
      commit(next)
    }
  }
  const onEnter = (e: React.KeyboardEvent, done: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      done()
    }
  }

  return (
    <div
      className="color-spectrum"
      ref={boxRef}
      role="dialog"
      aria-label={t('사용자 색')}
      data-testid="color-spectrum"
      onKeyDown={(e) => {
        // 여기서 누른 키는 배선도 단축키로 가지 않는다 (Esc는 이 창만 닫음)
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
      }}
    >
      <div
        className="spectrum-area"
        ref={areaRef}
        data-testid="spectrum-area"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
        onPointerDown={dragArea}
      >
        <span className="spectrum-cursor" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <input
        className="spectrum-hue"
        type="range"
        min={0}
        max={359}
        step={1}
        aria-label={t('색상')}
        value={Math.round(hsv.h)}
        onChange={(e) => setHsv({ ...hsv, h: Number(e.target.value) })}
        onPointerUp={() => commit()}
        onKeyUp={(e) => e.key.startsWith('Arrow') && commit()}
      />
      <div className="spectrum-fields">
        <span className="spectrum-preview" style={{ background: hex }} />
        {(['r', 'g', 'b'] as const).map((key) => (
          <label key={key}>
            {key.toUpperCase()}
            <input
              type="number"
              min={0}
              max={255}
              aria-label={key.toUpperCase()}
              value={channelDraft[key] ?? String(rgb[key])}
              onChange={(e) => setChannel(key, e.target.value)}
              onBlur={commitChannels}
              onKeyDown={(e) => onEnter(e, commitChannels)}
            />
          </label>
        ))}
        <label className="spectrum-hex">
          HEX
          <input
            aria-label="HEX"
            value={hexDraft ?? hex}
            spellCheck={false}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={commitHex}
            onKeyDown={(e) => onEnter(e, commitHex)}
          />
        </label>
      </div>
    </div>
  )
}
