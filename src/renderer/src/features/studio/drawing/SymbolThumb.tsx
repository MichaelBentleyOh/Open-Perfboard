import { useMemo } from 'react'
import type { Shape } from '@core/model'
import { shapeBounds, unionBox } from '@core/drawing'
import type { SymbolTemplate } from '@core/symbolTemplates'
import { slotInner } from '@core/symbolTemplates'

/** 기본 기호 미리보기 (작은 SVG, 핀 선 포함 — 부품 이름·번호는 빼고) */
export function SymbolThumb({ template, size = 44 }: { template: SymbolTemplate; size?: number }) {
  const { shapes, slots, box } = useMemo(() => {
    const body = template.build(4)
    const shapes = body.shapes.map((s, i) => ({ ...s, id: String(i) }) as Shape)
    const box = unionBox([...shapes.map(shapeBounds), ...body.slots.map((s) => ({ x: s.x, y: s.y, width: 0, height: 0 }))]) ?? { x: 0, y: 0, width: 1, height: 1 }
    return { shapes, slots: body.slots, box }
  }, [template])
  const pad = 4
  const side = Math.max(box.width, box.height) + pad * 2
  const vb = `${box.x + box.width / 2 - side / 2} ${box.y + box.height / 2 - side / 2} ${side} ${side}`
  return (
    <svg viewBox={vb} width={size} height={size} aria-hidden>
      <defs>
        <marker id="thumb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
        </marker>
      </defs>
      {shapes.map((s) => (
        <ThumbShape key={s.id} s={s} />
      ))}
      {slots.map((s, i) => {
        const inner = slotInner(s)
        return <line key={`p${i}`} x1={s.x} y1={s.y} x2={inner.x} y2={inner.y} stroke="#c62828" strokeWidth={2} />
      })}
    </svg>
  )
}

/** 그림판 도형 → SVG (색은 글자색을 따라 어두운 화면에서도 보이게) */
function ThumbShape({ s }: { s: Shape }) {
  const paint = (fill: string | undefined) => (fill === '#000000' ? 'currentColor' : fill ? 'var(--panel)' : 'none')
  switch (s.type) {
    case 'rect':
      return <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={paint(s.fill)} stroke="currentColor" strokeWidth={s.strokeWidth ?? 1} />
    case 'ellipse':
      return <ellipse cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} fill={paint(s.fill)} stroke="currentColor" strokeWidth={s.strokeWidth ?? 1} />
    case 'line': {
      const pts = s.points.map((v, i) => v + (i % 2 ? s.y : s.x)).join(' ')
      return s.closed ? (
        <polygon points={pts} fill={paint(s.fill)} stroke="currentColor" strokeWidth={s.strokeWidth} strokeLinejoin="round" />
      ) : (
        <polyline
          points={pts}
          fill="none"
          stroke="currentColor"
          strokeWidth={s.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          markerEnd={s.arrowEnd ? 'url(#thumb-arrow)' : undefined}
        />
      )
    }
    case 'text':
      return (
        <text x={s.x + s.w / 2} y={s.y + s.fontSize} fontSize={s.fontSize} textAnchor="middle" fill="currentColor">
          {s.text}
        </text>
      )
    default:
      return null
  }
}
