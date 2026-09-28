import { describe, expect, it } from 'vitest'
import type { Note } from '@core/model'
import { addNote, NOTE_MIN_WIDTH } from '@core/note'
import { resizeItems, SCALE_MAX, SCALE_MIN } from '@core/ops'
import { loadSample } from '../helpers'

const note = (o: Partial<Note> = {}): Note => ({ id: 'n1', x: 100, y: 50, width: 200, text: '메모', ...o })

describe('크기 바꾸기 (034)', () => {
  it('부품: 배율만 바뀌고 중심은 그대로', () => {
    const p = loadSample()
    const u = p.instances[0]
    const r = resizeItems(p, { instances: [u.id] }, 1.5)
    const v = r.instances[0]
    expect(v.scale).toBeCloseTo(u.scale * 1.5)
    expect([v.x, v.y]).toEqual([u.x, u.y])
    expect(r.instances[1]).toBe(p.instances[1])
    expect(p.instances[0].scale).toBe(u.scale) // 입력은 그대로
  })

  it('부품 배율은 범위 안에서 멈춘다', () => {
    const p = loadSample()
    const id = p.instances[0].id
    expect(resizeItems(p, { instances: [id] }, 100).instances[0].scale).toBe(SCALE_MAX)
    expect(resizeItems(p, { instances: [id] }, 0.001).instances[0].scale).toBe(SCALE_MIN)
    const max = resizeItems(p, { instances: [id] }, 100)
    expect(resizeItems(max, { instances: [id] }, 2)).toBe(max)
  })

  it('글 상자: 너비와 글자 크기를 함께, 왼쪽 위는 그대로', () => {
    const p = addNote(loadSample(), note())
    const r = resizeItems(p, { notes: ['n1'] }, 1.5)
    expect(r.notes![0]).toMatchObject({ x: 100, y: 50, width: 300, fontSize: 24 })
    // 기본 글자 크기로 돌아오면 필드를 지운다
    const back = resizeItems(addNote(loadSample(), note({ fontSize: 32 })), { notes: ['n1'] }, 0.5)
    expect(back.notes![0]).not.toHaveProperty('fontSize')
    expect(resizeItems(p, { notes: ['n1'] }, 0.01).notes![0].width).toBe(NOTE_MIN_WIDTH)
  })

  it('부품과 글 상자를 한꺼번에, 1배면 같은 객체', () => {
    const p = addNote(loadSample(), note())
    const r = resizeItems(p, { instances: p.instances.map((i) => i.id), notes: ['n1'] }, 2)
    expect(r.instances.every((i, k) => i.scale === p.instances[k].scale * 2)).toBe(true)
    expect(r.notes![0].width).toBe(400)
    expect(resizeItems(p, { instances: [p.instances[0].id] }, 1)).toBe(p)
  })
})
