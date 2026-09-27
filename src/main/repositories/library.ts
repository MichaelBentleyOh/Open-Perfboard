// 부품 라이브러리 저장소: <dir>/<id>.json 한 부품 = 한 파일.
// 문자열만 다룬다. 내용 검증은 렌더러의 core(parsePart)가 한다.
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../fsutil'

/** 파일 이름으로 써도 안전한 id만 허용한다 (경로 조작 방지). core/library.ts의 SAFE_PART_ID와 같은 규칙 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/

function fileOf(dir: string, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error(`잘못된 부품 id: ${id}`)
  return join(dir, `${id}.json`)
}

export async function listParts(dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true })
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()
  return Promise.all(names.map((n) => readFile(join(dir, n), 'utf8')))
}

export async function savePart(dir: string, id: string, content: string): Promise<void> {
  const file = fileOf(dir, id)
  await mkdir(dir, { recursive: true })
  await writeFileAtomic(file, content)
}

export async function removePart(dir: string, id: string): Promise<void> {
  await rm(fileOf(dir, id), { force: true })
}
