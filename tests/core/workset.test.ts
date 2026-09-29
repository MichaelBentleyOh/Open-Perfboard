import { describe, expect, it } from 'vitest'
import type { PartDef } from '../../src/core/model'
import { copyName, duplicateItem, removeItem, upsertItem, usedAttachmentData, worksetOf } from '../../src/core/workset'

const part = (id: string, name: string, attach?: string): PartDef => ({
  id,
  name,
  image: { data: 'data:image/png;base64,AA==', width: 10, height: 10 },
  connectors: [{ id: 'c1', name: 'J1', type: 'XH 2P' }],
  pins: [{ id: 'p1', number: '1', connectorId: 'c1', x: 0.5, y: 0.5 }],
  ...(attach ? { attachments: [{ id: attach, name: 'ds.pdf', type: 'pdf' as const, size: 3 }] } : {})
})

describe('작업 묶음 (037a)', () => {
  it('upsertItem: 같은 id는 바꾸고 없으면 넣고, 이름순 (입력은 그대로)', () => {
    const list = [part('a', '모터 10'), part('b', '모터 2')]
    const next = upsertItem(list, part('c', '모터 3'))
    expect(next.map((p) => p.name)).toEqual(['모터 2', '모터 3', '모터 10'])
    expect(upsertItem(next, part('a', '가')).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(list).toHaveLength(2)
    expect(removeItem(next, 'b').map((p) => p.id)).toEqual(['c', 'a'])
  })

  it('복제: 새 id, 겹치지 않는 이름, 내용은 깊은 복사', () => {
    const list = [part('a', '센서'), part('b', '센서 사본')]
    const r = duplicateItem(list, 'a', 'n1')!
    expect(r.item.id).toBe('n1')
    expect(r.item.name).toBe('센서 사본 2')
    expect(r.item.pins).toEqual(list[0]!.pins)
    expect(r.item.pins).not.toBe(list[0]!.pins)
    expect(r.list).toHaveLength(3)
    expect(duplicateItem(list, 'none', 'x')).toBeUndefined()
    expect(copyName('X', [])).toBe('X 사본')
  })

  it('쓰지 않는 첨부 본문은 버린다', () => {
    const parts = [part('a', 'A', 'h1')]
    expect(usedAttachmentData(parts, { h1: 'AAA', h2: 'BBB' })).toEqual({ h1: 'AAA' })
    const w = worksetOf([part('b', 'B'), ...parts], [], { h1: 'AAA', h2: 'BBB' })
    expect(w.parts.map((p) => p.name)).toEqual(['A', 'B'])
    expect(w.attachmentData).toEqual({ h1: 'AAA' })
  })
})
