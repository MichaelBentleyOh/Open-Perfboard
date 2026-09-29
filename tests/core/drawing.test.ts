import { describe, expect, it } from 'vitest'
import type { Drawing, PartDef, Shape } from '../../src/core/model'
import {
  addShape,
  alignShapes,
  duplicateShapes,
  emptyDrawing,
  fitDrawing,
  moveShapes,
  removeShapes,
  reorder,
  resizeDrawing,
  shapeBounds,
  shapesInBox,
  updateShapes
} from '../../src/core/drawing'
import { parsePart, parseProjectFile, parseSupply, serializePart } from '../../src/core/serialize'
import { readLibraryFile, serializeLibrary } from '../../src/core/library'

const rect = (id: string, x: number, y: number, w = 10, h = 10, extra: Partial<Shape> = {}): Shape => ({ id, type: 'rect', x, y, w, h, fill: '#ff0000', ...extra }) as Shape

const withShapes = (...shapes: Shape[]): Drawing => shapes.reduce(addShape, emptyDrawing(100, 80))

describe('그림 도형 (037b)', () => {
  it('상자 계산: 회전하면 차지하는 상자가 커진다, 선은 점들의 상자', () => {
    expect(shapeBounds(rect('a', 10, 20, 30, 40))).toEqual({ x: 10, y: 20, width: 30, height: 40 })
    const r = shapeBounds(rect('a', 0, 0, 10, 10, { rotation: 90 }))
    expect(r.width).toBeCloseTo(10)
    expect(r.x).toBeCloseTo(-10)
    const line: Shape = { id: 'l', type: 'line', x: 5, y: 5, points: [0, 0, 20, -10, 30, 10], stroke: '#000000', strokeWidth: 2 }
    expect(shapeBounds(line)).toEqual({ x: 5, y: -5, width: 30, height: 20 })
  })

  it('옮기기·지우기·여러 개 속성 (입력은 그대로, 잠긴 것은 안 움직임, 종류에 없는 속성은 안 넣음)', () => {
    const d = withShapes(rect('a', 0, 0), rect('b', 5, 5, 10, 10, { locked: true }), { id: 't', type: 'text', x: 0, y: 0, w: 50, text: '가', fontSize: 12, color: '#000000' })
    const moved = moveShapes(d, ['a', 'b'], 3, 4)
    expect(moved.shapes[0]).toMatchObject({ x: 3, y: 4 })
    expect(moved.shapes[1]).toMatchObject({ x: 5, y: 5 })
    expect(d.shapes[0]).toMatchObject({ x: 0, y: 0 })
    const painted = updateShapes(d, ['a', 't'], { fill: '#00ff00', fontSize: 20 })
    expect(painted.shapes[0]).toMatchObject({ fill: '#00ff00' })
    expect(painted.shapes[0]).not.toHaveProperty('fontSize')
    expect(painted.shapes[2]).toMatchObject({ fontSize: 20 })
    expect(painted.shapes[2]).not.toHaveProperty('fill')
    expect(updateShapes(d, ['a'], { fill: undefined }).shapes[0]).not.toHaveProperty('fill')
    expect(removeShapes(d, ['a', 't']).shapes.map((s) => s.id)).toEqual(['b'])
  })

  it('앞뒤 순서: 맨 앞·맨 뒤·한 칸씩 (고른 것끼리 순서 유지)', () => {
    const d = withShapes(rect('a', 0, 0), rect('b', 0, 0), rect('c', 0, 0), rect('d', 0, 0))
    const ids = (x: Drawing) => x.shapes.map((s) => s.id).join('')
    expect(ids(reorder(d, ['a', 'c'], 'front'))).toBe('bdac')
    expect(ids(reorder(d, ['b', 'd'], 'back'))).toBe('bdac')
    expect(ids(reorder(d, ['a'], 'forward'))).toBe('bacd')
    expect(ids(reorder(d, ['d'], 'forward'))).toBe('abcd')
    expect(ids(reorder(d, ['c', 'd'], 'backward'))).toBe('acdb')
  })

  it('정렬: 여럿은 서로, 하나는 그림판에', () => {
    const d = withShapes(rect('a', 0, 0, 10, 10), rect('b', 30, 20, 20, 10))
    const left = alignShapes(d, ['a', 'b'], 'left')
    expect(left.shapes.map((s) => s.x)).toEqual([0, 0])
    const mid = alignShapes(d, ['a', 'b'], 'middle')
    expect(mid.shapes.map((s) => s.y)).toEqual([10, 10])
    const center = alignShapes(d, ['b'], 'centerX')
    expect(center.shapes[1]!.x).toBe(40) // 그림판 100의 가운데
  })

  it('복제: 새 id, 옮긴 자리, 잠금은 풀림 · 끌어 고르기는 상자 안에 다 들어온 것만', () => {
    const d = withShapes(rect('a', 0, 0, 10, 10, { locked: true }), rect('b', 50, 50))
    let n = 0
    const r = duplicateShapes(d, ['a'], () => `n${++n}`)
    expect(r.ids).toEqual(['n1'])
    expect(r.drawing.shapes[2]).toMatchObject({ id: 'n1', x: 10, y: 10 })
    expect(r.drawing.shapes[2]).not.toHaveProperty('locked')
    expect(shapesInBox(r.drawing, { x: 0, y: 0, width: 30, height: 30 })).toEqual(['n1']) // a는 잠김
    expect(shapesInBox(r.drawing, { x: 0, y: 0, width: 55, height: 55 })).toEqual(['n1'])
  })

  it('그림판 크기: 핀은 그림 위 실제 자리 유지, 밖으로 나가면 가장자리 · 내용에 맞추기', () => {
    const d = withShapes(rect('a', 20, 10, 40, 20))
    const pins = [{ id: 'p', x: 0.5, y: 0.5 }, { id: 'q', x: 1, y: 1 }]
    const r = resizeDrawing(d, pins, 200, 40)
    expect(r.drawing).toMatchObject({ width: 200, height: 40 })
    expect(r.pins[0]).toMatchObject({ x: 0.25, y: 1 }) // (50, 40) → 200×40
    expect(r.clamped).toBe(1) // q (100, 80) → y 2 → 1
    const fit = fitDrawing(d, [{ id: 'p', x: 0.4, y: 0.25 }], 5) // 핀 (40, 20)
    expect(fit.drawing).toMatchObject({ width: 50, height: 30 })
    expect(fit.drawing.shapes[0]).toMatchObject({ x: 5, y: 5 })
    expect(fit.pins[0]).toMatchObject({ x: 0.5, y: 0.5 }) // (25, 15) / (50, 30)
  })
})

describe('그림 원본 파일 (037b)', () => {
  const drawing: Drawing = {
    width: 120,
    height: 90,
    background: '#ffffff',
    shapes: [
      rect('r', 1, 2, 30, 20, { radius: 4, stroke: '#000000', strokeWidth: 2, rotation: 15, opacity: 0.5 }),
      { id: 'e', type: 'ellipse', x: 40, y: 10, w: 20, h: 20, fill: '#00ff00' },
      { id: 'l', type: 'line', x: 0, y: 0, points: [0, 0, 10, 10, 20, 0], stroke: '#123456', strokeWidth: 3, arrowEnd: true, dashed: true },
      { id: 't', type: 'text', x: 5, y: 60, w: 100, text: 'VCC\nGND', fontSize: 14, color: '#222222', bold: true, align: 'center' },
      { id: 'i', type: 'image', x: 0, y: 0, w: 120, h: 90, src: 'data:image/png;base64,AA==', locked: true }
    ]
  }
  const part: PartDef = {
    id: 'p1',
    name: '그린 부품',
    image: { data: 'data:image/png;base64,AA==', width: 120, height: 90 },
    drawing,
    connectors: [],
    pins: [{ id: 'a', number: '1', x: 0.5, y: 0.5 }]
  }

  it('부품 파일·.opblib에 도형 원본이 그대로 오간다 (부속 부품도)', () => {
    const r = parsePart(serializePart(part))
    expect(r.ok && r.value.drawing).toEqual(drawing)
    const lib = readLibraryFile(serializeLibrary([part], {}, [{ id: 's', kind: 'housing', name: 'H', drawing }]))
    expect(lib.parts[0]!.drawing).toEqual(drawing)
    expect(lib.supplies![0]!.drawing).toEqual(drawing)
    const s = parseSupply(JSON.stringify({ id: 's', kind: 'tube', name: 'T', drawing }))
    expect(s.ok && s.value.drawing).toEqual(drawing)
  })

  it('잘못된 도형은 이유와 함께 거부한다', () => {
    const bad = (shape: unknown) => parsePart(serializePart({ ...part, drawing: { ...drawing, shapes: [shape as Shape] } }))
    const errs = (r: ReturnType<typeof parsePart>) => (r.ok ? [] : r.errors).join('\n')
    expect(errs(bad({ ...drawing.shapes[0], fill: 'red' }))).toContain('drawing.shapes[0].fill')
    expect(errs(bad({ id: 'x', type: 'star', x: 0, y: 0 }))).toContain('알 수 없는 도형')
    expect(errs(bad({ id: 'x', type: 'line', x: 0, y: 0, points: [1, 2, 3], stroke: '#000000', strokeWidth: 1 }))).toContain('points')
    expect(errs(bad({ id: 'x', type: 'image', x: 0, y: 0, w: 1, h: 1, src: 'file:///etc/passwd' }))).toContain('data URL')
    expect(errs(parsePart(serializePart({ ...part, drawing: { ...drawing, width: 1 } })))).toContain('drawing.width')
    // 원본이 없는 옛 부품은 그대로
    const { drawing: _d, ...old } = part
    expect(parsePart(JSON.stringify(old)).ok).toBe(true)
  })

  it('v7 배선도는 그대로 열리고 v8로 바뀐다', () => {
    const v7 = { version: 7, name: 'x', parts: { p1: { ...part, drawing: undefined } }, instances: [], wires: [] }
    const r = parseProjectFile(JSON.stringify(v7))
    expect(r.ok && r.value.project.version).toBe(8)
    const v9 = parseProjectFile(JSON.stringify({ ...v7, version: 9 }))
    expect(v9.ok).toBe(false)
  })
})
