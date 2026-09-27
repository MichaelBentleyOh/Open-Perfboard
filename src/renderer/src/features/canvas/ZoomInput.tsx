import { CommitInput } from '@/components/CommitInput'
import { clampZoom, parseZoomInput } from '@core/zoom'
import { useUiStore } from '@/stores/uiStore'
import { useT } from '@/i18n'
import { canvasZoom } from './canvasZoom'

/** 우하단 배율. 누르고 숫자 입력(150, 150%) → Enter. Esc = 취소 */
export function ZoomInput({ zoom }: { zoom: number }) {
  const t = useT()
  return (
    <CommitInput
      className="zoom-input"
      data-testid="zoom-input"
      aria-label={t('배율')}
      title={t('배율 입력 · Ctrl+0 = 100% · Ctrl+= / Ctrl+- = 확대/축소 · Home = 전체 보기')}
      value={`${Math.round(zoom * 100)}%`}
      onFocus={(e) => e.currentTarget.select()}
      onCommit={(text) => {
        const scale = parseZoomInput(text)
        const notify = useUiStore.getState().notify
        if (Number.isNaN(scale) || scale <= 0) {
          notify(t('배율은 숫자로 입력하세요 (예: 150)'))
          return false
        }
        if (clampZoom(scale) !== scale) notify(t('배율은 10~800%입니다'))
        canvasZoom()?.setZoom(clampZoom(scale))
      }}
    />
  )
}
