import { useEffect, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import type { PartDef } from '@core/model'
import { emptyPartDraft, type PartDraft } from '@core/part'
import { useLibraryStore } from '@/stores/libraryStore'
import { PartEditor } from '@/features/part-editor/PartEditor'
import { PART_DRAG_TYPE } from '@/features/canvas/CanvasView'
import { planImport, readLibraryFile, serializeLibrary } from '@core/library'
import { attachmentIdsOf, type AttachmentData } from '@core/attachment'
import { collectAttachmentData, putAttachmentData } from '@/services/attachmentService'
import { useUiStore } from '@/stores/uiStore'
import { ImportDialog } from './ImportDialog'
import { useT } from '@/i18n'

const notify = (m: string) => useUiStore.getState().notify(m)

export function LibraryPanel() {
  const t = useT()
  const { parts, status, problems, load, save, saveMany, remove } = useLibraryStore()
  const importing = useUiStore((s) => s.importRequest)
  const setImporting = useUiStore((s) => s.setImportRequest)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ draft: PartDraft; isNew: boolean } | null>(null)

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return parts
    return parts.filter((p) =>
      [p.name, p.partNumber, p.manufacturer].some((v) => v?.toLowerCase().includes(q))
    )
  }, [parts, query])

  const handleDelete = async (part: PartDef) => {
    if (!window.confirm(t("'{name}' 부품을 부품함에서 삭제할까요?\n이미 저장된 배선도에는 영향이 없습니다.", { name: part.name }))) return
    await remove(part.id)
  }

  /** 파일을 골라 읽고 → 내 라이브러리와 비교 → 확인 대화상자 */
  const startImport = async () => {
    try {
      const files = await window.api.library.pickFiles()
      if (files.length === 0) return
      const incoming = []
      const fileProblems: string[] = []
      const attachmentData: AttachmentData = {}
      for (const f of files) {
        const r = readLibraryFile(f.content, f.name, t)
        incoming.push(...r.parts)
        fileProblems.push(...r.problems)
        Object.assign(attachmentData, r.attachmentData)
      }
      setImporting({
        files: files.map((f) => f.name),
        plan: planImport(useLibraryStore.getState().parts, incoming),
        problems: fileProblems,
        attachmentData
      })
    } catch (e) {
      window.alert(`${t('파일을 읽지 못했습니다.')}\n${(e as Error).message}`)
    }
  }

  const exportLibrary = async () => {
    try {
      // 첨부 본문도 함께 (다른 PC에서 데이터시트를 볼 수 있게)
      const data = await collectAttachmentData(attachmentIdsOf(parts))
      const saved = await window.api.export.save('opblib', t('부품함'), serializeLibrary(parts, data))
      if (saved) notify(t('부품 {n}개를 내보냈습니다: {name}', { n: parts.length, name: saved.split(/[\\/]/).pop() ?? '' }))
    } catch (e) {
      window.alert(`${t('내보내지 못했습니다.')}\n${(e as Error).message}`)
    }
  }

  return (
    <>
      <h2>{t('부품함')}</h2>
      <button className="wide" onClick={() => setEditing({ draft: emptyPartDraft(nanoid()), isNew: true })}>
        {t('＋ 새 부품')}
      </button>
      <div className="button-row">
        <button className="grow" onClick={startImport} title={t('.opblib 부품함 파일, .json 부품, .opb 배선도에서 부품 가져오기')}>
          {t('⤓ 가져오기')}
        </button>
        <button className="grow" onClick={exportLibrary} disabled={parts.length === 0} title={t('내 부품함 전체를 .opblib 파일로')}>
          {t('⤒ 내보내기')}
        </button>
      </div>
      <input
        className="search"
        placeholder={t('이름·품번으로 찾기')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {problems.map((p) => (
        <p key={p} className="warning">
          {p}
        </p>
      ))}

      {status === 'loading' && <p className="empty">{t('불러오는 중…')}</p>}
      {status === 'ready' && parts.length === 0 && <p className="empty">{t('부품함이 비어 있습니다.')}</p>}
      {status === 'ready' && parts.length > 0 && filtered.length === 0 && (
        <p className="empty">{t('검색 결과가 없습니다.')}</p>
      )}

      <ul className="part-list" data-testid="part-list">
        {filtered.map((part) => (
          <li
            key={part.id}
            className="part-item"
            draggable
            title={t('캔버스로 끌어다 놓으세요')}
            onDragStart={(e) => {
              e.dataTransfer.setData(PART_DRAG_TYPE, part.id)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onDoubleClick={() => setEditing({ draft: part, isNew: false })}
          >
            <img src={part.image.data} alt="" />
            <div className="part-info">
              <strong>{part.name}</strong>
              <span>
                {[part.attachments?.length ? `📎 ${part.attachments.length}` : '', part.partNumber, t('핀 {n}', { n: part.pins.length })]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <div className="part-actions">
              <button className="icon" title={t('편집')} aria-label={t('편집')} onClick={() => setEditing({ draft: part, isNew: false })}>
                ✎
              </button>
              <button className="icon" title={t('삭제')} aria-label={t('삭제')} onClick={() => handleDelete(part)}>
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      {importing && (
        <ImportDialog
          request={importing}
          onCancel={() => setImporting(null)}
          onImport={async (toSave) => {
            try {
              await saveMany(toSave)
              await putAttachmentData(importing.attachmentData, attachmentIdsOf(toSave))
              notify(t('부품 {n}개를 가져왔습니다', { n: toSave.length }))
            } catch (e) {
              window.alert(`${t('가져오지 못했습니다.')}\n${(e as Error).message}`)
            }
            setImporting(null)
          }}
        />
      )}

      {editing && (
        <PartEditor
          initial={editing.draft}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSave={async (part) => {
            await save(part)
            setEditing(null)
          }}
        />
      )}
    </>
  )
}
