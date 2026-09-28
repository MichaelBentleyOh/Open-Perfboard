import { useState } from 'react'
import { useSheets, useWorkspaceStore } from '@/stores/workspaceStore'
import { useT } from '@/i18n'

/**
 * 화면 아래 배선도 탭 줄 (030): 누르면 그 배선도로, 두 번 누르면 이름 바꾸기, ✕로 삭제, ＋로 새 배선도.
 * 실행 취소 기록은 배선도마다 따로 남는다
 */
export function SheetTabs() {
  const t = useT()
  const sheets = useSheets()
  const activeId = useWorkspaceStore((s) => s.activeId)
  const ws = useWorkspaceStore.getState
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const commit = () => {
    if (editing && draft.trim()) ws().renameSheet(editing, draft)
    setEditing(null)
  }

  const remove = (id: string, name: string, empty: boolean) => {
    if (!empty && !window.confirm(t("'{name}' 배선도를 지울까요?\n이 배선도의 부품·전선이 모두 지워집니다. (저장하기 전이면 파일은 그대로)", { name }))) return
    ws().removeSheet(id)
  }

  return (
    <div className="sheet-tabs" role="tablist" aria-label={t('배선도 목록')} data-testid="sheet-tabs">
      {sheets.map((s) => {
        const active = s.id === activeId
        const empty = s.project.instances.length === 0 && s.project.wires.length === 0
        return (
          <div key={s.id} className={active ? 'sheet-tab active' : 'sheet-tab'} data-sheet={s.id}>
            {editing === s.id ? (
              <input
                className="sheet-rename"
                aria-label={t('배선도 이름')}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={commit}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <button
                role="tab"
                aria-selected={active}
                title={t('두 번 누르면 이름 바꾸기')}
                onClick={() => ws().switchTo(s.id)}
                onDoubleClick={() => {
                  setDraft(s.name)
                  setEditing(s.id)
                }}
              >
                {s.name}
              </button>
            )}
            {sheets.length > 1 && editing !== s.id && (
              <button
                className="sheet-close"
                aria-label={t('{name} 지우기', { name: s.name })}
                title={t('배선도 지우기')}
                onClick={() => remove(s.id, s.name, empty)}
              >
                ✕
              </button>
            )}
          </div>
        )
      })}
      <button className="sheet-add" aria-label={t('새 배선도 추가')} title={t('새 배선도 추가')} onClick={() => ws().addSheet()}>
        ＋
      </button>
    </div>
  )
}
