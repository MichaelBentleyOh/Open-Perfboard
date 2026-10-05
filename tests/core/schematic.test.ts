import { describe, expect, it } from 'vitest'
import type { PartDef, Pin, Project } from '../../src/core/model'
import { PROJECT_FILE_VERSION } from '../../src/core/model'
import { addInstance, connectEnds, emptyProject, removeItems } from '../../src/core/ops'
import {
  buildSchematicScene,
  layoutSchematic,
  mirrorSymbols,
  moveSchematicItems,
  netNames,
  placedBox,
  rotateSymbols,
  schematicPins,
  schematicSymbol,
  schematicWirePath,
  setNetLabels,
  symbolFrame,
  pinKey
} from '../../src/core/schematic'
import { SYMBOL_GRID } from '../../src/core/symbol'
import { parseProject, serializeProject } from '../../src/core/serialize'

const pin = (id: string, number: string, signal?: string): Pin => ({ id, number, x: 0.5, y: 0.5, ...(signal ? { signal } : {}) })
const part = (id: string, pins: Pin[]): PartDef => ({ id, name: id.toUpperCase(), image: { data: 'data:image/png;base64,AA==', width: 10, height: 10 }, connectors: [], pins })
const mcu = part('mcu', [pin('v', '1', 'VCC'), pin('g', '2', 'GND'), pin('a', '3', 'SDA'), pin('b', '4', 'SCL')])
const sensor = part('sensor', [pin('v', '1', 'VCC'), pin('g', '2', 'GND'), pin('a', '3', 'SDA')])

let n = 0
const id = () => `id${++n}`

/** MCU(U1) + 센서(U2), SDA끼리·GND끼리 연결 */
function board(): Project {
  let p = emptyProject('b')
  p = addInstance(p, mcu, { id: 'u1', x: 0, y: 0 })
  p = addInstance(p, sensor, { id: 'u2', x: 400, y: 0 })
  for (const [a, b] of [
    ['a', 'a'],
    ['g', 'g']
  ] as const) {
    const r = connectEnds(p, { instanceId: 'u1', pinId: a }, { instanceId: 'u2', pinId: b }, { color: '#000000', width: 2 }, id)
    if (!r.ok) throw new Error('connect')
    p = r.project
  }
  return p
}

const onGrid = (v: number) => Math.abs(v % SYMBOL_GRID) === 0

describe('회로도 (039)', () => {
  it('자동 배치: 참조명 순, 겹치지 않고 핀 끝은 격자 위', () => {
    const p = board()
    const layout = layoutSchematic(p)
    const b1 = placedBox(layout.symbols.get('u1')!, symbolFrame(schematicSymbol(mcu)).extent)
    const b2 = placedBox(layout.symbols.get('u2')!, symbolFrame(schematicSymbol(sensor)).extent)
    expect(b1.x + b1.width).toBeLessThanOrEqual(b2.x)
    for (const sp of schematicPins(p, layout).values()) {
      expect(onGrid(sp.x) && onGrid(sp.y)).toBe(true)
    }
  })

  it('저장된 자리는 그대로, 새 부품은 그 아래 줄에', () => {
    let p = moveSchematicItems(board(), { instances: ['u1'] }, 100, 0)
    const before = p.schematic!.symbols!
    expect(Object.keys(before)).toEqual(['u1', 'u2']) // 처음 옮길 때 모두 저장
    p = addInstance(p, sensor, { id: 'u3', x: 0, y: 400 })
    const layout = layoutSchematic(p)
    expect(layout.symbols.get('u1')).toEqual(before.u1)
    const top = Math.max(...['u1', 'u2'].map((k) => {
      const b = placedBox(layout.symbols.get(k)!, symbolFrame(schematicSymbol(p.parts[p.instances.find((i) => i.id === k)!.partId]!)).extent)
      return b.y + b.height
    }))
    const b3 = placedBox(layout.symbols.get('u3')!, symbolFrame(schematicSymbol(sensor)).extent)
    expect(b3.y).toBeGreaterThan(top)
  })

  it('옮기기는 격자 단위, 회전·반전해도 핀 끝이 격자 위이고 몸통 가운데는 제자리', () => {
    let p = moveSchematicItems(board(), { instances: ['u1'] }, 23, -7)
    const pl = p.schematic!.symbols!.u1!
    expect(onGrid(pl.x) && onGrid(pl.y)).toBe(true)
    p = rotateSymbols(p, ['u1'], 90)
    expect(p.schematic!.symbols!.u1).toMatchObject({ x: pl.x, y: pl.y, rotation: 90 })
    p = mirrorSymbols(p, ['u1'], 'horizontal')
    expect(p.schematic!.symbols!.u1).toMatchObject({ rotation: 270, mirror: true })
    const layout = layoutSchematic(p)
    const pins = schematicPins(p, layout)
    for (const sp of pins.values()) expect(onGrid(sp.x) && onGrid(sp.y)).toBe(true)
    // 오른쪽으로 90° 돌리면 위(VCC) 핀이 오른쪽을 향한다 (그다음 좌우 반전 → 왼쪽)
    expect(pins.get(pinKey('u1', 'v'))!.side).toBe('left')
    // 네 번 돌리면 처음과 같다
    let q = board()
    const start = schematicPins(q, layoutSchematic(q)).get(pinKey('u1', 'a'))
    for (let i = 0; i < 4; i++) q = rotateSymbols(q, ['u1'], -90)
    expect(q.schematic!.symbols!.u1!.rotation).toBeUndefined()
    expect(schematicPins(q, layoutSchematic(q)).get(pinKey('u1', 'a'))).toEqual(start)
  })

  it('선 경로: 곧으면 한 줄, 아니면 핀 방향으로 먼저 나가는 ㄱ자', () => {
    expect(schematicWirePath({ x: 0, y: 0, side: 'right' }, { x: 100, y: 0, side: 'left' })).toEqual([0, 0, 100, 0])
    expect(schematicWirePath({ x: 0, y: 0, side: 'right' }, { x: 100, y: 50 })).toEqual([0, 0, 100, 0, 100, 50])
    expect(schematicWirePath({ x: 0, y: 0, side: 'bottom' }, { x: 100, y: 50 })).toEqual([0, 0, 0, 50, 100, 50])
  })

  it('선 경로: 양 끝 기호 몸통을 가로지르지 않게 돌아간다 (아래 핀 → 오른쪽 기호의 위 핀)', () => {
    // 왼쪽 몸통 (0..40, -60..0) 아래 핀 끝 (20, 20), 오른쪽 몸통 (200..240, -140..-60) 위 핀 끝 (220, -160)
    const left = { x: 0, y: -60, width: 40, height: 60 }
    const right = { x: 200, y: -140, width: 40, height: 80 }
    const path = schematicWirePath({ x: 20, y: 20, side: 'bottom' }, { x: 220, y: -160, side: 'top' }, [left, right])
    const inside = (b: typeof left, x: number, y: number) => x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height
    for (let i = 0; i + 3 < path.length; i += 2) {
      // 선분 가운데·끝이 몸통 안에 없다 (가로·세로 선분)
      const mxp = (path[i]! + path[i + 2]!) / 2
      const myp = (path[i + 1]! + path[i + 3]!) / 2
      expect(inside(left, mxp, myp) || inside(right, mxp, myp)).toBe(false)
    }
    expect(path.slice(0, 2)).toEqual([20, 20])
    expect(path.slice(-2)).toEqual([220, -160])
    expect(path.length).toBeGreaterThan(6)
  })

  it('장면: 기호 2개, 선 2개 / 넷 라벨로 바꾸면 선 대신 양 끝에 이름표', () => {
    let p = board()
    let scene = buildSchematicScene(p)
    expect(scene.symbols).toHaveLength(2)
    expect(scene.wires).toHaveLength(2)
    expect(scene.labels).toHaveLength(0)
    const gndWire = p.wires[1]!.id
    p = setNetLabels(p, [gndWire], true)
    scene = buildSchematicScene(p)
    expect(scene.wires).toHaveLength(1)
    expect(scene.labels.map((l) => l.text)).toEqual(['GND', 'GND'])
    p = setNetLabels(p, [gndWire], false)
    expect(p.schematic?.labeled).toBeUndefined()
  })

  it('넷 이름: 전선 라벨 → 전원·GND → 신호 이름 → N1', () => {
    let p = board()
    const [sda, gnd] = p.wires.map((w) => w.id)
    let names = netNames(p)
    expect([names.get(sda!), names.get(gnd!)]).toEqual(['SDA', 'GND'])
    p = { ...p, wires: p.wires.map((w) => (w.id === sda ? { ...w, label: 'I2C_SDA' } : w)) }
    expect(netNames(p).get(sda!)).toBe('I2C_SDA')
    const bare = part('bare', [pin('x', '1'), pin('y', '2')])
    let q = addInstance(addInstance(emptyProject('q'), bare, { id: 'r1', x: 0, y: 0 }), bare, { id: 'r2', x: 100, y: 0 })
    const r = connectEnds(q, { instanceId: 'r1', pinId: 'x' }, { instanceId: 'r2', pinId: 'y' }, { color: '#000000', width: 2 }, id)
    q = r.ok ? r.project : q
    names = netNames(q)
    expect(names.get(q.wires[0]!.id)).toBe('N1')
  })

  it('부품·전선을 지우면 회로도 항목도 빠진다, 파일로 저장했다 읽어도 그대로', () => {
    let p = setNetLabels(rotateSymbols(board(), ['u2'], 90), [board().wires[0]!.id], true)
    const back = parseProject(serializeProject(p))
    expect(back.ok && back.value.schematic).toEqual(p.schematic)
    expect(back.ok && back.value.version).toBe(PROJECT_FILE_VERSION)
    p = removeItems(p, { instances: ['u2'], wires: [] })
    expect(Object.keys(p.schematic!.symbols!)).toEqual(['u1'])
    expect(p.schematic!.labeled).toBeUndefined()
  })

  it('파서: 없는 부품·전선을 가리키는 항목은 조용히 빼고, 잘못된 회전은 오류', () => {
    const p = board()
    const raw = JSON.parse(serializeProject(p))
    raw.schematic = { symbols: { u1: { x: 10, y: 20 }, gone: { x: 0, y: 0 } }, labeled: ['nope', p.wires[0]!.id] }
    const r = parseProject(JSON.stringify(raw))
    expect(r.ok && r.value.schematic).toEqual({ symbols: { u1: { x: 10, y: 20 } }, labeled: [p.wires[0]!.id] })
    raw.schematic = { symbols: { u1: { x: 10, y: 20, rotation: 45 } } }
    expect(parseProject(JSON.stringify(raw)).ok).toBe(false)
  })

  it('저장된 기호에 놓지 않은 핀이 있으면 회로도에서는 빈 자리에 채워 쓴다', () => {
    const base = schematicSymbol(sensor)
    const partial = { ...sensor, symbol: { ...base, pins: base.pins.filter((p) => p.pinId !== 'a') } }
    const s = schematicSymbol(partial)
    expect(s.pins.map((p) => p.pinId).sort()).toEqual(['a', 'g', 'v'])
    expect(new Set(s.pins.map((p) => `${p.x},${p.y}`)).size).toBe(3)
    expect(schematicSymbol(partial)).toBe(s) // 부품마다 한 번만
  })

  it('v9 파일은 그대로 열린다', () => {
    const raw = JSON.parse(serializeProject(board()))
    raw.version = 9
    const r = parseProject(JSON.stringify(raw))
    expect(r.ok && r.value.version).toBe(PROJECT_FILE_VERSION)
    expect(r.ok && r.value.schematic).toBeUndefined()
  })
})
