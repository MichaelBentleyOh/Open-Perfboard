import { useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { PIN_ELECTRICALS, SYMBOL_SIDES, type Connector, type Drawing, type Pin, type PinElectrical, type Shape, type SymbolPin, type SymbolSide, type TextAlign } from '@core/model'
import { PIN_ELECTRICAL_LABEL, SYMBOL_PIN_LENGTH, autoSymbol, fitSymbol, freeSpot, missingPins, overlappingPins, pinLabel, placePin } from '@core/symbol'
import {
  alignShapes,
  clampSize,
  duplicateShapes,
  fitDrawing,
  moveShapes,
  pasteShapes,
  removeShapes,
  reorder,
  resizeDrawing,
  updateShapes,
  type Align,
  type Order
} from '@core/drawing'
import { STUDIO_SHORTCUTS, matchCombo, type StudioShortcutId } from '@core/keymap'
import { readImageFile } from '@/features/part-editor/image'
import { msg } from '@core/i18n'
import { useT } from '@/i18n'
import { DrawingCanvas, type DrawTool } from './DrawingCanvas'

/** 기호 모드에서 그림과 함께 고치는 것 (038) */
export interface SymbolExtras {
  pins: SymbolPin[]
  showNumbers?: boolean
  showNames?: boolean
}

/** 회로도 기호 모드 (038): 격자 항상 켬, 사진 넣기 없음, 기호 핀 층 */
export interface SymbolMode {
  extras: SymbolExtras
  partName: string
  partPins: readonly Pin[]
  connectors: readonly Connector[]
  /** 핀의 전기 종류는 부품 핀의 성질 → 편집기 draft에서 바꾼다 (그림판 실행 취소 밖) */
  onElectrical: (pinId: string, value: PinElectrical) => void
}

/** 한 번의 사용자 동작 전 상태. 핀은 그림판 크기를 바꿀 때만, 기호 핀은 기호 모드에서 늘 함께 돌아간다 */
interface Snapshot {
  drawing: Drawing
  pins?: Pin[]
  extras?: SymbolExtras
}

/** 작업실 안 복사한 도형 (다른 부품 그림에 붙여넣기 가능) */
let clipboard: Shape[] = []

const TOOLS: { id: DrawTool; label: string; key: string }[] = [
  { id: 'select', label: '↖', key: 'V' },
  { id: 'rect', label: '▭', key: 'R' },
  { id: 'ellipse', label: '◯', key: 'O' },
  { id: 'line', label: '╱', key: 'L' },
  { id: 'text', label: 'T', key: 'T' }
]
const TOOL_NAMES: Record<DrawTool, string> = { select: msg('선택'), rect: msg('상자'), ellipse: msg('원'), line: msg('선'), text: msg('글상자') }
const SHAPE_NAMES: Record<Shape['type'], string> = { rect: msg('상자'), ellipse: msg('원'), line: msg('선'), text: msg('글상자'), image: msg('사진') }

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

interface Props {
  drawing: Drawing
  pins: readonly Pin[]
  /** 그림이 바뀜 (pins가 있으면 핀도 함께 바뀜: 그림판 크기, extras가 있으면 기호 핀도) */
  onChange: (d: Drawing, pins?: Pin[], extras?: SymbolExtras) => void
  /** 사진 넣기의 긴 변 한도 */
  maxImageSide?: number
  /** 있으면 회로도 기호 모드 */
  symbol?: SymbolMode
}

/**
 * 부품 그림판 (037b): 도구 막대 + 그림판 + 속성 칸.
 * 실행 취소 기록은 이 패널 안에만 있다 (작업실 전용, 배선도 기록과 따로)
 */
export function DrawingPanel({ drawing, pins, onChange, maxImageSide = 1600, symbol }: Props) {
  const t = useT()
  const [tool, setTool] = useState<DrawTool>('select')
  const [selected, setSelectedShapes] = useState<string[]>([])
  /** 고른 기호 핀 (도형 선택과 함께 쓰지 않는다) */
  const [selectedPin, setSelectedPin] = useState<string | null>(null)
  const setSelected = (ids: string[] | ((prev: string[]) => string[])) => {
    setSelectedShapes(ids)
    setSelectedPin(null)
  }
  const [gridPref, setGrid] = useState(false)
  // 기호는 핀 끝점이 격자 위에 있어야 하므로 늘 격자 맞춤
  const grid = symbol ? true : gridPref
  const extras = symbol?.extras
  const [past, setPast] = useState<Snapshot[]>([])
  const [future, setFuture] = useState<Snapshot[]>([])
  const [finishSignal, setFinishSignal] = useState(0)
  const [cancelSignal, setCancelSignal] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 키 처리기는 ref로 최신 값을 읽는다
  const state = useRef({ drawing, pins, selected, selectedPin, tool, past, future, extras })
  state.current = { drawing, pins, selected, selectedPin, tool, past, future, extras }

  /** 지금 상태를 기록용으로 (기호 모드면 기호 핀도) */
  const snap = (withPins: boolean): Snapshot => {
    const cur = state.current
    return { drawing: cur.drawing, ...(withPins ? { pins: [...cur.pins] } : {}), ...(cur.extras ? { extras: cur.extras } : {}) }
  }
  /** 한 동작을 반영하고 기록에 남긴다 */
  const commit = (next: Drawing, nextPins?: Pin[], nextExtras?: SymbolExtras) => {
    const cur = state.current
    if (next === cur.drawing && !nextPins && !nextExtras) return
    setPast((p) => [...p.slice(-199), snap(!!nextPins)])
    setFuture([])
    onChange(next, nextPins, nextExtras)
  }
  const commitExtras = (next: SymbolExtras) => commit(state.current.drawing, undefined, next)
  const undo = () => {
    const cur = state.current
    const last = cur.past[cur.past.length - 1]
    if (!last) return
    setPast(cur.past.slice(0, -1))
    setFuture([...cur.future, snap(!!last.pins)])
    onChange(last.drawing, last.pins, last.extras)
    setSelected((s) => s.filter((id) => last.drawing.shapes.some((x) => x.id === id)))
  }
  const redo = () => {
    const cur = state.current
    const next = cur.future[cur.future.length - 1]
    if (!next) return
    setFuture(cur.future.slice(0, -1))
    setPast([...cur.past, snap(!!next.pins)])
    onChange(next.drawing, next.pins, next.extras)
  }
  /** 기호로 보는 지금 모습 (core 기호 함수에 넘길 때) */
  const symbolNow = () => ({ drawing: state.current.drawing, ...state.current.extras!, pins: state.current.extras!.pins })

  const sel = drawing.shapes.filter((s) => selected.includes(s.id))
  const one = sel.length === 1 ? sel[0]! : undefined
  const patch = (p: Record<string, unknown>) => commit(updateShapes(state.current.drawing, state.current.selected, p))

  const run = (id: StudioShortcutId, shift: boolean) => {
    const cur = state.current
    const ids = cur.selected
    switch (id) {
      case 'toolSelect':
        return setTool('select')
      case 'toolRect':
        return setTool('rect')
      case 'toolEllipse':
        return setTool('ellipse')
      case 'toolLine':
        return setTool('line')
      case 'toolText':
        return setTool('text')
      case 'finishLine':
        return setFinishSignal((n) => n + 1)
      case 'escape':
        if (cur.tool !== 'select') {
          setCancelSignal((n) => n + 1)
          return setTool('select')
        }
        return setSelected([])
      case 'undo':
        return undo()
      case 'redo':
        return redo()
      case 'copy':
        clipboard = structuredClone(cur.drawing.shapes.filter((s) => ids.includes(s.id)))
        return
      case 'paste': {
        if (clipboard.length === 0) return
        const r = pasteShapes(cur.drawing, clipboard, nanoid)
        commit(r.drawing)
        return setSelected(r.ids)
      }
      case 'duplicate': {
        if (ids.length === 0) return
        const r = duplicateShapes(cur.drawing, ids, nanoid)
        commit(r.drawing)
        return setSelected(r.ids)
      }
      case 'selectAll':
        return setSelected(cur.drawing.shapes.filter((s) => !s.locked).map((s) => s.id))
      case 'delete':
        // 기호 핀을 지우면 기호에서만 빠진다 (부품 핀은 그대로, "놓지 않은 핀"으로)
        if (cur.selectedPin && cur.extras) {
          commitExtras({ ...cur.extras, pins: cur.extras.pins.filter((p) => p.pinId !== cur.selectedPin) })
          return setSelectedPin(null)
        }
        if (ids.length === 0) return
        commit(removeShapes(cur.drawing, ids))
        return setSelected([])
      case 'front':
      case 'back':
      case 'forward':
      case 'backward':
        return commit(reorder(cur.drawing, ids, id))
      case 'nudgeLeft':
      case 'nudgeRight':
      case 'nudgeUp':
      case 'nudgeDown': {
        const n = shift || symbol ? 10 : 1
        const dx = id === 'nudgeLeft' ? -n : id === 'nudgeRight' ? n : 0
        const dy = id === 'nudgeUp' ? -n : id === 'nudgeDown' ? n : 0
        // 기호 핀은 격자 한 칸씩, 쪽은 그대로
        if (cur.selectedPin && cur.extras) {
          const sp = cur.extras.pins.find((p) => p.pinId === cur.selectedPin)
          if (sp) commitExtras({ ...cur.extras, pins: placePin(symbolNow(), sp.pinId, { x: sp.x + dx, y: sp.y + dy }, sp.side).pins })
          return
        }
        if (ids.length) commit(moveShapes(cur.drawing, ids, dx, dy))
        return
      }
    }
  }

  // 단축키: 입력칸 밖에서만, 대화상자가 떠 있으면 무시
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('.modal-backdrop')) return
      const s = STUDIO_SHORTCUTS.find((x) => x.combos.some((c) => matchCombo(e, c)))
      if (!s) return
      e.preventDefault()
      run(s.id, e.shiftKey)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const addImage = async (file: File | undefined) => {
    if (!file) return
    try {
      const img = await readImageFile(file, maxImageSide)
      const d = state.current.drawing
      // 그림판에 들어가게 줄여서 가운데에
      const k = Math.min(1, (d.width * 0.9) / img.width, (d.height * 0.9) / img.height)
      const w = Math.round(img.width * k)
      const h = Math.round(img.height * k)
      const shape: Shape = { id: nanoid(), type: 'image', x: Math.round((d.width - w) / 2), y: Math.round((d.height - h) / 2), w, h, src: img.data }
      commit({ ...d, shapes: [...d.shapes, shape] })
      setSelected([shape.id])
      setTool('select')
      setMessage(null)
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  const resize = (w: number, h: number) => {
    const r = resizeDrawing(state.current.drawing, state.current.pins, w, h)
    commit(r.drawing, r.pins)
    setMessage(r.clamped ? t('그림판 밖으로 나간 핀 {n}개를 가장자리로 옮겼습니다', { n: r.clamped }) : null)
  }

  /** 기호 핀 글자: 핀 id → 번호(J1.3)·이름(신호) */
  const partPins = symbol?.partPins
  const connectors = symbol?.connectors
  const labels = useMemo(
    () => Object.fromEntries((partPins ?? []).map((p) => [p.id, { number: pinLabel(connectors ?? [], p), name: p.signal ?? '' }])),
    [partPins, connectors]
  )

  const order = (o: Order) => commit(reorder(drawing, selected, o))
  const align = (a: Align) => commit(alignShapes(drawing, selected, a))
  const colorOf = (key: 'fill' | 'stroke' | 'color') => {
    const v = one && (one as unknown as Record<string, unknown>)[key]
    return typeof v === 'string' ? v : undefined
  }
  const has = (types: Shape['type'][]) => sel.length > 0 && sel.every((s) => types.includes(s.type))

  return (
    <div className="drawing-panel">
      <div className="drawing-tools" role="toolbar" aria-label={t('그리기 도구')}>
        <div className="segmented">
          {TOOLS.map((x) => (
            <button
              key={x.id}
              className={tool === x.id ? 'active' : ''}
              aria-pressed={tool === x.id}
              aria-label={t(TOOL_NAMES[x.id])}
              title={`${t(TOOL_NAMES[x.id])} (${x.key})`}
              onClick={() => setTool(x.id)}
            >
              {x.label}
            </button>
          ))}
        </div>
        {!symbol && (
          <>
            <button onClick={() => fileRef.current?.click()} title={t('사진을 도형으로 넣기 (PNG·JPG·WebP)')}>
              {t('🖼 사진 넣기')}
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              data-testid="drawing-image-input"
              onChange={(e) => {
                addImage(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <label className="check">
              <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
              {t('격자 맞춤 ({n}px)', { n: 10 })}
            </label>
          </>
        )}
        {symbol && <span className="hint">{t('격자 50 mil · 핀 끝점은 격자에 붙습니다')}</span>}
        <div className="spacer" />
        <button onClick={undo} disabled={past.length === 0} aria-label={t('실행 취소')} title={t('실행 취소 (Ctrl+Z)')}>
          ↶
        </button>
        <button onClick={redo} disabled={future.length === 0} aria-label={t('다시 실행')} title={t('다시 실행 (Ctrl+Y)')}>
          ↷
        </button>
      </div>

      <div className="drawing-body">
        <DrawingCanvas
          drawing={drawing}
          pins={symbol ? [] : pins}
          tool={tool}
          selected={selected}
          grid={grid}
          onCommit={(d) => commit(d)}
          onSelect={setSelected}
          onToolDone={() => setTool('select')}
          onEditText={() => requestAnimationFrame(() => textRef.current?.select())}
          makeId={nanoid}
          finishLineSignal={finishSignal}
          cancelSignal={cancelSignal}
          symbolLayer={
            symbol && extras
              ? {
                  pins: extras.pins,
                  labels,
                  showNumbers: extras.showNumbers !== false,
                  showNames: extras.showNames !== false,
                  selected: selectedPin,
                  onSelect: (id) => {
                    setSelectedShapes([])
                    setSelectedPin(id)
                  },
                  onMove: (id, at) => commitExtras({ ...state.current.extras!, pins: placePin(symbolNow(), id, at).pins })
                }
              : undefined
          }
        />

        <aside className="drawing-props" aria-label={t('도형 속성')}>
          {symbol && extras && selectedPin ? (
            <SymbolPinProps
              pin={extras.pins.find((p) => p.pinId === selectedPin)}
              partPin={symbol.partPins.find((p) => p.id === selectedPin)}
              label={labels[selectedPin]}
              onChange={(next) => commitExtras({ ...extras, pins: extras.pins.map((p) => (p.pinId === next.pinId ? next : p)) })}
              onElectrical={(v) => symbol.onElectrical(selectedPin, v)}
              onRemove={() => run('delete', false)}
            />
          ) : sel.length === 0 && symbol && extras ? (
            <SymbolSection
              symbol={symbol}
              drawing={drawing}
              extras={extras}
              labels={labels}
              onResize={(w, h) => commit({ ...drawing, width: w, height: h })}
              onFit={() => {
                const r = fitSymbol(symbolNow())
                commit(r.drawing, undefined, { ...extras, pins: r.pins })
              }}
              onExtras={commitExtras}
              onPlace={(pinId) => {
                const spot = freeSpot(symbolNow())
                commitExtras({ ...extras, pins: placePin(symbolNow(), pinId, spot, spot.side).pins })
                setSelectedShapes([])
                setSelectedPin(pinId)
              }}
              onRebuild={() => {
                if (drawing.shapes.length && !window.confirm(t('지금 기호를 지우고 기본 기호로 다시 만들까요?'))) return
                const auto = autoSymbol({ name: symbol.partName, pins: [...symbol.partPins], connectors: [...symbol.connectors] }, nanoid)
                commit(auto.drawing, undefined, { ...extras, pins: auto.pins })
                setSelected([])
              }}
            />
          ) : sel.length === 0 ? (
            <>
              <h4>{t('그림판')}</h4>
              <ArtboardSize width={drawing.width} height={drawing.height} onApply={resize} />
              <label className="field">
                <span>{t('배경')}</span>
                <span className="price-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!drawing.background}
                      onChange={(e) => commit({ ...drawing, ...(e.target.checked ? { background: undefined } : { background: '#ffffff' }) })}
                    />
                    {t('투명')}
                  </label>
                  {drawing.background && (
                    <input type="color" aria-label={t('배경색')} value={drawing.background} onChange={(e) => commit({ ...drawing, background: e.target.value })} />
                  )}
                </span>
              </label>
              <button
                onClick={() => {
                  const r = fitDrawing(drawing, pins)
                  commit(r.drawing, r.pins)
                }}
                disabled={drawing.shapes.length === 0}
                title={t('그린 것 둘레에 맞게 그림판 크기를 줄이거나 늘립니다 (핀 자리는 그대로)')}
              >
                {t('내용에 맞추기')}
              </button>
              <p className="hint">{t('도형 {n}개 · 도구를 골라 그림판에 그리세요. 점선 밖은 사진에 들어가지 않습니다.', { n: drawing.shapes.length })}</p>
            </>
          ) : (
            <>
              <h4>{one ? t(SHAPE_NAMES[one.type]) : t('도형 {n}개', { n: sel.length })}</h4>
              {has(['rect', 'ellipse']) && (
                <ColorRow label={t('채우기')} value={colorOf('fill')} onChange={(v) => patch({ fill: v })} allowNone />
              )}
              {has(['rect', 'ellipse', 'line']) && (
                <>
                  <ColorRow label={t('선 색')} value={colorOf('stroke')} onChange={(v) => patch({ stroke: v })} allowNone={!has(['line'])} />
                  <NumberRow
                    label={t('선 굵기')}
                    value={one && 'strokeWidth' in one ? one.strokeWidth : undefined}
                    min={0}
                    max={50}
                    onChange={(v) => patch({ strokeWidth: v })}
                  />
                </>
              )}
              {has(['rect']) && <NumberRow label={t('둥글기')} value={one?.type === 'rect' ? (one.radius ?? 0) : undefined} min={0} max={500} onChange={(v) => patch({ radius: v || undefined })} />}
              {has(['line']) && (
                <div className="field">
                  <span>{t('선 모양')}</span>
                  <span className="check-row">
                    <CheckBox label={t('시작 화살표')} value={one?.type === 'line' && !!one.arrowStart} onChange={(v) => patch({ arrowStart: v || undefined })} />
                    <CheckBox label={t('끝 화살표')} value={one?.type === 'line' && !!one.arrowEnd} onChange={(v) => patch({ arrowEnd: v || undefined })} />
                    <CheckBox label={t('점선')} value={one?.type === 'line' && !!one.dashed} onChange={(v) => patch({ dashed: v || undefined })} />
                  </span>
                </div>
              )}
              {one?.type === 'text' && (
                <>
                  <label className="field">
                    <span>{t('글')}</span>
                    <textarea ref={textRef} rows={3} aria-label={t('글상자 내용')} value={one.text} onChange={(e) => patch({ text: e.target.value })} />
                  </label>
                  <NumberRow label={t('글자 크기')} value={one.fontSize} min={4} max={400} onChange={(v) => patch({ fontSize: v || 12 })} />
                  <ColorRow label={t('글자 색')} value={one.color} onChange={(v) => v && patch({ color: v })} />
                  <div className="field">
                    <span>{t('모양')}</span>
                    <span className="check-row">
                      <CheckBox label={t('굵게')} value={!!one.bold} onChange={(v) => patch({ bold: v || undefined })} />
                      <select aria-label={t('정렬')} value={one.align ?? 'left'} onChange={(e) => patch({ align: e.target.value as TextAlign })}>
                        <option value="left">{t('왼쪽')}</option>
                        <option value="center">{t('가운데')}</option>
                        <option value="right">{t('오른쪽')}</option>
                      </select>
                    </span>
                  </div>
                </>
              )}
              <NumberRow
                label={t('투명도 (%)')}
                value={one ? Math.round((1 - (one.opacity ?? 1)) * 100) : undefined}
                min={0}
                max={100}
                onChange={(v) => patch({ opacity: v ? Math.round(100 - v) / 100 : undefined })}
              />
              {one && <NumberRow label={t('회전 (°)')} value={one.rotation ?? 0} min={-360} max={360} onChange={(v) => patch({ rotation: v || undefined })} />}
              <div className="field">
                <span>{t('순서')}</span>
                <span className="button-row">
                  <button onClick={() => order('front')} title={t('맨 앞으로 (Ctrl+Shift+])')}>{t('맨 앞')}</button>
                  <button onClick={() => order('forward')} title={t('앞으로 (Ctrl+])')}>{t('앞')}</button>
                  <button onClick={() => order('backward')} title={t('뒤로 (Ctrl+[)')}>{t('뒤')}</button>
                  <button onClick={() => order('back')} title={t('맨 뒤로 (Ctrl+Shift+[)')}>{t('맨 뒤')}</button>
                </span>
              </div>
              <div className="field">
                <span>{t('정렬')}</span>
                <span className="button-row align-row" title={t('둘 이상이면 서로, 하나면 그림판에 맞춥니다')}>
                  {(
                    [
                      ['left', '⇤', msg('왼쪽')],
                      ['centerX', '↔', msg('가로 가운데')],
                      ['right', '⇥', msg('오른쪽')],
                      ['top', '⤒', msg('위')],
                      ['middle', '↕', msg('세로 가운데')],
                      ['bottom', '⤓', msg('아래')]
                    ] as const
                  ).map(([a, icon, name]) => (
                    <button key={a} className="icon" aria-label={t(name)} title={t(name)} onClick={() => align(a)}>
                      {icon}
                    </button>
                  ))}
                </span>
              </div>
              <div className="button-row">
                <button onClick={() => run('duplicate', false)}>{t('복제')}</button>
                <button onClick={() => patch({ locked: true })} title={t('잠그면 고르거나 옮길 수 없습니다 (배경 사진 등)')}>
                  {t('잠그기')}
                </button>
                <button className="danger" onClick={() => run('delete', false)}>
                  {t('삭제')}
                </button>
              </div>
            </>
          )}
          {drawing.shapes.some((s) => s.locked) && (
            <button className="small" onClick={() => commit(updateShapes(drawing, drawing.shapes.filter((s) => s.locked).map((s) => s.id), { locked: undefined }))}>
              {t('잠금 모두 풀기')}
            </button>
          )}
          {message && <p className="warning">{message}</p>}
        </aside>
      </div>
    </div>
  )
}

function ArtboardSize({ width, height, onApply }: { width: number; height: number; onApply: (w: number, h: number) => void }) {
  const t = useT()
  const [w, setW] = useState(String(width))
  const [h, setH] = useState(String(height))
  useEffect(() => {
    setW(String(width))
    setH(String(height))
  }, [width, height])
  const apply = () => {
    const nw = clampSize(Number(w) || width)
    const nh = clampSize(Number(h) || height)
    if (nw !== width || nh !== height) onApply(nw, nh)
    else {
      setW(String(width))
      setH(String(height))
    }
  }
  const onKey = (e: React.KeyboardEvent) => e.key === 'Enter' && apply()
  return (
    <div className="field">
      <span>{t('크기 (px)')}</span>
      <span className="price-row">
        <input aria-label={t('그림판 너비')} inputMode="numeric" value={w} onChange={(e) => setW(e.target.value)} onBlur={apply} onKeyDown={onKey} />
        ×
        <input aria-label={t('그림판 높이')} inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} onBlur={apply} onKeyDown={onKey} />
      </span>
    </div>
  )
}

function ColorRow({ label, value, onChange, allowNone }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void; allowNone?: boolean }) {
  const t = useT()
  return (
    <div className="field">
      <span>{label}</span>
      <span className="price-row">
        {allowNone && (
          <label className="check">
            <input type="checkbox" checked={!value} onChange={(e) => onChange(e.target.checked ? undefined : '#9e9e9e')} />
            {t('없음')}
          </label>
        )}
        {(value || !allowNone) && <input type="color" aria-label={label} value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} />}
      </span>
    </div>
  )
}

/** 숫자 칸: 입력을 마치면(Enter·포커스 나감) 한 번 반영 → 실행 취소 1회 */
function NumberRow({ label, value, min, max, onChange }: { label: string; value: number | undefined; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  useEffect(() => setText(value === undefined ? '' : String(value)), [value])
  const apply = () => {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n)) return setText(value === undefined ? '' : String(value))
    const v = Math.min(max, Math.max(min, n))
    if (v !== value) onChange(v)
    else setText(String(v))
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode="decimal" aria-label={label} value={text} placeholder="—" onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />
    </label>
  )
}

function CheckBox({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

/** 고른 기호 핀: 쪽·길이·전기 종류 */
function SymbolPinProps({
  pin,
  partPin,
  label,
  onChange,
  onElectrical,
  onRemove
}: {
  pin: SymbolPin | undefined
  partPin: Pin | undefined
  label: { number: string; name: string } | undefined
  onChange: (p: SymbolPin) => void
  onElectrical: (v: PinElectrical) => void
  onRemove: () => void
}) {
  const t = useT()
  if (!pin || !partPin) return null
  const SIDE_NAMES: Record<SymbolSide, string> = { left: t('왼쪽'), right: t('오른쪽'), top: t('위'), bottom: t('아래') }
  return (
    <>
      <h4>
        {t('기호 핀')} {label?.number}
        {label?.name ? ` · ${label.name}` : ''}
      </h4>
      <label className="field">
        <span>{t('붙는 쪽')}</span>
        <select aria-label={t('붙는 쪽')} value={pin.side} onChange={(e) => onChange({ ...pin, side: e.target.value as SymbolSide })}>
          {SYMBOL_SIDES.map((s) => (
            <option key={s} value={s}>
              {SIDE_NAMES[s]}
            </option>
          ))}
        </select>
      </label>
      <NumberRow
        label={t('핀 길이')}
        value={pin.length ?? SYMBOL_PIN_LENGTH}
        min={0}
        max={200}
        onChange={(v) => {
          const length = Math.round(v / 10) * 10
          const { length: _, ...rest } = pin
          onChange(length === SYMBOL_PIN_LENGTH ? rest : { ...rest, length })
        }}
      />
      <label className="field">
        <span>{t('전기 종류')}</span>
        <select aria-label={t('전기 종류')} value={partPin.electrical ?? 'passive'} onChange={(e) => onElectrical(e.target.value as PinElectrical)}>
          {PIN_ELECTRICALS.map((k) => (
            <option key={k} value={k}>
              {t(PIN_ELECTRICAL_LABEL[k])}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{t('끌어서 옮기면 격자와 몸통 가장자리에 맞춰집니다. 방향키 = 한 칸. 신호 이름은 핀 탭에서 고칩니다.')}</p>
      <div className="button-row">
        <button onClick={onRemove} title={t('기호에서만 뺍니다 (부품 핀은 그대로)')}>
          {t('기호에서 빼기')}
        </button>
      </div>
    </>
  )
}

/** 아무것도 안 골랐을 때 (기호 모드): 그림판 크기, 놓지 않은 핀, 보이기, 기본 기호 */
function SymbolSection({
  symbol,
  drawing,
  extras,
  labels,
  onResize,
  onFit,
  onExtras,
  onPlace,
  onRebuild
}: {
  symbol: SymbolMode
  drawing: Drawing
  extras: SymbolExtras
  labels: Record<string, { number: string; name: string }>
  onResize: (w: number, h: number) => void
  onFit: () => void
  onExtras: (e: SymbolExtras) => void
  onPlace: (pinId: string) => void
  onRebuild: () => void
}) {
  const t = useT()
  const missing = missingPins({ pins: [...symbol.partPins], connectors: [...symbol.connectors] }, { drawing, ...extras })
  const overlaps = overlappingPins({ drawing, ...extras })
  return (
    <>
      <h4>{t('기호')}</h4>
      <ArtboardSize width={drawing.width} height={drawing.height} onApply={onResize} />
      <button onClick={onFit} title={t('도형과 핀 둘레에 맞게 그림판 크기를 맞춥니다')}>
        {t('내용에 맞추기')}
      </button>
      <div className="check-row">
        <CheckBox label={t('핀 번호')} value={extras.showNumbers !== false} onChange={(v) => onExtras({ ...extras, showNumbers: v ? undefined : false })} />
        <CheckBox label={t('핀 이름')} value={extras.showNames !== false} onChange={(v) => onExtras({ ...extras, showNames: v ? undefined : false })} />
      </div>
      <h4>{t('놓지 않은 핀 ({n})', { n: missing.length })}</h4>
      {missing.length === 0 ? (
        <p className="hint">{t('모든 핀을 기호에 놓았습니다.')}</p>
      ) : (
        <ul className="missing-pins" aria-label={t('놓지 않은 핀')}>
          {missing.map((p) => (
            <li key={p.id}>
              <button onClick={() => onPlace(p.id)} title={t('빈 자리에 놓기')}>
                {labels[p.id]?.number ?? p.number}
                {p.signal ? ` · ${p.signal}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      {overlaps.length > 0 && (
        <p className="warning">
          {t('끝점이 겹친 핀이 있습니다 (회로도에서 서로 이어져 버림): {pins}', {
            pins: overlaps.map((ids) => ids.map((id) => labels[id]?.number ?? id).join('·')).join(', ')
          })}
        </p>
      )}
      <button onClick={onRebuild}>{t('기본 기호로 다시 만들기')}</button>
      <p className="hint">{t('도형 도구로 몸통을 그리고, 핀을 끌어 자리를 잡으세요. 핀을 누르면 쪽·길이·전기 종류를 바꿀 수 있습니다.')}</p>
    </>
  )
}
