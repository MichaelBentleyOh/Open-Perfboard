import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorFrame } from '@/features/part-editor/PartEditor'
import { AWG_MAX, AWG_MIN, SUPPLY_KINDS, type Supply, type SupplyKind } from '@core/model'
import { parseAmount } from '@core/money'
import { SUPPLY_KIND_LABEL, checkSupply, finalizeSupply } from '@core/supply'
import { naturalCompare } from '@core/sort'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSupplyStore } from '@/stores/supplyStore'
import { readImageFile } from '@/features/part-editor/image'
import { useT } from '@/i18n'

const AWG_OPTIONS = Array.from({ length: AWG_MAX - AWG_MIN + 1 }, (_, i) => AWG_MAX - i)
/** 부속 부품 사진은 목록·BOM 확인용이라 작게 */
const SUPPLY_IMAGE_SIDE = 480

interface Props {
  initial: Supply
  isNew: boolean
  onCancel: () => void
  onSave: (s: Supply) => Promise<void>
  /** modal: 배선도 부품함 창 · panel: 부품 작업실 안 (037a) */
  variant?: 'modal' | 'panel'
  onDirtyChange?: (dirty: boolean) => void
}

/** 부속 부품 편집 (027): 핀 없이 BOM용 정보만. 종류에 따라 칸이 달라진다 */
export function SupplyEditor({ initial, isNew, onCancel, onSave, variant = 'modal', onDirtyChange }: Props) {
  const t = useT()
  const [draft, setDraft] = useState<Supply>(initial)
  const [priceText, setPriceText] = useState(initial.unitPrice === undefined ? '' : initial.unitPrice.toLocaleString('ko-KR'))
  const [diameterText, setDiameterText] = useState(initial.diameter === undefined ? '' : String(initial.diameter))
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const parts = useLibraryStore((s) => s.parts)
  const supplies = useSupplyStore((s) => s.supplies)
  const errors = checkSupply(draft, t)
  const set = <K extends keyof Supply>(k: K, v: Supply[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const dirty = draft !== initial
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

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
      await onSave(finalizeSupply(draft))
    } catch (e) {
      setMessage(t('저장하지 못했습니다: {detail}', { detail: (e as Error).message }))
      setSaving(false)
    }
  }

  return (
    <EditorFrame variant={variant} className="supply-editor" label={t('부속 부품 편집')} onEscape={onCancel}>

        <header className="modal-header">
          <h2>{isNew ? t('새 부속 부품') : t('부속 부품 편집 — {name}', { name: initial.name })}</h2>
        </header>
        <div className="supply-editor-body">
          <div className="supply-photo">
            {draft.image ? <img src={draft.image.data} alt="" /> : <div className="supply-photo-empty">{t('사진 없음')}</div>}
            <div className="button-row">
              <button onClick={() => fileRef.current?.click()}>{draft.image ? t('사진 바꾸기') : t('사진 불러오기')}</button>
              {draft.image && <button onClick={() => set('image', undefined)}>{t('사진 빼기')}</button>}
            </div>
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
                  set('image', await readImageFile(file, SUPPLY_IMAGE_SIDE))
                } catch (err) {
                  setMessage((err as Error).message)
                }
              }}
            />
          </div>
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
