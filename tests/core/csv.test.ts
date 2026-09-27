import { describe, expect, it } from 'vitest'
import { toCsv } from '@core/csv'

interface Row {
  name: string
  qty?: number
}

const columns = [
  { header: '이름', value: (r: Row) => r.name },
  { header: '수량', value: (r: Row) => r.qty }
]

describe('toCsv', () => {
  it('UTF-8 BOM과 CRLF로 헤더와 행을 쓴다', () => {
    expect(toCsv([{ name: 'ESP32', qty: 2 }], columns)).toBe('﻿이름,수량\r\nESP32,2\r\n')
  })

  it('쉼표, 따옴표, 줄바꿈이 있는 셀은 따옴표로 감싼다', () => {
    const csv = toCsv([{ name: 'JST "XH", 4P\n2.5mm', qty: 1 }], columns)
    expect(csv).toContain('"JST ""XH"", 4P\n2.5mm",1')
  })

  it('undefined는 빈 셀로 쓴다', () => {
    expect(toCsv([{ name: 'A' }], columns)).toContain('A,\r\n')
  })

  it('행이 없으면 헤더만 쓴다', () => {
    expect(toCsv([], columns)).toBe('﻿이름,수량\r\n')
  })
})
