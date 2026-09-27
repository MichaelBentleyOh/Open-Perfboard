// 프로젝트/내보내기 파일 읽기·쓰기. 문자열/바이트만 다루고 내용 검증은 렌더러의 core가 한다.
import { stat, readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { writeFileAtomic } from '../fsutil'
import { mt } from '../locale'

export const PROJECT_EXT = '.opb'
/** 사진이 많아도 이 정도면 충분하다. 잘못 고른 거대한 파일로 메모리를 채우지 않게 한다 */
export const MAX_PROJECT_BYTES = 200 * 1024 * 1024

/** 확장자가 없거나 다르면 붙인다 */
export function withExtension(path: string, ext: string): string {
  return extname(path).toLowerCase() === ext ? path : `${path}${ext}`
}

export async function readProjectFile(path: string): Promise<string> {
  const { size } = await stat(path)
  if (size > MAX_PROJECT_BYTES) throw new Error(mt('파일이 너무 큽니다 ({size}MB)', { size: Math.round(size / 1024 / 1024) }))
  return readFile(path, 'utf8')
}

export async function writeProjectFile(path: string, content: string): Promise<string> {
  const target = withExtension(path, PROJECT_EXT)
  await writeFileAtomic(target, content)
  return target
}

export async function writeExportFile(path: string, data: string | Uint8Array, ext: string): Promise<string> {
  const target = withExtension(path, ext)
  await writeFileAtomic(target, data)
  return target
}
