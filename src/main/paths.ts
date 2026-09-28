import { join } from 'node:path'
import { app } from 'electron'

/** E2E 테스트가 실제 사용자 데이터를 건드리지 않도록 userData 경로를 바꿀 수 있다 */
export function applyUserDataOverride(): void {
  const override = process.env['OPB_USER_DATA']
  if (override) app.setPath('userData', override)
}

export const libraryDir = (): string => join(app.getPath('userData'), 'library')

/** 부속 부품 (027): 하우징·단자·수축 튜브·전선, <id>.json */
export const suppliesDir = (): string => join(libraryDir(), 'supplies')

/** 창 아이콘 (메인 창, 첨부 보기 창 공통) */
export const appIconPath = (): string => join(app.getAppPath(), 'build/icon.png')

/** 부품 첨부 본문 (<sha256>.<확장자>) */
export const attachmentsDir = (): string => join(libraryDir(), 'attachments')

/** 최근 파일 목록 */
export const recentFile = (): string => join(app.getPath('userData'), 'recent.json')

/** 자동 저장 복구 사본 */
export const recoveryDir = (): string => join(app.getPath('userData'), 'recovery')
