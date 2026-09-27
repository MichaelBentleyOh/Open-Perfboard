import { rename, rm, writeFile } from 'node:fs/promises'

/** 임시 파일에 쓴 뒤 rename 한다. 쓰는 도중 꺼져도 원래 파일은 깨지지 않는다 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tmp, data)
    await rename(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}
