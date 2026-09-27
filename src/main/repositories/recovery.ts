// 자동 저장 복구 사본: <dir>/<세션 id>.opb (배선도) + <세션 id>.json (원래 경로·이름·시각).
// 원래 .opb 파일은 건드리지 않는다. 비정상 종료 뒤 다음 실행에서 남은 사본을 보여 준다.
import { rmSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../fsutil'

export interface RecoveryMeta {
  /** 원래 파일 경로 (새 배선도면 null) */
  filePath: string | null
  name: string
  /** 사본을 쓴 시각 (ms) */
  savedAt: number
}

export interface RecoveryEntry extends RecoveryMeta {
  id: string
  /** 사본 크기 (바이트) */
  size: number
}

/** 세션 id 형식만 허용 (경로 조작 방지) */
export const RECOVERY_ID = /^[A-Za-z0-9_-]{8,64}$/

const assertId = (id: string) => {
  if (!RECOVERY_ID.test(id)) throw new Error('recovery id')
}

export async function writeRecovery(dir: string, id: string, content: string, meta: RecoveryMeta): Promise<void> {
  assertId(id)
  await mkdir(dir, { recursive: true })
  // 본문 먼저, 설명은 나중에: 설명 파일이 있으면 본문도 온전하다
  await writeFileAtomic(join(dir, `${id}.opb`), content)
  await writeFileAtomic(join(dir, `${id}.json`), JSON.stringify(meta))
}

export async function clearRecovery(dir: string, id: string): Promise<void> {
  assertId(id)
  await rm(join(dir, `${id}.json`), { force: true })
  await rm(join(dir, `${id}.opb`), { force: true })
}

/** 앱이 끝나는 중에 지울 때: 비동기로 지우면 끝나기 전에 프로세스가 끝날 수 있다 */
export function clearRecoverySync(dir: string, id: string): void {
  assertId(id)
  rmSync(join(dir, `${id}.json`), { force: true })
  rmSync(join(dir, `${id}.opb`), { force: true })
}

function readMeta(text: string): RecoveryMeta | undefined {
  try {
    const v = JSON.parse(text) as Partial<RecoveryMeta>
    if (typeof v.name !== 'string' || typeof v.savedAt !== 'number') return undefined
    if (v.filePath !== null && typeof v.filePath !== 'string') return undefined
    return { filePath: v.filePath, name: v.name, savedAt: v.savedAt }
  } catch {
    return undefined
  }
}

/** 남아 있는 사본 (except 세션 것은 빼고), 최근 것부터. 짝이 안 맞거나 깨진 것은 건너뛴다 */
export async function listRecovery(dir: string, except?: string): Promise<RecoveryEntry[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: RecoveryEntry[] = []
  for (const name of names) {
    const id = name.replace(/\.json$/, '')
    if (!name.endsWith('.json') || !RECOVERY_ID.test(id) || id === except) continue
    try {
      const meta = readMeta(await readFile(join(dir, name), 'utf8'))
      const { size } = await stat(join(dir, `${id}.opb`))
      if (meta) out.push({ ...meta, id, size })
    } catch {
      // 본문이 없으면 건너뛴다
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
}

export async function readRecovery(dir: string, id: string): Promise<{ meta: RecoveryMeta; content: string }> {
  assertId(id)
  const meta = readMeta(await readFile(join(dir, `${id}.json`), 'utf8'))
  if (!meta) throw new Error('recovery meta')
  return { meta, content: await readFile(join(dir, `${id}.opb`), 'utf8') }
}
