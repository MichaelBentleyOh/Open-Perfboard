import { useEffect } from 'react'
import { MOUSE_HELP, SHORTCUTS, STUDIO_MOUSE_HELP, STUDIO_SHORTCUTS, formatCombo, type Combo } from '@core/keymap'
import { useUiStore } from '@/stores/uiStore'
import { useT } from '@/i18n'

interface Row {
  id: string
  group: string
  description: string
  combos: Combo[]
}

/** 분류 순서를 지키며 묶는다. 설명이 같은 줄(방향키 네 개 등)은 한 줄로 */
function grouped(list: readonly Row[]): [string, Row[]][] {
  const out: [string, Row[]][] = []
  for (const s of list) {
    const last = out.find(([g]) => g === s.group)
    const same = last?.[1].find((r) => r.description === s.description)
    if (same) same.combos = [...same.combos, ...s.combos].filter((c) => !c.shift)
    else if (last) last[1].push({ ...s, combos: [...s.combos] })
    else out.push([s.group, [{ ...s, combos: [...s.combos] }]])
  }
  return out
}

/**
 * 단축키·마우스 조작 도움말. 내용은 core/keymap.ts 목록에서 만든다 (실제 동작과 같은 목록).
 * studio면 부품 작업실 그림판 단축키 (037b)
 */
export function HelpDialog({ studio = false }: { studio?: boolean }) {
  const t = useT()
  const open = useUiStore((s) => s.helpOpen)
  const version = useUiStore((s) => s.appVersion)
  const close = () => useUiStore.getState().setHelpOpen(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'F1' || e.key === '?') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal help-dialog" role="dialog" aria-label={t('단축키 도움말')}>
        <header className="modal-header">
          <h2>{studio ? t('단축키 도움말 — 부품 그림판') : t('단축키 도움말')}</h2>
        </header>
        <div className="help-body">
          <div className="help-columns">
            {grouped(studio ? STUDIO_SHORTCUTS : SHORTCUTS).map(([group, items]) => (
              <section key={group} className="help-group">
                <h3>{t(group)}</h3>
                <table>
                  <tbody>
                    {items.map((s) => (
                      <tr key={s.id}>
                        <td className="help-keys">
                          {s.combos.filter((c) => !c.alias).map((c, i) => (
                            <span key={i}>
                              {i > 0 && ' / '}
                              <kbd>{formatCombo(c)}</kbd>
                            </span>
                          ))}
                        </td>
                        <td>{t(s.description)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
          <section className="help-group help-mouse">
            <h3>{t('마우스')}</h3>
            <table>
              <tbody>
                {(studio ? STUDIO_MOUSE_HELP : MOUSE_HELP).map((m) => (
                  <tr key={m.gesture}>
                    <td className="help-keys">{t(m.gesture)}</td>
                    <td>{t(m.description)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <footer className="modal-footer">
          <div className="messages">
            <span className="hint-text">{t('? 또는 F1로 열고 닫을 수 있습니다')}</span>
            {version && <span className="hint-text app-version"> · Open Perfboard v{version}</span>}
          </div>
          <button className="primary" onClick={close}>
            {t('닫기')}
          </button>
        </footer>
      </div>
    </div>
  )
}
