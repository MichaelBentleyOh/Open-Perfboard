import { useState } from 'react'
import type { PaperSize } from '@core/report'
import { useT } from '@/i18n'

export interface PdfDialogValue {
  title: string
  author: string
  notes: string
  paper: PaperSize
  landscape: boolean
  include: { diagram: boolean; schematic: boolean; bom: boolean; netlist: boolean }
}

interface Props {
  initial: PdfDialogValue
  onCancel: () => void
  onExport: (v: PdfDialogValue) => Promise<boolean>
}

/** PDF 내보내기 설정 (용지, 방향, 포함 항목, 타이틀 블록) */
export function PdfDialog({ initial, onCancel, onExport }: Props) {
  const t = useT()
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof PdfDialogValue>(k: K, value: PdfDialogValue[K]) => setV((o) => ({ ...o, [k]: value }))
  const include = (k: keyof PdfDialogValue['include'], on: boolean) => setV((o) => ({ ...o, include: { ...o.include, [k]: on } }))
  const nothing = !v.include.diagram && !v.include.schematic && !v.include.bom && !v.include.netlist

  return (
    <div className="modal-backdrop">
      <div className="modal pdf-dialog" role="dialog" aria-label={t('PDF 내보내기')}>
        <header className="modal-header">
          <h2>{t('PDF 내보내기')}</h2>
        </header>
        <div className="pdf-body">
          <label className="field">
            <span>{t('제목')}</span>
            <input value={v.title} onChange={(e) => set('title', e.target.value)} />
          </label>
          <label className="field">
            <span>{t('작성자')}</span>
            <input value={v.author} onChange={(e) => set('author', e.target.value)} />
          </label>
          <label className="field">
            <span>{t('비고')}</span>
            <textarea rows={3} value={v.notes} placeholder={t('주의사항, 배선 순서 등')} onChange={(e) => set('notes', e.target.value)} />
          </label>
          <div className="field">
            <span>{t('용지')}</span>
            <div className="choice-row">
              <select aria-label={t('용지 크기')} value={v.paper} onChange={(e) => set('paper', e.target.value as PaperSize)}>
                <option value="A4">A4</option>
                <option value="A3">A3</option>
              </select>
              <label>
                <input type="radio" name="orient" checked={v.landscape} onChange={() => set('landscape', true)} /> {t('가로')}
              </label>
              <label>
                <input type="radio" name="orient" checked={!v.landscape} onChange={() => set('landscape', false)} /> {t('세로')}
              </label>
            </div>
          </div>
          <div className="field">
            <span>{t('포함')}</span>
            <div className="choice-row">
              <label>
                <input type="checkbox" checked={v.include.diagram} onChange={(e) => include('diagram', e.target.checked)} /> {t('배선도')}
              </label>
              <label>
                <input type="checkbox" checked={v.include.schematic} onChange={(e) => include('schematic', e.target.checked)} /> {t('회로도')}
              </label>
              <label>
                <input type="checkbox" checked={v.include.bom} onChange={(e) => include('bom', e.target.checked)} /> BOM
              </label>
              <label>
                <input type="checkbox" checked={v.include.netlist} onChange={(e) => include('netlist', e.target.checked)} /> {t('결선표')}
              </label>
            </div>
          </div>
          <p className="hint-text">{t('작성자와 비고는 배선도 파일에 함께 저장됩니다.')}</p>
        </div>
        <footer className="modal-footer">
          <div className="messages">{nothing && <p className="error">{t('포함할 항목을 하나 이상 고르세요')}</p>}</div>
          <button onClick={onCancel} disabled={busy}>
            {t('취소')}
          </button>
          <button
            className="primary"
            disabled={busy || nothing}
            onClick={async () => {
              setBusy(true)
              const ok = await onExport(v)
              setBusy(false)
              if (ok) onCancel()
            }}
          >
            {busy ? t('만드는 중…') : t('PDF 내보내기')}
          </button>
        </footer>
      </div>
    </div>
  )
}
