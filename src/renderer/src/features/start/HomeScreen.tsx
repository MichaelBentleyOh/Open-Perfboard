import { useEffect, useState } from 'react'
import logoUrl from '@/assets/logo.svg'
import { openDocument, openRecent } from '@/app/fileCommands'
import { useUiStore } from '@/stores/uiStore'
import { documentName, useDocumentStore, useIsDirty } from '@/stores/documentStore'
import { useLocaleStore, useT } from '@/i18n'

type Recent = Awaited<ReturnType<Window['api']['recent']['list']>>[number]

/** 홈에 보여 줄 최근 배선도 수 */
const RECENT_MAX = 5

/** 부품 그림: 핀이 달린 칩 */
function PartIcon() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden>
      <rect x="16" y="14" width="32" height="36" rx="4" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="3" />
      {[22, 32, 42].map((y) => (
        <g key={y} stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <line x1="6" y1={y} x2="16" y2={y} />
          <line x1="48" y1={y} x2="58" y2={y} />
        </g>
      ))}
      <circle cx="24" cy="21" r="3" fill="currentColor" />
    </svg>
  )
}

/** 배선도 그림: 두 부품을 잇는 전선 */
function DiagramIcon() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden>
      <rect x="4" y="10" width="20" height="20" rx="3" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="3" />
      <rect x="40" y="34" width="20" height="20" rx="3" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="3" />
      <path d="M24 16 H34 V40 H40" fill="none" stroke="#e53935" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 24 H30 V48 H40" fill="none" stroke="#1e88e5" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * 홈 (036): 큰 버튼 두 개(부품 만들기 / 배선도 만들기)와 최근 배선도.
 * 배선도는 메모리에 그대로 있으므로 홈에 왔다가 돌아가도 하던 작업이 이어진다.
 */
export function HomeScreen() {
  const t = useT()
  const { locale, setLocale } = useLocaleStore()
  const version = useUiStore((s) => s.appVersion)
  const notice = useUiStore((s) => s.notice)
  const filePath = useDocumentStore((s) => s.filePath)
  const dirty = useIsDirty()
  const [recent, setRecent] = useState<Recent[]>([])

  const loadRecent = () => window.api.recent.list().then(setRecent, () => setRecent([]))
  useEffect(() => {
    loadRecent()
  }, [])

  // 이어서 할 배선도가 있으면 버튼에 이름을 보여 준다
  const current = filePath || dirty ? documentName(filePath) + (dirty ? ' *' : '') : null
  const enterDiagram = () => useUiStore.getState().setScreen('diagram')

  return (
    <div className="home">
      <div className="home-top">
        <div className="toolbar-group home-lang" role="group" aria-label="Language / 언어">
          <button className={locale === 'ko' ? 'toggle active' : 'toggle'} aria-pressed={locale === 'ko'} title="한국어" onClick={() => setLocale('ko')}>
            한
          </button>
          <button className={locale === 'en' ? 'toggle active' : 'toggle'} aria-pressed={locale === 'en'} title="English" onClick={() => setLocale('en')}>
            EN
          </button>
        </div>
      </div>

      <div className="home-main">
        <header className="home-brand">
          <img src={logoUrl} alt="" width={72} height={72} />
          <h1>Open Perfboard</h1>
        </header>

        <div className="home-actions">
          <button className="home-card" onClick={() => useUiStore.getState().setScreen('studio')}>
            <PartIcon />
            <strong>{t('부품 만들기')}</strong>
            <span>{t('부품·부속 부품을 만들고 부품함 파일(.opblib)을 고칩니다')}</span>
          </button>
          <button className="home-card" onClick={enterDiagram}>
            <DiagramIcon />
            <strong>{t('배선도 만들기')}</strong>
            <span>{current ? t('이어서: {name}', { name: current }) : t('부품을 놓고 전선을 이어 BOM·결선표까지 만듭니다')}</span>
          </button>
        </div>

        <section className="home-recent" aria-label={t('최근 배선도')}>
          <div className="home-recent-head">
            <h2>{t('최근 배선도')}</h2>
            <button className="link" onClick={() => openDocument()}>
              {t('배선도 열기…')}
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="muted">{t('최근에 연 배선도가 없습니다')}</p>
          ) : (
            <ul>
              {recent.slice(0, RECENT_MAX).map((r) => (
                <li key={r.path}>
                  <button
                    className={r.exists ? '' : 'missing'}
                    title={r.exists ? r.path : t('파일을 찾을 수 없습니다: {path}', { path: r.path })}
                    onClick={() => openRecent(r.path).then(loadRecent)}
                  >
                    <strong>{documentName(r.path)}</strong>
                    <span className="menu-path">{r.path.replace(/[\\/][^\\/]*$/, '')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {notice && (
        <div className="home-notice" role="status">
          {notice}
        </div>
      )}
      {version && <div className="home-version">v{version}</div>}
    </div>
  )
}
