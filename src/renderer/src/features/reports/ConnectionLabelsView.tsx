import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Arrow, ConnectionLabel, InstanceLabel } from '@core/connection'
import type { PartDef, PartInstance, Pin } from '@core/model'
import { naturalCompare } from '@core/sort'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'
import { useT } from '@/i18n'
import { connectionLabelsOf, setDirection } from './connectionLabels'

/**
 * 결선표 연결 라벨 보기 (025): Simulink의 Goto/From처럼, 부품 사진의 핀에서 선이 나와 이름표(깃발)에 닿는다.
 * 같은 이름의 깃발이 두 부품에 하나씩 있으면 이어진 것이다. 보내는 쪽은 Goto(선이 깃발로), 받는 쪽은 From(깃발에서 핀으로).
 * 깃발을 누르면 그 전선을 골라 짝 깃발을 강조한다. 신호 방향은 여기와 결선표 표에서만 바꾼다(부품 정의는 그대로).
 * 부품(카드 사진·"연결 보기")을 누르면 간이 창: 왼쪽에 그 부품, 오른쪽에 이어진 부품들(하나씩 크게, 넘기기·목록).
 */
export function ConnectionLabelsView() {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const selectedWire = useUiStore((s) => (s.selection.wires.length === 1 ? s.selection.wires[0] : null))
  const popupId = useUiStore((s) => s.labelFocus)
  const { labels, byWire, byInstance } = useMemo(() => connectionLabelsOf(project), [project])

  // 전선이 많이 이어진 부품(보통 제어 보드)부터, 같으면 참조명 순
  const cards = useMemo(() => {
    const list = project.instances.filter((i) => byInstance.has(i.id) && project.parts[i.partId])
    return list.sort((a, b) => byInstance.get(b.id)!.length - byInstance.get(a.id)!.length || naturalCompare(a.refDes, b.refDes))
  }, [project, byInstance])

  const selected = selectedWire ? byWire.get(selectedWire) : undefined

  const pick = useCallback((wireId: string) => useUiStore.getState().selectOne('wire', wireId), [])
  const open = useCallback((id: string | null) => useUiStore.getState().setLabelFocus(id), [])
  const close = useCallback(() => useUiStore.getState().setLabelFocus(null), [])
  const popup = popupId && byInstance.has(popupId) ? cards.find((c) => c.id === popupId) : undefined

  return (
    <section className="report" aria-label={t('연결 라벨')}>
      <header className="report-header">
        <h2>{t('연결 라벨')}</h2>
        <span className="report-summary">{t('전선 {n}개 · 부품 {m}개', { n: labels.length, m: cards.length })}</span>
        <div className="spacer" />
        {/* 빠른 접근: 부품을 고르면 바로 간이 창 */}
        <select className="conn-focus" aria-label={t('부품 연결 보기')} value="" onChange={(e) => e.target.value && open(e.target.value)}>
          <option value="">{t('부품 연결 보기…')}</option>
          {cards.map((inst) => (
            <option key={inst.id} value={inst.id}>
              {inst.refDes} {project.parts[inst.partId].name}
            </option>
          ))}
        </select>
      </header>
      {labels.length === 0 ? (
        <p className="empty">{t('연결된 전선이 없습니다. 배선도 탭에서 핀과 핀을 연결하세요.')}</p>
      ) : (
        <>
          <p className="conn-hint">
            {t('같은 이름의 라벨끼리 이어집니다. 화살표는 신호가 흐르는 방향입니다(핀 → 라벨: 보냄, 라벨 → 핀: 받음). 라벨을 누르면 짝 라벨과 전선 정보가 보이고, 위에서 신호 방향을 바꿀 수 있습니다. 부품 사진을 누르면 이어진 부품을 따로 봅니다.')}
          </p>
          {selected && !popup && <DirectionBar label={selected} />}
          <div className="conn-grid" data-testid="connection-labels">
            {cards.map((inst) => (
              <ConnectionCard
                key={inst.id}
                instance={inst}
                part={project.parts[inst.partId]}
                items={byInstance.get(inst.id)!}
                // 고른 전선이 닿는 카드만 다시 그린다
                selectedWire={selected && (selected.a.instanceId === inst.id || selected.b.instanceId === inst.id) ? selected.wireId : null}
                onPick={pick}
                onOpen={open}
              />
            ))}
          </div>
        </>
      )}
      {popup && (
        <ConnectionPopup
          focus={popup}
          project={project}
          byInstance={byInstance}
          selected={selected}
          onPick={pick}
          onClose={close}
        />
      )}
    </section>
  )
}

const ARROW_CHOICES: readonly Arrow[] = ['->', '<-', '<->']

/** 고른 연결의 신호 방향 바꾸기 (A -> B / A <- B / A <-> B). 실행 취소 1회 */
function DirectionBar({ label }: { label: ConnectionLabel }) {
  const t = useT()
  return (
    <div className="conn-direction" role="group" aria-label={t('신호 방향')} data-testid="direction-bar">
      <span className="conn-direction-title">{t('신호 방향')}</span>
      {ARROW_CHOICES.map((arrow) => (
        <button
          key={arrow}
          aria-pressed={label.arrow === arrow}
          className={label.arrow === arrow ? 'active' : undefined}
          onClick={() => setDirection({ wireId: label.wireId, reversed: !label.aIsFrom }, arrow)}
        >
          {label.a.name} <b className="conn-arrow">{arrow}</b> {label.b.name}
        </button>
      ))}
      <span className="conn-direction-signal">: {label.signal}</span>
    </div>
  )
}

/**
 * 한 부품의 연결 간이 창. 왼쪽 = 고른 부품(모든 깃발, 지금 보는 이웃과 잇는 깃발만 진하게),
 * 오른쪽 = 이어진 부품: 처음엔 모두 작게, 하나를 고르면 크게(그 부품과 잇는 깃발만). ◀ ▶(←/→ 키)로 넘기고, 목록으로 바로 간다.
 */
function ConnectionPopup({
  focus,
  project,
  byInstance,
  selected,
  onPick,
  onClose
}: {
  focus: PartInstance
  project: ReturnType<typeof useProjectStore.getState>['project']
  byInstance: ReadonlyMap<string, InstanceLabel[]>
  selected: ConnectionLabel | undefined
  onPick: (wireId: string) => void
  onClose: () => void
}) {
  const t = useT()
  const boxRef = useRef<HTMLDivElement>(null)
  const focusItems = byInstance.get(focus.id)!
  const touches = (x: InstanceLabel, id: string) => x.label.a.instanceId === id || x.label.b.instanceId === id

  // 이어진 부품: 전선이 많이 이어진 쪽부터
  const neighbors = useMemo(() => {
    const count = new Map<string, number>()
    for (const x of focusItems) {
      const other = (x.label.a.instanceId === focus.id ? x.label.b : x.label.a).instanceId
      if (other && other !== focus.id) count.set(other, (count.get(other) ?? 0) + 1)
    }
    return project.instances
      .filter((i) => count.has(i.id) && project.parts[i.partId])
      .sort((a, b) => count.get(b.id)! - count.get(a.id)! || naturalCompare(a.refDes, b.refDes))
      .map((inst) => ({ inst, count: count.get(inst.id)! }))
  }, [focusItems, focus.id, project])

  const [index, setIndex] = useState<number | null>(null)
  const current = index === null ? undefined : neighbors[index]
  const go = useCallback(
    (step: number) => setIndex((i) => (neighbors.length === 0 ? null : ((i ?? (step > 0 ? -1 : 0)) + step + neighbors.length) % neighbors.length)),
    [neighbors.length]
  )

  useEffect(() => boxRef.current?.focus(), [])
  useEffect(() => setIndex(null), [focus.id])
  // 키는 창 전체에서 받는다 (누른 단추가 다시 그려져 사라져도 Esc·←/→가 먹게). 다른 단축키는 창이 열려 있으면 쉰다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && !(e.target instanceof HTMLSelectElement)) go(1)
      else if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLSelectElement)) go(-1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose])

  const highlight = useMemo(
    () => (current ? new Set(focusItems.filter((x) => touches(x, current.inst.id)).map((x) => x.label.wireId)) : null),
    [current, focusItems]
  )
  const currentItems = useMemo(
    () => (current ? byInstance.get(current.inst.id)!.filter((x) => touches(x, focus.id)) : []),
    [current, byInstance, focus.id]
  )
  // 간이 창에 보이는 전선은 모두 이 부품에 닿는다
  const selectedHere = selected && (selected.a.instanceId === focus.id || selected.b.instanceId === focus.id) ? selected : undefined

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal conn-popup"
        role="dialog"
        aria-label={t('{ref} {name} 연결', { ref: focus.refDes, name: project.parts[focus.partId].name })}
        tabIndex={-1}
        ref={boxRef}
      >
        <header className="conn-popup-header">
          <h2>{t('{ref} {name} 연결', { ref: focus.refDes, name: project.parts[focus.partId].name })}</h2>
          <span className="report-summary">{t('이어진 부품 {n}개', { n: neighbors.length })}</span>
          <div className="spacer" />
          <button className="icon" aria-label={t('닫기')} title={t('닫기 (Esc)')} onClick={onClose}>
            ✕
          </button>
        </header>
        {selectedHere && <DirectionBar label={selectedHere} />}
        <div className="conn-popup-body">
          <div className="conn-popup-pane left">
            <ConnectionCard
              instance={focus}
              part={project.parts[focus.partId]}
              items={focusItems}
              selectedWire={selectedHere?.wireId ?? null}
              highlight={highlight}
              large
              onPick={onPick}
            />
          </div>
          <div className="conn-popup-pane right">
            <nav className="conn-popup-nav" aria-label={t('이어진 부품')}>
              <button aria-label={t('이전 부품')} title={t('이전 부품 (←)')} onClick={() => go(-1)} disabled={neighbors.length === 0}>
                ◀
              </button>
              <select aria-label={t('이어진 부품 목록')} value={index ?? ''} onChange={(e) => setIndex(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">{t('모두 보기 ({n})', { n: neighbors.length })}</option>
                {neighbors.map((n, i) => (
                  <option key={n.inst.id} value={i}>
                    {t('{ref} {name} · 전선 {n}', { ref: n.inst.refDes, name: project.parts[n.inst.partId].name, n: n.count })}
                  </option>
                ))}
              </select>
              <button aria-label={t('다음 부품')} title={t('다음 부품 (→)')} onClick={() => go(1)} disabled={neighbors.length === 0}>
                ▶
              </button>
              {current && <span className="conn-popup-count">{index! + 1} / {neighbors.length}</span>}
            </nav>
            {current ? (
              <ConnectionCard
                key={current.inst.id}
                instance={current.inst}
                part={project.parts[current.inst.partId]}
                items={currentItems}
                selectedWire={selectedHere?.wireId ?? null}
                large
                onPick={onPick}
              />
            ) : (
              <ul className="conn-thumbs">
                {neighbors.map((n, i) => (
                  <li key={n.inst.id}>
                    <button className="conn-thumb" onClick={() => setIndex(i)} data-testid={`conn-thumb-${n.inst.refDes}`}>
                      <img src={project.parts[n.inst.partId].image.data} alt="" draggable={false} />
                      <span>
                        <strong>{n.inst.refDes}</strong> {project.parts[n.inst.partId].name}
                      </span>
                      <small>{t('전선 {n}개', { n: n.count })}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface Flag {
  item: InstanceLabel
  pin: Pin
  key: string
  /** 핀에서 선이 사진 밖으로 나가는 쪽: 위·아래 가장자리에 더 가까우면 위/아래, 아니면 옆 */
  exit: 'top' | 'side' | 'bottom'
  /** 사진 옆 틈(·위아래 띠)에서 몇 번째 줄로 지나가는지. 클수록 사진에서 멀다 */
  lane: number
}

interface Leader {
  key: string
  points: string
  role: InstanceLabel['role']
  on: boolean
  dim: boolean
}

/** 사진 옆 틈에서 선끼리 겹치지 않게 조금씩 비켜 세우는 간격 (px) */
const LANE = 5
const LANES = 8

/** 깃발 한 줄(왼쪽 또는 오른쪽)의 순서와 선이 지나갈 줄. 위로 빠지는 핀 → 옆 핀 → 아래로 빠지는 핀 순으로 쌓고,
 *  선끼리 엇갈리지 않게 위 무리는 옆 가장자리에서 먼 핀일수록 위 깃발·바깥 줄, 아래 무리는 그 반대 */
function arrange(flags: Omit<Flag, 'lane' | 'exit'>[], side: 'left' | 'right'): Flag[] {
  const fromSide = (p: Pin) => (side === 'left' ? p.x : 1 - p.x)
  const withExit = flags.map((f) => {
    const toEdgeY = Math.min(f.pin.y, 1 - f.pin.y)
    const exit: Flag['exit'] = toEdgeY < Math.min(f.pin.x, 1 - f.pin.x) ? (f.pin.y < 0.5 ? 'top' : 'bottom') : 'side'
    return { ...f, exit }
  })
  const top = withExit.filter((f) => f.exit === 'top').sort((a, b) => fromSide(b.pin) - fromSide(a.pin))
  const mid = withExit.filter((f) => f.exit === 'side').sort((a, b) => a.pin.y - b.pin.y)
  const bottom = withExit.filter((f) => f.exit === 'bottom').sort((a, b) => fromSide(a.pin) - fromSide(b.pin))
  const clamp = (n: number) => Math.min(n, LANES - 1)
  return [
    ...top.map((f, i) => ({ ...f, lane: clamp(top.length - 1 - i) })),
    ...mid.map((f, i) => ({ ...f, lane: clamp(i % 2) })),
    ...bottom.map((f, i) => ({ ...f, lane: clamp(i) }))
  ]
}

// 품번(CTRL-32)의 - 뒤에서 줄이 바뀌지 않게 보이는 글자만 줄 안 바뀌는 하이픈(U+2011)으로
const glue = (text: string) => text.replaceAll('-', '\u2011')

const ROLE_ARROW: Record<InstanceLabel['role'], Arrow> = { goto: '->', from: '<-', both: '<->' }

/**
 * 카드 깃발 글자: 카드의 부품 이름은 빼고 "-> 모터 드라이버 MD-2A : IO4"처럼 상대 부품과 신호만 (Goto/From 태그처럼 짧게).
 * 화살표는 이 부품 기준(-> 보냄, <- 받음). 전체 이름("제어 보드 -> 모터 드라이버 : IO4")은 aria-label·툴팁·방향 막대·선택 항목에
 */
function FlagText({ item }: { item: InstanceLabel }) {
  const other = item.end === item.label.a ? item.label.b : item.label.a
  return (
    <>
      <b className="conn-arrow">{ROLE_ARROW[item.role]}</b>
      {'\u00a0'}
      {glue(other.name)}
      {'\u00a0: '}
      {glue(item.label.signal)}
    </>
  )
}

let cardSerial = 0

const ConnectionCard = memo(function ConnectionCard({
  instance,
  part,
  items,
  selectedWire,
  highlight = null,
  large = false,
  onPick,
  onOpen
}: {
  instance: PartInstance
  part: PartDef
  items: InstanceLabel[]
  selectedWire: string | null
  /** 있으면 이 전선들만 진하게, 나머지 깃발은 흐리게 (간이 창 왼쪽) */
  highlight?: ReadonlySet<string> | null
  /** 간이 창에서 크게 */
  large?: boolean
  onPick: (wireId: string) => void
  /** 있으면 사진·머리 버튼으로 간이 창을 연다 (목록의 카드) */
  onOpen?: (instanceId: string) => void
}) {
  const t = useT()
  const bodyRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [leaders, setLeaders] = useState<Leader[]>([])
  // 같은 부품이 목록과 간이 창에 함께 그려져도 화살촉 id가 겹치지 않게
  const [arrowId] = useState(() => `conn-arrow-${++cardSerial}`)

  // 사진의 왼쪽 반에 있는 핀은 왼쪽 깃발 줄, 나머지는 오른쪽. 줄 안에서는 핀 높이 순 → 선이 덜 엇갈린다
  const [left, right] = useMemo(() => {
    const pins = new Map(part.pins.map((p) => [p.id, p]))
    const flags: Omit<Flag, 'lane' | 'exit'>[] = []
    for (const item of items) {
      const pin = item.end.pinId ? pins.get(item.end.pinId) : undefined
      if (pin) flags.push({ item, pin, key: `${item.label.wireId}-${pin.id}` })
    }
    return [arrange(flags.filter((f) => f.pin.x < 0.5), 'left'), arrange(flags.filter((f) => f.pin.x >= 0.5), 'right')]
  }, [items, part])
  const active = items.some((x) => x.label.wireId === selectedWire)
  const dimmed = (wireId: string) => !!highlight && !highlight.has(wireId)

  // 핀(사진 위 위치) → 사진 옆 틈 → 깃발 끝까지 꺾은 선. 화면 배치가 끝난 뒤 실제 위치를 재서 그린다
  useLayoutEffect(() => {
    const body = bodyRef.current
    const img = imgRef.current
    if (!body || !img) return
    const measure = () => {
      const b = body.getBoundingClientRect()
      const r = img.getBoundingClientRect()
      if (r.width === 0) return
      const next: Leader[] = []
      for (const [side, flags] of [['left', left], ['right', right]] as const) {
        flags.forEach((f) => {
          const el = body.querySelector<HTMLElement>(`[data-flag="${f.key}"]`)
          if (!el) return
          const fr = el.getBoundingClientRect()
          const px = r.left - b.left + f.pin.x * r.width
          const py = r.top - b.top + f.pin.y * r.height
          const fx = (side === 'left' ? fr.right : fr.left) - b.left
          const fy = fr.top + fr.height / 2 - b.top
          const lane = 8 + f.lane * LANE
          const gx = side === 'left' ? r.left - b.left - lane : r.right - b.left + lane
          // 위·아래로 빠지는 핀은 먼저 사진 밖으로 빼고 옆으로 돌린다 → 선이 사진을 덜 가로지른다
          let points: string
          if (f.exit !== 'side') {
            const ey = f.exit === 'top' ? r.top - b.top - lane : r.bottom - b.top + lane
            points = `${px},${py} ${px},${ey} ${gx},${ey} ${gx},${fy} ${fx},${fy}`
          } else {
            points = `${px},${py} ${gx},${py} ${gx},${fy} ${fx},${fy}`
          }
          const wireId = f.item.label.wireId
          next.push({ key: f.key, points, role: f.item.role, on: wireId === selectedWire, dim: dimmed(wireId) })
        })
      }
      setLeaders(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(body)
    img.addEventListener('load', measure)
    return () => {
      ro.disconnect()
      img.removeEventListener('load', measure)
    }
  }, [left, right, selectedWire, highlight]) // dimmed는 highlight에서 나온다

  const flag = (f: Flag, side: 'left' | 'right') => {
    const { label, end, role } = f.item
    const on = label.wireId === selectedWire
    return (
      <button
        key={f.key}
        data-flag={f.key}
        className={['conn-flag', role, side, on && 'on', dimmed(label.wireId) && 'dim'].filter(Boolean).join(' ')}
        aria-pressed={on}
        aria-label={label.name}
        title={`${end.pinLabel} · ${label.name}`}
        onClick={() => onPick(label.wireId)}
      >
        <span className="conn-flag-body">
          <span className="conn-pin">{end.pinLabel}</span>
          <span className="conn-swatch" style={{ background: label.color }} />
          <span className="conn-name">
            <FlagText item={f.item} />
          </span>
        </span>
      </button>
    )
  }

  return (
    <article
      className={['conn-card', active && 'active', large && 'large'].filter(Boolean).join(' ')}
      data-card={instance.id}
      data-testid={`conn-card-${instance.refDes}`}
    >
      <header className="conn-card-header">
        <span>
          <strong>{instance.refDes}</strong> {part.name}
        </span>
        {onOpen && (
          <button className="link" onClick={() => onOpen(instance.id)}>
            {t('연결 보기')}
          </button>
        )}
      </header>
      <div className="conn-body" ref={bodyRef}>
        <div className="conn-flags left">{left.map((f) => flag(f, 'left'))}</div>
        <div className="conn-photo">
          <img
            ref={imgRef}
            src={part.image.data}
            alt={part.name}
            draggable={false}
            className={onOpen ? 'openable' : undefined}
            title={onOpen ? t('이어진 부품 보기') : undefined}
            onClick={onOpen && (() => onOpen(instance.id))}
          />
          {[...left, ...right].map((f) => (
            <span
              key={f.key}
              className={f.item.label.wireId === selectedWire ? 'conn-dot on' : 'conn-dot'}
              style={{ left: `${f.pin.x * 100}%`, top: `${f.pin.y * 100}%` }}
            />
          ))}
        </div>
        <div className="conn-flags right">{right.map((f) => flag(f, 'right'))}</div>
        <svg className="conn-leaders" aria-hidden>
          <defs>
            {(['', 'on'] as const).map((v) => (
              <marker key={v} id={`${arrowId}${v}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L8,4 L0,8 z" className={v ? 'on' : undefined} />
              </marker>
            ))}
          </defs>
          {leaders.map((l) => (
            <polyline
              key={l.key}
              className={l.on ? 'on' : l.dim ? 'dim' : undefined}
              points={l.points}
              // 신호가 흐르는 쪽에 화살촉: 보냄 = 깃발 쪽, 받음 = 핀 쪽, 양방향 = 둘 다
              markerEnd={l.role !== 'from' ? `url(#${arrowId}${l.on ? 'on' : ''})` : undefined}
              markerStart={l.role !== 'goto' ? `url(#${arrowId}${l.on ? 'on' : ''})` : undefined}
            />
          ))}
        </svg>
      </div>
    </article>
  )
})
