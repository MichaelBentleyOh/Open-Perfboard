import { describe, expect, it } from 'vitest'
import type { Project } from '@core/model'
import { parsePart, parseProject, serializePart, serializeProject } from '@core/serialize'
import { loadSample, makePart, readFixture } from '../helpers'

/** 샘플 파일 JSON을 고쳐서 다시 파싱한다 */
function parseModified(edit: (raw: Project) => void) {
  const raw = JSON.parse(readFixture('sample-project.opb')) as Project
  edit(raw)
  return parseProject(JSON.stringify(raw))
}

/** 일부러 잘못된 값을 넣을 때 타입 검사를 피한다 */
const loose = (o: object) => o as Record<string, unknown>

const errorsOf = (r: ReturnType<typeof parseProject>) => (r.ok ? [] : r.errors)

describe('parseProject', () => {
  it('샘플 파일을 읽는다', () => {
    const p = loadSample()
    expect(p.name).toBe('예제: 제어 보드 + 전원 커넥터')
    expect(p.instances).toHaveLength(2)
    expect(p.wires).toHaveLength(2)
  })

  it('저장 → 열기 왕복 후 내용이 같다', () => {
    const p = loadSample()
    const again = parseProject(serializeProject(p))
    expect(again).toEqual({ ok: true, value: p })
  })

  it('모르는 필드는 버린다', () => {
    const r = parseModified((raw) => {
      loose(raw).extra = 1
      loose(raw.instances[0]).hack = 'x'
    })
    expect(r.ok && 'extra' in r.value).toBe(false)
    expect(r.ok && 'hack' in r.value.instances[0]).toBe(false)
  })

  it('JSON이 아니면 거부한다', () => {
    expect(errorsOf(parseProject('{nope'))[0]).toMatch(/JSON 형식이 아닙니다/)
  })

  it('더 새로운 버전 파일은 거부한다', () => {
    expect(errorsOf(parseModified((raw) => (loose(raw).version = 99)))[0]).toMatch(/새로운 버전\(v99\)/)
  })

  it('버전이 없거나 이상하면 거부한다', () => {
    expect(errorsOf(parseModified((raw) => delete loose(raw).version))[0]).toMatch(/^version/)
    expect(errorsOf(parseModified((raw) => (loose(raw).version = 1.5)))[0]).toMatch(/^version/)
  })

  it('존재하지 않는 부품을 쓰는 배치를 거부한다', () => {
    expect(errorsOf(parseModified((raw) => (raw.instances[0].partId = 'ghost')))).toContain(
      "instances[0].partId: 존재하지 않는 부품 'ghost'"
    )
  })

  it('존재하지 않는 핀을 가리키는 전선을 거부한다', () => {
    expect(errorsOf(parseModified((raw) => (loose(raw.wires[0].to).pinId = 'zz')))).toContain(
      'wires[0].to: 존재하지 않는 핀을 가리킵니다'
    )
  })

  it('핀 좌표가 0~1을 벗어나면 거부한다', () => {
    const errors = errorsOf(parseModified((raw) => (raw.parts['part-ctrl'].pins[0].x = 1.5)))
    expect(errors).toContain('parts.part-ctrl.pins[0].x: 범위를 벗어났습니다 (1.5)')
  })

  it('없는 커넥터를 가리키는 핀을 거부한다', () => {
    const errors = errorsOf(parseModified((raw) => (raw.parts['part-ctrl'].pins[0].connectorId = 'c-x')))
    expect(errors).toContain("parts.part-ctrl.pins[0].connectorId: 존재하지 않는 커넥터 'c-x'")
  })

  it('중복 id를 거부한다', () => {
    const errors = errorsOf(parseModified((raw) => (raw.wires[1].id = 'w1')))
    expect(errors).toContain("wires: id 'w1'가 중복됩니다")
  })

  it('필드 타입이 틀리면 경로와 함께 알려 준다', () => {
    const errors = errorsOf(parseModified((raw) => (loose(raw.instances[1]).x = '10')))
    expect(errors).toContain('instances[1].x: 숫자여야 합니다')
  })
})

describe('parsePart', () => {
  it('부품 파일 왕복', () => {
    const part = makePart('x', { refPrefix: 'J', connectors: [{ id: 'c', name: 'J1', type: 'JST-XH 2P' }] })
    expect(parsePart(serializePart(part))).toEqual({ ok: true, value: part })
  })

  it('이미지가 data URL이 아니면 거부한다', () => {
    const part = makePart('x', { image: { data: 'C:/photo.png', width: 1, height: 1 } })
    const r = parsePart(serializePart(part))
    expect(r.ok ? [] : r.errors).toContain('image.data: 이미지 data URL이 아닙니다')
  })
})

describe('구매 링크', () => {
  it('http/https만 허용한다', () => {
    const ok = makePart('x', { purchaseUrl: 'https://www.devicemart.co.kr/goods/view?no=1' })
    expect(parsePart(serializePart(ok))).toEqual({ ok: true, value: ok })
    for (const bad of ['javascript:alert(1)', 'file:///C:/a', 'www.naver.com', ' https://a.com']) {
      const r = parsePart(serializePart(makePart('x', { purchaseUrl: bad })))
      expect(r.ok ? [] : r.errors).toContain('purchaseUrl: http:// 또는 https:// 주소여야 합니다')
    }
  })
})
