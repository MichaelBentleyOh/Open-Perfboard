// 최근에 열거나 저장한 배선도 경로 목록 (최근 것부터). userData/recent.json
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { writeFileAtomic } from '../fsutil'

export const MAX_RECENT = 10

export interface RecentFile {
  path: string
  /** 지금도 그 자리에 있는지 */
  exists: boolean
}

/** Windows 경로는 대소문자를 가리지 않는다 */
const key = (p: string) => resolve(p).toLowerCase()

export async function readRecent(file: string): Promise<string[]> {
  try {
    const v: unknown = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

async function write(file: string, list: string[]): Promise<string[]> {
  await writeFileAtomic(file, JSON.stringify(list))
  return list
}

/** 맨 앞에 넣는다 (이미 있으면 앞으로 옮김) */
export async function addRecent(file: string, path: string): Promise<string[]> {
  const list = (await readRecent(file)).filter((p) => key(p) !== key(path))
  return write(file, [path, ...list].slice(0, MAX_RECENT))
}

export async function removeRecent(file: string, path: string): Promise<string[]> {
  return write(file, (await readRecent(file)).filter((p) => key(p) !== key(path)))
}

export async function clearRecent(file: string): Promise<void> {
  await write(file, [])
}

export async function isRecent(file: string, path: string): Promise<boolean> {
  return (await readRecent(file)).some((p) => key(p) === key(path))
}

export async function listRecent(file: string): Promise<RecentFile[]> {
  return Promise.all(
    (await readRecent(file)).map(async (path) => ({
      path,
      exists: await access(path).then(
        () => true,
        () => false
      )
    }))
  )
}
