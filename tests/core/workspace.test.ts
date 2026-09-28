import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { addBomItem, addInstance, emptyProject, setBomOverride } from '@core/ops'
import { bomTotals } from '@core/bom'
import type { Project, Supply } from '@core/model'
import { parseProject, serializeProject } from '@core/serialize'
import { chooseSupply } from '@core/supply'
import {
  buildScopedBom,
  buildScopedNetlist,
  nextSheetName,
  parseDocumentText,
  parseWorkspaceZip,
  serializeWorkspaceJson,
  serializeWorkspaceZip,
  sheetFileName
} from '@core/workspace'
import { loadSample, makePart } from '../helpers'

const motor = makePart('m', { name: '모터', unitPrice: 1000 })
const sheet = (name: string, n: number): Project => {
  let p = emptyProject(name)
  for (let i = 0; i < n; i++) p = addInstance(p, motor, { id: `${name}-i${i}`, x: i * 300, y: 0 })
  return p
}

describe('.zip 묶음', () => {
  it('저장·열기 왕복: 배선도 순서·이름, 활성, 범위, 부품함·부속 부품', () => {
    const a = loadSample()
    const b = sheet('배선도 2', 2)
    const tube: Supply = { id: 't', kind: 'tube', name: '튜브' }
    const bytes = serializeWorkspaceZip([a, b], { active: 1, scope: [1] }, { library: [motor], supplies: [tube] })
    const names = Object.keys(unzipSync(bytes)).sort()
    expect(names).toEqual(['01-예제_ 제어 보드 + 전원 커넥터.opb', '02-배선도 2.opb', 'library.opblib', 'manifest.json'].sort())
    const r = parseWorkspaceZip(bytes)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.projects).toEqual([a, b])
    expect(r.value.active).toBe(1)
    expect(r.value.scope).toEqual([1])
    expect(r.value.library.map((p) => p.id)).toContain('m')
    expect(r.value.supplies).toEqual([tube])
  })

  it('안의 .opb는 예전 형식 그대로 (하나만 풀어도 열린다)', () => {
    const files = unzipSync(serializeWorkspaceZip([sheet('A', 1), sheet('B', 1)], { active: 0 }))
    const r = parseProject(strFromU8(files['02-B.opb']))
    expect(r.ok && r.value.instances).toHaveLength(1)
  })

  it('파일 이름에 쓸 수 없는 문자는 바꾼다', () => {
    expect(sheetFileName(9, 'a/b:c?')).toBe('10-a_b_c_.opb')
  })

  it('묶음이 아니거나 깨진 배선도는 오류 (어느 파일인지)', () => {
    expect(parseWorkspaceZip(strToU8('not zip')).ok).toBe(false)
    const other = zipSync({ 'readme.txt': strToU8('hi') })
    expect(!parseWorkspaceZip(other).ok && parseWorkspaceZip(other)).toMatchObject({ errors: [expect.stringContaining('manifest.json')] })
    const files = unzipSync(serializeWorkspaceZip([sheet('A', 1), sheet('B', 1)], { active: 5, scope: [0, 9, 0] }))
    const ok = parseWorkspaceZip(zipSync(files))
    expect(ok.ok && [ok.value.active, ok.value.scope]).toEqual([0, [0]]) // 범위 밖 번호는 버린다
    files['02-B.opb'] = strToU8('{"version": 1}')
    const bad = parseWorkspaceZip(zipSync(files))
    expect(!bad.ok && bad.errors[0]).toMatch(/^02-B\.opb: /)
  })
})

describe('문자열 문서 (자동 저장)', () => {
  it('배선도 하나면 .opb 그대로, 여러 개면 묶음 JSON', () => {
    const a = sheet('A', 1)
    expect(serializeWorkspaceJson([a], { active: 0 })).toBe(serializeProject(a))
    const text = serializeWorkspaceJson([a, sheet('B', 2)], { active: 1, scope: [0, 1] })
    const r = parseDocumentText(text)
    expect(r.ok && r.value.projects.map((p) => p.name)).toEqual(['A', 'B'])
    expect(r.ok && [r.value.active, r.value.scope]).toEqual([1, [0, 1]])
    const one = parseDocumentText(serializeProject(loadSample()))
    expect(one.ok && one.value.projects).toHaveLength(1)
    expect(parseDocumentText('{').ok).toBe(false)
  })
})

describe('여러 배선도 BOM·결선표', () => {
  it('같은 부품은 합치고 참조명 앞에 배선도 이름, 직접 추가는 따로', () => {
    let a = sheet('A', 1)
    a = setBomOverride(a, 'm', { supplier: '가게' })
    let b = sheet('B', 2)
    b = addBomItem(b, { id: 'x', name: '타이', quantity: 5 })
    const rows = buildScopedBom([
      { id: 'a', name: 'A', project: a },
      { id: 'b', name: 'B', project: b }
    ])
    expect(rows.map((r) => [r.no, r.name, r.quantity, r.refDes.join(','), r.amount, r.supplier])).toEqual([
      [1, '모터', 3, 'A: U1,B: U1,B: U2', 3000, '가게'],
      [2, '타이', 5, 'B', undefined, undefined]
    ])
    expect(rows[0].sources).toEqual([{ sheetId: 'a', quantity: 1, unitPrice: 1000 }, { sheetId: 'b', quantity: 2, unitPrice: 1000 }])
    // 하나면 이름을 붙이지 않는다
    expect(buildScopedBom([{ id: 'a', name: 'A', project: a }])[0].refDes).toEqual(['U1'])
  })

  it('배선도마다 단가가 다르면 단가는 비우고 금액은 배선도별 합 (단가 미입력으로 세지 않는다)', () => {
    const a = sheet('A', 2)
    const b = setBomOverride(sheet('B', 1), 'm', { unitPrice: 1500 })
    const [r] = buildScopedBom([
      { id: 'a', name: 'A', project: a },
      { id: 'b', name: 'B', project: b }
    ])
    expect([r.unitPrice, r.mixedPrice, r.amount]).toEqual([undefined, true, 3500])
    expect(bomTotals([r])).toMatchObject({ total: 3500, unpriced: 0 })
    const c = setBomOverride(sheet('C', 1), 'm', { unitPrice: null })
    const noPrice = { ...c, parts: { m: { ...c.parts.m, unitPrice: undefined } } }
    const [m] = buildScopedBom([
      { id: 'a', name: 'A', project: a },
      { id: 'c', name: 'C', project: noPrice }
    ])
    expect([m.amount, bomTotals([m]).unpriced]).toEqual([undefined, 1])
  })

  it('부속 부품도 합친다', () => {
    const wire: Supply = { id: 'w', kind: 'wire', name: '전선', unitPrice: 100 }
    const a = chooseSupply(sheet('A', 1), wire, true)
    const b = chooseSupply(sheet('B', 1), wire, true)
    const rows = buildScopedBom([
      { id: 'a', name: 'A', project: a },
      { id: 'b', name: 'B', project: b }
    ]).filter((r) => r.kind === 'supply')
    expect(rows).toHaveLength(1)
    expect(rows[0].sources.map((s) => s.sheetId)).toEqual(['a', 'b'])
  })

  it('결선표: 배선도 순서대로 행마다 이름', () => {
    const rows = buildScopedNetlist([
      { id: 'x', name: 'X', project: loadSample() },
      { id: 'y', name: 'Y', project: loadSample() }
    ])
    expect(rows.map((r) => r.sheetName)).toEqual(['X', 'X', 'Y', 'Y'])
  })

  it('새 배선도 이름', () => {
    expect(nextSheetName(['배선도 1', '배선도 3'], '배선도')).toBe('배선도 2')
    expect(nextSheetName([], 'Diagram')).toBe('Diagram 1')
  })
})
