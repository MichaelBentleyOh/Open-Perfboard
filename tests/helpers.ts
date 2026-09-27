import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PartDef, Project } from '@core/model'
import { parseProject } from '@core/serialize'

/** tests/fixtures 아래 파일을 문자열로 읽는다 */
export function readFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8')
}

/** 예제 프로젝트: 제어 보드(U1) + 전원 커넥터(CN1), 전선 2개 */
export function loadSample(): Project {
  const r = parseProject(readFixture('sample-project.opb'))
  if (!r.ok) throw new Error(r.errors.join('\n'))
  return r.value
}

/** 테스트용 최소 부품 정의 */
export function makePart(id: string, overrides: Partial<PartDef> = {}): PartDef {
  return {
    id,
    name: id,
    image: { data: 'data:image/png;base64,AA==', width: 10, height: 10 },
    connectors: [],
    pins: [
      { id: 'a', number: '1', x: 0, y: 0 },
      { id: 'b', number: '2', x: 1, y: 1 }
    ],
    ...overrides
  }
}
