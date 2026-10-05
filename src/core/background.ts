// 사진 배경 지우기 (크로마키): 배경색(키 색)과 비슷한 픽셀을 사진 전체에서 투명하게 한다.
// 부품 안쪽 구멍으로 보이는 배경도 지워진다. 키 색의 기본값 = 가장자리 픽셀 색의 중앙값
import type { Rgb } from './color'

/** RGBA 픽셀 (canvas ImageData와 같은 배치) */
export interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** 허용 범위 (RGB 거리, 0~441). 클수록 키 색에서 먼 색까지 지운다 */
export const BACKGROUND_TOLERANCE_DEFAULT = 40
export const BACKGROUND_TOLERANCE_MAX = 160
/** 허용 범위 바깥으로 이만큼(비율)은 반투명하게 이어 테두리를 부드럽게 한다 */
const SOFTNESS = 0.5

/** 이미 거의 투명한 픽셀은 키 색 계산에서 뺀다 */
const CLEAR_ALPHA = 16

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

/** 가장자리 픽셀(투명한 것 제외) 색의 중앙값. 가장자리가 모두 투명하면 undefined */
export function edgeColor({ data, width, height }: Pixels): Rgb | undefined {
  const r: number[] = []
  const g: number[] = []
  const b: number[] = []
  const take = (x: number, y: number) => {
    const i = (y * width + x) * 4
    if (data[i + 3] < CLEAR_ALPHA) return
    r.push(data[i])
    g.push(data[i + 1])
    b.push(data[i + 2])
  }
  for (let x = 0; x < width; x++) {
    take(x, 0)
    if (height > 1) take(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    take(0, y)
    if (width > 1) take(width - 1, y)
  }
  return r.length ? { r: median(r), g: median(g), b: median(b) } : undefined
}

/**
 * 키 색을 지운 새 픽셀. 키 색과 tolerance 안인 픽셀은 투명하게, 그 바깥 tolerance × SOFTNESS 안은
 * 멀수록 진하게(반투명) 해 테두리를 부드럽게 한다. key가 없으면 가장자리 색. 입력은 바꾸지 않는다.
 * 반환 형은 추론에 맡긴다 (ArrayBuffer 기반 배열이어야 ImageData에 넣을 수 있다)
 */
export function removeBackground(px: Pixels, tolerance = BACKGROUND_TOLERANCE_DEFAULT, key: Rgb | undefined = edgeColor(px)) {
  const { data } = px
  const out = new Uint8ClampedArray(data)
  if (!key) return out
  const soft = Math.max(1, tolerance * SOFTNESS)
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.hypot(data[i] - key.r, data[i + 1] - key.g, data[i + 2] - key.b)
    if (d <= tolerance) out[i + 3] = 0
    else if (d < tolerance + soft) out[i + 3] = Math.round(data[i + 3] * ((d - tolerance) / soft))
  }
  return out
}
