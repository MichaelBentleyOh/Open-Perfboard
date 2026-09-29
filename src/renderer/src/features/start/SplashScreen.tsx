import { useEffect, useState } from 'react'
import logoUrl from '@/assets/logo.svg'
import { runStartup, STARTUP_BASE, type StartupResult } from '@/app/startup'
import { useT } from '@/i18n'

/** 막대가 끝까지 차는 모습을 보여 주는 시간 (너무 빨리 끝나 깜빡이지 않게) */
const FINISH_MS = 200

/**
 * 로딩 화면 (036): 큰 로고와 아래 진행 막대. index.html의 정적 화면과 같은 모양이라 React가 이어받아도 튀지 않는다.
 * 시작 작업이 끝나면 onDone.
 */
export function SplashScreen({ onDone }: { onDone: (r: StartupResult) => void }) {
  const t = useT()
  const [progress, setProgress] = useState(STARTUP_BASE)
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    runStartup((l, p) => {
      if (cancelled) return
      setLabel(l)
      setProgress(p)
    }).then((r) => {
      if (!cancelled) setTimeout(() => onDone(r), FINISH_MS)
    })
    return () => {
      cancelled = true
    }
  }, [onDone])

  return (
    <div className="splash" role="progressbar" aria-label={t('시작하는 중')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
      <img className="splash-logo" src={logoUrl} alt="" />
      <div className="splash-name">Open Perfboard</div>
      <div className="splash-bar">
        <div className="splash-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="splash-step">{label ? t(label) : progress >= 1 ? t('준비 완료') : ''}</div>
    </div>
  )
}
