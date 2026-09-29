import { useState } from 'react'
import { formatBytes } from '@core/attachment'
import { autosaveNow } from '@/app/autosave'
import { openRecovered } from '@/app/fileCommands'
import { useUiStore } from '@/stores/uiStore'
import { useLocaleStore, useT } from '@/i18n'

import type { RecoveryEntry as Entry } from '@/app/startup'

/**
 * 시작할 때 지난 실행이 남긴 복구 사본(비정상 종료)이 있으면 보여 준다. 목록은 시작 화면(036)이 읽어 넘긴다.
 * 복구하면 그 배선도가 "저장 안 됨" 상태로 열리고, 이번 실행의 사본으로 옮긴 뒤 옛 사본은 지운다.
 * 닫으면 사본은 그대로 남아 다음 실행에서 다시 묻는다.
 */
export function RecoveryDialog({ initial }: { initial: Entry[] }) {
  const t = useT()
  const locale = useLocaleStore((s) => s.locale)
  const [entries, setEntries] = useState<Entry[]>(initial)

  if (entries.length === 0) return null
  const close = () => setEntries([])
  const discard = async (id: string) => {
    await window.api.recovery.discard(id)
    setEntries((list) => list.filter((e) => e.id !== id))
  }
  const recover = async (e: Entry) => {
    if (!(await openRecovered(e.id))) return
    await autosaveNow() // 이번 실행의 사본으로 먼저 옮기고
    await window.api.recovery.discard(e.id) // 옛 사본을 지운다
    close()
    useUiStore.getState().notify(t('복구했습니다. 저장해야 파일에 반영됩니다: {name}', { name: e.name }))
  }

  return (
    <div className="modal-backdrop">
      <div className="modal recovery-dialog" role="dialog" aria-label={t('작업 복구')}>
        <header className="modal-header">
          <h2>{t('작업 복구')}</h2>
        </header>
        <p className="recovery-note">{t('지난번에 저장하지 못하고 끝난 배선도가 있습니다. 자동 저장된 사본에서 되살릴 수 있습니다.')}</p>
        <ul className="recovery-list">
          {entries.map((e) => (
            <li key={e.id}>
              <div className="recovery-info">
                <strong>{e.name}</strong>
                <span className="muted" title={e.filePath ?? undefined}>
                  {e.filePath ?? t('저장한 적 없는 새 배선도')}
                </span>
                <span className="muted">
                  {new Date(e.savedAt).toLocaleString(locale === 'en' ? 'en-US' : 'ko-KR')} · {formatBytes(e.size)}
                </span>
              </div>
              <button className="primary" onClick={() => recover(e)}>
                {t('복구')}
              </button>
              <button onClick={() => discard(e.id)}>{t('버리기')}</button>
            </li>
          ))}
        </ul>
        <footer className="modal-footer">
          <div className="spacer" />
          <button onClick={close}>{t('나중에')}</button>
        </footer>
      </div>
    </div>
  )
}
