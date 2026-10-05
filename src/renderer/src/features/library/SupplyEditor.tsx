import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorFrame } from '@/features/part-editor/PartEditor'
import { drawingFromImage, emptyDrawing } from '@core/drawing'
import { DrawingPanel } from '@/features/studio/drawing/DrawingPanel'
import { bakeDrawing, SUPPLY_BAKE_MAX } from '@/features/studio/drawing/bake'
import { AWG_MAX, AWG_MIN, SUPPLY_KINDS, type Connector, type Pin, type Supply, type SupplyKind } from '@core/model'
import { parseAmount } from '@core/money'
import { SUPPLY_KIND_LABEL, checkSupply, finalizeSupply, housingsByType } from '@core/supply'
import { naturalCompare } from '@core/sort'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSupplyStore } from '@/stores/supplyStore'
import { readImageFile } from '@/features/part-editor/image'
import { PinWorkspace, type PinEdit } from '@/features/part-editor/PinWorkspace'
import { PinTables } from '@/features/part-editor/PinTables'
import { BackgroundTool } from '@/features/part-editor/BackgroundTool'
import { useT } from '@/i18n'

const AWG_OPTIONS = Array.from({ length: AWG_MAX - AWG_MIN + 1 }, (_, i) => AWG_MAX - i)
/** 부속 부품 사진은 목록·BOM 확인용이라 작게 (핀을 찍을 만큼은) */
const SUPPLY_IMAGE_SIDE = 480

/** 편집 중에는 핀·커넥터가 늘 배열 (저장할 때 비었으면 뺀다) */
type SupplyDraft = Supply & { pins: Pin[]; connectors: Connector[] }
const toDraft = (s: Supply): SupplyDraft => ({ ...s, pins: s.pins ?? [], connectors: s.connectors ?? [] })

interface Props {
  initial: Supply
  isNew: boolean
  onCancel: () => void
  onSave: (s: Supply) => Promise<void>
  /** modal: 배선도 부품함 창 · panel: 부품 작업실 안 (037a) */
  variant?: 'modal' | 'panel'
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * 부속 부품 편집 (027): BOM용 정보. 종류에 따라 칸이 달라진다.
 * 사진 위에 핀을 찍어 두면 부품처럼 배선도에 올릴 수 있다 (작업실: [핀] 탭, 부품함 창: [핀 찍기])
 */
export function SupplyEditor({ initial, isNew, onCancel, onSave, variant = 'modal', onDirtyChange }: Props) {
  const t = useT()
  const [start] = useState(() => toDraft(initial))
  const [draft, setDraft] = useState<SupplyDraft>(start)
  const [priceText, setPriceText] = useState(initial.unitPrice === undefined ? '' : initial.unitPrice.toLocaleString('ko-KR'))
  const [diameterText, setDiameterText] = useState(initial.diameter === undefined ? '' : String(initial.diameter))
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const parts = useLibraryStore((s) => s.parts)
  const supplies = useSupplyStore((s) => s.supplies)
  const housings = useMemo(() => housingsByType(supplies), [supplies])
  const errors = checkSupply(draft, t)
  const set = <K extends keyof Supply>(k: K, v: Supply[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const dirty = draft !== start
  // 그림 (037b, 작업실에서만): 저장할 때·핀 탭으로 갈 때 PNG로 굽는다
  const stale = useRef(false)
  const drawingNow = useMemo(
    () => draft.drawing ?? (draft.image ? drawingFromImage(draft.image.data, draft.image.width, draft.image.height, 'photo') : emptyDrawing(240, 240)),
    [draft.drawing, draft.image]
  )
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  // 핀 (배선도에 올리기): 작업실은 [그림 | 핀] 탭, 부품함 창은 [핀 찍기]로 넓은 화면
  const [view, setView] = useState<'draw' | 'pins'>('draw')
  const [pinMode, setPinMode] = useState(() => start.pins.length > 0)
  const [baking, setBaking] = useState(false)
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null)
  const [activeConnectorId, setActiveConnectorId] = useState('')
  const editPins = useCallback((edit: PinEdit) => setDraft((d) => edit(d)), [])
  const withPins = variant === 'panel' || pinMode
  const draftRef = useRef(draft)
  draftRef.current = draft

  /** 고친 그림을 사진으로 굽는다. 아무것도 안 그렸으면 그림도 사진도 없음 */
  const bake = async (d: SupplyDraft): Promise<SupplyDraft> => {
    if (!stale.current || !d.drawing) return d
    setBaking(true)
    try {
      const next: SupplyDraft = d.drawing.shapes.length
        ? { ...d, image: await bakeDrawing(d.drawing, SUPPLY_BAKE_MAX) }
        : { ...d, image: undefined, drawing: undefined }
      stale.current = false
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

  /** 부품함 부품의 커넥터 종류 (자동 완성) */
  const connectorTypes = useMemo(() => {
    const types = new Set<string>()
    for (const p of parts) for (const c of p.connectors) if (c.type.trim()) types.add(c.type.trim())
    return [...types].sort(naturalCompare)
  }, [parts])
  const terminals = supplies.filter((s) => s.kind === 'terminal')
  const kind = draft.kind
  const colored = kind === 'tube' || kind === 'wire'

  const save = async () => {
    if (errors.length > 0) return
    setSaving(true)
    try {
      await onSave(finalizeSupply(await bake(draft)))
    } catch (e) {
      setMessage(t('저장하지 못했습니다: {detail}', { detail: (e as Error).message }))
      setSaving(false)
    }
  }

  const pinWorkspace = draft.image && (
    <PinWorkspace
      image={draft.image}
      pins={draft.pins}
      connectors={draft.connectors}
      activeConnectorId={activeConnectorId}
      selectedPinId={selectedPinId}
      onSelectPin={setSelectedPinId}
      onChange={editPins}
    />
  )
  const backgroundTool = (
    <BackgroundTool
      draft={draft}
      onChange={(photo, rebake) => {
        if (rebake) stale.current = true
        setDraft((d) => ({ ...d, image: photo.image, drawing: photo.drawing }))
      }}
      onError={setMessage}
    />
  )

  return (
    <EditorFrame variant={variant} className={`supply-editor${variant === 'modal' && pinMode ? ' pinning' : ''}`} label={t('부속 부품 편집')} onEscape={onCancel}>

        <header className="modal-header">
          <h2>{isNew ? t('새 부속 부품') : t('부속 부품 편집 — {name}', { name: initial.name })}</h2>
        </header>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (!file) return
            try {
              const image = await readImageFile(file, SUPPLY_IMAGE_SIDE)
              setDraft((x) => ({ ...x, image, drawing: undefined }))
              stale.current = false
            } catch (err) {
              setMessage((err as Error).message)
            }
          }}
        />
        <div className={`supply-editor-body${withPins ? ' with-pins' : ''}`}>
          {variant === 'panel' ? (
            <div className="supply-drawing">
              <div className="segmented editor-view-tabs" role="tablist" aria-label={t('편집 화면')}>
                <button role="tab" aria-selected={view === 'draw'} className={view === 'draw' ? 'active' : ''} onClick={() => setView('draw')}>
                  {t('✏ 그림')}
                </button>
                <button role="tab" aria-selected={view === 'pins'} className={view === 'pins' ? 'active' : ''} onClick={showPins} disabled={baking}>
                  {baking ? t('사진 만드는 중…') : t('● 핀')}
                </button>
              </div>
              {view === 'draw' ? (
                <DrawingPanel
                  drawing={drawingNow}
                  pins={draft.pins}
                  maxImageSide={SUPPLY_IMAGE_SIDE * 2}
                  onChange={(drawing, pins) => {
                    stale.current = true
                    setDraft((x) => ({ ...x, drawing, ...(pins ? { pins } : {}) }))
                  }}
                />
              ) : (
                <section className="photo-area">
                  {pinWorkspace || (
                    <div className="photo-empty">
                      <p>{t('그림 탭에서 그린 뒤 핀을 찍으세요.')}</p>
                    </div>
                  )}
                </section>
              )}
            </div>
          ) : pinMode && pinWorkspace ? (
            <section className="photo-area">{pinWorkspace}</section>
          ) : (
          <div className="supply-photo">
            {draft.image ? <img src={draft.image.data} alt="" /> : <div className="supply-photo-empty">{t('사진 없음')}</div>}
            <div className="button-row">
              <button onClick={() => fileRef.current?.click()}>{draft.image ? t('사진 바꾸기') : t('사진 불러오기')}</button>
              {draft.image && <button onClick={() => setDraft((x) => ({ ...x, image: undefined, drawing: undefined }))}>{t('사진 빼기')}</button>}
            </div>
          </div>
          )}
          <div className="supply-fields">
            <label className="field">
              <span>{t('종류')}</span>
              <select aria-label={t('종류')} value={kind} onChange={(e) => set('kind', e.target.value as SupplyKind)}>
                {SUPPLY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(SUPPLY_KIND_LABEL[k])}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('이름')}</span>
              <input autoFocus value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder={t('예: XH 4P 하우징')} />
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

            {kind === 'housing' && (
              <>
                <label className="field">
                  <span>{t('짝 커넥터')}</span>
                  <input
                    aria-label={t('짝 커넥터 종류')}
                    list="supply-connector-types"
                    value={draft.connectorType ?? ''}
                    placeholder="JST-XH 4P"
                    onChange={(e) => set('connectorType', e.target.value)}
                  />
                </label>
                <datalist id="supply-connector-types">
                  {connectorTypes.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <label className="field">
                  <span>{t('쓰는 단자')}</span>
                  <select aria-label={t('쓰는 단자')} value={draft.terminalId ?? ''} onChange={(e) => set('terminalId', e.target.value || undefined)}>
                    <option value="">{terminals.length ? t('없음') : t('부속 부품에 단자를 먼저 추가하세요')}</option>
                    {terminals.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {kind === 'tube' && (
              <label className="field">
                <span>{t('지름(mm)')}</span>
                <input
                  aria-label={t('지름(mm)')}
                  inputMode="decimal"
                  value={diameterText}
                  onChange={(e) => {
                    setDiameterText(e.target.value)
                    const n = parseAmount(e.target.value)
                    set('diameter', n === undefined ? undefined : n)
                  }}
                />
              </label>
            )}
            {kind === 'wire' && (
              <label className="field">
                <span>{t('규격(AWG)')}</span>
                <select aria-label={t('규격(AWG)')} value={draft.awg ?? ''} onChange={(e) => set('awg', e.target.value ? Number(e.target.value) : undefined)}>
                  <option value="">-</option>
                  {AWG_OPTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a} AWG
                    </option>
                  ))}
                </select>
              </label>
            )}
            {colored && (
              <>
                <label className="field">
                  <span>{t('색상')}</span>
                  <span className="price-row">
                    <input
                      type="color"
                      aria-label={t('색상')}
                      value={draft.color ?? '#212121'}
                      onChange={(e) => set('color', e.target.value)}
                    />
                    {draft.color && (
                      <button type="button" onClick={() => set('color', undefined)}>
                        {t('색 빼기')}
                      </button>
                    )}
                  </span>
                </label>
                <label className="field">
                  <span>{t('묶음')}</span>
                  <input
                    aria-label={t('묶음')}
                    value={draft.pack ?? ''}
                    placeholder={kind === 'wire' ? t('예: 10 m 릴') : t('예: 1 m 롤, 100개입')}
                    onChange={(e) => set('pack', e.target.value)}
                  />
                </label>
              </>
            )}

            <label className="field">
              <span>{colored ? t('묶음 단가') : t('단가')}</span>
              <span className="price-row">
                <input
                  aria-label={t('단가')}
                  inputMode="decimal"
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
              <input type="url" value={draft.purchaseUrl ?? ''} placeholder="https://..." onChange={(e) => set('purchaseUrl', e.target.value)} />
            </label>
            <label className="field">
              <span>{t('메모')}</span>
              <input value={draft.memo ?? ''} onChange={(e) => set('memo', e.target.value)} />
            </label>

            {variant === 'modal' && draft.image && (
              <div className="button-row">
                {pinMode && <button onClick={() => fileRef.current?.click()}>{t('사진 바꾸기')}</button>}
                {backgroundTool}
                {!pinMode && (
                  <button onClick={() => setPinMode(true)} title={t('핀을 찍으면 부품처럼 배선도에 올릴 수 있습니다')}>
                    {t('● 핀 찍기')}
                  </button>
                )}
              </div>
            )}
            {variant === 'panel' && draft.image && <div className="button-row">{backgroundTool}</div>}
            {withPins && (
              <>
                <p className="hint-text">{t('핀을 찍어 두면 부품함에서 배선도로 끌어다 놓고 전선을 이을 수 있습니다.')}</p>
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
              </>
            )}
          </div>
        </div>
        <footer className="modal-footer">
          <div className="messages">
            {errors.map((m) => (
              <p key={m} className="error">
                {m}
              </p>
            ))}
            {message && <p className="error">{message}</p>}
          </div>
          <button onClick={onCancel} disabled={saving || (variant === 'panel' && !dirty && !isNew)}>
            {variant === 'panel' ? t('되돌리기') : t('취소')}
          </button>
          <button className="primary" disabled={saving || errors.length > 0} onClick={save}>
            {t('저장')}
          </button>
        </footer>
    </EditorFrame>
  )
}
