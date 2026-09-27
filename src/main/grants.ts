// 렌더러가 저장할 수 있는 배선도 경로. 사용자가 대화상자에서 고르거나(열기·저장), 최근 파일·복구·파일 연결로
// 사용자가 직접 연 경로만 기억한다. 렌더러가 임의 경로로 "저장"을 요청해도 여기 없는 경로에는 쓰지 않는다.
import { resolve } from 'node:path'

const grantedPaths = new Set<string>()

export const grant = (path: string): string => {
  grantedPaths.add(resolve(path).toLowerCase())
  return path
}

export const isGranted = (path: string): boolean => grantedPaths.has(resolve(path).toLowerCase())
