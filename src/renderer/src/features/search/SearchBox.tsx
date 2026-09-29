import { useMemo, useState } from 'react'
import { searchSheets, type SearchHit, type SearchKind } from '@core/search'
import { useSheets, useWorkspaceStore } from '@/stores/workspaceStore'
import { useUiStore } from '@/stores/uiStore'
import { canvasZoom } from '@/features/canvas/canvasZoom'
import { msg } from '@core/i18n'
import { useT } from '@/i18n'

const KIND_LABEL: Record<SearchKind, string> = {
  part: msg('부품'),
  pin: msg('핀 신호'),
  wire: msg('전선 라벨'),
  junction: msg('접속점'),
  note: msg('글 상자')
}

/** 결과로 가기: 그 배선도 탭으로, 배선도 보기로, 그 자리로 화면을 옮기고 고른다 */
function goToHit(hit: SearchHit, showDiagram: () => void): void {
  showDiagram()
  useWorkspaceStore.getState().switchTo(hit.sheetId)
  // 탭을 바꾸면 캔버스가 그 배선도의 화면 위치를 먼저 되살린다 → 그 뒤에 옮긴다
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      canvasZoom()?.centerOn(hit.at)
      const kind = hit.kind === 'pin' || hit.kind === 'part' ? 'instance' : hit.kind
      useUiStore.getState().selectOne(kind, hit.id)
    })
  )
}

/**
 * 찾기 (Ctrl+F, 032): 모든 배선도에서 참조명·부품 이름·품번·핀 신호·전선 라벨·접속점·글 상자 글.
 * ↑↓로 고르고 Enter(또는 누르기)로 그 자리로. Esc로 닫기
 */
export function SearchBox({ onShowDiagram }: { onShowDiagram: () => void }) {
  const t = useT()
  const sheets = useSheets()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const hits = useMemo(() => searchSheets(sheets, query, 50), [sheets, query])
  const many = sheets.length > 1
  const close = () => useUiStore.getState().setSearchOpen(false)
  const go = (h: SearchHit) => {
    goToHit(h, onShowDiagram)
    close()
  }

  return (
    <div className="search-box" role="search">
      <input
        aria-label={t('찾기')}
        placeholder={t('부품·참조명·신호·라벨·메모 찾기')}
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setIndex(0)
        }}
        onBlur={(e) => {
          // 결과를 누르는 중이면 닫지 않는다
          if (!e.relatedTarget || !e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) setTimeout(close, 150)
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') close()
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIndex((i) => Math.min(i + 1, hits.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIndex((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && hits[index]) go(hits[index])
        }}
      />
      {query.trim() && (
        <ul className="search-results" role="listbox" aria-label={t('찾은 결과')}>
          {hits.length === 0 && <li className="empty">{t('찾은 것이 없습니다')}</li>}
          {hits.map((h, i) => (
            <li
              key={`${h.sheetId}-${h.kind}-${h.id}-${i}`}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setIndex(i)}
              onClick={() => go(h)}
            >
              <span className="search-kind">{t(KIND_LABEL[h.kind])}</span>
              <span className="search-title">{h.title}</span>
              {many && <span className="search-sheet">{h.sheetName}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
