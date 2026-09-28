import { useMemo } from 'react'
import type { Supply } from '@core/model'
import { SUPPLY_KIND_LABEL, chooseSupply, type SupplyUse } from '@core/supply'
import { scopedSupplyQuestions, type SheetRef } from '@core/workspace'
import { useSupplyStore } from '@/stores/supplyStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useT } from '@/i18n'

/**
 * BOM 위: 배선도에 쓰인 부속 부품을 BOM에 넣을지 묻는다 (027).
 * 하우징·단자는 개수, 수축 튜브·전선은 묶음 1개를 제안하고, 넣은 뒤 수량은 표에서 고친다
 */
export function SupplyQuestions({ sheets }: { sheets: SheetRef[] }) {
  const t = useT()
  const library = useSupplyStore((s) => s.supplies)
  const report = useMemo(() => scopedSupplyQuestions(sheets, library), [sheets, library])
  const { pending, excluded } = report
  /** 그 배선도들에서 넣기/빼기 (030: 고른 배선도 모두, 각자의 실행 취소 기록) */
  const choose = (ids: string[], supply: Supply, include: boolean) =>
    useWorkspaceStore.getState().applyTo(ids, (p) => chooseSupply(p, supply, include, library))

  const usage = (u: SupplyUse) => {
    switch (u.supply.kind) {
      case 'housing':
        return t('커넥터 {n}개', { n: u.count })
      case 'terminal':
        return t('연결된 핀 {n}개', { n: u.count })
      case 'tube':
        return t('양 끝 {ends} · 중간 {middle}조각', { ends: u.ends ?? 0, middle: u.middle ?? 0 })
      case 'wire':
        return t('전선 {n}가닥', { n: u.count })
    }
  }
  const suggestion = (u: SupplyUse) =>
    u.supply.kind === 'housing' || u.supply.kind === 'terminal'
      ? t('{n}개', { n: u.suggested })
      : [t('{n}묶음', { n: u.suggested }), u.supply.pack].filter(Boolean).join(' · ')

  if (pending.length === 0 && excluded.length === 0 && report.missing.length === 0) return null
  return (
    <div className="supply-questions" data-testid="supply-questions">
      {pending.length > 0 && (
        <div className="callout">
          <div className="supply-questions-head">
            <b>{t('BOM에 넣을까요?')}</b>
            <span className="muted">{t('배선도에 쓰인 부속 부품입니다. 수축 튜브·전선은 묶음 단위로 제안하니 수량은 구매 링크를 보고 고치세요.')}</span>
            <div className="spacer" />
            {pending.length > 1 && (
              <button onClick={() => pending.forEach((u) => choose(u.pendingIn, u.supply, true))}>{t('모두 넣기')}</button>
            )}
          </div>
          <ul className="supply-question-list">
            {pending.map((u) => (
              <li key={u.supply.id} data-supply-question={u.supply.id}>
                <span className="muted">{t(SUPPLY_KIND_LABEL[u.supply.kind])}</span>
                <b>{u.supply.name}</b>
                <span className="muted">
                  {usage(u)}
                  {u.refs.length > 0 && ` (${u.refs.join(', ')})`}
                </span>
                <span className="supply-suggest">{t('제안 {text}', { text: suggestion(u) })}</span>
                <button className="primary" onClick={() => choose(u.pendingIn, u.supply, true)}>
                  {t('넣기')}
                </button>
                <button onClick={() => choose(u.pendingIn, u.supply, false)}>{t('빼기')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.missing.length > 0 && (
        <p className="hint-text" data-testid="missing-housings">
          {t('짝 하우징이 없는 커넥터 종류: {list}. 부품함 > 부속 부품에서 하우징을 추가하고 "짝 커넥터"에 이 종류를 적으세요.', {
            list: report.missing.map((m) => `${m.type} (${m.refs.join(', ')})`).join(', ')
          })}
        </p>
      )}
      {excluded.length > 0 && (
        <details className="supply-excluded">
          <summary>{t('뺀 부속 부품 {n}개', { n: excluded.length })}</summary>
          <ul className="supply-question-list">
            {excluded.map((u) => (
              <li key={u.supply.id}>
                <span className="muted">{t(SUPPLY_KIND_LABEL[u.supply.kind])}</span>
                <b>{u.supply.name}</b>
                <span className="muted">{usage(u)}</span>
                <button onClick={() => choose(u.excludedIn, u.supply, true)}>{t('다시 넣기')}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
