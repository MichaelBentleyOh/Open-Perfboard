import { useEffect, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import logoUrl from '@/assets/logo.svg'
import { SUPPLY_KINDS, type PartDef, type Supply, type SupplyKind } from '@core/model'
import { SUPPLY_KIND_LABEL, emptySupply, supplySummary } from '@core/supply'
import { emptyPartDraft } from '@core/part'
import { PartEditor } from '@/features/part-editor/PartEditor'
import { SupplyEditor } from '@/features/library/SupplyEditor'
import { ImportDialog } from '@/features/library/ImportDialog'
import { HelpDialog } from '@/features/help/HelpDialog'
import { applyImport } from '@/app/libraryCommands'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSupplyStore } from '@/stores/supplyStore'
import { useStudioStore, type ItemKind } from '@/stores/studioStore'
import { useUiStore } from '@/stores/uiStore'
import { useLocaleStore, useT } from '@/i18n'

/**
 * 부품 작업실 (037a): 부품·부속 부품을 만들고 고친다.
 * 대상은 내 부품함(바로 저장) 또는 열어 둔 .opblib 파일(저장할 때 파일에 씀).
 */
export function StudioScreen() {
  const t = useT()
  const { locale, setLocale } = useLocaleStore()
  const s = useStudioStore()
  const mineParts = useLibraryStore((st) => st.parts)
  const mineSupplies = useSupplyStore((st) => st.supplies)
  const notice = useUiStore((st) => st.notice)
  const importing = useUiStore((st) => st.importRequest)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<SupplyKind | 'all'>('all')

  // ? / F1 = 그림판 단축키 도움말
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target
      if (el instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (e.key === 'F1' || e.key === '?') {
        e.preventDefault()
        useUiStore.getState().setHelpOpen(!useUiStore.getState().helpOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isFile = s.target.kind === 'file'
  const parts = isFile ? s.file.parts : mineParts
  const supplies = isFile ? s.file.supplies : mineSupplies
  const targetName = s.target.kind === 'file' ? s.target.name : t('내 부품함')

  const q = query.trim().toLowerCase()
  const shownParts = useMemo(
    () => (q ? parts.filter((p) => [p.name, p.partNumber, p.manufacturer].some((v) => v?.toLowerCase().includes(q))) : parts),
    [parts, q]
  )
  const shownSupplies = useMemo(
    () =>
      supplies.filter(
        (x) =>
          (kindFilter === 'all' || x.kind === kindFilter) &&
          (!q || [x.name, x.partNumber, x.manufacturer, x.connectorType].some((v) => v?.toLowerCase().includes(q)))
      ),
    [supplies, kindFilter, q]
  )

  const sel = s.selected
  const selectedPart = sel?.kind === 'part' && !sel.isNew ? parts.find((p) => p.id === sel.id) : undefined
  const selectedSupply = sel?.kind === 'supply' && !sel.isNew ? supplies.find((x) => x.id === sel.id) : undefined

  const goto = (screen: 'home' | 'diagram') => {
    // 파일 대상의 변경은 작업실에 남아 있으므로 화면만 바꾼다. 편집기의 변경은 버려지므로 묻는다
    if (!s.select(null)) return
    useUiStore.getState().setScreen(screen)
  }

  const itemActions = (kind: ItemKind, id: string, name: string) => (
    // 버튼을 눌러도 항목 고르기(li 클릭)는 따로 일어나지 않게
    <div className="part-actions" onClick={(e) => e.stopPropagation()}>
      <button className="icon" title={t('복제')} aria-label={t('복제: {name}', { name })} onClick={() => s.duplicate(kind, id)}>
        ⧉
      </button>
      {isFile && (
        <button className="icon" title={t('내 부품함에 넣기')} aria-label={t('내 부품함에 넣기: {name}', { name })} onClick={() => s.addToMine([id])}>
          ⤓
        </button>
      )}
      <button className="icon" title={t('삭제')} aria-label={t('삭제: {name}', { name })} onClick={() => s.removeItem(kind, id)}>
        ✕
      </button>
    </div>
  )

  return (
    <div className="studio">
      <header className="toolbar">
        <button className="brand" onClick={() => goto('home')} title={t('홈 화면으로')} aria-label={t('홈')}>
          <img src={logoUrl} alt="" width={20} height={20} />
          {t('부품 작업실')}
        </button>
        <span className="doc-name" data-testid="studio-target">
          {targetName}
          {s.dirty && <span className="dirty-mark" title={t('저장하지 않은 변경 내용')}> *</span>}
        </span>
        <div className="toolbar-group" role="group" aria-label={t('작업 대상')}>
          <button
            className={isFile ? 'toggle' : 'toggle active'}
            aria-pressed={!isFile}
            title={t('내 부품함: 저장하면 바로 반영되고 배선도에서 쓸 수 있습니다')}
            onClick={() => s.useMine()}
          >
            {t('내 부품함')}
          </button>
        </div>
        <div className="toolbar-group" role="group" aria-label={t('부품함 파일')}>
          <button onClick={() => s.newFile()} title={t('빈 부품함 파일(.opblib)을 새로 만들어 고칩니다')}>
            {t('새 부품함 파일')}
          </button>
          <button onClick={() => s.openFile()} title={t('.opblib 파일을 열어 고칩니다 (.json 부품, .opb 배선도의 부품도)')}>
            {t('열기…')}
          </button>
          <button onClick={() => s.saveFile()} disabled={!isFile} title={t('열어 둔 부품함 파일에 저장')}>
            {t('저장')}
          </button>
          <button onClick={() => s.saveFile(true)} disabled={!isFile}>
            {t('다른 이름으로 저장…')}
          </button>
        </div>
        <div className="spacer" />
        <button className="help-btn" onClick={() => useUiStore.getState().setHelpOpen(true)} title={t('단축키 도움말 (? / F1)')} aria-label={t('단축키 도움말')}>
          ?
        </button>
        <button onClick={() => goto('diagram')}>{t('배선도로 →')}</button>
        <div className="toolbar-group" role="group" aria-label="Language / 언어">
          <button className={locale === 'ko' ? 'toggle active' : 'toggle'} aria-pressed={locale === 'ko'} title="한국어" onClick={() => setLocale('ko')}>
            한
          </button>
          <button className={locale === 'en' ? 'toggle active' : 'toggle'} aria-pressed={locale === 'en'} title="English" onClick={() => setLocale('en')}>
            EN
          </button>
        </div>
      </header>

      <aside className="panel left studio-list">
        <div className="segmented library-tabs" role="tablist" aria-label={t('부품함 보기')}>
          <button role="tab" aria-selected={s.tab === 'parts'} className={s.tab === 'parts' ? 'active' : ''} onClick={() => s.setTab('parts')}>
            {t('부품')} ({parts.length})
          </button>
          <button role="tab" aria-selected={s.tab === 'supplies'} className={s.tab === 'supplies' ? 'active' : ''} onClick={() => s.setTab('supplies')}>
            {t('부속 부품')} ({supplies.length})
          </button>
        </div>
        {s.tab === 'parts' ? (
          <button className="wide" onClick={() => s.select({ kind: 'part', id: nanoid(), isNew: true })}>
            {t('＋ 새 부품')}
          </button>
        ) : (
          <button className="wide" onClick={() => s.select({ kind: 'supply', id: nanoid(), isNew: true, supplyKind: kindFilter === 'all' ? 'housing' : kindFilter })}>
            {t('＋ 새 부속 부품')}
          </button>
        )}
        {isFile && (
          <button
            className="wide"
            disabled={parts.length + supplies.length === 0}
            onClick={() => s.addToMine()}
            title={t('이 파일의 부품·부속 부품을 모두 내 부품함에 넣습니다 (같은 이름은 물어봄)')}
          >
            {t('⤓ 모두 내 부품함에 넣기')}
          </button>
        )}
        <input className="search" placeholder={t('이름·품번으로 찾기')} value={query} onChange={(e) => setQuery(e.target.value)} />

        {s.tab === 'parts' ? (
          <>
            {parts.length === 0 && <p className="empty">{isFile ? t('이 부품함 파일에 부품이 없습니다.') : t('부품함이 비어 있습니다.')}</p>}
            <ul className="part-list" data-testid="studio-part-list">
              {shownParts.map((p: PartDef) => (
                <li
                  key={p.id}
                  className={sel?.kind === 'part' && sel.id === p.id ? 'part-item selected' : 'part-item'}
                  onClick={() => s.select({ kind: 'part', id: p.id })}
                >
                  <img src={p.image.data} alt="" />
                  <div className="part-info">
                    <strong>{p.name}</strong>
                    <span>{[p.partNumber, t('핀 {n}', { n: p.pins.length })].filter(Boolean).join(' · ')}</span>
                  </div>
                  {itemActions('part', p.id, p.name)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <div className="kind-filter" role="group" aria-label={t('부속 부품 종류')}>
              {(['all', ...SUPPLY_KINDS] as const).map((k) => (
                <button key={k} className={kindFilter === k ? 'chip active' : 'chip'} aria-pressed={kindFilter === k} onClick={() => setKindFilter(k)}>
                  {k === 'all' ? t('전체') : t(SUPPLY_KIND_LABEL[k])}
                </button>
              ))}
            </div>
            {supplies.length === 0 && <p className="empty">{t('하우징·단자·수축 튜브·전선을 등록해 두면 전선과 BOM에서 고를 수 있습니다.')}</p>}
            <ul className="part-list supply-list" data-testid="studio-supply-list">
              {shownSupplies.map((x: Supply) => (
                <li
                  key={x.id}
                  className={sel?.kind === 'supply' && sel.id === x.id ? 'part-item supply-item selected' : 'part-item supply-item'}
                  onClick={() => s.select({ kind: 'supply', id: x.id })}
                >
                  {x.image ? (
                    <img src={x.image.data} alt="" />
                  ) : (
                    <span className="supply-icon" style={x.color ? { background: x.color } : undefined} aria-hidden>
                      {x.color ? '' : t(SUPPLY_KIND_LABEL[x.kind]).slice(0, 1)}
                    </span>
                  )}
                  <div className="part-info">
                    <strong>{x.name}</strong>
                    <span>{[t(SUPPLY_KIND_LABEL[x.kind]), supplySummary(x, t)].filter(Boolean).join(' · ')}</span>
                  </div>
                  {itemActions('supply', x.id, x.name)}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>

      <main className="studio-main">
        {sel?.kind === 'part' && (sel.isNew || selectedPart) ? (
          <PartEditor
            key={s.editorKey}
            variant="panel"
            initial={selectedPart ?? emptyPartDraft(sel.id)}
            isNew={!!sel.isNew}
            onCancel={s.revert}
            onSave={(p) => s.saveItem('part', p)}
            onDirtyChange={s.setEditorDirty}
            initialView={s.partView ?? undefined}
            onViewChange={s.setPartView}
          />
        ) : sel?.kind === 'supply' && (sel.isNew || selectedSupply) ? (
          <SupplyEditor
            key={s.editorKey}
            variant="panel"
            initial={selectedSupply ?? emptySupply(sel.id, sel.supplyKind ?? 'housing')}
            isNew={!!sel.isNew}
            onCancel={s.revert}
            onSave={(x) => s.saveItem('supply', x)}
            onDirtyChange={s.setEditorDirty}
          />
        ) : (
          <div className="studio-empty">
            <p>{t('왼쪽 목록에서 고르거나 새로 만드세요.')}</p>
            <p className="muted">
              {isFile
                ? t('지금은 부품함 파일 "{name}"을 고치고 있습니다. 저장하면 이 파일에 씁니다.', { name: targetName })
                : t('지금은 내 부품함을 고치고 있습니다. 저장하면 바로 배선도에서 쓸 수 있습니다.')}
            </p>
          </div>
        )}
        {notice && (
          <div className="canvas-status" role="status">
            {notice}
          </div>
        )}
      </main>

      <HelpDialog studio />
      {importing && (
        <ImportDialog
          request={importing}
          onCancel={() => useUiStore.getState().setImportRequest(null)}
          onImport={(toSave, suppliesToSave) => applyImport(importing, toSave, suppliesToSave)}
        />
      )}
    </div>
  )
}
