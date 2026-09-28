import { useMemo } from 'react'
import { NETLIST_COLUMNS, buildNetlist, type Arrow, type NetlistRow } from '@core/netlist'
import { useProjectStore } from '@/stores/projectStore'
import { WIRE_COLORS, useUiStore } from '@/stores/uiStore'
import { ReportTable } from './ReportTable'
import { ConnectionLabelsView } from './ConnectionLabelsView'
import { setDirection } from './connectionLabels'
import { useT } from '@/i18n'

/** 결선표 탭: [표 | 연결 라벨] 전환 (025) */
export function NetlistView({ onExport }: { onExport: () => void }) {
  const t = useT()
  const mode = useUiStore((s) => s.netlistMode)
  const setMode = useUiStore((s) => s.setNetlistMode)
  return (
    <>
      <div className="netlist-mode" role="group" aria-label={t('결선표 보기')}>
        {(['table', 'labels'] as const).map((m) => (
          <button key={m} className={m === mode ? 'active' : ''} aria-pressed={m === mode} onClick={() => setMode(m)}>
            {m === 'table' ? t('표') : t('연결 라벨')}
          </button>
        ))}
      </div>
      {mode === 'table' ? <NetlistTable onExport={onExport} /> : <ConnectionLabelsView />}
    </>
  )
}

const ARROWS: readonly Arrow[] = ['<->', '->', '<-']

function NetlistTable({ onExport }: { onExport: () => void }) {
  const t = useT()
  const colorName = (hex: string) => {
    const name = WIRE_COLORS.find((c) => c.value === hex)?.name
    return name ? t(name) : hex
  }
  const project = useProjectStore((s) => s.project)
  const rows = useMemo(() => buildNetlist(project), [project])
  return (
    <ReportTable<NetlistRow>
      title={t('결선표')}
      rows={rows}
      columns={NETLIST_COLUMNS}
      rowKey={(r) => r.wireId}
      summary={t('전선 {n}개', { n: rows.length })}
      empty={t('연결된 전선이 없습니다. 배선도 탭에서 핀과 핀을 연결하세요.')}
      onExport={onExport}
      render={{
        // 신호 방향은 여기(결선표)에서만 바꾼다. 행의 시작 → 끝 기준
        방향: (r) => (
          <select
            className="arrow-select"
            aria-label={t('신호 방향 {from} → {to}', { from: r.from.label, to: r.to.label })}
            value={r.arrow}
            onChange={(e) => setDirection(r, e.target.value as Arrow)}
          >
            {ARROWS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        ),
        색상: (r) => (
          <span className="color-cell">
            <span className="swatch" style={{ background: r.color }} />
            {colorName(r.color)}
          </span>
        )
      }}
    />
  )
}
