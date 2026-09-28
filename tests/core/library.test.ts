import { describe, expect, it } from 'vitest'
import {
  importSummary,
  planImport,
  readLibraryFile,
  resolveImport,
  serializeLibrary
} from '@core/library'
import { serializePart } from '@core/serialize'
import { makePart, readFixture } from '../helpers'

const A = makePart('a', { name: '모터 드라이버' })
const B = makePart('b', { name: '서보' })

describe('readLibraryFile', () => {
  it('라이브러리 묶음 왕복', () => {
    const r = readLibraryFile(serializeLibrary([A, B]), 'my.opblib')
    expect(r).toEqual({ parts: [A, B], problems: [], kind: 'library', attachmentData: {}, supplies: [] })
  })

  it('묶음 안의 잘못된 부품만 건너뛰고 이유를 알린다', () => {
    const raw = JSON.parse(serializeLibrary([A, B]))
    raw.parts[1].pins[0].x = 5
    const r = readLibraryFile(JSON.stringify(raw), 'my.opblib')
    expect(r.parts).toEqual([A])
    expect(r.problems).toEqual(['my.opblib · 서보: pins[0].x: 범위를 벗어났습니다 (5)'])
  })

  it('부품 하나(.json)', () => {
    expect(readLibraryFile(serializePart(A), 'a.json')).toEqual({ parts: [A], problems: [], kind: 'part' })
  })

  it('배선도(.opb)에서 쓰인 부품들을 꺼낸다', () => {
    const r = readLibraryFile(readFixture('sample-project.opb'), 'sample.opb')
    expect(r.kind).toBe('project')
    expect(r.parts.map((p) => p.name)).toEqual(['제어 보드 CB-100', '전원 커넥터 PWR-2P'])
  })

  it('알 수 없는 파일, 더 새로운 버전', () => {
    expect(readLibraryFile('not json', 'x.txt').problems).toEqual(['x.txt: JSON 형식이 아닙니다'])
    expect(readLibraryFile('{"hello":1}', 'x.json').problems[0]).toMatch(/^x\.json: 부품 파일이 아닙니다/)
    const future = JSON.stringify({ format: 'open-perfboard-library', version: 99, parts: [] })
    expect(readLibraryFile(future, 'f.opblib').problems).toEqual(['f.opblib: 더 새로운 버전의 부품함 파일입니다'])
  })
})

describe('planImport / resolveImport', () => {
  const A2 = { ...A, name: '모터 드라이버 v2' } // 같은 id, 다른 내용
  const C = makePart('c', { name: '릴레이' })
  const plan = planImport([A, B], [A2, B, C, C])

  it('새 부품 / 같음 / 내용 다름으로 나누고, 파일 안 중복은 한 번만', () => {
    expect(plan.map((e) => [e.part.id, e.status])).toEqual([
      ['a', 'changed'],
      ['b', 'same'],
      ['c', 'new']
    ])
    expect(importSummary(plan)).toEqual({ new: 1, same: 1, changed: 1 })
    expect(plan[0].existing).toEqual(A)
  })

  it('덮어쓰기 / 사본으로 추가 / 건너뛰기', () => {
    let n = 0
    const id = () => `new${++n}`
    expect(resolveImport(plan, 'overwrite', id).map((p) => [p.id, p.name])).toEqual([
      ['a', '모터 드라이버 v2'],
      ['c', '릴레이']
    ])
    expect(resolveImport(plan, 'copy', id).map((p) => [p.id, p.name])).toEqual([
      ['new1', '모터 드라이버 v2 (가져옴)'],
      ['c', '릴레이']
    ])
    expect(resolveImport(plan, 'skip', id).map((p) => p.id)).toEqual(['c'])
  })

  it('파일 이름으로 쓸 수 없는 id는 새 id로 바꾼다', () => {
    const weird = makePart('../../evil', { name: '이상한 id' })
    const out = resolveImport(planImport([], [weird]), 'skip', () => 'safe1')
    expect(out.map((p) => [p.id, p.name])).toEqual([['safe1', '이상한 id']])
  })
})
