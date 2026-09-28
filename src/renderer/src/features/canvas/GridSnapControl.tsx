import { GRID_SIZES, type GridSize } from '@core/geometry'
import { useSettingsStore } from '@/stores/settingsStore'
import { useT } from '@/i18n'

/** 배율 칸 옆: 격자 맞춤 켜고 끄기 + 간격 (033). 끄는 중 Alt = 잠시 반대로 */
export function GridSnapControl() {
  const t = useT()
  const on = useSettingsStore((s) => s.gridSnap)
  const size = useSettingsStore((s) => s.gridSize)
  const settings = useSettingsStore.getState
  return (
    <div className="grid-snap" role="group" aria-label={t('격자 맞춤')}>
      <button
        className={on ? 'toggle active' : 'toggle'}
        aria-pressed={on}
        title={t('격자 맞춤: 부품·글 상자를 끌거나 놓을 때 격자점에 맞춤 (끄는 중 Alt = 잠시 반대로)')}
        onClick={() => settings().setGridSnap(!on)}
      >
        {t('# 격자')}
      </button>
      {on && (
        <select aria-label={t('격자 간격')} value={size} onChange={(e) => settings().setGridSize(Number(e.target.value) as GridSize)}>
          {GRID_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
