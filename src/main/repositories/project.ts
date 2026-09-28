// 프로젝트/내보내기 파일 읽기·쓰기. 문자열/바이트만 다루고 내용 검증은 렌더러의 core가 한다.
// 배선도 하나 = .opb (JSON 문자열), 여러 배선도 묶음 = .zip (바이트, 030)
import { stat, readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { writeFileAtomic } from '../fsutil'
import { mt } from '../locale'

export const PROJECT_EXT = '.opb'
export const BUNDLE_EXT = '.zip'
/** 사진이 많아도 이 정도면 충분하다. 잘못 고른 거대한 파일로 메모리를 채우지 않게 한다 */
export const MAX_PROJECT_BYTES = 200 * 1024 * 1024

/** 배선도 파일 내용: .opb는 문자열, .zip은 바이트 */
export type ProjectContent = string | Uint8Array

/** 확장자가 없거나 다르면 붙인다 */
export function withExtension(path: string, ext: string): string {
  return extname(path).toLowerCase() === ext ? path : `${path}${ext}`
}

/** 배선도 경로의 확장자를 내용에 맞춘다 (x.opb에 묶음을 저장하면 x.zip) */
export function projectPath(path: string, content: ProjectContent): string {
  const ext = typeof content === 'string' ? PROJECT_EXT : BUNDLE_EXT
  const cur = extname(path).toLowerCase()
  if (cur === ext) return path
  if (cur === PROJECT_EXT || cur === BUNDLE_EXT) return `${path.slice(0, -cur.length)}${ext}`
  return `${path}${ext}`
}

export const isBundlePath = (path: string) => extname(path).toLowerCase() === BUNDLE_EXT

export async function readProjectFile(path: string): Promise<ProjectContent> {
  const { size } = await stat(path)
  if (size > MAX_PROJECT_BYTES) throw new Error(mt('파일이 너무 큽니다 ({size}MB)', { size: Math.round(size / 1024 / 1024) }))
  if (isBundlePath(path)) return new Uint8Array(await readFile(path))
  return readFile(path, 'utf8')
}

export async function writeProjectFile(path: string, content: ProjectContent): Promise<string> {
  const target = projectPath(path, content)
  await writeFileAtomic(target, content)
  return target
}

export async function writeExportFile(path: string, data: string | Uint8Array, ext: string): Promise<string> {
  const target = withExtension(path, ext)
  await writeFileAtomic(target, data)
  return target
}
