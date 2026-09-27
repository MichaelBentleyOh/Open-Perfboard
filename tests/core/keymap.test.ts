import { describe, expect, it } from 'vitest'
import { SHORTCUTS, formatCombo, matchCombo, type Combo } from '@core/keymap'

const key = (k: string, o: { ctrl?: boolean; shift?: boolean; alt?: boolean; code?: string } = {}) => ({
  key: k,
  code: o.code ?? '',
  ctrlKey: !!o.ctrl,
  metaKey: false,
  shiftKey: !!o.shift,
  altKey: !!o.alt
})

/** 조합 → 그 조합을 쓰는 항목 id들 */
function byCombo(): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const s of SHORTCUTS) for (const c of s.combos) m.set(formatCombo(c), [...(m.get(formatCombo(c)) ?? []), s.id])
  return m
}

const find = (e: ReturnType<typeof key>) => SHORTCUTS.filter((s) => s.combos.some((c) => matchCombo(e, c))).map((s) => s.id)

describe('단축키 목록', () => {
  it('id가 겹치지 않고, 모두 분류·설명·조합이 있다', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length)
    for (const s of SHORTCUTS) {
      expect(s.group && s.description && s.combos.length).toBeTruthy()
      expect(s.combos.some((c) => !c.alias)).toBe(true) // 도움말에 보일 키가 하나는 있다
    }
  })

  it('같은 조합은 한 곳에서만 (Backspace: 그리는 중 꺾임점 취소 → 아니면 삭제, 의도된 순서)', () => {
    const dup = [...byCombo()].filter(([, ids]) => ids.length > 1)
    expect(dup).toEqual([['Backspace', ['wireBack', 'delete']]])
  })

  it('새 키: V 선택, W 배선, F / Shift+F 반전, Home 전체 보기, ? / F1 도움말', () => {
    expect(find(key('v'))).toEqual(['selectMode'])
    expect(find(key('w'))).toEqual(['wireMode'])
    expect(find(key('f'))).toEqual(['flipH'])
    expect(find(key('F', { shift: true }))).toEqual(['flipV'])
    expect(find(key('Home'))).toEqual(['fit'])
    expect(find(key('?', { shift: true }))).toEqual(['help'])
    expect(find(key('F1'))).toEqual(['help'])
  })

  it('옛 키·겹치던 키는 없다: S, H, Ctrl+9, Ctrl+L, Ctrl+D(복제 = 복사+붙여넣기), Ctrl+Shift+Z(= Ctrl+Y)', () => {
    expect(find(key('d', { ctrl: true }))).toEqual([])
    expect(find(key('z', { ctrl: true, shift: true }))).toEqual([])
    expect(find(key('s'))).toEqual([])
    expect(find(key('h'))).toEqual([])
    expect(find(key('9', { ctrl: true }))).toEqual([])
    expect(find(key('l', { ctrl: true }))).toEqual([])
  })

  it('Ctrl·Shift·Alt를 정확히 구분한다', () => {
    expect(find(key('v', { ctrl: true }))).toEqual(['paste'])
    expect(find(key('s', { ctrl: true }))).toEqual(['save'])
    expect(find(key('S', { ctrl: true, shift: true }))).toEqual(['saveAs'])
    expect(find(key('y', { ctrl: true }))).toEqual(['redo'])
    expect(find(key('r', { shift: true }))).toEqual(['rotateBack'])
    expect(find(key('v', { alt: true }))).toEqual([])
    expect(find(key('+', { code: 'NumpadAdd' }))).toEqual(['zoomIn'])
  })

  it('표시용 이름', () => {
    const c = (x: Combo) => formatCombo(x)
    expect(c({ key: 's', ctrl: true, shift: true })).toBe('Ctrl+Shift+S')
    expect(c({ key: 'escape' })).toBe('Esc')
    expect(c({ code: 'NumpadAdd' })).toBe('Num +')
    expect(c({ key: '=', ctrl: true })).toBe('Ctrl+=')
  })
})
