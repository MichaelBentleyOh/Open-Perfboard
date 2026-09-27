import { useEffect, useState } from 'react'
import { formatBytes, isImageAttachment } from '@core/attachment'
import type { Attachment } from '@core/model'
import { CommitInput } from '@/components/CommitInput'
import { useAttachmentRevision } from '@/services/attachmentService'
import { useUiStore } from '@/stores/uiStore'
import { useT } from '@/i18n'

/** 이 PC에 있는 첨부 id. 목록이나 첨부 폴더가 바뀌면 다시 확인 */
function usePresent(ids: string[]): Set<string> | null {
  const [present, setPresent] = useState<Set<string> | null>(null)
  const revision = useAttachmentRevision((s) => s.n)
  const key = ids.join(',')
  useEffect(() => {
    let alive = true
    window.api.attachments.exists(ids).then((found) => alive && setPresent(new Set(found)))
    return () => {
      alive = false
    }
  }, [key, revision])
  return present
}

interface Props {
  items: Attachment[]
  /** 편집 가능(부품 편집기): 제목 바꾸기·삭제 */
  onRename?: (id: string, name: string) => void
  onRemove?: (id: string) => void
}

/** 첨부 목록: 그림은 썸네일, PDF는 아이콘. 누르면 앱의 별도 창에서 열린다 */
export function AttachmentList({ items, onRename, onRemove }: Props) {
  const t = useT()
  const present = usePresent(items.map((a) => a.id))
  const open = async (a: Attachment) => {
    try {
      await window.api.attachments.open(a.id, a.name)
    } catch (e) {
      useUiStore.getState().notify((e as Error).message)
    }
  }
  return (
    <ul className="attachment-list" data-testid="attachment-list">
      {items.map((a) => {
        const missing = present !== null && !present.has(a.id)
        return (
          <li key={a.id} className={missing ? 'attachment missing' : 'attachment'}>
            <button className="attachment-thumb" onClick={() => open(a)} disabled={missing} title={t('열기')} aria-label={t('{name} 열기', { name: a.name })}>
              {isImageAttachment(a.type) && !missing && present ? <img src={`opb-attach://${a.id}`} alt="" /> : <span>{a.type === 'pdf' ? 'PDF' : '🖼'}</span>}
            </button>
            <div className="attachment-info">
              {onRename ? (
                <CommitInput aria-label={t('첨부 제목')} value={a.name} onCommit={(v) => (v.trim() ? onRename(a.id, v) : false)} />
              ) : (
                <button className="link" onClick={() => open(a)} disabled={missing}>
                  {a.name}
                </button>
              )}
              <small>
                {a.type.toUpperCase()} · {formatBytes(a.size)}
                {missing && <span className="warning-inline"> · {t('파일 없음')}</span>}
              </small>
            </div>
            {onRemove && (
              <button className="icon" title={t('첨부 삭제')} aria-label={t('첨부 삭제')} onClick={() => onRemove(a.id)}>
                ✕
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
