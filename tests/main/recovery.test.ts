import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearRecovery, listRecovery, readRecovery, writeRecovery } from '../../src/main/repositories/recovery'
import { MAX_RECENT, addRecent, clearRecent, isRecent, listRecent, readRecent, removeRecent } from '../../src/main/repositories/recent'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'opb-rec-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('복구 사본', () => {
  const rdir = () => join(dir, 'recovery')

  it('쓰기 → 목록(자기 세션 제외, 최근 것부터) → 읽기 → 지우기', async () => {
    await writeRecovery(rdir(), 'sessionAAA', '{"a":1}', { filePath: 'C:/x/a.opb', name: 'a', savedAt: 100 })
    await writeRecovery(rdir(), 'sessionBBB', '{"b":2}', { filePath: null, name: '새 배선도', savedAt: 200 })
    // 같은 세션은 덮어쓴다
    await writeRecovery(rdir(), 'sessionAAA', '{"a":2}', { filePath: 'C:/x/a.opb', name: 'a', savedAt: 150 })
    const all = await listRecovery(rdir())
    expect(all.map((e) => [e.id, e.savedAt])).toEqual([['sessionBBB', 200], ['sessionAAA', 150]])
    expect((await listRecovery(rdir(), 'sessionBBB')).map((e) => e.id)).toEqual(['sessionAAA'])
    expect(await readRecovery(rdir(), 'sessionAAA')).toEqual({ meta: { filePath: 'C:/x/a.opb', name: 'a', savedAt: 150 }, content: '{"a":2}' })
    await clearRecovery(rdir(), 'sessionAAA')
    expect((await listRecovery(rdir())).map((e) => e.id)).toEqual(['sessionBBB'])
    expect((await readdir(rdir())).sort()).toEqual(['sessionBBB.json', 'sessionBBB.opb'])
  })

  it('폴더가 없으면 빈 목록, 깨진 설명·본문 없는 사본은 건너뛴다, 이상한 id는 거부', async () => {
    expect(await listRecovery(rdir())).toEqual([])
    await writeRecovery(rdir(), 'goodgood', 'x', { filePath: null, name: 'g', savedAt: 1 })
    await writeFile(join(rdir(), 'brokenxx.json'), '{not json')
    await writeFile(join(rdir(), 'brokenxx.opb'), 'x')
    await writeFile(join(rdir(), 'nobodyxx.json'), JSON.stringify({ filePath: null, name: 'n', savedAt: 5 }))
    expect((await listRecovery(rdir())).map((e) => e.id)).toEqual(['goodgood'])
    await expect(writeRecovery(rdir(), '../../evil', 'x', { filePath: null, name: 'e', savedAt: 1 })).rejects.toThrow()
    await expect(readRecovery(rdir(), '..\evil')).rejects.toThrow()
  })
})

describe('최근 파일', () => {
  const file = () => join(dir, 'recent.json')

  it('맨 앞에 넣고, 같은 경로(대소문자 무시)는 앞으로 옮기고, 10개까지', async () => {
    expect(await readRecent(file())).toEqual([])
    for (let i = 0; i < 12; i++) await addRecent(file(), join(dir, `f${i}.opb`))
    await addRecent(file(), join(dir, 'F3.OPB'))
    const list = await readRecent(file())
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]).toBe(join(dir, 'F3.OPB'))
    expect(list.filter((p) => p.toLowerCase().endsWith('f3.opb'))).toHaveLength(1)
    expect(await isRecent(file(), join(dir, 'f11.opb'))).toBe(true)
    expect(await isRecent(file(), join(dir, 'f0.opb'))).toBe(false)
  })

  it('있는지 표시, 빼기, 지우기, 깨진 파일은 빈 목록', async () => {
    const real = join(dir, 'real.opb')
    await writeFile(real, '{}')
    await addRecent(file(), join(dir, 'gone.opb'))
    await addRecent(file(), real)
    expect(await listRecent(file())).toEqual([
      { path: real, exists: true },
      { path: join(dir, 'gone.opb'), exists: false }
    ])
    await removeRecent(file(), join(dir, 'GONE.opb'))
    expect(await readRecent(file())).toEqual([real])
    await clearRecent(file())
    expect(await readRecent(file())).toEqual([])
    await writeFile(file(), '{oops')
    expect(await readRecent(file())).toEqual([])
  })
})
