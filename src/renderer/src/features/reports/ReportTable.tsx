import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CsvColumn } from '@core/csv'
import { useT } from '@/i18n'

interface Props<T> {
  title: string
  rows: T[]
  columns: readonly CsvColumn<T>[]
  /** 특정 열을 텍스트 대신 다르게 그린다 (예: 색상 견본) */
  render?: Partial<Record<string, (row: T) => ReactNode>>
  rowKey: (row: T) => string
  empty: string
  onExport: () => void
  summary?: string
  /** 제목 옆에 둘 것 (배선도 범위 고르기 등) */
  tools?: ReactNode
}

/** 행이 이보다 많으면 보이는 행만 그린다 (수천 행도 바로 뜨게) */
const VIRTUAL_FROM = 200
/** 보이는 행만 그릴 때의 행 높이(px, CSS .report-table.virtual과 같게)와 위아래로 더 그릴 행 수 */
const ROW_HEIGHT = 32
const OVERSCAN = 20

/**
 * 보이는 행 범위 [first, last). 스크롤은 표를 감싼 가장 가까운 스크롤 영역(.report-overlay)에서 일어난다.
 * 꺼져 있으면 전부.
 */
function useVisibleRows(bodyRef: React.RefObject<HTMLTableSectionElement | null>, count: number, enabled: boolean): [number, number] {
  const [range, setRange] = useState<[number, number]>([0, enabled ? Math.min(count, 60) : count])
  useEffect(() => {
    if (!enabled) {
      setRange([0, count])
      return
    }
    const body = bodyRef.current
    const scroller = body?.closest('.report-overlay')
    if (!body || !scroller) return
    const update = () => {
      // 첫 행의 위치 (스크롤 영역 안쪽 기준)
      const top = body.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      const from = Math.floor((scroller.scrollTop - top) / ROW_HEIGHT) - OVERSCAN
      const to = Math.ceil((scroller.scrollTop + scroller.clientHeight - top) / ROW_HEIGHT) + OVERSCAN
      const first = Math.max(0, Math.min(count, from))
      const last = Math.max(first, Math.min(count, to))
      setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]))
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [bodyRef, count, enabled])
  return range
}

/** CSV 내보내기와 같은 열 정의로 표를 그린다 → 화면과 파일 내용이 항상 같다 */
export function ReportTable<T>({ title, rows, columns, render, rowKey, empty, onExport, summary, tools }: Props<T>) {
  const t = useT()
  const bodyRef = useRef<HTMLTableSectionElement>(null)
  const virtual = rows.length > VIRTUAL_FROM
  const [first, last] = useVisibleRows(bodyRef, rows.length, virtual)
  const spacer = (n: number, key: string) =>
    n > 0 && (
      <tr key={key} className="spacer-row" aria-hidden style={{ height: n * ROW_HEIGHT }}>
        <td colSpan={columns.length + 1} />
      </tr>
    )
  return (
    <section className="report" aria-label={title}>
      <header className="report-header">
        <h2>{title}</h2>
        {tools}
        {summary && <span className="report-summary">{summary}</span>}
        <div className="spacer" />
        <button onClick={onExport} disabled={rows.length === 0}>
          {t('CSV 내보내기')}
        </button>
      </header>
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="report-scroll">
          <table className={`report-table${virtual ? ' virtual' : ''}`}>
            <thead>
              <tr>
                <th>#</th>
                {columns.map((c) => (
                  <th key={c.header}>{t(c.header)}</th>
                ))}
              </tr>
            </thead>
            <tbody ref={bodyRef}>
              {spacer(first, 'before')}
              {rows.slice(first, last).map((row, k) => (
                <tr key={rowKey(row)}>
                  <td className="num">{first + k + 1}</td>
                  {columns.map((c) => (
                    <td key={c.header}>{render?.[c.header]?.(row) ?? c.value(row) ?? ''}</td>
                  ))}
                </tr>
              ))}
              {spacer(rows.length - last, 'after')}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
