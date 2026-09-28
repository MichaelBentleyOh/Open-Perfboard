import { useState } from 'react'
import type { Currency } from '@core/model'
import { parseRate, projectCurrency } from '@core/money'
import { useProjectStore } from '@/stores/projectStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { setBomCurrency } from '@core/ops'
import { useT } from '@/i18n'

/**
 * BOM 통화 설정 (029): 원 또는 달러 하나로 고정하고, 환율(1 USD = ? 원)을 적는다.
 * 통화를 바꾸면 배선도 안의 단가를 모두 환율로 바꾼다. 환율이 0보다 큰 숫자가 아니면 저장할 수 없다
 */
export function CurrencyDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const current = projectCurrency(project)
  const [currency, setCurrency] = useState<Currency>(current)
  const [rateText, setRateText] = useState(project.bom?.exchangeRate?.toLocaleString('en-US', { maximumFractionDigits: 6 }) ?? '')
  const rate = parseRate(rateText)
  const changing = currency !== current

  const save = () => {
    if (rate === undefined) return
    // 통화는 묶음 전체에 하나 (030): 모든 배선도에 적용
    const ws = useWorkspaceStore.getState()
    ws.applyTo(ws.sheets.map((s) => s.id), (p) => setBomCurrency(p, currency, rate))
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal currency-dialog"
        role="dialog"
        aria-label={t('통화 설정')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && rate !== undefined) save()
        }}
      >
        <header className="modal-header">
          <h2>{t('통화 설정')}</h2>
        </header>
        <div className="pdf-body">
          <div className="field">
            <span>{t('통화')}</span>
            <div className="choice-row" role="radiogroup" aria-label={t('통화')}>
              <label>
                <input type="radio" name="currency" checked={currency === 'KRW'} onChange={() => setCurrency('KRW')} /> {t('원 (₩)')}
              </label>
              <label>
                <input type="radio" name="currency" checked={currency === 'USD'} onChange={() => setCurrency('USD')} /> {t('달러 ($)')}
              </label>
            </div>
          </div>
          <label className="field">
            <span>{t('환율')}</span>
            <span className="rate-row">
              1 USD =
              <input
                aria-label={t('환율')}
                inputMode="decimal"
                autoFocus
                placeholder="1,350"
                value={rateText}
                aria-invalid={rate === undefined}
                onChange={(e) => setRateText(e.target.value)}
              />
              {t('원')}
            </span>
          </label>
          <p className="hint-text">
            {changing
              ? t('저장하면 모든 배선도의 단가(부품·수정값·직접 추가 항목)를 환율로 바꿉니다. 원은 정수, 달러는 소수 둘째 자리로 반올림합니다.')
              : t('금액은 한 가지 통화로만 씁니다 (모든 배선도 공통). 부품함의 단가는 부품을 놓을 때 이 통화로 바꿔 넣습니다.')}
          </p>
        </div>
        <footer className="modal-footer">
          <div className="messages">{rate === undefined && <p className="error">{t('환율은 0보다 큰 숫자로 입력하세요')}</p>}</div>
          <button onClick={onClose}>{t('취소')}</button>
          <button className="primary" disabled={rate === undefined} onClick={save}>
            {t('저장')}
          </button>
        </footer>
      </div>
    </div>
  )
}
