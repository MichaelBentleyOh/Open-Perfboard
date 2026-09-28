import { buildScopedNetlist, netlistColumns, type ScopedNetlistRow } from '@core/workspace'
import { arrowToDirection, type Arrow } from '@core/netlist'
import { updateWires } from '@core/ops'
import { scopedSheets, useSheets, useWorkspaceStore } from '@/stores/workspaceStore'
import { ScopePicker } from '@/features/sheets/ScopePicker'
import { WIRE_COLORS, useUiStore } from '@/stores/uiStore'
import { ReportTable } from './ReportTable'
import { ConnectionLabelsView } from './ConnectionLabelsView'
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
  // 포함할 배선도 (030). 여럿이면 맨 앞에 배선도 칸
  const sheets = scopedSheets(useSheets(), useWorkspaceStore((s) => s.scope))
  const rows = buildScopedNetlist(sheets)
  const many = sheets.length > 1
  return (
    <ReportTable<ScopedNetlistRow>
      title={t('결선표')}
      tools={<ScopePicker />}
      rows={rows}
      columns={netlistColumns<ScopedNetlistRow>(many)}
      rowKey={(r) => `${r.sheetId}-${r.wireId}`}
      summary={t('전선 {n}개', { n: rows.length })}
      empty={t('연결된 전선이 없습니다. 배선도 탭에서 핀과 핀을 연결하세요.')}
      onExport={onExport}
      render={{
        // 신호 방향은 여기(결선표)에서만 바꾼다. 행의 시작 → 끝 기준. 그 행의 배선도에 (실행 취소 1회)
        방향: (r) => (
          <select
            className="arrow-select"
            aria-label={t('신호 방향 {from} → {to}', { from: r.from.label, to: r.to.label })}
            value={r.arrow}
            onChange={(e) =>
              useWorkspaceStore
                .getState()
                .applyTo([r.sheetId], (p) => updateWires(p, [r.wireId], { direction: arrowToDirection(e.target.value as Arrow, r.reversed) }))
            }
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
