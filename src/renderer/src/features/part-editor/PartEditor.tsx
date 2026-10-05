import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { nanoid } from 'nanoid'
import type { PartDef } from '@core/model'
import { checkDraft, finalizeDraft, updatePin, type PartDraft } from '@core/part'
import { parseAmount } from '@core/money'
import { housingsByType } from '@core/supply'
import { useSupplyStore } from '@/stores/supplyStore'
import { readImageFile } from './image'
import { addAttachments, removeAttachment, renameAttachment } from '@core/attachment'
import { AttachmentList } from '@/features/attachments/AttachmentList'
import { useAttachmentRevision } from '@/services/attachmentService'
import { PinWorkspace, type PinEdit } from './PinWorkspace'
import { PinTables } from './PinTables'
import { BackgroundTool } from './BackgroundTool'
import { drawingFromImage, emptyDrawing } from '@core/drawing'
import { autoSymbol } from '@core/symbol'
import { DrawingPanel } from '@/features/studio/drawing/DrawingPanel'
import { bakeDrawing, PART_BAKE_MAX } from '@/features/studio/drawing/bake'
import { useT } from '@/i18n'
import type { PartView } from '@/stores/studioStore'

interface Props {
  initial: PartDraft
  isNew: boolean
  onCancel: () => void
  onSave: (part: PartDef) => Promise<void>
  /** modal: 배선도 부품함 창의 빠른 편집 · panel: 부품 작업실 안 (037a) */
  variant?: 'modal' | 'panel'
  /** 고친 게 있는지 (작업실이 다른 항목으로 바꿀 때 묻는 데 씀) */
  onDirtyChange?: (dirty: boolean) => void
  /** 작업실: 처음 보일 탭, 탭을 바꿀 때 알림 (저장 뒤 다시 열려도 보던 탭) */
  initialView?: PartView
  onViewChange?: (v: PartView) => void
}

/** 부품 추가/편집. 편집 내용은 저장 전까지 이 컴포넌트 안에만 있다 */
export function PartEditor({ initial, isNew, onCancel, onSave, variant = 'modal', onDirtyChange, initialView, onViewChange }: Props) {
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
  const editPins = useCallback((edit: PinEdit) => setDraft((d) => edit(d)), [])

  // 그림 (037b, 작업실에서만): 그림 탭에서 그리고, 핀 탭으로 갈 때·저장할 때 PNG로 굽는다
  const [view, setView] = useState<PartView>(variant === 'panel' ? (initialView ?? (isNew || initial.drawing ? 'draw' : 'pins')) : 'pins')
  const onViewRef = useRef(onViewChange)
  onViewRef.current = onViewChange
  useEffect(() => {
    onViewRef.current?.(view)
  }, [view])
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
  /** 회로도 기호 (038): 저장된 게 없으면 지금 핀으로 만든 기본 기호를 보여 준다 (고치기 전까지 draft는 그대로) */
  const symbolNow = useMemo(
    () => draft.symbol ?? autoSymbol({ name: draft.name, pins: draft.pins, connectors: draft.connectors }, nanoid),
    [draft.symbol, draft.name, draft.pins, draft.connectors]
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
                <button role="tab" aria-selected={view === 'symbol'} className={view === 'symbol' ? 'active' : ''} onClick={() => setView('symbol')}>
                  {t('⎍ 기호')}
                </button>
              </div>
            )}
            {variant === 'panel' && view === 'symbol' ? (
              <DrawingPanel
                key="symbol"
                drawing={symbolNow.drawing}
                pins={[]}
                symbol={{
                  extras: { pins: symbolNow.pins, ...(symbolNow.showNumbers === false ? { showNumbers: false } : {}), ...(symbolNow.showNames === false ? { showNames: false } : {}) },
                  partName: draft.name,
                  partPins: draft.pins,
                  connectors: draft.connectors,
                  onElectrical: (pinId, value) => setDraft((d) => updatePin(d, pinId, { electrical: value }))
                }}
                onChange={(drawing, _pins, extras) =>
                  setDraft((d) => {
                    const cur = d.symbol ?? symbolNow
                    const e = extras ?? cur
                    return {
                      ...d,
                      symbol: {
                        drawing,
                        pins: e.pins,
                        ...(e.showNumbers === false ? { showNumbers: false } : {}),
                        ...(e.showNames === false ? { showNames: false } : {})
                      }
                    }
                  })
                }
              />
            ) : variant === 'panel' && view === 'draw' ? (
              <DrawingPanel
                key="draw"
                drawing={drawingNow}
                pins={draft.pins}
                onChange={(drawing, pins) => {
                  stale.current = true
                  setDraft((d) => ({ ...d, drawing, ...(pins ? { pins } : {}) }))
                }}
              />
            ) : (
            <>
            {draft.image ? (
              <PinWorkspace
                image={draft.image}
                pins={draft.pins}
                connectors={draft.connectors}
                activeConnectorId={activeConnectorId}
                selectedPinId={selectedPinId}
                onSelectPin={setSelectedPinId}
                onChange={editPins}
              />
            ) : (
              <div className="photo-empty">
                <p>{variant === 'panel' ? t('부품 사진을 불러오거나 그림 탭에서 그리세요.') : t('부품 사진을 불러오세요.')}</p>
                <button onClick={() => fileRef.current?.click()}>{t('사진 불러오기')}</button>
              </div>
            )}
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
              <BackgroundTool
                draft={draft}
                onChange={(photo, rebake) => {
                  if (rebake) stale.current = true
                  setDraft((d) => ({ ...d, image: photo.image, drawing: photo.drawing }))
                }}
                onError={setMessage}
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

            <PinTables
              pins={draft.pins}
              connectors={draft.connectors}
              onChange={editPins}
              selectedPinId={selectedPinId}
              onSelectPin={setSelectedPinId}
              activeConnectorId={activeConnectorId}
              onActiveConnector={setActiveConnectorId}
              housings={housings}
            />
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
