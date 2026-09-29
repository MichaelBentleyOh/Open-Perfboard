import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { nanoid } from 'nanoid'
import type { PartDef } from '@core/model'
import {
  addConnector,
  addPin,
  checkDraft,
  finalizeDraft,
  movePin,
  removeConnector,
  removePin,
  updateConnector,
  updatePin,
  type PartDraft
} from '@core/part'
import { parseAmount } from '@core/money'
import { housingsByType } from '@core/supply'
import { useSupplyStore } from '@/stores/supplyStore'
import { readImageFile } from './image'
import { addAttachments, removeAttachment, renameAttachment } from '@core/attachment'
import { AttachmentList } from '@/features/attachments/AttachmentList'
import { useAttachmentRevision } from '@/services/attachmentService'
import { PinCanvas, type PinTool } from './PinCanvas'
import { connectorColor } from './connectorColor'
import { evenPoints, pinsOnGuide, respacePins, type Guide, type Point } from '@core/guide'
import { drawingFromImage, emptyDrawing } from '@core/drawing'
import { DrawingPanel } from '@/features/studio/drawing/DrawingPanel'
import { bakeDrawing, PART_BAKE_MAX } from '@/features/studio/drawing/bake'
import { useT } from '@/i18n'

interface Props {
  initial: PartDraft
  isNew: boolean
  onCancel: () => void
  onSave: (part: PartDef) => Promise<void>
  /** modal: 배선도 부품함 창의 빠른 편집 · panel: 부품 작업실 안 (037a) */
  variant?: 'modal' | 'panel'
  /** 고친 게 있는지 (작업실이 다른 항목으로 바꿀 때 묻는 데 씀) */
  onDirtyChange?: (dirty: boolean) => void
}

/** 부품 추가/편집. 편집 내용은 저장 전까지 이 컴포넌트 안에만 있다 */
export function PartEditor({ initial, isNew, onCancel, onSave, variant = 'modal', onDirtyChange }: Props) {
  const t = useT()
  const [draft, setDraft] = useState<PartDraft>(initial)
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null)
  /** 새로 찍는 핀이 들어갈 커넥터 */
  const [activeConnectorId, setActiveConnectorId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  /** 단가 입력 원문 ("12,500" 같은 쉼표 입력을 유지하려고 따로 둔다) */
  const [priceText, setPriceText] = useState(initial.unitPrice === undefined ? '' : initial.unitPrice.toLocaleString('ko-KR'))
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const check = checkDraft(draft, t)
  // 커넥터 종류: 부속 부품 하우징의 "짝 커넥터"에서 고르거나 직접 입력 (027)
  const supplies = useSupplyStore((s) => s.supplies)
  const housings = useMemo(() => housingsByType(supplies), [supplies])
  // 보조선 (026): 편집하는 동안만 있고 저장하지 않는다
  const [tool, setTool] = useState<PinTool>('pin')
  const [guides, setGuides] = useState<Guide[]>([])
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null)
  const [snap, setSnap] = useState(true)
  const [evenCount, setEvenCount] = useState('4')
  const [preview, setPreview] = useState<Point[]>([])
  const selectedGuide = guides.find((g) => g.id === selectedGuideId)
  // 보조선 위 핀을 찾는 허용 거리: 사진 긴 변의 0.5% (붙여 찍은 핀은 거의 0)
  const imageScale = draft.image ? { x: draft.image.width, y: draft.image.height } : { x: 1, y: 1 }
  const onGuideTolerance = Math.max(imageScale.x, imageScale.y) * 0.005
  const count = Math.min(200, Math.max(1, Math.floor(Number(evenCount)) || 1))

  // 그림 (037b, 작업실에서만): 그림 탭에서 그리고, 핀 탭으로 갈 때·저장할 때 PNG로 굽는다
  const [view, setView] = useState<'draw' | 'pins'>(variant === 'panel' && (isNew || initial.drawing) ? 'draw' : 'pins')
  /** 그림을 고쳤는데 아직 사진으로 굽지 않았다 */
  const stale = useRef(false)
  const [baking, setBaking] = useState(false)
  const draftRef = useRef(draft)
  draftRef.current = draft
  /** 그림판에 보일 그림: 원본이 없으면 지금 사진 한 장(또는 빈 그림판)에서 시작 (고치기 전까지는 draft를 바꾸지 않는다) */
  const drawingNow = useMemo(
    () => draft.drawing ?? (draft.image ? drawingFromImage(draft.image.data, draft.image.width, draft.image.height, 'photo') : emptyDrawing()),
    [draft.drawing, draft.image]
  )
  /** 고친 그림을 사진으로 굽는다. 구운 draft를 돌려준다 */
  const bake = async (d: PartDraft): Promise<PartDraft> => {
    if (!stale.current || !d.drawing) return d
    setBaking(true)
    try {
      const image = await bakeDrawing(d.drawing, PART_BAKE_MAX)
      stale.current = false
      const next = { ...draftRef.current, image }
      setDraft(next)
      return next
    } finally {
      setBaking(false)
    }
  }
  const showPins = async () => {
    try {
      await bake(draftRef.current)
      setView('pins')
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  const selectPin = (id: string | null) => {
    setSelectedPinId(id)
    if (id) setSelectedGuideId(null)
  }
  const selectGuide = (id: string | null) => {
    setSelectedGuideId(id)
    if (id) setSelectedPinId(null)
  }
  /** 고른 보조선에 핀 n개를 같은 간격으로 (양 끝 포함) */
  const placeEven = () => {
    if (!selectedGuide) return
    setDraft((d) =>
      evenPoints(selectedGuide.a, selectedGuide.b, count).reduce(
        (acc, p) => addPin(acc, { id: nanoid(), x: p.x, y: p.y, connectorId: activeConnectorId || undefined }),
        d
      )
    )
    setPreview([])
  }
  /** 고른 보조선 위의 핀을 첫 핀 ~ 끝 핀 사이에 같은 간격으로 */
  const respace = () => {
    if (!selectedGuide) return
    setDraft((d) => respacePins(d.pins, selectedGuide, onGuideTolerance, imageScale).reduce((acc, m) => movePin(acc, m.id, m.x, m.y), d))
  }
  const onGuidePins = selectedGuide ? pinsOnGuide(draft.pins, selectedGuide, onGuideTolerance, imageScale).length : 0

  // 입력칸 밖에서 Delete/Backspace → 선택한 핀(또는 보조선) 삭제, Esc → 선택 해제
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      // 그림 탭의 키는 그림판이 처리한다
      if (view === 'draw') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPinId) {
        setDraft((d) => removePin(d, selectedPinId))
        setSelectedPinId(null)
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedGuideId) {
        setGuides((gs) => gs.filter((g) => g.id !== selectedGuideId))
        setSelectedGuideId(null)
      } else if (e.key === 'Escape') {
        setSelectedPinId(null)
        setSelectedGuideId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedPinId, selectedGuideId, view])

  const dirty = draft !== initial
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  const set = <K extends keyof PartDraft>(key: K, value: PartDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    try {
      if (draft.drawing && draft.drawing.shapes.length > 1 && !window.confirm(t('그린 그림을 이 사진 한 장으로 바꿀까요?'))) return
      const image = await readImageFile(file)
      // 사진을 바꾸면 그림 원본은 그 사진 한 장이 된다 (배선도 빠른 편집에서는 원본을 뺀다)
      setDraft((d) => ({ ...d, image, drawing: variant === 'panel' ? drawingFromImage(image.data, image.width, image.height, 'photo') : undefined }))
      stale.current = false
      // 사진을 불러왔으면 바로 핀을 찍을 수 있게
      setView('pins')
      setMessage(null)
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  const addFiles = async () => {
    try {
      const r = await window.api.attachments.add()
      if (r.attachments.length) {
        setDraft((d) => addAttachments(d, r.attachments))
        useAttachmentRevision.getState().bump()
      }
      setMessage(r.problems.length ? r.problems.join('\n') : null)
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const part = finalizeDraft(await bake(draft))
      if (!part) {
        setSaving(false)
        return
      }
      await onSave(part)
    } catch (e) {
      setMessage(t('저장하지 못했습니다: {detail}', { detail: (e as Error).message }))
      setSaving(false)
    }
  }

  return (
    <EditorFrame variant={variant} className="part-editor" label={t('부품 편집')}>
        <header className="modal-header">
          <h2>{isNew ? t('새 부품 만들기') : t('부품 편집 — {name}', { name: initial.name })}</h2>
        </header>

        <div className="part-editor-body">
          <section className="photo-area">
            {variant === 'panel' && (
              <div className="segmented editor-view-tabs" role="tablist" aria-label={t('편집 화면')}>
                <button role="tab" aria-selected={view === 'draw'} className={view === 'draw' ? 'active' : ''} onClick={() => setView('draw')}>
                  {t('✏ 그림')}
                </button>
                <button role="tab" aria-selected={view === 'pins'} className={view === 'pins' ? 'active' : ''} onClick={showPins} disabled={baking}>
                  {baking ? t('사진 만드는 중…') : t('● 핀')}
                </button>
              </div>
            )}
            {variant === 'panel' && view === 'draw' ? (
              <DrawingPanel
                drawing={drawingNow}
                pins={draft.pins}
                onChange={(drawing, pins) => {
                  stale.current = true
                  setDraft((d) => ({ ...d, drawing, ...(pins ? { pins } : {}) }))
                }}
              />
            ) : (
            <>
            {draft.image && (
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
            )}
            {draft.image ? (
              <PinCanvas
                image={draft.image}
                pins={draft.pins}
                connectors={draft.connectors}
                selectedPinId={selectedPinId}
                onAddPin={(x, y) => {
                  const id = nanoid()
                  setDraft((d) => addPin(d, { id, x, y, connectorId: activeConnectorId || undefined }))
                  selectPin(id)
                }}
                onMovePin={(id, x, y) => setDraft((d) => movePin(d, id, x, y))}
                onSelectPin={selectPin}
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
            ) : (
              <div className="photo-empty">
                <p>{variant === 'panel' ? t('부품 사진을 불러오거나 그림 탭에서 그리세요.') : t('부품 사진을 불러오세요.')}</p>
                <button onClick={() => fileRef.current?.click()}>{t('사진 불러오기')}</button>
              </div>
            )}
            <p className="hint">
              {tool === 'pin'
                ? t('사진을 클릭하면 핀이 추가됩니다 · 핀은 드래그로 이동 · 선택 후 Delete로 삭제 · 보조선 가까이 찍으면 선 위에 붙습니다')
                : t('사진 위를 끌어 보조선을 긋습니다 (수평·수직에 가까우면 곧게, Shift = 자유 각도) · 선을 눌러 고르고 끝점 손잡이로 조절 · Delete로 삭제')}
            </p>
            </>
            )}
          </section>

          <section className="form-area">
            <div className="field-row">
              <button onClick={() => fileRef.current?.click()}>{draft.image ? t('사진 바꾸기') : t('사진 불러오기')}</button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                data-testid="photo-input"
                onChange={(e) => {
                  handleFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>

            <h3>{t('기본 정보')}</h3>
            <label className="field">
              <span>{t('이름 *')}</span>
              <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="제어 보드 CB-100" autoFocus />
            </label>
            <label className="field">
              <span>{t('품번')}</span>
              <input value={draft.partNumber ?? ''} onChange={(e) => set('partNumber', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('제조사')}</span>
              <input value={draft.manufacturer ?? ''} onChange={(e) => set('manufacturer', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('조달처')}</span>
              <input value={draft.supplier ?? ''} placeholder={t('구매처 (예: 온라인 부품몰)')} onChange={(e) => set('supplier', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('기본 단가')}</span>
              <span className="price-row">
                <input
                  inputMode="decimal"
                  placeholder={t('BOM에서 배선도마다 바꿀 수 있음')}
                  value={priceText}
                  onChange={(e) => {
                    setPriceText(e.target.value)
                    const n = parseAmount(e.target.value)
                    set('unitPrice', n === undefined ? undefined : n)
                  }}
                />
                <select
                  aria-label={t('단가 통화')}
                  value={draft.currency ?? 'KRW'}
                  onChange={(e) => set('currency', e.target.value === 'USD' ? 'USD' : undefined)}
                >
                  <option value="KRW">{t('원 (₩)')}</option>
                  <option value="USD">{t('달러 ($)')}</option>
                </select>
              </span>
            </label>
            <label className="field">
              <span>{t('구매 링크')}</span>
              <input
                type="url"
                value={draft.purchaseUrl ?? ''}
                onChange={(e) => set('purchaseUrl', e.target.value)}
                placeholder="https://..."
              />
            </label>
            <label className="field">
              <span>{t('참조명 접두사')}</span>
              <input
                value={draft.refPrefix ?? ''}
                onChange={(e) => set('refPrefix', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                placeholder="U (J, BT, R ...)"
              />
            </label>
            <label className="field">
              <span>{t('메모')}</span>
              <textarea rows={2} value={draft.memo ?? ''} onChange={(e) => set('memo', e.target.value)} />
            </label>

            <h3>
              {t('첨부')}
              <button className="small" onClick={addFiles} title={t('데이터시트 PDF, 핀아웃 그림 (최대 30MB)')}>
                {t('＋ 파일 첨부')}
              </button>
            </h3>
            {draft.attachments?.length ? (
              <AttachmentList
                items={draft.attachments}
                onRename={(id, name) => setDraft((d) => renameAttachment(d, id, name))}
                onRemove={(id) => setDraft((d) => removeAttachment(d, id))}
              />
            ) : (
              <p className="empty">{t('데이터시트나 핀아웃 그림을 첨부할 수 있습니다.')}</p>
            )}

            <h3>
              {t('커넥터')}
              <button className="small" onClick={() => setDraft((d) => addConnector(d, { id: nanoid() }))}>
                {t('＋ 커넥터')}
              </button>
            </h3>
            {draft.connectors.length === 0 ? (
              <p className="empty">{t('커넥터 없이 핀만 써도 됩니다.')}</p>
            ) : (
              <table className="grid-table">
                <thead>
                  <tr>
                    <th />
                    <th>{t('이름')}</th>
                    <th>{t('종류')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.connectors.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span className="swatch" style={{ background: connectorColor(draft.connectors, c.id) }} />
                      </td>
                      <td>
                        <input value={c.name} onChange={(e) => setDraft((d) => updateConnector(d, c.id, { name: e.target.value }))} />
                      </td>
                      <td>
                        <input
                          aria-label={t('커넥터 종류')}
                          list="connector-type-options"
                          value={c.type}
                          placeholder="JST-XH 4P"
                          onChange={(e) => setDraft((d) => updateConnector(d, c.id, { type: e.target.value }))}
                        />
                        {c.type.trim() && (
                          <small className={housings.get(c.type.trim().toLowerCase()) ? 'mate ok' : 'mate'} data-testid="connector-mate">
                            {housings.get(c.type.trim().toLowerCase())
                              ? t('짝: {name}', { name: housings.get(c.type.trim().toLowerCase())!.name })
                              : t('짝 하우징 미지정')}
                          </small>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon"
                          title={t('커넥터 삭제')}
                          aria-label={t('커넥터 삭제')}
                          onClick={() => {
                            setDraft((d) => removeConnector(d, c.id))
                            if (activeConnectorId === c.id) setActiveConnectorId('')
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <datalist id="connector-type-options">
              {[...housings.values()].map((h) => (
                <option key={h.id} value={h.connectorType} label={h.name} />
              ))}
            </datalist>

            <h3>{t('핀 ({n})', { n: draft.pins.length })}</h3>
            {draft.connectors.length > 0 && (
              <label className="field">
                <span>{t('새 핀의 커넥터')}</span>
                <select value={activeConnectorId} onChange={(e) => setActiveConnectorId(e.target.value)}>
                  <option value="">{t('(없음)')}</option>
                  {draft.connectors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {draft.pins.length === 0 ? (
              <p className="empty">{t('사진을 클릭해 핀을 찍으세요.')}</p>
            ) : (
              <table className="grid-table" data-testid="pin-table">
                <thead>
                  <tr>
                    <th>{t('번호')}</th>
                    <th>{t('신호')}</th>
                    <th>{t('커넥터')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.pins.map((p) => (
                    <tr
                      key={p.id}
                      className={p.id === selectedPinId ? 'selected' : ''}
                      onClick={() => setSelectedPinId(p.id)}
                    >
                      <td>
                        <input
                          className="narrow"
                          aria-label={t('핀 번호')}
                          value={p.number}
                          onChange={(e) => setDraft((d) => updatePin(d, p.id, { number: e.target.value }))}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={t('신호')}
                          value={p.signal ?? ''}
                          placeholder="SDA"
                          onChange={(e) => setDraft((d) => updatePin(d, p.id, { signal: e.target.value }))}
                        />
                      </td>
                      <td>
                        <select
                          value={p.connectorId ?? ''}
                          onChange={(e) =>
                            setDraft((d) => updatePin(d, p.id, { connectorId: e.target.value || null }))
                          }
                        >
                          <option value="">-</option>
                          {draft.connectors.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          className="icon"
                          title={t('핀 삭제')}
                          aria-label={t('핀 삭제')}
                          onClick={(e) => {
                            e.stopPropagation()
                            setDraft((d) => removePin(d, p.id))
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <footer className="modal-footer">
          <div className="messages">
            {message && <p className="error">{message}</p>}
            {check.errors.map((m) => (
              <p key={m} className="error">
                {m}
              </p>
            ))}
            {check.warnings.map((m) => (
              <p key={m} className="warning">
                {m}
              </p>
            ))}
          </div>
          <button onClick={onCancel} disabled={saving || (variant === 'panel' && !dirty && !isNew)}>
            {variant === 'panel' ? t('되돌리기') : t('취소')}
          </button>
          <button className="primary" onClick={handleSave} disabled={saving || check.errors.length > 0}>
            {saving ? t('저장 중…') : t('저장')}
          </button>
        </footer>
    </EditorFrame>
  )
}

/** 모달이면 배경 + 대화상자, 작업실이면 화면 안 영역 */
export function EditorFrame({
  variant,
  className,
  label,
  onEscape,
  children
}: {
  variant: 'modal' | 'panel'
  className: string
  label: string
  /** 모달에서 Esc = 취소 */
  onEscape?: () => void
  children: ReactNode
}) {
  if (variant === 'panel') {
    return (
      <section className={`studio-editor ${className}`} aria-label={label}>
        {children}
      </section>
    )
  }
  return (
    <div className="modal-backdrop">
      <div className={`modal ${className}`} role="dialog" aria-label={label} onKeyDown={(e) => e.key === 'Escape' && onEscape?.()}>
        {children}
      </div>
    </div>
  )
}
