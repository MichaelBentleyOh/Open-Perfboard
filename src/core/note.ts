// 캔버스 글 상자(메모, 032). 위치 x·y는 왼쪽 위, 너비는 고정하고 글이 길면 줄을 바꾼다.
import type { Rect } from './geometry'
import type { Note, Project } from './model'

export const NOTE_DEFAULT_WIDTH = 220
export const NOTE_DEFAULT_FONT = 16
export const NOTE_FONT_SIZES = [12, 16, 20, 28] as const
export const NOTE_PADDING = 8
/** 글 상자 기본 색 (연한 노랑 바탕에 어울리는 글자색) */
export const NOTE_DEFAULT_COLOR = '#1f2328'

export const noteFont = (n: Pick<Note, 'fontSize'>) => n.fontSize ?? NOTE_DEFAULT_FONT

/**
 * 글 상자 크기 (대략). 화면은 Konva가 실제로 줄을 바꿔 그리지만, 선택 사각형·전체 보기에는 이 값을 쓴다.
 * 한글 한 글자 ≈ 글자 크기, 영문 ≈ 0.6배로 어림한다
 */
export function noteBounds(n: Note): Rect {
  const font = noteFont(n)
  const inner = Math.max(20, n.width - 2 * NOTE_PADDING)
  let lines = 0
  for (const line of (n.text || ' ').split('\n')) {
    let w = 0
    for (const ch of line) w += ch.charCodeAt(0) > 0x2e80 ? font : font * 0.6
    lines += Math.max(1, Math.ceil(w / inner))
  }
  return { x: n.x, y: n.y, width: n.width, height: lines * font * 1.3 + 2 * NOTE_PADDING }
}

/** 글 상자 목록을 바꾼다. 비면 필드를 지운다 */
function withNotes(project: Project, notes: Note[]): Project {
  const next = { ...project }
  if (notes.length > 0) next.notes = notes
  else delete next.notes
  return next
}

export function addNote(project: Project, note: Note): Project {
  return withNotes(project, [...(project.notes ?? []), note])
}

export type NotePatch = Partial<Pick<Note, 'text' | 'x' | 'y' | 'width' | 'fontSize' | 'color'>>

/** 글·크기·색을 고친다. 기본값과 같은 글자 크기·색은 필드를 지운다. 바뀐 게 없으면 같은 객체 */
export function updateNote(project: Project, id: string, patch: NotePatch): Project {
  let changed = false
  const notes = (project.notes ?? []).map((n) => {
    if (n.id !== id) return n
    const next: Note = { ...n, ...patch }
    if (next.fontSize === undefined || next.fontSize === NOTE_DEFAULT_FONT) delete next.fontSize
    if (!next.color || next.color === NOTE_DEFAULT_COLOR) delete next.color
    if (JSON.stringify(next) === JSON.stringify(n)) return n
    changed = true
    return next
  })
  return changed ? withNotes(project, notes) : project
}

export function moveNotes(project: Project, ids: readonly string[], dx: number, dy: number): Project {
  if (ids.length === 0 || (dx === 0 && dy === 0) || !project.notes) return project
  const set = new Set(ids)
  return withNotes(
    project,
    project.notes.map((n) => (set.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n))
  )
}

export const NOTE_MIN_WIDTH = 40
export const NOTE_MAX_WIDTH = 2000
export const NOTE_MIN_FONT = 8
export const NOTE_MAX_FONT = 120

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 글 상자를 factor배로 (034). 왼쪽 위는 그대로, 너비와 글자 크기를 함께 바꾼다 */
export function resizedNote(n: Note, factor: number): Note {
  const width = Math.round(clamp(n.width * factor, NOTE_MIN_WIDTH, NOTE_MAX_WIDTH))
  const fontSize = Math.round(clamp(noteFont(n) * factor, NOTE_MIN_FONT, NOTE_MAX_FONT))
  const next: Note = { ...n, width, fontSize }
  if (fontSize === NOTE_DEFAULT_FONT) delete next.fontSize
  return next
}

export function resizeNotes(project: Project, ids: readonly string[], factor: number): Project {
  if (ids.length === 0 || factor === 1 || !project.notes) return project
  const set = new Set(ids)
  let changed = false
  const notes = project.notes.map((n) => {
    if (!set.has(n.id)) return n
    const next = resizedNote(n, factor)
    if (next.width === n.width && next.fontSize === n.fontSize) return n
    changed = true
    return next
  })
  return changed ? withNotes(project, notes) : project
}

export function removeNotes(project: Project, ids: readonly string[]): Project {
  if (ids.length === 0 || !project.notes) return project
  const set = new Set(ids)
  return withNotes(
    project,
    project.notes.filter((n) => !set.has(n.id))
  )
}
