import { describe, expect, it } from 'vitest'
import { pinWorldPosition, type Point } from '@core/geometry'
import { PROJECT_FILE_VERSION, type PartInstance, type Project } from '@core/model'
import { flipInstances, setMeta } from '@core/ops'
import { parseProject, serializeProject } from '@core/serialize'
import { loadSample, makePart } from '../helpers'

// 200x100 사진 → 표시 240x120. 핀 r: 오른쪽 가운데, tl: 왼쪽 위
const part = makePart('p', {
  image: { data: 'data:image/png;base64,AA==', width: 200, height: 100 },
  pins: [
    { id: 'r', number: '1', x: 1, y: 0.5 },
    { id: 'tl', number: '2', x: 0, y: 0 }
  ]
})
const inst = (o: Partial<PartInstance> = {}): PartInstance => ({
  id: 'i', partId: 'p', refDes: 'U1', x: 0, y: 0, rotation: 0, scale: 1, ...o
})
const project = (i: PartInstance): Project => ({ version: PROJECT_FILE_VERSION, name: 't', parts: { p: part }, instances: [i], wires: [] })
const pinAt = (i: PartInstance, id: string): Point => pinWorldPosition(i, part, part.pins.find((p) => p.id === id)!)
const close = (p: Point, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6)
  expect(p.y).toBeCloseTo(y, 6)
}

describe('반전된 부품의 핀 위치', () => {
  it('좌우 반전: 오른쪽 핀이 왼쪽으로', () => {
    close(pinAt(inst({ flipped: true }), 'r'), -120, 0)
    close(pinAt(inst({ flipped: true }), 'tl'), 120, -60)
  })
})

describe('flipInstances (화면 기준)', () => {
  // 화면 좌우 반전 = x 부호만 바뀌어야 하고, 상하 반전 = y 부호만 바뀌어야 한다 (중심이 원점)
  for (const rotation of [0, 90, 180, 270, 30]) {
    for (const flipped of [false, true]) {
      it(`회전 ${rotation}°, 반전 ${flipped}`, () => {
        const before = inst({ rotation, flipped })
        const h = flipInstances(project(before), ['i'], 'horizontal').instances[0]
        const v = flipInstances(project(before), ['i'], 'vertical').instances[0]
        for (const id of ['r', 'tl']) {
          const p = pinAt(before, id)
          close(pinAt(h, id), -p.x, p.y)
          close(pinAt(v, id), p.x, -p.y)
        }
      })
    }
  }

  it('두 번 반전하면 원래대로 (flipped 필드도 사라짐)', () => {
    const p = loadSample()
    const twice = flipInstances(flipInstances(p, ['i1'], 'vertical'), ['i1'], 'vertical')
    expect(twice.instances[0]).toEqual(p.instances[0])
    expect(twice.instances[0]).not.toHaveProperty('flipped')
  })

  it('지정한 부품만 바꾼다', () => {
    const p = flipInstances(loadSample(), ['i2'], 'horizontal')
    expect(p.instances[0]).toEqual(loadSample().instances[0])
    expect(p.instances[1].flipped).toBe(true)
  })
})

describe('파일 저장/열기', () => {
  it('flipped와 meta가 왕복한다', () => {
    let p = flipInstances(loadSample(), ['i1'], 'horizontal')
    p = setMeta(p, { author: ' 홍길동 ', notes: '전원 먼저 연결\n퓨즈 5A' })
    const again = parseProject(serializeProject(p))
    expect(again.ok && again.value.instances[0].flipped).toBe(true)
    expect(again.ok && again.value.meta).toEqual({ author: '홍길동', notes: '전원 먼저 연결\n퓨즈 5A' })
  })

  it('빈 meta는 저장하지 않는다', () => {
    expect(setMeta(loadSample(), { author: ' ', notes: '' })).not.toHaveProperty('meta')
  })

  it('flipped 타입이 틀리면 거부한다', () => {
    const raw = JSON.parse(serializeProject(loadSample()))
    raw.instances[0].flipped = 'yes'
    const r = parseProject(JSON.stringify(raw))
    expect(r.ok ? [] : r.errors).toContain('instances[0].flipped: true/false여야 합니다')
  })
})
