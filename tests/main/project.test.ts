import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_PROJECT_BYTES,
  readProjectFile,
  withExtension,
  writeExportFile,
  writeProjectFile
} from '../../src/main/repositories/project'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'opb-proj-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('withExtension', () => {
  it('확장자가 없거나 다르면 붙이고, 같으면 그대로 둔다 (대소문자 무시)', () => {
    expect(withExtension('C:/a/b', '.opb')).toBe('C:/a/b.opb')
    expect(withExtension('C:/a/b.txt', '.opb')).toBe('C:/a/b.txt.opb')
    expect(withExtension('C:/a/b.OPB', '.opb')).toBe('C:/a/b.OPB')
  })
})

describe('프로젝트 파일', () => {
  it('저장하면 .opb를 붙이고 경로를 돌려준다, 읽으면 같은 내용', async () => {
    const saved = await writeProjectFile(join(dir, '배선도'), '{"a":1}')
    expect(saved).toBe(join(dir, '배선도.opb'))
    expect(await readProjectFile(saved)).toBe('{"a":1}')
  })

  it('너무 큰 파일은 읽지 않는다', async () => {
    const big = join(dir, 'big.opb')
    await writeFile(big, '')
    await truncate(big, MAX_PROJECT_BYTES + 1)
    await expect(readProjectFile(big)).rejects.toThrow('파일이 너무 큽니다')
  })

  it('내보내기: 바이트도 쓸 수 있다', async () => {
    const saved = await writeExportFile(join(dir, 'img'), new Uint8Array([137, 80, 78, 71]), '.png')
    expect(saved).toBe(join(dir, 'img.png'))
    expect([...(await readFile(saved))]).toEqual([137, 80, 78, 71])
  })
})
