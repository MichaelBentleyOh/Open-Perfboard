import { useState } from 'react'
import { nanoid } from 'nanoid'
import { importSummary, resolveImport, type ConflictChoice, type ImportEntry } from '@core/library'
import type { PartDef, Supply } from '@core/model'
import type { ImportRequest } from '@/stores/uiStore'
import { useT } from '@/i18n'
import { msg } from '@core/i18n'

export type { ImportRequest }

interface Props {
  request: ImportRequest
  onCancel: () => void
  onImport: (parts: PartDef[], supplies: Supply[]) => Promise<void>
}

const STATUS_TEXT: Record<ImportEntry['status'], string> = {
  new: msg('새 부품'),
  same: msg('이미 있음 (건너뜀)'),
  changed: msg('이미 있음 · 내용 다름')
}

/** 가져오기 전에 무엇이 들어오는지 보여 주고, 내용이 다른 같은 부품을 어떻게 할지 고른다 */
export function ImportDialog({ request, onCancel, onImport }: Props) {
  const t = useT()
  const { plan, problems, files, note } = request
  const [choice, setChoice] = useState<ConflictChoice>('copy')
  const [busy, setBusy] = useState(false)
  const supplyPlan = request.supplyPlan ?? []
  const summary = importSummary(plan)
  const supplySummary = importSummary(supplyPlan)
  const count = resolveImport(plan, choice, () => 'x').length
  const supplyCount = resolveImport(supplyPlan, choice, () => 'x').length
  const changed = summary.changed + supplySummary.changed

  return (
    <div className="modal-backdrop">
      <div className="modal import-dialog" role="dialog" aria-label={t('부품 가져오기')}>
        <header className="modal-header">
          <h2>{t('부품 가져오기')}</h2>
        </header>
        <div className="import-body">
          {note && <p className="callout">{note}</p>}
          <p className="hint-text">{files.join(', ')}</p>
          <div className="import-summary" data-testid="import-summary">
            <span className="chip new">{t('새 부품 {n}', { n: summary.new })}</span>
            <span className="chip same">{t('이미 있음 {n}', { n: summary.same })}</span>
            <span className="chip changed">{t('내용 다름 {n}', { n: summary.changed })}</span>
            {problems.length > 0 && <span className="chip bad">{t('읽지 못함 {n}', { n: problems.length })}</span>}
          </div>
          {supplyPlan.length > 0 && (
            <p className="hint-text" data-testid="import-supplies">
              {t('부속 부품: 새 {new} · 이미 있음 {same} · 내용 다름 {changed}', supplySummary)}
            </p>
          )}

          {plan.length > 0 && (
            <ul className="import-list">
              {plan.map((e) => (
                <li key={e.part.id} className={`import-item ${e.status}`}>
                  <img src={e.part.image.data} alt="" />
                  <div className="part-info">
                    <strong>{e.part.name}</strong>
                    <span>
                      {[e.part.partNumber, t('핀 {n}', { n: e.part.pins.length })].filter(Boolean).join(' · ')}
                      {e.status === 'changed' && e.existing && e.existing.name !== e.part.name && ` · ${t('내 부품함: {name}', { name: e.existing.name })}`}
                    </span>
                  </div>
                  <span className={`badge ${e.status}`}>{t(STATUS_TEXT[e.status])}</span>
                </li>
              ))}
            </ul>
          )}

          {changed > 0 && (
            <fieldset className="conflict">
              <legend>{t('내용이 다른 같은 부품 {n}개', { n: changed })}</legend>
              <label>
                <input type="radio" name="conflict" checked={choice === 'copy'} onChange={() => setChoice('copy')} /> {t('사본으로 추가 (둘 다 유지)')}
              </label>
              <label>
                <input type="radio" name="conflict" checked={choice === 'overwrite'} onChange={() => setChoice('overwrite')} /> {t('덮어쓰기 (가져온 것으로 바꿈)')}
              </label>
              <label>
                <input type="radio" name="conflict" checked={choice === 'skip'} onChange={() => setChoice('skip')} /> {t('건너뛰기 (내 것 유지)')}
              </label>
            </fieldset>
          )}

          {problems.length > 0 && (
            <div className="import-problems">
              {problems.map((p) => (
                <p key={p} className="warning">
                  {p}
                </p>
              ))}
            </div>
          )}
        </div>
        <footer className="modal-footer">
          <div className="messages" />
          <button onClick={onCancel} disabled={busy}>
            {count + supplyCount === 0 ? t('닫기') : t('취소')}
          </button>
          {count + supplyCount > 0 && (
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await onImport(resolveImport(plan, choice, () => nanoid(), t), resolveImport(supplyPlan, choice, () => nanoid(), t))
              }}
            >
              {busy ? t('가져오는 중…') : t('가져오기 ({n}개)', { n: count + supplyCount })}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
