import { useMemo } from 'react'
import { NETLIST_COLUMNS, buildNetlist, type NetlistRow } from '@core/netlist'
import { useProjectStore } from '@/stores/projectStore'
import { WIRE_COLORS } from '@/stores/uiStore'
import { ReportTable } from './ReportTable'
import { useT } from '@/i18n'

export function NetlistView({ onExport }: { onExport: () => void }) {
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
