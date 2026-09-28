import { useEffect, useRef, useState } from 'react'
import { useSheets, useWorkspaceStore } from '@/stores/workspaceStore'
import { useT } from '@/i18n'

/**
 * BOM·결선표에 넣을 배선도 고르기 (030). 칸을 누르면 아래로 펼쳐져
 * 맨 위 "모두 선택", 그 아래 배선도마다 체크 칸이 칸 너비에 맞춰 한 줄씩 나온다
 */
export function ScopePicker() {
  const t = useT()
  const sheets = useSheets()
  const scope = useWorkspaceStore((s) => s.scope)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const chosen = new Set(scope ?? sheets.map((s) => s.id))
  const all = sheets.every((s) => chosen.has(s.id))
  const none = sheets.every((s) => !chosen.has(s.id))

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const set = (ids: Set<string>) => {
    const list = sheets.filter((s) => ids.has(s.id)).map((s) => s.id)
    useWorkspaceStore.getState().setScope(list.length === sheets.length ? null : list)
  }
  const toggle = (id: string) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    set(next)
  }

  const label = all
    ? sheets.length > 1
      ? t('배선도: 모두 ({n})', { n: sheets.length })
      : t('배선도: {name}', { name: sheets[0]?.name ?? '' })
    : none
      ? t('배선도: 없음')
      : chosen.size === 1
        ? t('배선도: {name}', { name: sheets.find((s) => chosen.has(s.id))!.name })
        : t('배선도: {n}개', { n: chosen.size })

  return (
    <div className="scope-picker" ref={ref}>
      <button
        className="scope-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('포함할 배선도')}
        title={t('포함할 배선도')}
        onClick={() => setOpen((o) => !o)}
      >
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="scope-list" role="listbox" aria-multiselectable aria-label={t('포함할 배선도')}>
          <label className="scope-item scope-all">
            <input
              type="checkbox"
              checked={all}
              ref={(el) => {
                if (el) el.indeterminate = !all && !none
              }}
              onChange={() => set(all ? new Set() : new Set(sheets.map((s) => s.id)))}
            />
            {t('모두 선택')}
          </label>
          {sheets.map((s) => (
            <label key={s.id} className="scope-item">
              <input type="checkbox" checked={chosen.has(s.id)} onChange={() => toggle(s.id)} />
              {s.name}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
