import { useState } from 'react'
import { bomDetails, bomTotals } from '@core/bom'
import { CURRENCY_SYMBOL, formatMoney, parseAmount, projectCurrency } from '@core/money'
import type { Project } from '@core/model'
import { addBomItem, removeBomItem, setBomOverride, updateBomItem, type BomItemPatch, type BomOverridePatch } from '@core/ops'
import { chooseSupply, setSupplyChoice, type SupplyChoicePatch } from '@core/supply'
import { buildScopedBom, type ScopedBomRow } from '@core/workspace'
import { isHttpUrl, shortUrl } from '@core/url'
import { nanoid } from 'nanoid'
import { CommitInput } from '@/components/CommitInput'
import { useProjectStore } from '@/stores/projectStore'
import { scopedSheets, useSheets, useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import { ScopePicker } from '@/features/sheets/ScopePicker'
import { CurrencyDialog } from './CurrencyDialog'
import { SupplyQuestions } from './SupplyQuestions'
import { t as tNow, useT } from '@/i18n'

const notify = (m: string) => useUiStore.getState().notify(m)

/** 금액 입력칸: "12,500"처럼 쉼표 허용, 비우면 지움 */
function MoneyInput({
  value,
  onCommit,
  label,
  placeholder = '-'
}: {
  value?: number
  placeholder?: string
  /** false = 거부 (입력칸을 이전 값으로) */
  onCommit: (v: number | undefined) => void | boolean
  label: string
}) {
  return (
    <CommitInput
      className="num-input"
      aria-label={label}
      inputMode="decimal"
      placeholder={placeholder}
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

const apply = (ids: readonly string[], fn: (p: Project) => Project) => useWorkspaceStore.getState().applyTo(ids, fn)
const sourceIds = (r: ScopedBomRow) => r.sources.map((s) => s.sheetId)

/**
 * BOM 표 (편집 가능, 031). 칸: 번호 / 분류 / 품명 / 세부사항 / 수량 / 예상 단가 / 예상 총액 / 조달처 / 구매사이트 / 비고
 * - 포함할 배선도를 고른다 (030). 여러 배선도의 같은 부품은 한 행으로 합치고, 고치면 그 배선도들 모두에 적용
 * - 배선도 부품 행: 품명·수량은 배선도에서 자동, 단가·조달처·비고만 편집
 * - 직접 추가한 행: 모든 칸 편집, 삭제 가능
 */
export function BomEditor({ onExportCsv, onExportXlsx }: { onExportCsv: () => void; onExportXlsx: () => void }) {
  const t = useT()
  const project = useProjectStore((s) => s.project)
  const sheets = useSheets()
  const scope = useWorkspaceStore((s) => s.scope)
  const activeId = useWorkspaceStore((s) => s.activeId)
  const inScope = scopedSheets(sheets, scope)
  // 배선도 수에 비례하는 계산이라 그릴 때마다 한다 (범위·배선도가 바뀌면 다시)
  const rows = buildScopedBom(inScope)
  const totals = bomTotals(rows)
  const currency = projectCurrency(project)
  const money = (n: number) => formatMoney(n, t, currency)
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const nameLabel = t('품명')

  const addItem = () => {
    // 지금 배선도가 범위에 없으면 범위의 첫 배선도에 넣는다 (보이는 곳에)
    const target = inScope.some((s) => s.id === activeId) ? activeId : (inScope[0]?.id ?? activeId)
    const id = nanoid()
    apply([target], (p) => addBomItem(p, { id, name: t('새 항목'), quantity: 1 }))
    // 새 행의 이름 칸에 바로 입력할 수 있게
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-item="${id}"] input[aria-label="${nameLabel}"]`)?.select())
  }

  const part = (r: ScopedBomRow, patch: BomOverridePatch) => apply(sourceIds(r), (p) => setBomOverride(p, r.id, patch))
  const supply = (r: ScopedBomRow, patch: SupplyChoicePatch) => apply(sourceIds(r), (p) => setSupplyChoice(p, r.id, patch))
  const item = (r: ScopedBomRow, patch: BomItemPatch) => apply(sourceIds(r), (p) => updateBomItem(p, r.id, patch))

  const supplierCell = (r: ScopedBomRow, onCommit: (v: string | null) => void) => (
    <CommitInput aria-label={t('조달처')} value={r.supplier ?? ''} onCommit={(v) => onCommit(v.trim() || null)} />
  )
  const memoCell = (r: ScopedBomRow, onCommit: (v: string | null) => void) => (
    <CommitInput aria-label={t('비고')} value={r.memo ?? ''} onCommit={(v) => onCommit(v.trim() || null)} />
  )
  const amountCell = (r: ScopedBomRow) => (
    <td className="right money" data-testid="amount">
      {r.amount === undefined ? <span className="muted">-</span> : money(r.amount)}
    </td>
  )
  const linkCell = (r: ScopedBomRow) => <td>{r.purchaseUrl ? <Link url={r.purchaseUrl} /> : <span className="muted">-</span>}</td>

  return (
    <section className="report" aria-label="BOM">
      <header className="report-header">
        <h2>BOM</h2>
        <ScopePicker />
        <span className="report-summary">
          {t('{lines}종 · {quantity}개 · 총액', { lines: totals.lines, quantity: totals.quantity })}{' '}
          <b data-testid="bom-total">{money(totals.total)}</b>
        </span>
        <div className="spacer" />
        <button onClick={() => setCurrencyOpen(true)} title={t('BOM 통화와 환율')} data-testid="currency-button">
          {t('통화: {symbol}', { symbol: CURRENCY_SYMBOL[currency] })}
          {project.bom?.exchangeRate !== undefined && <span className="muted"> · 1 USD = {project.bom.exchangeRate.toLocaleString('en-US')}</span>}
        </button>
        <button onClick={addItem}>{t('＋ 항목 추가')}</button>
        <button onClick={onExportXlsx} disabled={rows.length === 0} title={t('금액·합계가 수식으로 들어가 엑셀에서 고치면 다시 계산됩니다')}>
          {t('엑셀 내보내기')}
        </button>
        <button onClick={onExportCsv} disabled={rows.length === 0}>
          {t('CSV 내보내기')}
        </button>
      </header>
      <SupplyQuestions sheets={inScope} />
      {rows.length === 0 ? (
        <p className="empty">{t('배치된 부품이 없습니다. 배선도 탭에서 부품을 배치하거나 "＋ 항목 추가"로 직접 넣으세요.')}</p>
      ) : (
        <div className="report-scroll">
          <table className="report-table bom-table">
            <thead>
              <tr>
                <th className="num">{t('번호')}</th>
                <th>{t('분류')}</th>
                <th>{t('품명')}</th>
                <th>{t('세부사항')}</th>
                <th className="right">{t('수량')}</th>
                <th className="right">{t('예상 단가')}</th>
                <th className="right">{t('예상 총액')}</th>
                <th>{t('조달처')}</th>
                <th>{t('구매사이트')}</th>
                <th>{t('비고')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                r.kind === 'supply' ? (
                  <tr key={`s-${r.id}`} data-supply={r.id} className="bom-supply">
                    <td className="num">{r.no}</td>
                    <td className="category">{t(r.category)}</td>
                    <td className="name">{r.name}</td>
                    <td className="details">{bomDetails(r)}</td>
                    <td className="right">
                      {r.sources.length > 1 ? (
                        <span title={t('배선도 하나만 고르면 수량을 고칠 수 있습니다')}>{r.quantity}</span>
                      ) : (
                        <MoneyInput
                          label={t('수량')}
                          value={r.quantity}
                          onCommit={(v) => supply(r, { quantity: v === undefined || v === r.suggested ? null : v })}
                        />
                      )}
                    </td>
                    <td className="right">
                      <MoneyInput label={t('예상 단가')} value={r.unitPrice} placeholder={r.mixedPrice ? t('여러 값') : undefined} onCommit={(v) => supply(r, { unitPrice: v ?? null })} />
                    </td>
                    {amountCell(r)}
                    <td>{supplierCell(r, (v) => supply(r, { supplier: v }))}</td>
                    {linkCell(r)}
                    <td>{memoCell(r, (v) => supply(r, { memo: v }))}</td>
                    <td>
                      <button
                        className="icon"
                        title={t('BOM에서 빼기')}
                        aria-label={t('BOM에서 빼기')}
                        onClick={() =>
                          apply(sourceIds(r), (p) => {
                            const s = p.supplies?.[r.id]
                            return s ? chooseSupply(p, s, false) : p
                          })
                        }
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ) : r.kind === 'part' ? (
                  <tr key={`p-${r.id}`} data-part={r.id}>
                    <td className="num">{r.no}</td>
                    <td className="category">{t(r.category)}</td>
                    <td className="name" title={t('배선도 부품: 품명은 부품에서, 수량은 배치한 개수가 기본입니다')}>
                      {r.name}
                    </td>
                    <td className="details">{bomDetails(r)}</td>
                    <td className="right">
                      {r.sources.length > 1 ? (
                        <span title={t('배선도 하나만 고르면 수량을 고칠 수 있습니다')}>{r.quantity}</span>
                      ) : (
                        // 예비품 등으로 배치한 개수보다 많이 살 때. 비우거나 배치한 개수를 넣으면 다시 자동
                        <MoneyInput
                          label={t('수량')}
                          value={r.quantity}
                          onCommit={(v) => part(r, { quantity: v === undefined || v === r.suggested ? null : v })}
                        />
                      )}
                      {r.suggested !== undefined && r.quantity !== r.suggested && (
                        <small className="muted" title={t('배치한 개수')}>
                          {' '}
                          ({r.suggested})
                        </small>
                      )}
                    </td>
                    <td className="right">
                      <MoneyInput label={t('예상 단가')} value={r.unitPrice} placeholder={r.mixedPrice ? t('여러 값') : undefined} onCommit={(v) => part(r, { unitPrice: v ?? null })} />
                    </td>
                    {amountCell(r)}
                    <td>{supplierCell(r, (v) => part(r, { supplier: v }))}</td>
                    {linkCell(r)}
                    <td>{memoCell(r, (v) => part(r, { memo: v }))}</td>
                    <td />
                  </tr>
                ) : (
                  <tr key={`i-${r.sources[0].sheetId}-${r.id}`} data-item={r.id} className="bom-item">
                    <td className="num">{r.no}</td>
                    <td className="category muted" title={t('직접 추가한 항목')}>
                      {t(r.category)}
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
                          item(r, { name: v.trim() })
                        }}
                      />
                    </td>
                    <td className="details">
                      <span className="details-inputs">
                        <CommitInput aria-label={t('품번')} placeholder={t('품번')} value={r.partNumber ?? ''} onCommit={(v) => item(r, { partNumber: v.trim() || undefined })} />
                        <CommitInput aria-label={t('제조사')} placeholder={t('제조사')} value={r.manufacturer ?? ''} onCommit={(v) => item(r, { manufacturer: v.trim() || undefined })} />
                      </span>
                      {r.refDes.length > 0 && <small className="muted"> {r.refDes.join(', ')}</small>}
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
                          item(r, { quantity: v })
                        }}
                      />
                    </td>
                    <td className="right">
                      <MoneyInput label={t('예상 단가')} value={r.unitPrice} onCommit={(v) => item(r, { unitPrice: v })} />
                    </td>
                    {amountCell(r)}
                    <td>{supplierCell(r, (v) => item(r, { supplier: v ?? undefined }))}</td>
                    <td>
                      <CommitInput
                        aria-label={t('구매사이트')}
                        placeholder="https://..."
                        value={r.purchaseUrl ?? ''}
                        onCommit={(v) => {
                          const url = v.trim()
                          if (url && !isHttpUrl(url)) {
                            notify(t('구매 링크는 http:// 또는 https://로 시작해야 합니다'))
                            return false
                          }
                          item(r, { purchaseUrl: url || undefined })
                        }}
                      />
                    </td>
                    <td>{memoCell(r, (v) => item(r, { memo: v ?? undefined }))}</td>
                    <td>
                      <button className="icon" title={t('항목 삭제')} aria-label={t('항목 삭제')} onClick={() => apply(sourceIds(r), (p) => removeBomItem(p, r.id))}>
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
                <td colSpan={3}>
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
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="hint-text bom-hint">
        {t(
          '배선도 부품은 품명이 부품에서 오고, 수량은 배치한 개수가 기본입니다 (예비품만큼 늘릴 수 있음). 여러 배선도를 고르면 같은 부품을 합쳐 보여 주고, 고친 값은 그 배선도들 모두에 들어갑니다. 소모품·예비품은 "＋ 항목 추가"로 넣으세요. 칸은 Enter 또는 다른 곳을 누르면 반영되고, Ctrl+Z로 되돌릴 수 있습니다.'
        )}
      </p>
      {currencyOpen && <CurrencyDialog onClose={() => setCurrencyOpen(false)} />}
    </section>
  )
}
