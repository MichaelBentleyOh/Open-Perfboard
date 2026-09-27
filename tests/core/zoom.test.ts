import { describe, expect, it } from 'vitest'
import { instanceBounds } from '@core/geometry'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  contentBounds,
  fitView,
  nextZoomStep,
  parseZoomInput,
  zoomAround
} from '@core/zoom'
import { emptyProject } from '@core/ops'
import { loadSample } from '../helpers'

describe('배율 입력', () => {
  it('숫자, %, 공백, 소수를 받는다', () => {
    expect(parseZoomInput('150')).toBe(1.5)
    expect(parseZoomInput('150%')).toBe(1.5)
    expect(parseZoomInput(' 75 % ')).toBe(0.75)
    expect(parseZoomInput('12.5')).toBe(0.125)
    expect(parseZoomInput('1,000')).toBe(10)
  })

  it('숫자가 아니면 NaN', () => {
    for (const t of ['', 'abc', '-50', '50x', '%', '1e2']) expect(parseZoomInput(t)).toBeNaN()
  })

  it('범위는 10~800%', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(20)).toBe(MAX_ZOOM)
    expect(clampZoom(1.3)).toBe(1.3)
  })
})

describe('단계 이동', () => {
  it('정해진 단계를 오간다', () => {
    expect(nextZoomStep(1, 1)).toBe(1.25)
    expect(nextZoomStep(1.25, 1)).toBe(1.5)
    expect(nextZoomStep(1, -1)).toBe(0.9)
  })

  it('단계 사이(휠로 맞춘 배율)에서는 가까운 다음 단계, 끝에서는 끝', () => {
    expect(nextZoomStep(1.1, 1)).toBe(1.25)
    expect(nextZoomStep(1.1, -1)).toBe(1)
    expect(nextZoomStep(8, 1)).toBe(8)
    expect(nextZoomStep(0.1, -1)).toBe(0.1)
  })
})

describe('기준점 확대', () => {
  it('기준점이 가리키는 월드 점은 움직이지 않는다', () => {
    const v = { x: 100, y: 50, scale: 1 }
    const anchor = { x: 400, y: 300 }
    const before = { x: (anchor.x - v.x) / v.scale, y: (anchor.y - v.y) / v.scale }
    const z = zoomAround(v, 2.5, anchor)
    expect(z.scale).toBe(2.5)
    expect((anchor.x - z.x) / z.scale).toBeCloseTo(before.x)
    expect((anchor.y - z.y) / z.scale).toBeCloseTo(before.y)
  })

  it('범위를 넘는 배율은 맞춰진다', () => {
    expect(zoomAround({ x: 0, y: 0, scale: 1 }, 50, { x: 0, y: 0 }).scale).toBe(MAX_ZOOM)
  })
})

describe('전체 보기', () => {
  it('내용이 여백을 두고 화면 가운데에 들어온다', () => {
    const bounds = { x: -100, y: 0, width: 400, height: 200 }
    const view = fitView(bounds, { width: 1000, height: 600 }, 40)
    // 가로가 기준: (1000-80)/400 = 2.3, 세로 (600-80)/200 = 2.6 → 2.3
    expect(view.scale).toBeCloseTo(2.3)
    const toScreen = (x: number, y: number) => ({ x: x * view.scale + view.x, y: y * view.scale + view.y })
    const tl = toScreen(bounds.x, bounds.y)
    const br = toScreen(bounds.x + bounds.width, bounds.y + bounds.height)
    expect(tl.x).toBeCloseTo(40)
    expect(br.x).toBeCloseTo(960)
    expect((tl.y + br.y) / 2).toBeCloseTo(300)
  })

  it('아주 작은 내용도 800%를 넘지 않는다', () => {
    expect(fitView({ x: 0, y: 0, width: 1, height: 1 }, { width: 1000, height: 600 }).scale).toBe(MAX_ZOOM)
  })

  it('contentBounds: 부품(참조명 자리 포함)과 전선을 담고, 비면 undefined', () => {
    expect(contentBounds(emptyProject('x'))).toBeUndefined()
    const p = loadSample()
    const b = contentBounds(p)!
    for (const inst of p.instances) {
      const r = instanceBounds(inst, p.parts[inst.partId])
      expect(b.x).toBeLessThanOrEqual(r.x)
      expect(b.y).toBeLessThan(r.y) // 참조명 자리만큼 위로
      expect(b.x + b.width).toBeGreaterThanOrEqual(r.x + r.width)
      expect(b.y + b.height).toBeGreaterThanOrEqual(r.y + r.height)
    }
  })
})
