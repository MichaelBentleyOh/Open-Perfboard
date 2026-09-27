import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listParts, removePart, savePart } from '../../src/main/repositories/library'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'opb-lib-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('부품 라이브러리 저장소', () => {
  it('저장 → 목록 → 삭제', async () => {
    await savePart(dir, 'a1', '{"id":"a1"}')
    await savePart(dir, 'b2', '{"id":"b2"}')
    expect(await listParts(dir)).toEqual(['{"id":"a1"}', '{"id":"b2"}'])
    await removePart(dir, 'a1')
    expect(await listParts(dir)).toEqual(['{"id":"b2"}'])
  })

  it('같은 id로 저장하면 덮어쓰고 임시 파일을 남기지 않는다', async () => {
    await savePart(dir, 'a1', 'old')
    await savePart(dir, 'a1', 'new')
    expect(await listParts(dir)).toEqual(['new'])
    expect(await readdir(dir)).toEqual(['a1.json'])
  })

  it('폴더가 없으면 만든다', async () => {
    expect(await listParts(join(dir, 'sub', 'library'))).toEqual([])
  })

  it('json이 아닌 파일은 무시한다', async () => {
    await writeFile(join(dir, 'note.txt'), 'x')
    expect(await listParts(dir)).toEqual([])
  })

  it('경로를 벗어나는 id는 거부한다', async () => {
    await expect(savePart(dir, '../evil', 'x')).rejects.toThrow('잘못된 부품 id')
    await expect(removePart(dir, 'a/b')).rejects.toThrow('잘못된 부품 id')
  })
})
