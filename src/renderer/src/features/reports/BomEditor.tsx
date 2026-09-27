import { useMemo } from 'react'
import { bomTotals, buildBom, type BomRow } from '@core/bom'
import { formatMoney, parseAmount } from '@core/money'
import { isHttpUrl, shortUrl } from '@core/url'
import { CommitInput } from '@/components/CommitInput'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'
import { t as tNow, useT } from '@/i18n'

const notify = (m: string) => useUiStore.getState().notify(m)

/** 금액 입력칸: "12,500"처럼 쉼표 허용, 비우면 지움 */
function MoneyInput({
  value,
  onCommit,
  label
}: {
  value?: number
  /** false = 거부 (입력칸을 이전 값으로) */
  onCommit: (v: number | undefined) => void | boolean
  label: string
}) {
  return (
    <CommitInput
      className="num-input"
      aria-label={label}
      inputMode="decimal"
      placeholder="-"
      value={value === undefined ? '' : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}
      onCommit={(text) => {
        const n = parseAmount(text)
        if (Number.isNaN(n)) {
          notify(tNow('0 이상의 숫자를 입력하세요'))
          return false
        }
        return onCommit(n)
      }}
    />
  )
}

function Link({ url }: { url: string }) {
  return (
    <a
      href={url}
      title={url}
      onClick={(e) => {
        e.preventDefault()
        window.api.shell.openExternal(url)
      }}
    >
      {shortUrl(url)} ↗
    </a>
  )
}

/**
 * BOM 표 (편집 가능).
 * - 배선도 부품 행: 이름·수량은 배선도에서 자동, 단가·비고만 편집
 * - 직접 추가한 행: 모든 칸 편집, 삭제 가능
 * - 금액 = 수량 × 단가, 표 아래 총액
 */
export function BomEditor({ onExportCsv, onExportXlsx }: { onExportCsv: () => void; onExportXlsx: () => void }) {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const rows = useMemo(() => buildBom(project), [project])
  const totals = bomTotals(rows)
  const store = useProjectStore.getState
  const money = (n: number) => formatMoney(n, t)
  const nameLabel = t('이름')

  const addItem = () => {
    const id = store().addBomItem(t('새 항목'))
    // 새 행의 이름 칸에 바로 입력할 수 있게
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-item="${id}"] input[aria-label="${nameLabel}"]`)?.select())
  }

  const partCell = (r: BomRow) => r.refDes.join(', ')

  return (
    <section className="report" aria-label="BOM">
      <header className="report-header">
        <h2>BOM</h2>
        <span className="report-summary">
          {t('{lines}종 · {quantity}개 · 총액', { lines: totals.lines, quantity: totals.quantity })}{' '}
          <b data-testid="bom-total">{money(totals.total)}</b>
        </span>
        <div className="spacer" />
        <button onClick={addItem}>{t('＋ 항목 추가')}</button>
        <button onClick={onExportXlsx} disabled={rows.length === 0} title={t('금액·합계가 수식으로 들어가 엑셀에서 고치면 다시 계산됩니다')}>
          {t('엑셀 내보내기')}
        </button>
        <button onClick={onExportCsv} disabled={rows.length === 0}>
          {t('CSV 내보내기')}
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="empty">{t('배치된 부품이 없습니다. 배선도 탭에서 부품을 배치하거나 "＋ 항목 추가"로 직접 넣으세요.')}</p>
      ) : (
        <div className="report-scroll">
          <table className="report-table bom-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('참조명')}</th>
                <th>{t('이름')}</th>
                <th>{t('품번')}</th>
                <th>{t('제조사')}</th>
                <th className="right">{t('수량')}</th>
                <th className="right">{t('단가')}</th>
                <th className="right">{t('금액')}</th>
                <th>{t('구매 링크')}</th>
                <th>{t('비고')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) =>
                r.kind === 'part' ? (
                  <tr key={`p-${r.id}`} data-part={r.id}>
                    <td className="num">{i + 1}</td>
                    <td className="ref">{partCell(r)}</td>
                    <td className="name" title={t('배선도 부품: 이름·수량은 부품에서 옵니다')}>
                      {r.name}
                    </td>
                    <td>{r.partNumber}</td>
                    <td>{r.manufacturer}</td>
                    <td className="right">{r.quantity}</td>
                    <td className="right">
                      <MoneyInput label={t('단가')} value={r.unitPrice} onCommit={(v) => store().setBomOverride(r.id, { unitPrice: v ?? null })} />
                    </td>
                    <td className="right money" data-testid="amount">
                      {r.amount === undefined ? <span className="muted">-</span> : money(r.amount)}
                    </td>
                    <td>{r.purchaseUrl ? <Link url={r.purchaseUrl} /> : <span className="muted">-</span>}</td>
                    <td>
                      <CommitInput aria-label={t('비고')} value={r.memo ?? ''} onCommit={(v) => store().setBomOverride(r.id, { memo: v || null })} />
                    </td>
                    <td />
                  </tr>
                ) : (
                  <tr key={`i-${r.id}`} data-item={r.id} className="bom-item">
                    <td className="num">{i + 1}</td>
                    <td className="ref muted" title={t('직접 추가한 항목')}>
                      {t('추가')}
                    </td>
                    <td className="name">
                      <CommitInput
                        aria-label={nameLabel}
                        value={r.name}
                        onCommit={(v) => {
                          if (!v.trim()) {
                            notify(t('이름을 입력하세요'))
                            return false
                          }
                          store().updateBomItem(r.id, { name: v.trim() })
                        }}
                      />
                    </td>
                    <td>
                      <CommitInput aria-label={t('품번')} value={r.partNumber ?? ''} onCommit={(v) => store().updateBomItem(r.id, { partNumber: v.trim() || undefined })} />
                    </td>
                    <td>
                      <CommitInput aria-label={t('제조사')} value={r.manufacturer ?? ''} onCommit={(v) => store().updateBomItem(r.id, { manufacturer: v.trim() || undefined })} />
                    </td>
                    <td className="right">
                      <MoneyInput
                        label={t('수량')}
                        value={r.quantity}
                        onCommit={(v) => {
                          if (v === undefined) {
                            notify(t('수량을 입력하세요'))
                            return false
                          }
                          store().updateBomItem(r.id, { quantity: v })
                        }}
                      />
                    </td>
                    <td className="right">
                      <MoneyInput label={t('단가')} value={r.unitPrice} onCommit={(v) => store().updateBomItem(r.id, { unitPrice: v })} />
                    </td>
                    <td className="right money" data-testid="amount">
                      {r.amount === undefined ? <span className="muted">-</span> : money(r.amount)}
                    </td>
                    <td>
                      <CommitInput
                        aria-label={t('구매 링크')}
                        placeholder="https://..."
                        value={r.purchaseUrl ?? ''}
                        onCommit={(v) => {
                          const url = v.trim()
                          if (url && !isHttpUrl(url)) {
                            notify(t('구매 링크는 http:// 또는 https://로 시작해야 합니다'))
                            return false
                          }
                          store().updateBomItem(r.id, { purchaseUrl: url || undefined })
                        }}
                      />
                    </td>
                    <td>
                      <CommitInput aria-label={t('비고')} value={r.memo ?? ''} onCommit={(v) => store().updateBomItem(r.id, { memo: v.trim() || undefined })} />
                    </td>
                    <td>
                      <button className="icon" title={t('항목 삭제')} aria-label={t('항목 삭제')} onClick={() => store().removeBomItem(r.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td colSpan={4}>
                  <b>{t('합계')}</b>
                  {totals.unpriced > 0 && (
                    <span className="warning-inline"> · {t('단가 미입력 {n}건 (총액에서 빠짐)', { n: totals.unpriced })}</span>
                  )}
                </td>
                <td className="right">{totals.quantity}</td>
                <td />
                <td className="right money">
                  <b>{money(totals.total)}</b>
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="hint-text bom-hint">
        {t(
          '배선도 부품은 단가·비고만 고칠 수 있습니다 (이름·수량은 배선도 기준). 소모품·예비품은 "＋ 항목 추가"로 넣으세요. 칸은 Enter 또는 다른 곳을 누르면 반영되고, Ctrl+Z로 되돌릴 수 있습니다.'
        )}
      </p>
    </section>
  )
}
