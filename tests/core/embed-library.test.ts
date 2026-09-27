import { describe, expect, it } from 'vitest'
import { carriedParts, embedLibrary, planImport, readLibraryFile } from '@core/library'
import { PROJECT_FILE_VERSION } from '@core/model'
import { parseProject, parseProjectFile, serializeProject } from '@core/serialize'
import { loadSample, makePart, readFixture } from '../helpers'

const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : r.errors!)

describe('배선도 파일에 부품 라이브러리 포함 (v3)', () => {
  const sample = loadSample()
  const [usedId] = Object.keys(sample.parts)
  const unused = makePart('unused-1', { name: '안 쓴 부품' })

  it('저장 → 열기 왕복: 라이브러리는 파일에만, 편집용 Project에는 없다', () => {
    const text = serializeProject(sample, [unused])
    expect(JSON.parse(text).library).toHaveLength(1)
    const r = parseProjectFile(text)
    expect(r.ok && r.value.library).toEqual([unused])
    expect(r.ok && r.value.project).toEqual(sample)
    expect(r.ok && 'library' in r.value.project).toBe(false)
    // 기존 parseProject는 Project만
    const p = parseProject(text)
    expect(p.ok && p.value).toEqual(sample)
  })

  it('라이브러리가 없으면 필드를 쓰지 않는다, 예전 파일(v1)은 빈 라이브러리로 열린다', () => {
    expect('library' in JSON.parse(serializeProject(sample))).toBe(false)
    const r = parseProjectFile(readFixture('sample-project.opb'))
    expect(r.ok && r.value.library).toEqual([])
    expect(r.ok && r.value.project.version).toBe(PROJECT_FILE_VERSION)
    expect(PROJECT_FILE_VERSION).toBeGreaterThanOrEqual(3)
  })

  it('라이브러리 부품도 검증한다: 잘못된 부품, 중복 id', () => {
    const raw = JSON.parse(serializeProject(sample, [unused]))
    raw.library.push({ id: 'bad', name: 'x' })
    expect(errorsOf(parseProjectFile(JSON.stringify(raw))).some((e) => e.startsWith('library[1].image'))).toBe(true)
    raw.library = [unused, unused]
    expect(errorsOf(parseProjectFile(JSON.stringify(raw)))).toContain("library: id 'unused-1'가 중복됩니다")
  })

  it('embedLibrary: 배선도 사본과 같은 부품은 빼고, 다르거나 안 쓴 부품은 넣는다', () => {
    const same = sample.parts[usedId]
    const changed = { ...same, name: `${same.name} v2` }
    expect(embedLibrary(sample, [same, unused])).toEqual([unused])
    expect(embedLibrary(sample, [changed, unused])).toEqual([changed, unused])
  })

  it('carriedParts: 라이브러리 + 사본, 같은 id면 라이브러리 쪽', () => {
    const changed = { ...sample.parts[usedId], name: '최신' }
    const parts = carriedParts({ project: sample, library: [changed, unused], attachmentData: {} })
    expect(parts.map((p) => p.id).sort()).toEqual([...Object.keys(sample.parts), 'unused-1'].sort())
    expect(parts.find((p) => p.id === usedId)!.name).toBe('최신')
  })

  it('라이브러리 가져오기에서 .opb를 고르면 함께 저장된 라이브러리 부품도 나온다', () => {
    const text = serializeProject(sample, embedLibrary(sample, [sample.parts[usedId], unused]))
    const r = readLibraryFile(text, 'x.opb')
    expect(r.kind).toBe('project')
    expect(r.parts.map((p) => p.id)).toContain('unused-1')
    expect(r.parts).toHaveLength(Object.keys(sample.parts).length + 1)
    // 빈 라이브러리에서 열면 모두 새 부품
    expect(planImport([], r.parts).every((e) => e.status === 'new')).toBe(true)
  })
})
