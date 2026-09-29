import { useEffect, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import type { PartDef, Supply, SupplyKind } from '@core/model'
import { SUPPLY_KINDS } from '@core/model'
import { SUPPLY_KIND_LABEL, emptySupply, supplySummary } from '@core/supply'
import { emptyPartDraft, type PartDraft } from '@core/part'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSupplyStore } from '@/stores/supplyStore'
import { SupplyEditor } from './SupplyEditor'
import { PartEditor } from '@/features/part-editor/PartEditor'
import { PART_DRAG_TYPE } from '@/features/canvas/dragTypes'
import { planImport, readLibraryFile, serializeLibrary } from '@core/library'
import { attachmentIdsOf, type AttachmentData } from '@core/attachment'
import { collectAttachmentData } from '@/services/attachmentService'
import { applyImport } from '@/app/libraryCommands'
import { useUiStore } from '@/stores/uiStore'
import { ImportDialog } from './ImportDialog'
import { useT } from '@/i18n'

const notify = (m: string) => useUiStore.getState().notify(m)

export function LibraryPanel() {
  const t = useT()
  const { parts, status, problems, load, save, remove } = useLibraryStore()
  const importing = useUiStore((s) => s.importRequest)
  const setImporting = useUiStore((s) => s.setImportRequest)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<{ draft: PartDraft; isNew: boolean } | null>(null)
  // 부속 부품 (027)
  const supplyStore = useSupplyStore()
  const [tab, setTab] = useState<'parts' | 'supplies'>('parts')
  const [kindFilter, setKindFilter] = useState<SupplyKind | 'all'>('all')
  const [editingSupply, setEditingSupply] = useState<{ draft: Supply; isNew: boolean } | null>(null)

  // 보통은 시작 화면(036)이 이미 읽었다. 아직이면 여기서 읽는다
  useEffect(() => {
    if (useLibraryStore.getState().status === 'idle') load()
    if (useSupplyStore.getState().status === 'idle') useSupplyStore.getState().load()
  }, [load])

  const filteredSupplies = useMemo(() => {
    const q = query.trim().toLowerCase()
    return supplyStore.supplies.filter(
      (s) =>
        (kindFilter === 'all' || s.kind === kindFilter) &&
        (!q || [s.name, s.partNumber, s.manufacturer, s.connectorType].some((v) => v?.toLowerCase().includes(q)))
    )
  }, [supplyStore.supplies, kindFilter, query])

  const handleDeleteSupply = async (s: Supply) => {
    if (!window.confirm(t("'{name}'을(를) 부속 부품에서 삭제할까요?\n이미 저장된 배선도에는 영향이 없습니다.", { name: s.name }))) return
    await supplyStore.remove(s.id)
  }

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
      const incomingSupplies: Supply[] = []
      const fileProblems: string[] = []
      const attachmentData: AttachmentData = {}
      for (const f of files) {
        const r = readLibraryFile(f.content, f.name, t)
        incoming.push(...r.parts)
        incomingSupplies.push(...(r.supplies ?? []))
        fileProblems.push(...r.problems)
        Object.assign(attachmentData, r.attachmentData)
      }
      setImporting({
        files: files.map((f) => f.name),
        plan: planImport(useLibraryStore.getState().parts, incoming),
        supplyPlan: planImport(useSupplyStore.getState().supplies, incomingSupplies),
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
      const supplies = useSupplyStore.getState().supplies
      const saved = await window.api.export.save('opblib', t('부품함'), serializeLibrary(parts, data, supplies))
      if (saved) {
        const name = saved.split(/[\\/]/).pop() ?? ''
        notify(
          supplies.length
            ? t('부품 {n}개, 부속 부품 {m}개를 내보냈습니다: {name}', { n: parts.length, m: supplies.length, name })
            : t('부품 {n}개를 내보냈습니다: {name}', { n: parts.length, name })
        )
      }
    } catch (e) {
      window.alert(`${t('내보내지 못했습니다.')}\n${(e as Error).message}`)
    }
  }

  return (
    <>
      <h2>{t('부품함')}</h2>
      <div className="segmented library-tabs" role="tablist" aria-label={t('부품함 보기')}>
        <button role="tab" aria-selected={tab === 'parts'} className={tab === 'parts' ? 'active' : ''} onClick={() => setTab('parts')}>
          {t('부품')}
        </button>
        <button role="tab" aria-selected={tab === 'supplies'} className={tab === 'supplies' ? 'active' : ''} onClick={() => setTab('supplies')}>
          {t('부속 부품')}
        </button>
      </div>
      {tab === 'parts' ? (
        <button className="wide" onClick={() => setEditing({ draft: emptyPartDraft(nanoid()), isNew: true })}>
          {t('＋ 새 부품')}
        </button>
      ) : (
        <button
          className="wide"
          onClick={() => setEditingSupply({ draft: emptySupply(nanoid(), kindFilter === 'all' ? 'housing' : kindFilter), isNew: true })}
        >
          {t('＋ 새 부속 부품')}
        </button>
      )}
      <div className="button-row">
        <button className="grow" onClick={startImport} title={t('.opblib 부품함 파일, .json 부품, .opb 배선도에서 부품 가져오기')}>
          {t('⤓ 가져오기')}
        </button>
        <button
          className="grow"
          onClick={exportLibrary}
          disabled={parts.length === 0 && supplyStore.supplies.length === 0}
          title={t('내 부품함 전체(부속 부품 포함)를 .opblib 파일로')}
        >
          {t('⤒ 내보내기')}
        </button>
      </div>
      <input
        className="search"
        placeholder={t('이름·품번으로 찾기')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {tab === 'supplies' && (
        <>
          <div className="kind-filter" role="group" aria-label={t('부속 부품 종류')}>
            {(['all', ...SUPPLY_KINDS] as const).map((k) => (
              <button key={k} className={kindFilter === k ? 'chip active' : 'chip'} aria-pressed={kindFilter === k} onClick={() => setKindFilter(k)}>
                {k === 'all' ? t('전체') : t(SUPPLY_KIND_LABEL[k])}
              </button>
            ))}
          </div>
          {supplyStore.problems.map((p) => (
            <p key={p} className="warning">
              {p}
            </p>
          ))}
          {supplyStore.status === 'ready' && supplyStore.supplies.length === 0 && (
            <p className="empty">{t('하우징·단자·수축 튜브·전선을 등록해 두면 전선과 BOM에서 고를 수 있습니다.')}</p>
          )}
          <ul className="part-list supply-list" data-testid="supply-list">
            {filteredSupplies.map((s) => (
              <li key={s.id} className="part-item supply-item" onDoubleClick={() => setEditingSupply({ draft: s, isNew: false })}>
                {s.image ? (
                  <img src={s.image.data} alt="" />
                ) : (
                  <span className="supply-icon" style={s.color ? { background: s.color } : undefined} aria-hidden>
                    {s.color ? '' : t(SUPPLY_KIND_LABEL[s.kind]).slice(0, 1)}
                  </span>
                )}
                <div className="part-info">
                  <strong>{s.name}</strong>
                  <span>{[t(SUPPLY_KIND_LABEL[s.kind]), supplySummary(s, t)].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="part-actions">
                  <button className="icon" title={t('편집')} aria-label={t('편집')} onClick={() => setEditingSupply({ draft: s, isNew: false })}>
                    ✎
                  </button>
                  <button className="icon" title={t('삭제')} aria-label={t('삭제')} onClick={() => handleDeleteSupply(s)}>
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'parts' && (
        <>
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
        </>
      )}

      {editingSupply && (
        <SupplyEditor
          initial={editingSupply.draft}
          isNew={editingSupply.isNew}
          onCancel={() => setEditingSupply(null)}
          onSave={async (s) => {
            await supplyStore.save(s)
            setEditingSupply(null)
          }}
        />
      )}

      {importing && (
        <ImportDialog
          request={importing}
          onCancel={() => setImporting(null)}
          onImport={(toSave, suppliesToSave) => applyImport(importing, toSave, suppliesToSave)}
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
