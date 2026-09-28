import { describe, expect, it } from 'vitest'
import { copySelection, pasteClipboard } from '@core/clipboard'
import { snapTo } from '@core/geometry'
import type { Note, Project } from '@core/model'
import { addNote, noteBounds, updateNote } from '@core/note'
import { moveInstances, removeItems } from '@core/ops'
import { searchSheets } from '@core/search'
import { selectInRect } from '@core/selection'
import { parseProject, serializeProject } from '@core/serialize'
import { contentBounds } from '@core/zoom'
import { loadSample } from '../helpers'

const note = (o: Partial<Note> = {}): Note => ({ id: 'n1', x: 1000, y: 1000, width: 200, text: '전원 먼저 연결', ...o })
const withNote = (p: Project = loadSample()) => addNote(p, note())

describe('글 상자', () => {
  it('파일 왕복, 잘못된 값은 오류', () => {
    const p = updateNote(withNote(), 'n1', { fontSize: 20, color: '#e53935' })
    const r = parseProject(serializeProject(p))
    expect(r.ok && r.value.notes).toEqual([{ ...note(), fontSize: 20, color: '#e53935' }])
    const raw = JSON.parse(serializeProject(p))
    raw.notes[0].width = 0
    expect(parseProject(JSON.stringify(raw)).ok).toBe(false)
  })

  it('기본값과 같은 글자 크기·색은 지우고, 바뀐 게 없으면 같은 객체', () => {
    const p = withNote()
    expect(updateNote(p, 'n1', { text: note().text })).toBe(p)
    const big = updateNote(p, 'n1', { fontSize: 28 })
    expect(updateNote(big, 'n1', { fontSize: 16 }).notes![0]).not.toHaveProperty('fontSize')
  })

  it('선택 사각형·함께 옮기기·지우기·전체 보기에 들어간다', () => {
    const p = withNote()
    expect(selectInRect(p, { x: 990, y: 990, width: 30, height: 30 }).notes).toEqual(['n1'])
    const moved = moveInstances(p, [], 10, -5, [], ['n1'])
    expect(moved.notes![0]).toMatchObject({ x: 1010, y: 995 })
    expect(removeItems(p, { instances: [], wires: [], notes: ['n1'] })).not.toHaveProperty('notes')
    const b = contentBounds(p)!
    expect(b.x + b.width).toBeGreaterThanOrEqual(1200)
  })

  it('크기 어림: 긴 글은 여러 줄, 줄바꿈도 센다', () => {
    const one = noteBounds(note({ text: '짧음' })).height
    expect(noteBounds(note({ text: '가'.repeat(40) })).height).toBeGreaterThan(one * 2)
    expect(noteBounds(note({ text: 'a\nb\nc' })).height).toBeGreaterThan(one * 2)
  })

  it('글 상자만 복사해 붙여넣을 수 있다', () => {
    const p = withNote()
    const clip = copySelection(p, { instances: [], wires: [], notes: ['n1'] })!
    const r = pasteClipboard(p, clip, { x: 50, y: 50 }, () => 'n2')
    expect(r.notes).toEqual(['n2'])
    expect(r.project.notes!.map((n) => [n.id, n.x])).toEqual([
      ['n1', 1000],
      ['n2', 1050]
    ])
  })
})

describe('찾기', () => {
  const sheets = () => [
    { id: 'a', name: 'A', project: withNote() },
    { id: 'b', name: 'B', project: loadSample() }
  ]

  it('참조명·부품 이름·핀 신호·전선 라벨·글 상자를 모든 배선도에서', () => {
    const kinds = (q: string) => searchSheets(sheets(), q).map((h) => [h.sheetName, h.kind, h.title])
    expect(kinds('cb-100')).toEqual([
      ['A', 'part', 'U1 · 제어 보드 CB-100 · CB-100'],
      ['B', 'part', 'U1 · 제어 보드 CB-100 · CB-100']
    ])
    expect(kinds('전원 먼저')).toEqual([['A', 'note', '전원 먼저 연결']])
    expect(searchSheets(sheets(), 'VIN').some((h) => h.kind === 'pin' && h.title === 'U1.J1.1 VIN')).toBe(true)
    expect(searchSheets(sheets(), '+12v').some((h) => h.kind === 'wire')).toBe(true)
    expect(searchSheets(sheets(), '  ')).toEqual([])
  })

  it('결과 수 제한', () => {
    expect(searchSheets(sheets(), 'u', 2)).toHaveLength(2)
  })
})

describe('격자 맞춤', () => {
  it('가장 가까운 격자점', () => {
    expect(snapTo({ x: 29, y: -31 }, 20)).toEqual({ x: 20, y: -40 })
    expect(snapTo({ x: 24, y: 26 }, 50)).toEqual({ x: 0, y: 50 })
  })
})
