// 전선 색 (026): HEX ↔ RGB ↔ HSV 변환과 키보드로 친 색 읽기. 저장은 늘 소문자 #rrggbb
export interface Rgb {
  r: number
  g: number
  b: number
}

/** 색상(h 0~360) · 채도(s 0~1) · 밝기(v 0~1) */
export interface Hsv {
  h: number
  s: number
  v: number
}

const clampByte = (n: number) => Math.min(255, Math.max(0, Math.round(n)))

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((n) => clampByte(n).toString(16).padStart(2, '0')).join('')}`
}

/** #rgb 또는 #rrggbb. 아니면 undefined */
export function hexToRgb(hex: string): Rgb | undefined {
  let h = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/i.test(h)) return undefined
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * 키보드로 친 색을 읽는다: "#123456", "123456", "#abc", "18, 52, 86", "18 52 86", "rgb(18,52,86)".
 * 0~255를 벗어난 숫자나 모르는 형식은 undefined
 */
export function parseColor(text: string): string | undefined {
  const s = text.trim().toLowerCase()
  const hex = hexToRgb(s)
  if (hex) return rgbToHex(hex)
  const m = /^(?:rgb\s*\()?\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)?$/.exec(s)
  if (!m) return undefined
  const [r, g, b] = m.slice(1).map(Number)
  if ([r, g, b].some((n) => n > 255)) return undefined
  return rgbToHex({ r, g, b })
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s
  const hh = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const [r1, g1, b1] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x]
  const m = v - c
  return { r: clampByte((r1 + m) * 255), g: clampByte((g1 + m) * 255), b: clampByte((b1 + m) * 255) }
}
