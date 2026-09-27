import { useEffect, useState } from 'react'
import { useUiStore } from '@/stores/uiStore'
import { useT } from '@/i18n'

/** 이보다 빨리 끝나는 작업은 진행 창을 보이지 않는다 (깜빡임 방지). 그동안에도 조작은 막는다 */
const SHOW_AFTER_MS = 300

/** 오래 걸리는 작업(배선 정리)의 진행 창: 진행률과 취소. 떠 있는 동안 다른 조작·단축키는 막힌다 */
export function BusyOverlay() {
  const t = useT()
  const busy = useUiStore((s) => s.busy)
  const [shown, setShown] = useState(false)
  const active = busy !== null

  useEffect(() => {
    if (!active) {
      setShown(false)
      return
    }
    const timer = setTimeout(() => setShown(true), SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [active])

  useEffect(() => {
    if (!busy) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') busy.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy?.cancel])

  if (!busy) return null
  const percent = busy.total > 0 ? Math.round((busy.done / busy.total) * 100) : 0
  return (
    <div className={`modal-backdrop${shown ? '' : ' invisible'}`} data-testid="busy-overlay">
      <div className="modal busy-dialog" role="dialog" aria-label={busy.label}>
        <header className="modal-header">
          <h2>{busy.label}</h2>
        </header>
        <div className="busy-body">
          <progress max={busy.total} value={busy.done} aria-label={busy.label} />
          <span>
            {busy.done} / {busy.total} ({percent}%)
          </span>
        </div>
        <footer className="modal-footer">
          <div className="spacer" />
          <button onClick={busy.cancel}>{t('취소')}</button>
        </footer>
      </div>
    </div>
  )
}
