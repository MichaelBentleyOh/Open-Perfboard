import { describe, expect, it } from 'vitest'
import { hexToRgb, hsvToRgb, parseColor, rgbToHex, rgbToHsv } from '@core/color'

describe('색 변환', () => {
  it('HEX ↔ RGB, 저장은 소문자 #rrggbb', () => {
    expect(hexToRgb('#123456')).toEqual({ r: 0x12, g: 0x34, b: 0x56 })
    expect(hexToRgb('#AbC')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
    expect(hexToRgb('zzz')).toBeUndefined()
    expect(rgbToHex({ r: 18, g: 52, b: 86 })).toBe('#123456')
    expect(rgbToHex({ r: 300, g: -5, b: 0.4 })).toBe('#ff0000')
  })

  it('키보드로 친 색: HEX, 숫자 셋(쉼표·공백), rgb(...)', () => {
    expect(parseColor('#123456')).toBe('#123456')
    expect(parseColor('ABCDEF')).toBe('#abcdef')
    expect(parseColor('#fff')).toBe('#ffffff')
    expect(parseColor('18, 52, 86')).toBe('#123456')
    expect(parseColor('18 52 86')).toBe('#123456')
    expect(parseColor('rgb(18,52,86)')).toBe('#123456')
    expect(parseColor('256,0,0')).toBeUndefined()
    expect(parseColor('빨강')).toBeUndefined()
  })

  it('RGB ↔ HSV 왕복', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 })
    expect(hsvToRgb({ h: 120, s: 1, v: 1 })).toEqual({ r: 0, g: 255, b: 0 })
    expect(hsvToRgb({ h: 0, s: 0, v: 0.5 })).toEqual({ r: 128, g: 128, b: 128 })
    for (const hex of ['#123456', '#e53935', '#fdd835', '#8e24aa', '#000000', '#ffffff']) {
      expect(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex)!)))).toBe(hex)
    }
  })
})
