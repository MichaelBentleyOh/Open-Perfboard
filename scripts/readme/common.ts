// README 스크린샷·동작 GIF가 함께 쓰는 예시 부품과 배선도
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import type { PartDef, PartSymbol, Project, SchPlacement, Supply, SymbolSide, WireDirection } from '../../src/core/model'
import { SYMBOL_TEMPLATES, applyTemplate } from '../../src/core/symbolTemplates'
import { chooseSupply, setWireSupplies } from '../../src/core/supply'
import { addInstance, connectEnds, emptyProject, routeWires, setMeta, updateInstance } from '../../src/core/ops'
import { serializePart, serializeProject, serializeSupply } from '../../src/core/serialize'
import { launchApp, makeTempDir, makeUserDataDir, nextFrame, stubDialogs } from '../../tests/e2e/launch'

export const OUT = join(__dirname, '../../images')
const svg = (name: string) => `data:image/svg+xml;base64,${readFileSync(join(__dirname, 'parts', `${name}.svg`)).toString('base64')}`

type PinSpec = [id: string, number: string, signal: string, x: number, y: number]
function part(o: {
  id: string
  name: string
  partNumber: string
  refPrefix: string
  image: string
  size: [number, number]
  unitPrice: number
  connectors: { id: string; name: string; type: string; pins: PinSpec[] }[]
}): PartDef {
  return {
    id: o.id,
    name: o.name,
    partNumber: o.partNumber,
    manufacturer: 'Demo Parts',
    refPrefix: o.refPrefix,
    unitPrice: o.unitPrice,
    purchaseUrl: `https://example.com/parts/${o.partNumber.toLowerCase()}`,
    image: { data: svg(o.image), width: o.size[0], height: o.size[1] },
    connectors: o.connectors.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    pins: o.connectors.flatMap((c) =>
      c.pins.map(([id, number, signal, x, y]) => ({ id, number, signal, connectorId: c.id, x, y }))
    )
  }
}

// 핀 좌표 = SVG 안의 단자 위치 / 그림 크기
const PARTS: PartDef[] = [
  part({
    id: 'demo-ctrl', name: '제어 보드 CTRL-32', partNumber: 'CTRL-32', refPrefix: 'U', image: 'ctrl-board', size: [400, 260], unitPrice: 18500,
    connectors: [{ id: 'j1', name: 'J1', type: '2.54mm 헤더 8P', pins: [
      ['p1', '1', '5V', 0.15, 0.096], ['p2', '2', 'GND', 0.25, 0.096], ['p3', '3', 'IO4', 0.35, 0.096], ['p4', '4', 'IO5', 0.45, 0.096],
      ['p5', '5', 'IO12', 0.55, 0.096], ['p6', '6', 'IO13', 0.65, 0.096], ['p7', '7', 'IO14', 0.75, 0.096], ['p8', '8', 'IO15', 0.85, 0.096]
    ] }]
  }),
  part({
    id: 'demo-driver', name: '모터 드라이버 MD-2A', partNumber: 'MD-2A', refPrefix: 'U', image: 'motor-driver', size: [300, 240], unitPrice: 7200,
    connectors: [
      { id: 'j1', name: 'J1', type: '나사 단자 2P', pins: [['vm', '1', 'VM', 0.08, 0.35], ['g1', '2', 'GND', 0.08, 0.55]] },
      { id: 'j2', name: 'J2', type: '나사 단자 2P', pins: [['mp', '1', 'M+', 0.92, 0.35], ['mn', '2', 'M-', 0.92, 0.55]] },
      { id: 'j3', name: 'J3', type: '2.54mm 헤더 4P', pins: [
        ['in1', '1', 'IN1', 0.3, 0.879], ['in2', '2', 'IN2', 0.433, 0.879], ['en', '3', 'EN', 0.567, 0.879], ['g2', '4', 'GND', 0.7, 0.879]
      ] }
    ]
  }),
  part({
    id: 'demo-battery', name: '배터리 팩 3S 2200mAh', partNumber: 'BP-3S22', refPrefix: 'BT', image: 'battery', size: [320, 180], unitPrice: 32000,
    connectors: [{ id: 'p1', name: 'P1', type: 'XT60', pins: [['bp', '+', 'VBAT', 0.944, 0.4], ['bn', '-', 'GND', 0.944, 0.6]] }]
  }),
  part({
    id: 'demo-sensor', name: '거리 센서 DS-4', partNumber: 'DS-4', refPrefix: 'U', image: 'distance-sensor', size: [260, 160], unitPrice: 2900,
    connectors: [{ id: 'j1', name: 'J1', type: '2.54mm 헤더 4P', pins: [
      ['vcc', '1', 'VCC', 0.308, 0.856], ['trig', '2', 'TRIG', 0.435, 0.856], ['echo', '3', 'ECHO', 0.565, 0.856], ['gnd', '4', 'GND', 0.692, 0.856]
    ] }]
  }),
  part({
    id: 'demo-motor', name: 'DC 모터 12V', partNumber: 'DCM-12', refPrefix: 'M', image: 'dc-motor', size: [260, 150], unitPrice: 9800,
    connectors: [{ id: 't', name: 'T', type: '탭 단자', pins: [['mp', '+', 'M+', 0.065, 0.347], ['mn', '-', 'M-', 0.065, 0.653]] }]
  })
]

export type Lang = 'ko' | 'en'
/** 영어 스크린샷용 이름 */
const EN: Record<string, string> = {
  '제어 보드 CTRL-32': 'Control board CTRL-32',
  '모터 드라이버 MD-2A': 'Motor driver MD-2A',
  '배터리 팩 3S 2200mAh': 'Battery pack 3S 2200mAh',
  '거리 센서 DS-4': 'Distance sensor DS-4',
  'DC 모터 12V': 'DC motor 12V',
  '2.54mm 헤더 8P': '2.54mm header 8P',
  '2.54mm 헤더 4P': '2.54mm header 4P',
  '나사 단자 2P': 'Screw terminal 2P',
  '탭 단자': 'Tab terminal',
  '로봇 구동부 배선': 'Robot drive wiring',
  '듀폰 하우징 4P': 'Dupont housing 4P',
  '듀폰 하우징 8P': 'Dupont housing 8P',
  '듀폰 암 단자': 'Dupont female terminal',
  'XT60 암 커넥터': 'XT60 female connector',
  '실리콘 전선 18AWG': 'Silicone wire 18AWG',
  '실리콘 전선 20AWG': 'Silicone wire 20AWG',
  'UL1007 전선 26AWG': 'UL1007 wire 26AWG',
  '수축 튜브 Ø2': 'Heat-shrink Ø2',
  '수축 튜브 Ø6': 'Heat-shrink Ø6',
  '10 m 릴': '10 m reel',
  '1 m 롤': '1 m roll',
  '100개입': 'pack of 100',
  '예시 배선도 (README 스크린샷)': 'Example diagram (README screenshots)'
}
export const tr = (s: string, lang: Lang) => (lang === 'en' ? (EN[s] ?? s) : s)
/** 회로도 기호 (038b): 배터리·모터는 기본 회로 기호 모음에서 */
const SYMBOL_OF: Record<string, string> = { 'demo-battery': 'battery', 'demo-motor': 'motor' }
/** 모터 드라이버는 직접 그린 기호: 전원 왼쪽, 모터 오른쪽, 제어 신호 아래 */
function driverSymbol(name: string): PartSymbol {
  const pin = (pinId: string, x: number, y: number, side: SymbolSide) => ({ pinId, x, y, side })
  return {
    drawing: {
      width: 220,
      height: 220,
      shapes: [
        { id: 'body', type: 'rect', x: 40, y: 40, w: 140, h: 140, fill: '#ffffff', stroke: '#000000', strokeWidth: 2 },
        { id: 'name', type: 'text', x: 10, y: 18, w: 200, text: name, fontSize: 12, color: '#000000', bold: true, align: 'center' }
      ]
    },
    pins: [
      pin('vm', 20, 90, 'left'),
      pin('g1', 20, 130, 'left'),
      pin('mp', 200, 90, 'right'),
      pin('mn', 200, 130, 'right'),
      pin('in1', 70, 200, 'bottom'),
      pin('in2', 90, 200, 'bottom'),
      pin('en', 110, 200, 'bottom'),
      pin('g2', 150, 200, 'bottom')
    ]
  }
}
function withSymbol(p: PartDef): PartDef {
  if (p.id === 'demo-driver') return { ...p, symbol: driverSymbol(p.name) }
  const tpl = SYMBOL_TEMPLATES.find((t) => t.id === SYMBOL_OF[p.id])
  if (!tpl) return p
  let k = 0
  return { ...p, symbol: applyTemplate(tpl, p, () => `sym-${p.id}-${++k}`) }
}
const partsIn = (lang: Lang): PartDef[] =>
  PARTS.map((p) => withSymbol({ ...p, name: tr(p.name, lang), connectors: p.connectors.map((c) => ({ ...c, type: tr(c.type, lang) })) }))

/** 예시 부속 부품 (027): 하우징·단자·전선·수축 튜브 */
const SUPPLIES: Supply[] = [
  { id: 'demo-dupont-4', kind: 'housing', name: '듀폰 하우징 4P', connectorType: '2.54mm 헤더 4P', terminalId: 'demo-dupont-f', unitPrice: 50 },
  { id: 'demo-dupont-8', kind: 'housing', name: '듀폰 하우징 8P', connectorType: '2.54mm 헤더 8P', terminalId: 'demo-dupont-f', unitPrice: 90 },
  { id: 'demo-dupont-f', kind: 'terminal', name: '듀폰 암 단자', pack: '100개입', unitPrice: 20 },
  { id: 'demo-xt60', kind: 'housing', name: 'XT60 암 커넥터', connectorType: 'XT60', unitPrice: 1200 },
  { id: 'demo-wire-18', kind: 'wire', name: '실리콘 전선 18AWG', awg: 18, pack: '10 m 릴', unitPrice: 9000 },
  { id: 'demo-wire-20', kind: 'wire', name: '실리콘 전선 20AWG', awg: 20, pack: '10 m 릴', unitPrice: 7000 },
  { id: 'demo-wire-26', kind: 'wire', name: 'UL1007 전선 26AWG', awg: 26, pack: '10 m 릴', unitPrice: 3500 },
  { id: 'demo-tube-2', kind: 'tube', name: '수축 튜브 Ø2', diameter: 2, pack: '1 m 롤', unitPrice: 800 },
  { id: 'demo-tube-6', kind: 'tube', name: '수축 튜브 Ø6', diameter: 6, pack: '1 m 롤', unitPrice: 1500 }
]
const suppliesIn = (lang: Lang): Supply[] =>
  SUPPLIES.map((s) => ({
    ...s,
    name: tr(s.name, lang),
    ...(s.connectorType ? { connectorType: tr(s.connectorType, lang) } : {}),
    ...(s.pack ? { pack: tr(s.pack, lang) } : {})
  }))

/** 작은 로봇 배선도: 배터리 → 모터 드라이버 → 모터, 제어 보드 → 드라이버·센서. omit = 빼 둘 부품 id(이어진 전선도 뺌) */
export function demoProject(lang: Lang, omit: string[] = []): Project {
  const byId = Object.fromEntries(partsIn(lang).map((p) => [p.id, p]))
  let p = emptyProject(tr('로봇 구동부 배선', lang))
  const place: [string, string, number, number, number][] = [
    ['bt', 'demo-battery', -600, -150, 1],
    ['drv', 'demo-driver', -200, -150, 1],
    ['mot', 'demo-motor', 230, -160, 0.9],
    ['mcu', 'demo-ctrl', -160, 340, 1.3],
    ['sen', 'demo-sensor', 330, 110, 1]
  ]
  for (const [id, partId, x, y, scale] of place) {
    if (omit.includes(id)) continue
    p = addInstance(p, byId[partId], { id, x, y })
    if (scale !== 1) p = updateInstance(p, id, { scale })
  }
  let n = 0
  const wire = (a: [string, string], b: [string, string], color: string, extra: { label?: string; awg?: number; direction?: WireDirection } = {}) => {
    if (omit.includes(a[0]) || omit.includes(b[0])) return
    const r = connectEnds(p, { instanceId: a[0], pinId: a[1] }, { instanceId: b[0], pinId: b[1] }, { color, width: extra.awg && extra.awg <= 18 ? 3 : 2, orthogonal: true, ...extra }, () => `w${++n}`)
    if (!r.ok) throw new Error(r.error)
    p = r.project
  }
  // 신호 방향(결선표 연결 라벨의 -> / <-): forward = 앞 핀에서 뒤 핀으로
  wire(['bt', 'bp'], ['drv', 'vm'], '#e53935', { label: 'VBAT', awg: 18, direction: 'forward' })
  wire(['bt', 'bn'], ['drv', 'g1'], '#212121', { awg: 18 })
  wire(['drv', 'mp'], ['mot', 'mp'], '#fb8c00', { awg: 20, direction: 'forward' })
  wire(['drv', 'mn'], ['mot', 'mn'], '#212121', { awg: 20, direction: 'forward' })
  wire(['mcu', 'p3'], ['drv', 'in1'], '#fdd835', { awg: 26, direction: 'forward' })
  wire(['mcu', 'p4'], ['drv', 'in2'], '#43a047', { awg: 26, direction: 'forward' })
  wire(['mcu', 'p5'], ['drv', 'en'], '#1e88e5', { awg: 26, direction: 'forward' })
  wire(['mcu', 'p2'], ['drv', 'g2'], '#212121', { awg: 26 })
  wire(['mcu', 'p1'], ['sen', 'vcc'], '#e53935', { awg: 26, direction: 'forward' })
  wire(['mcu', 'p6'], ['sen', 'trig'], '#8e24aa', { awg: 26, direction: 'forward' })
  wire(['mcu', 'p7'], ['sen', 'echo'], '#f5f5f5', { awg: 26, direction: 'reverse' })
  wire(['sen', 'gnd'], ['mcu', 'p2'], '#212121', { awg: 26 })
  p = routeWires(p, p.wires.map((w) => w.id))
  // 부속 부품: 전선 종류·수축 튜브, BOM에는 하우징·단자·전선을 넣고 수축 튜브는 아직 묻는 중으로 둔다
  const sup = Object.fromEntries(suppliesIn(lang).map((s) => [s.id, s]))
  const ids = new Set(p.wires.map((w) => w.id))
  const pick = (wireIds: string[], patch: Parameters<typeof setWireSupplies>[2]) => {
    const list = wireIds.filter((id) => ids.has(id))
    if (list.length) p = setWireSupplies(p, list, patch)
  }
  pick(['w1', 'w2'], { wire: sup['demo-wire-18'], tubeEnds: sup['demo-tube-6'] })
  pick(['w3', 'w4'], { wire: sup['demo-wire-20'], tubeEnds: sup['demo-tube-6'] })
  pick(['w5', 'w6', 'w7', 'w8', 'w9', 'w10', 'w11', 'w12'], { wire: sup['demo-wire-26'] })
  pick(['w9', 'w10', 'w11', 'w12'], { tubeMiddle: sup['demo-tube-2'] })
  const library = suppliesIn(lang)
  for (const id of ['demo-dupont-4', 'demo-dupont-8', 'demo-dupont-f', 'demo-xt60', 'demo-wire-18', 'demo-wire-20', 'demo-wire-26']) {
    p = chooseSupply(p, sup[id], true, library)
  }
  // 회로도 (039): 기호 자리를 정하고 제어 보드 쪽 신호는 넷 라벨로
  const at: Record<string, SchPlacement> = {
    // 배터리·모터 핀 끝이 드라이버 핀과 같은 높이 → 곧은 선
    bt: { x: 150, y: 180 },
    drv: { x: 450, y: 180 },
    mot: { x: 700, y: 190 },
    mcu: { x: 450, y: 500 },
    sen: { x: 780, y: 500 }
  }
  const labeled = p.wires.filter((w) => [w.from, w.to].some((e) => 'instanceId' in e && e.instanceId === 'mcu')).map((w) => w.id)
  p = { ...p, schematic: { symbols: Object.fromEntries(Object.entries(at).filter(([id]) => !omit.includes(id))), labeled } }
  return setMeta(p, { author: 'Open Perfboard', notes: tr('예시 배선도 (README 스크린샷)', lang) })
}

export async function shot(win: Page, name: string) {
  await nextFrame(win)
  await win.waitForTimeout(300) // 그림 로드·그리기
  await win.screenshot({ path: join(OUT, `${name}.png`) })
}

/** 부품함과 예시 배선도를 준비하고 앱을 띄워 연다 */
export async function openDemo(lang: Lang, o: { omit?: string[] } = {}) {
  const userData = makeUserDataDir()
  mkdirSync(join(userData, 'library'), { recursive: true })
  for (const p of partsIn(lang)) writeFileSync(join(userData, 'library', `${p.id}.json`), serializePart(p))
  mkdirSync(join(userData, 'library', 'supplies'), { recursive: true })
  for (const s of suppliesIn(lang)) writeFileSync(join(userData, 'library', 'supplies', `${s.id}.json`), serializeSupply(s))
  const name = tr('로봇 구동부 배선', lang)
  const file = join(makeTempDir('opb-readme-'), `${name}.opb`)
  writeFileSync(file, serializeProject(demoProject(lang, o.omit)))
  const { app, win } = await launchApp(userData)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 860))
  await expect(win.getByTestId('part-list')).toContainText('CTRL-32')
  if (lang === 'en') await win.getByRole('button', { name: 'EN', exact: true }).click()
  await stubDialogs(app, { open: file })
  await win.keyboard.press('Control+o')
  await expect(win.getByTestId('doc-name')).toHaveText(name)
  await win.keyboard.press('Home')
  await nextFrame(win)
  return { app, win }
}

/** 제어 보드를 골라 오른쪽에 스펙이 보이게 */
export async function selectBoard(win: Page) {
  const mcu = (await win.evaluate(() => window.__opbCanvas!.instanceClientPosition('mcu')))!
  await win.mouse.click(mcu.x - 60, mcu.y + 40) // 칩 왼쪽 빈 기판
  await expect(win.getByTestId('props-instance')).toBeVisible()
}
