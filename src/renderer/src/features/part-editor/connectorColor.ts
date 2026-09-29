// 커넥터별 핀 색 (부품 편집기와 배선도가 같이 쓴다).
// 컴포넌트 파일(.tsx)에는 컴포넌트만 내보낸다 — 섞이면 개발 중 화면 고침(Fast Refresh)이 페이지 전체 새로고침이 된다
import type { Connector } from '@core/model'

/** 커넥터 순서대로 돌려 쓰는 색. 커넥터 없음은 회색 */
const CONNECTOR_COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00897b']
const NO_CONNECTOR_COLOR = '#616161'

export function connectorColor(connectors: readonly Connector[], connectorId?: string): string {
  const i = connectors.findIndex((c) => c.id === connectorId)
  return i < 0 ? NO_CONNECTOR_COLOR : CONNECTOR_COLORS[i % CONNECTOR_COLORS.length]!
}
