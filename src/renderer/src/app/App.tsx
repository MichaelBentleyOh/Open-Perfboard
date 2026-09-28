import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { CanvasView } from '@/features/canvas/CanvasView'
import { ZoomInput } from '@/features/canvas/ZoomInput'
import { HelpDialog } from '@/features/help/HelpDialog'
import { BusyOverlay } from '@/components/BusyOverlay'
import { RecoveryDialog } from '@/features/recovery/RecoveryDialog'
import { scopedSheets, useSheets, useWorkspaceStore } from '@/stores/workspaceStore'
import type { Project } from '@core/model'
import { SheetTabs } from '@/features/sheets/SheetTabs'
import { SearchBox } from '@/features/search/SearchBox'
import { GridSnapControl } from '@/features/canvas/GridSnapControl'
import { addTextBox } from './editCommands'
import { LibraryPanel } from '@/features/library/LibraryPanel'
import { ColorPicker, PropertiesPanel } from '@/features/properties/PropertiesPanel'
import { NetlistView } from '@/features/reports/Reports'
import { BomEditor } from '@/features/reports/BomEditor'
import { PdfDialog, type PdfDialogValue } from '@/features/export/PdfDialog'
import { redo, undo, useProjectStore } from '@/stores/projectStore'
import { documentName, useDocumentStore, useIsDirty } from '@/stores/documentStore'
import { useUiStore } from '@/stores/uiStore'
import { useLocaleStore, useT } from '@/i18n'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  exportBomCsv,
  exportBomXlsx,
  exportNetlistCsv,
  exportPdf,
  exportPng,
  newDocument,
  openDocument,
  openFilePayload,
  openRecent,
  saveDocument
} from './fileCommands'
import { startAutosave } from './autosave'
import { tidyWiring } from './editCommands'
import { useCanvasShortcuts } from './shortcuts'

type BottomTab = 'diagram' | 'bom' | 'netlist'

export default function App() {
  const t = useT()
  const { locale, setLocale } = useLocaleStore()
  const embedAttachments = useSettingsStore((s) => s.embedAttachments)
  const leftCollapsed = useSettingsStore((s) => s.leftCollapsed)
  const rightCollapsed = useSettingsStore((s) => s.rightCollapsed)
  const [tab, setTab] = useState<BottomTab>('diagram')
  const searchOpen = useUiStore((s) => s.searchOpen)
  const [zoom, setZoom] = useState(1)
  const project = useProjectStore((s) => s.project)
  const name = documentName(useDocumentStore((s) => s.filePath))
  const dirty = useIsDirty()
  const canUndo = useStore(useProjectStore.temporal, (s) => s.pastStates.length > 0)
  const canRedo = useStore(useProjectStore.temporal, (s) => s.futureStates.length > 0)
  const { tool, setTool, wireColor, setWireColor, wireStart, wirePoints, wireOrthogonal, setWireOrthogonal, notice } = useUiStore()
  const exportMenu = useRef<HTMLDetailsElement>(null)
  const fileMenu = useRef<HTMLDetailsElement>(null)
  const [pdf, setPdf] = useState<PdfDialogValue | null>(null)
  /** 용지·방향·포함 항목은 세션 동안 기억한다 */
  const [pdfPrefs, setPdfPrefs] = useState<Pick<PdfDialogValue, 'paper' | 'landscape' | 'include'>>({
    paper: 'A4',
    landscape: true,
    include: { diagram: true, bom: true, netlist: true }
  })
  const openPdf = () => {
    exportMenu.current?.removeAttribute('open')
    const meta = useProjectStore.getState().project.meta
    setPdf({ title: name, author: meta?.author ?? '', notes: meta?.notes ?? '', ...pdfPrefs })
  }
  useCanvasShortcuts({ onPdf: openPdf })

  // 창 제목과 main의 닫기 확인에 변경 여부를 알린다
  useEffect(() => {
    document.title = `${dirty ? '* ' : ''}${name} — Open Perfboard`
    window.api.app.setDirty(dirty)
  }, [dirty, name])

  // main의 대화상자(열기·저장·닫기 확인)도 같은 언어로
  useEffect(() => {
    document.documentElement.lang = locale
    window.api.app.setLocale(locale)
  }, [locale])

  // 닫기 확인에서 "저장"을 고른 경우
  useEffect(
    () =>
      window.api.app.onSaveAndClose(async () => {
        if (await saveDocument()) window.api.app.closeNow()
      }),
    []
  )

  // 앱 버전, 자동 저장 시작, .opb 파일로 실행했으면 그 파일 열기
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    window.api.app.config().then(({ version, autosaveMs }) => {
      if (cancelled) return
      useUiStore.getState().setAppVersion(version)
      stop = startAutosave(autosaveMs)
    })
    window.api.app.takeOpenFile().then((file) => file && openFilePayload(file))
    const off = window.api.app.onOpenFile((file) => void openFilePayload(file))
    return () => {
      cancelled = true
      stop?.()
      off()
    }
  }, [])

  // 최근 파일: 파일 메뉴를 열 때마다 새로 읽는다 (없어진 파일 표시)
  const [recent, setRecent] = useState<Awaited<ReturnType<Window['api']['recent']['list']>>>([])
  const loadRecent = () => window.api.recent.list().then(setRecent, () => setRecent([]))

  const runFile = (fn: () => unknown) => () => {
    fileMenu.current?.removeAttribute('open')
    fn()
  }

  const runExport = (fn: () => Promise<void>) => () => {
    exportMenu.current?.removeAttribute('open')
    fn()
  }

  // BOM·결선표 개수는 포함할 배선도 기준 (030)
  const sheets = useSheets()
  const scope = useWorkspaceStore((s) => s.scope)
  const inScope = scopedSheets(sheets, scope)
  const count = (fn: (p: Project) => number) => inScope.reduce((n, s) => n + fn(s.project), 0)
  const tabs: { id: BottomTab; label: string }[] = [
    { id: 'diagram', label: t('배선도') },
    { id: 'bom', label: `BOM (${count((p) => p.instances.length + (p.bom?.items?.length ?? 0))})` },
    { id: 'netlist', label: t('결선표 ({n})', { n: count((p) => p.wires.length) }) }
  ]

  return (
    <div className={['app', leftCollapsed && 'left-collapsed', rightCollapsed && 'right-collapsed'].filter(Boolean).join(' ')}>
      <header className="toolbar">
        <span className="brand">Open Perfboard</span>
        <span className="doc-name" data-testid="doc-name">
          {name}
          {dirty && <span className="dirty-mark" title={t('저장하지 않은 변경 내용')}> *</span>}
        </span>
        <div className="toolbar-group">
          <button onClick={undo} disabled={!canUndo} title={t('실행 취소 (Ctrl+Z)')} aria-label={t('실행 취소')}>
            ↶
          </button>
          <button onClick={redo} disabled={!canRedo} title={t('다시 실행 (Ctrl+Y)')} aria-label={t('다시 실행')}>
            ↷
          </button>
        </div>
        <div className="toolbar-group" role="group" aria-label={t('모드')}>
          <button
            className={tool === 'select' ? 'toggle active' : 'toggle'}
            aria-pressed={tool === 'select'}
            title={t('선택 모드 (V, Esc): 부품·전선을 고르고 옮기기')}
            onClick={() => setTool('select')}
          >
            {t('↖ 선택')}
          </button>
          <button
            className={tool === 'wire' ? 'toggle active' : 'toggle'}
            aria-pressed={tool === 'wire'}
            title={t('배선 모드 (W): 핀·접속점 클릭으로 잇기, 전선 클릭·끌기로 분기')}
            onClick={() => setTool('wire')}
          >
            {t('✎ 배선')}
          </button>
        </div>
        <div className="toolbar-group">
          <button onClick={tidyWiring} title={t('배선 정리: 부품을 피하고 겹치지 않는 직각 경로로 다시 그리기 (선택한 것만, 없으면 전체)')}>
            {t('⌁ 배선 정리')}
          </button>
          <button
            onClick={() => {
              setTab('diagram')
              requestAnimationFrame(addTextBox)
            }}
            title={t('글 상자 추가 (T): 화면 가운데에 만들고 바로 입력')}
          >
            {t('T 글 상자')}
          </button>
          <button onClick={() => useUiStore.getState().setSearchOpen(true)} title={t('부품·신호 찾기 (Ctrl+F)')} aria-label={t('찾기')}>
            {t('⌕ 찾기')}
          </button>
        </div>
        {/* 새 전선 설정은 배선 모드에서만 */}
        {tool === 'wire' && (
          <>
            <div className="toolbar-group" role="group" aria-label={t('새 전선 모양')}>
              <button
                className={wireOrthogonal ? 'toggle active' : 'toggle'}
                aria-pressed={wireOrthogonal}
                title={t('새 전선 모양 · 직각: 비스듬한 구간을 자동으로 ㄱ/ㄴ자로 꺾음')}
                onClick={() => setWireOrthogonal(true)}
              >
                {t('┐ 직각')}
              </button>
              <button
                className={!wireOrthogonal ? 'toggle active' : 'toggle'}
                aria-pressed={!wireOrthogonal}
                title={t('새 전선 모양 · 직선: 찍은 점을 곧게 이음')}
                onClick={() => setWireOrthogonal(false)}
              >
                {t('╱ 직선')}
              </button>
            </div>
            <div className="toolbar-group" title={t('새 전선 색')}>
              <ColorPicker value={wireColor} onChange={setWireColor} />
            </div>
          </>
        )}
        <div className="spacer" />
        <button
          className="help-btn"
          onClick={() => useUiStore.getState().setHelpOpen(true)}
          title={t('단축키 도움말 (? / F1)')}
          aria-label={t('단축키 도움말')}
        >
          ?
        </button>
        <button onClick={() => saveDocument()} title={t('저장 (Ctrl+S)')}>
          {t('저장')}
        </button>
        <details className="menu" ref={fileMenu} onToggle={(e) => e.currentTarget.open && loadRecent()}>
          <summary>{t('파일 ▾')}</summary>
          <div className="menu-items" role="menu">
            <button role="menuitem" onClick={runFile(newDocument)} title="Ctrl+N">
              {t('새로 만들기')}
            </button>
            <button role="menuitem" onClick={runFile(openDocument)} title="Ctrl+O">
              {t('열기…')}
            </button>
            <button role="menuitem" onClick={runFile(() => saveDocument(true))} title="Ctrl+Shift+S">
              {t('다른 이름으로 저장…')}
            </button>
            <label className="menu-check" title={t('데이터시트·핀아웃 파일을 배선도에 넣어 다른 PC에서도 볼 수 있게 합니다 (파일이 커짐)')}>
              <input
                type="checkbox"
                checked={embedAttachments}
                onChange={(e) => useSettingsStore.getState().setEmbedAttachments(e.target.checked)}
              />
              {t('저장할 때 첨부 파일 포함')}
            </label>
            <div className="menu-section" role="group" aria-label={t('최근 파일')}>
              <span className="menu-heading">{t('최근 파일')}</span>
              {recent.length === 0 && <span className="menu-empty">{t('없음')}</span>}
              {recent.map((r) => (
                <button
                  key={r.path}
                  role="menuitem"
                  className={r.exists ? '' : 'missing'}
                  title={r.exists ? r.path : t('파일을 찾을 수 없습니다: {path}', { path: r.path })}
                  onClick={runFile(() => openRecent(r.path))}
                >
                  {documentName(r.path)}
                  <span className="menu-path">{r.path.replace(/[\\/][^\\/]*$/, '')}</span>
                </button>
              ))}
              {recent.length > 0 && (
                <button role="menuitem" className="menu-minor" onClick={runFile(() => window.api.recent.clear())}>
                  {t('목록 지우기')}
                </button>
              )}
            </div>
          </div>
        </details>
        <details className="menu" ref={exportMenu}>
          <summary>{t('내보내기 ▾')}</summary>
          <div className="menu-items" role="menu">
            <button role="menuitem" onClick={runExport(exportBomXlsx)}>
              {t('BOM (엑셀 xlsx)')}
            </button>
            <button role="menuitem" onClick={runExport(exportBomCsv)}>
              BOM (CSV)
            </button>
            <button role="menuitem" onClick={runExport(exportNetlistCsv)}>
              {t('결선표 (CSV)')}
            </button>
            <button role="menuitem" onClick={runExport(exportPng)}>
              {t('배선도 이미지 (PNG)')}
            </button>
            <button role="menuitem" onClick={openPdf} title="Ctrl+P">
              {t('PDF (배선도·BOM·결선표)…')}
            </button>
          </div>
        </details>
        <div className="toolbar-group" role="group" aria-label="Language / 언어">
          <button className={locale === 'ko' ? 'toggle active' : 'toggle'} aria-pressed={locale === 'ko'} title="한국어" onClick={() => setLocale('ko')}>
            한
          </button>
          <button className={locale === 'en' ? 'toggle active' : 'toggle'} aria-pressed={locale === 'en'} title="English" onClick={() => setLocale('en')}>
            EN
          </button>
        </div>
      </header>

      {/* 양옆 창은 접을 수 있다. 접으면 얇은 띠만 남고 배선도가 그만큼 넓어진다 */}
      {leftCollapsed ? (
        <button className="panel-strip left" aria-label={t('부품함 펼치기')} title={t('부품함 펼치기')} onClick={() => useSettingsStore.getState().setLeftCollapsed(false)}>
          <span aria-hidden>»</span>
          <span className="panel-strip-text">{t('부품함')}</span>
        </button>
      ) : (
        <aside className="panel left">
          <button className="panel-collapse" aria-label={t('부품함 접기')} title={t('부품함 접기')} onClick={() => useSettingsStore.getState().setLeftCollapsed(true)}>
            «
          </button>
          <LibraryPanel />
        </aside>
      )}

      <main className="center">
        {/* 보기 전환: 배선도 / BOM / 결선표 */}
        <nav className="view-switch" aria-label={t('보기')}>
          {tabs.map((b) => (
            <button key={b.id} className={b.id === tab ? 'active' : ''} aria-pressed={b.id === tab} onClick={() => setTab(b.id)}>
              {b.label}
            </button>
          ))}
        </nav>
        <div className="view">
          {/* 캔버스는 탭과 무관하게 유지한다 (화면 위치 유지, 언제든 PNG 내보내기) */}
          <CanvasView onZoomChange={setZoom} />
          {tab !== 'diagram' && (
            <div className="report-overlay">
              {tab === 'bom' ? <BomEditor onExportCsv={exportBomCsv} onExportXlsx={exportBomXlsx} /> : <NetlistView onExport={exportNetlistCsv} />}
            </div>
          )}
          {(notice || (tab === 'diagram' && (wireStart || tool === 'wire'))) && (
            <div className="canvas-status" role="status">
              {notice ??
                (wireStart
                  ? [
                      t('연결할 핀을 클릭하세요 · 빈 곳 클릭 = 꺾기'),
                      ...(wirePoints.length ? [`(${wirePoints.length})`, t('Backspace 되돌리기')] : []),
                      t('Esc 취소')
                    ].join(' · ').replace(' · (', ' (')
                  : t('배선 모드 · 핀 클릭 = 시작 · 전선 클릭/끌기 = 분기 · Esc = 선택 모드'))}
            </div>
          )}
          {tab === 'diagram' && (
            <div className="zoom-float">
              <GridSnapControl />
              <ZoomInput zoom={zoom} />
            </div>
          )}
          {searchOpen && <SearchBox onShowDiagram={() => setTab('diagram')} />}
        </div>
        <SheetTabs />
      </main>

      {rightCollapsed ? (
        <button className="panel-strip right" aria-label={t('선택 항목 펼치기')} title={t('선택 항목 펼치기')} onClick={() => useSettingsStore.getState().setRightCollapsed(false)}>
          <span aria-hidden>«</span>
          <span className="panel-strip-text">{t('선택 항목')}</span>
        </button>
      ) : (
        <aside className="panel right">
          <button className="panel-collapse" aria-label={t('선택 항목 접기')} title={t('선택 항목 접기')} onClick={() => useSettingsStore.getState().setRightCollapsed(true)}>
            »
          </button>
          <PropertiesPanel />
        </aside>
      )}

      <HelpDialog />
      <BusyOverlay />
      <RecoveryDialog />

      {pdf && (
        <PdfDialog
          initial={pdf}
          onCancel={() => setPdf(null)}
          onExport={async (v) => {
            setPdfPrefs({ paper: v.paper, landscape: v.landscape, include: v.include })
            return exportPdf(v)
          }}
        />
      )}
    </div>
  )
}
