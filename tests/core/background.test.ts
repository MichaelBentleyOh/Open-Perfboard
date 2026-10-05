import { describe, expect, it } from 'vitest'
import { edgeColor, removeBackground, type Pixels } from '@core/background'

/** w×h 그림: 기본은 흰 배경, paint로 칠한다 */
function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number] | undefined): Pixels {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y) ?? [255, 255, 255, 255]
      data.set(c, (y * w + x) * 4)
    }
  }
  return { data, width: w, height: h }
}
const alpha = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4 + 3]

describe('배경 지우기 (크로마키)', () => {
  // 7×7 흰 배경 가운데 3×3 검은 고리, 고리 안 가운데 한 칸은 흰색 (귀걸이 구멍처럼 가장자리와 이어지지 않음)
  const ring = image(7, 7, (x, y) => {
    if (x === 3 && y === 3) return [255, 255, 255, 255]
    if (x >= 2 && x <= 4 && y >= 2 && y <= 4) return [0, 0, 0, 255]
    return undefined
  })

  it('키 색 기본값 = 가장자리 색의 중앙값', () => {
    expect(edgeColor(ring)).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('키 색은 사진 어디에 있든 투명해진다 (고리 안 구멍 포함), 다른 색은 그대로', () => {
    const out = removeBackground(ring)
    expect(alpha(out, 7, 0, 0)).toBe(0)
    expect(alpha(out, 7, 3, 3)).toBe(0)
    expect(alpha(out, 7, 2, 2)).toBe(255)
    // 입력은 그대로
    expect(alpha(ring.data, 7, 0, 0)).toBe(255)
  })

  it('키 색을 직접 고를 수 있다 (초록 배경 위 흰 부품)', () => {
    const green = image(5, 5, (x, y) => (x === 2 && y === 2 ? undefined : [0, 200, 0, 255]))
    const out = removeBackground(green, 40, { r: 0, g: 200, b: 0 })
    expect(alpha(out, 5, 0, 0)).toBe(0)
    expect(alpha(out, 5, 2, 2)).toBe(255)
  })

  it('허용 범위 안의 비슷한 색도 지운다', () => {
    const noisy = image(5, 5, (x, y) => (x === 1 && y === 1 ? [240, 245, 250, 255] : x === 2 && y === 2 ? [10, 10, 10, 255] : undefined))
    expect(alpha(removeBackground(noisy, 40), 5, 1, 1)).toBe(0)
    expect(alpha(removeBackground(noisy, 5), 5, 1, 1)).toBe(255)
    expect(alpha(removeBackground(noisy, 40), 5, 2, 2)).toBe(255)
  })

  it('허용 범위 바로 바깥은 반투명 (테두리를 부드럽게)', () => {
    // 회색(키와 거리 ≈ 55)은 40 ~ 60 사이 → 반투명
    const soft = image(5, 5, (x, y) => (x === 2 && y === 2 ? [223, 223, 223, 255] : undefined))
    const a = alpha(removeBackground(soft, 40), 5, 2, 2)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(255)
  })

  it('가장자리가 모두 투명하고 키 색도 없으면 그대로', () => {
    const clear = image(3, 3, (x, y) => (x === 1 && y === 1 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    expect(edgeColor(clear)).toBeUndefined()
    expect([...removeBackground(clear)]).toEqual([...clear.data])
  })
})
