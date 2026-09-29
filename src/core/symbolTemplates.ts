// 기본 회로 기호 모음 (038b): 저항·축전기·코일·다이오드·트랜지스터·연산증폭기·논리 게이트·전원 …
// 좌표는 기호 단위(1 = 5 mil), 핀 끝점은 SYMBOL_GRID 배수. 곡선(코일·게이트)은 꺾은선 점으로 근사한다
import type { PartSymbol, Pin, Shape, SymbolPin, SymbolSide, TextShape } from './model'
import { shapeBounds, unionBox } from './drawing'
import { POWER_BOTTOM, POWER_TOP, SYMBOL_GRID, SYMBOL_PIN_LENGTH, fitSymbol, symbolPinOrder, textWidth, type HasPins } from './symbol'
import { msg } from './i18n'

/** 기호 핀 자리. match가 있으면 신호 이름이 맞는 부품 핀을 먼저 이 자리에 놓는다 */
export interface TemplateSlot {
  x: number
  y: number
  side: SymbolSide
  length: number
  match?: RegExp
}

type ShapeDraft = Shape extends infer S ? (S extends Shape ? Omit<S, 'id'> : never) : never

export interface TemplateBody {
  slots: TemplateSlot[]
  shapes: ShapeDraft[]
  /** 부품 이름 글상자 자리 (none = 넣지 않음) */
  nameAt: 'right' | 'top' | 'bottom' | 'none'
  showNumbers?: false
  showNames?: false
}

export type TemplateGroup = 'passive' | 'semi' | 'logic' | 'power'
export const TEMPLATE_GROUPS: readonly { id: TemplateGroup; name: string }[] = [
  { id: 'passive', name: msg('수동 소자') },
  { id: 'semi', name: msg('반도체') },
  { id: 'logic', name: msg('증폭기·논리') },
  { id: 'power', name: msg('전원·스위치·기타') }
]

export interface SymbolTemplate {
  id: string
  group: TemplateGroup
  name: string
  /** 부품 핀 수 → 모양 (커넥터만 핀 수에 따라 달라진다) */
  build: (pinCount: number) => TemplateBody
}

const INK = '#000000'
const r2 = (v: number) => Math.round(v * 100) / 100

// ---- 도형 도우미 (절대 좌표로 쓰고, 선은 첫 점을 x, y로)
function line(pts: number[], o: { width?: number; arrow?: boolean; closed?: boolean; fill?: string } = {}): ShapeDraft {
  const x = pts[0]!
  const y = pts[1]!
  return {
    type: 'line',
    x,
    y,
    points: pts.map((v, i) => r2(v - (i % 2 ? y : x))),
    stroke: INK,
    strokeWidth: o.width ?? 2,
    ...(o.arrow ? { arrowEnd: true } : {}),
    ...(o.closed ? { closed: true } : {}),
    ...(o.fill ? { fill: o.fill } : {})
  }
}
const rect = (x: number, y: number, w: number, h: number, fill?: string): ShapeDraft => ({ type: 'rect', x, y, w, h, stroke: INK, strokeWidth: 2, ...(fill ? { fill } : {}) })
const circle = (cx: number, cy: number, r: number, fill?: string): ShapeDraft => ({
  type: 'ellipse',
  x: cx - r,
  y: cy - r,
  w: r * 2,
  h: r * 2,
  stroke: INK,
  strokeWidth: 2,
  ...(fill ? { fill } : {})
})
const label = (x: number, y: number, w: number, text: string, size = 10): ShapeDraft => ({ type: 'text', x, y, w, text, fontSize: size, color: INK, align: 'center' })

/** 2차 베지어 곡선 점 (시작점 빼고) */
function quad(p0: [number, number], c: [number, number], p2: [number, number], n = 8): number[] {
  const out: number[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const a = (1 - t) * (1 - t)
    const b = 2 * (1 - t) * t
    const d = t * t
    out.push(a * p0[0] + b * c[0] + d * p2[0], a * p0[1] + b * c[1] + d * p2[1])
  }
  return out
}
/** 원호 점: 중심 (cx, cy), 반지름 r, 각도 a0 → a1 (도, 시작점 포함) */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 10): number[] {
  const out: number[] = []
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a))
  }
  return out
}

// ---- 핀 이름 규칙
const re = (s: string) => new RegExp(`^(${s})$`, 'i')
const M = {
  plus: re('\\+|POS|PLUS|\\+V|V\\+'),
  minus: re('-|−|NEG|MINUS|V-|V−'),
  anode: re('A|AN|ANODE|\\+'),
  cathode: re('K|CATHODE|KATHODE|-|−'),
  base: re('B|BASE'),
  collector: re('C|COL|COLLECTOR'),
  emitter: re('E|EMITTER'),
  gate: re('G|GATE'),
  drain: re('D|DRAIN'),
  source: re('S|SOURCE'),
  inP: re('\\+|IN\\+|\\+IN|INP|IN_P|NONINV|NON_INV|V_?IN\\+'),
  inN: re('-|−|IN-|-IN|INN|IN_N|INV|V_?IN-'),
  out: re('OUT|OUTPUT|VOUT|O|Y|Q'),
  inA: re('A|IN|IN1|I|D|INA'),
  inB: re('B|IN2|INB'),
  wiper: re('W|WIPER|WIP|2'),
  vneg: re('V-|V−|VEE|VSS|GND|V_?NEG')
}

const slot = (x: number, y: number, side: SymbolSide, length: number, match?: RegExp): TemplateSlot => ({ x, y, side, length, ...(match ? { match } : {}) })

// 2핀 세로 (위 1번, 아래 2번): 끝점 ±e, 몸통 끝 ±b
const vertical2 = (e: number, b: number, top?: RegExp, bottom?: RegExp) => [slot(0, -e, 'top', e - b, top), slot(0, e, 'bottom', e - b, bottom)]
const horizontal2 = (e: number, b: number) => [slot(-e, 0, 'left', e - b), slot(e, 0, 'right', e - b)]
const small = { showNumbers: false, showNames: false } as const

// ---- 모양
const diodeBody = (): ShapeDraft[] => [line([-8, -8, -8, 8, 8, 0], { closed: true }), line([8, -8, 8, 8])]
const diodeSlots = () => [slot(20, 0, 'right', 12, M.cathode), slot(-20, 0, 'left', 12, M.anode)]

/** 바이폴라 트랜지스터: 베이스 왼쪽, 위·아래 오른쪽. npn = 이미터 아래·화살표 밖으로, pnp = 이미터 위·화살표 안으로 */
function bjt(npn: boolean): TemplateBody {
  const up = (y: number) => (npn ? y : -y)
  return {
    shapes: [
      circle(4, 0, 17),
      line([-4, -10, -4, 10], { width: 3 }),
      // 컬렉터
      line([-4, up(-5), 10, up(-12)]),
      // 이미터 (화살표)
      npn ? line([-4, 5, 10, 12], { arrow: true }) : line([10, -12, -3, -5.5], { arrow: true })
    ],
    slots: [slot(-20, 0, 'left', 16, M.base), slot(10, up(-30), npn ? 'top' : 'bottom', 18, M.collector), slot(10, up(30), npn ? 'bottom' : 'top', 18, M.emitter)],
    nameAt: 'right',
    showNames: false
  }
}

/** MOSFET: 게이트 왼쪽. n = 드레인 위·화살표 안으로, p = 소스 위·화살표 밖으로 */
function mosfet(n: boolean): TemplateBody {
  const up = (y: number) => (n ? y : -y)
  return {
    shapes: [
      circle(4, 0, 17),
      line([-8, -10, -8, 10]),
      line([-4, -12, -4, -6], { width: 3 }),
      line([-4, -3, -4, 3], { width: 3 }),
      line([-4, 6, -4, 12], { width: 3 }),
      line([-4, up(-9), 10, up(-9)]),
      line([-4, up(9), 10, up(9)]),
      n ? line([10, 9, 10, 0, -3, 0], { arrow: true }) : line([-4, 0, 7, 0], { arrow: true }),
      ...(n ? [] : [line([7, 0, 10, 0, 10, up(9)])])
    ],
    slots: [slot(-20, 0, 'left', 12, M.gate), slot(10, up(-30), n ? 'top' : 'bottom', 21, M.drain), slot(10, up(30), n ? 'bottom' : 'top', 21, M.source)],
    nameAt: 'right',
    showNames: false
  }
}

/** 게이트 몸통 뒤 곡선 (OR 계열): x = -15 기준, 가운데 (-5, 0)으로 휜다 */
const orBack = (dx = 0) => [-15 + dx, 15, ...quad([-15 + dx, 15], [-5 + dx, 0], [-15 + dx, -15])]
function orBody(): ShapeDraft {
  const pts = [-15, -15, ...quad([-15, -15], [5, -15], [15, 0]), ...quad([15, 0], [5, 15], [-15, 15]), ...orBack().slice(2, -2)]
  return line(pts, { closed: true, fill: '#ffffff' })
}
const andBody = (): ShapeDraft => line([-15, -15, 0, -15, ...arc(0, 0, 15, -90, 90), -15, 15], { closed: true, fill: '#ffffff' })
const bubble = (x: number) => circle(x + 3, 0, 3, '#ffffff')

/** 2입력 게이트: 입력 A·B 왼쪽, 출력 오른쪽. inset = 입력 핀이 몸통 뒤 곡선까지 들어가는 길이 */
function gate(body: ShapeDraft[], outFrom: number, inset: number): TemplateBody {
  return {
    shapes: body,
    slots: [slot(-30, -10, 'left', inset, M.inA), slot(-30, 10, 'left', inset, M.inB), slot(30, 0, 'right', 30 - outFrom, M.out)],
    nameAt: 'top',
    showNames: false
  }
}

/** 한 줄 커넥터: 핀 수만큼 왼쪽에 */
function connector(n: number): TemplateBody {
  const count = Math.max(1, n)
  return {
    shapes: [rect(0, -10, 20, count * 20, '#ffffff'), ...Array.from({ length: count }, (_, i) => rect(0, i * 20 - 1, 6, 2, INK))],
    slots: Array.from({ length: count }, (_, i) => slot(-20, i * 20, 'left', 20)),
    nameAt: 'top',
    showNames: false
  }
}

const fixed = (b: TemplateBody) => () => b

export const SYMBOL_TEMPLATES: readonly SymbolTemplate[] = [
  // 수동 소자 (세로, KiCad처럼 1번 위)
  { id: 'resistor', group: 'passive', name: msg('저항'), build: fixed({ shapes: [rect(-8, -20, 16, 40)], slots: vertical2(30, 20), nameAt: 'right', ...small }) },
  {
    id: 'resistor-us',
    group: 'passive',
    name: msg('저항 (지그재그)'),
    build: fixed({
      shapes: [line([0, -20, ...Array.from({ length: 6 }, (_, k) => [k % 2 ? -8 : 8, -20 + ((2 * k + 1) * 40) / 12]).flat(), 0, 20])],
      slots: vertical2(30, 20),
      nameAt: 'right',
      ...small
    })
  },
  {
    id: 'potentiometer',
    group: 'passive',
    name: msg('가변 저항'),
    build: fixed({
      shapes: [rect(-8, -20, 16, 40), line([20, 0, 10, 0], { arrow: true })],
      slots: [slot(0, -30, 'top', 10), slot(30, 0, 'right', 10, M.wiper), slot(0, 30, 'bottom', 10)],
      nameAt: 'top',
      ...small
    })
  },
  {
    id: 'capacitor',
    group: 'passive',
    name: msg('축전기'),
    build: fixed({ shapes: [line([-12, -4, 12, -4], { width: 3 }), line([-12, 4, 12, 4], { width: 3 })], slots: vertical2(20, 4), nameAt: 'right', ...small })
  },
  {
    id: 'capacitor-polarized',
    group: 'passive',
    name: msg('극성 축전기'),
    build: fixed({
      shapes: [line([-12, -4, 12, -4], { width: 3 }), rect(-12, 4, 24, 3, INK), label(-20, -16, 8, '+')],
      slots: [slot(0, -20, 'top', 16, M.plus), slot(0, 20, 'bottom', 13, M.minus)],
      nameAt: 'right',
      ...small
    })
  },
  {
    id: 'inductor',
    group: 'passive',
    name: msg('코일 (인덕터)'),
    build: fixed({
      shapes: [line([0, -20, ...[-15, -5, 5, 15].flatMap((cy) => arc(0, cy, 5, -90, 90, 8).slice(2))])],
      slots: vertical2(30, 20),
      nameAt: 'right',
      ...small
    })
  },
  {
    id: 'crystal',
    group: 'passive',
    name: msg('크리스털'),
    build: fixed({ shapes: [rect(-4, -10, 8, 20), line([-8, -8, -8, 8], { width: 3 }), line([8, -8, 8, 8], { width: 3 })], slots: horizontal2(20, 8), nameAt: 'top', ...small })
  },
  { id: 'fuse', group: 'passive', name: msg('퓨즈'), build: fixed({ shapes: [rect(-6, -16, 12, 32), line([0, -16, 0, 16])], slots: vertical2(30, 16), nameAt: 'right', ...small }) },

  // 반도체
  { id: 'diode', group: 'semi', name: msg('다이오드'), build: fixed({ shapes: diodeBody(), slots: diodeSlots(), nameAt: 'top', ...small }) },
  {
    id: 'zener',
    group: 'semi',
    name: msg('제너 다이오드'),
    build: fixed({ shapes: [line([-8, -8, -8, 8, 8, 0], { closed: true }), line([4, -10, 8, -8, 8, 8, 12, 10])], slots: diodeSlots(), nameAt: 'top', ...small })
  },
  {
    id: 'led',
    group: 'semi',
    name: msg('LED'),
    build: fixed({
      shapes: [...diodeBody(), line([-2, -11, 6, -22], { width: 1.5, arrow: true }), line([5, -10, 13, -21], { width: 1.5, arrow: true })],
      slots: diodeSlots(),
      nameAt: 'bottom',
      ...small
    })
  },
  { id: 'npn', group: 'semi', name: msg('NPN 트랜지스터'), build: fixed(bjt(true)) },
  { id: 'pnp', group: 'semi', name: msg('PNP 트랜지스터'), build: fixed(bjt(false)) },
  { id: 'nmos', group: 'semi', name: msg('N채널 MOSFET'), build: fixed(mosfet(true)) },
  { id: 'pmos', group: 'semi', name: msg('P채널 MOSFET'), build: fixed(mosfet(false)) },

  // 증폭기·논리
  {
    id: 'opamp',
    group: 'logic',
    name: msg('연산 증폭기'),
    build: fixed({
      shapes: [line([-20, -25, -20, 25, 25, 0], { closed: true, fill: '#ffffff' }), label(-19, -17, 10, '+', 12), label(-19, 3, 10, '−', 12)],
      slots: [
        slot(40, 0, 'right', 15, M.out),
        slot(-30, 10, 'left', 10, M.inN),
        slot(-30, -10, 'left', 10, M.inP),
        slot(0, 30, 'bottom', 16, M.vneg),
        slot(0, -30, 'top', 16, POWER_TOP)
      ],
      nameAt: 'right',
      showNames: false
    })
  },
  {
    id: 'buffer',
    group: 'logic',
    name: msg('버퍼'),
    build: fixed({
      shapes: [line([-15, -15, -15, 15, 15, 0], { closed: true, fill: '#ffffff' })],
      slots: [slot(-30, 0, 'left', 15, M.inA), slot(30, 0, 'right', 15, M.out)],
      nameAt: 'top',
      showNames: false
    })
  },
  {
    id: 'not',
    group: 'logic',
    name: msg('NOT (인버터)'),
    build: fixed({
      shapes: [line([-15, -15, -15, 15, 13, 0], { closed: true, fill: '#ffffff' }), bubble(13)],
      slots: [slot(-30, 0, 'left', 15, M.inA), slot(30, 0, 'right', 11, M.out)],
      nameAt: 'top',
      showNames: false
    })
  },
  { id: 'and', group: 'logic', name: msg('AND'), build: fixed(gate([andBody()], 15, 15)) },
  { id: 'nand', group: 'logic', name: msg('NAND'), build: fixed(gate([andBody(), bubble(15)], 21, 15)) },
  { id: 'or', group: 'logic', name: msg('OR'), build: fixed(gate([orBody()], 15, 18)) },
  { id: 'nor', group: 'logic', name: msg('NOR'), build: fixed(gate([orBody(), bubble(15)], 21, 18)) },
  { id: 'xor', group: 'logic', name: msg('XOR'), build: fixed(gate([orBody(), line(orBack(-5))], 15, 13)) },

  // 전원·스위치·기타
  {
    id: 'battery',
    group: 'power',
    name: msg('배터리'),
    build: fixed({
      shapes: [line([-12, -4, 12, -4]), line([-6, 4, 6, 4], { width: 4 }), label(-20, -16, 8, '+')],
      slots: vertical2(20, 4, M.plus, M.minus),
      nameAt: 'right',
      ...small
    })
  },
  {
    id: 'switch',
    group: 'power',
    name: msg('스위치'),
    build: fixed({ shapes: [circle(-10, 0, 2), circle(10, 0, 2), line([-8, -1, 9, -9])], slots: horizontal2(20, 12), nameAt: 'top', ...small })
  },
  {
    id: 'push-button',
    group: 'power',
    name: msg('푸시 버튼'),
    build: fixed({
      shapes: [circle(-10, 0, 2), circle(10, 0, 2), line([-12, -6, 12, -6]), line([0, -6, 0, -14]), line([-5, -14, 5, -14])],
      slots: horizontal2(20, 12),
      nameAt: 'top',
      ...small
    })
  },
  {
    id: 'motor',
    group: 'power',
    name: msg('모터'),
    build: fixed({ shapes: [circle(0, 0, 14), label(-14, -8, 28, 'M', 14)], slots: vertical2(30, 14, M.plus, M.minus), nameAt: 'right', ...small })
  },
  {
    id: 'ground',
    group: 'power',
    name: msg('접지'),
    build: fixed({
      shapes: [line([-12, 0, 12, 0]), line([-8, 4, 8, 4]), line([-4, 8, 4, 8])],
      slots: [slot(0, -20, 'top', 20, POWER_BOTTOM)],
      nameAt: 'bottom',
      ...small
    })
  },
  {
    id: 'power',
    group: 'power',
    name: msg('전원'),
    build: fixed({ shapes: [line([-10, 0, 10, 0])], slots: [slot(0, 20, 'bottom', 20, POWER_TOP)], nameAt: 'top', ...small })
  },
  { id: 'connector', group: 'power', name: msg('커넥터 (한 줄)'), build: connector }
]

/** 기호 핀 선의 몸통 쪽 끝 */
export function slotInner(s: TemplateSlot): { x: number; y: number } {
  const dx = s.side === 'left' ? s.length : s.side === 'right' ? -s.length : 0
  const dy = s.side === 'top' ? s.length : s.side === 'bottom' ? -s.length : 0
  return { x: s.x + dx, y: s.y + dy }
}

/**
 * 슬롯마다 부품 핀을 정한다: 먼저 신호 이름이 슬롯 규칙에 맞는 핀, 남은 슬롯은 기호 핀 순서(커넥터 → 번호)대로.
 * 슬롯보다 핀이 많으면 남은 핀은 놓지 않은 핀이 되고, 적으면 슬롯이 빈다
 */
export function assignSlots(slots: readonly TemplateSlot[], pins: readonly Pin[]): (Pin | undefined)[] {
  const used = new Set<string>()
  const out: (Pin | undefined)[] = slots.map((s) => {
    if (!s.match) return undefined
    // 신호 이름이 맞는 핀 먼저, 없으면 번호가 맞는 핀 (배터리 단자 "+"·"-" 처럼 번호가 이름인 부품)
    const fits = (text: string | undefined) => pins.find((x) => !used.has(x.id) && s.match!.test((text === 'signal' ? x.signal : x.number)?.trim() ?? ''))
    const p = fits('signal') ?? fits('number')
    if (p) used.add(p.id)
    return p
  })
  const rest = pins.filter((p) => !used.has(p.id))
  return out.map((p) => p ?? rest.shift())
}

/** 기본 기호로 부품의 기호를 만든다 (그림판 크기는 내용에 맞춤) */
export function applyTemplate(tpl: SymbolTemplate, part: HasPins & { name: string }, makeId: () => string): PartSymbol {
  const pins = symbolPinOrder(part)
  const body = tpl.build(pins.length)
  const assigned = assignSlots(body.slots, pins)
  const symbolPins: SymbolPin[] = body.slots.flatMap((s, i) => {
    const p = assigned[i]
    if (!p) return []
    return [{ pinId: p.id, x: s.x, y: s.y, side: s.side, ...(s.length !== SYMBOL_PIN_LENGTH ? { length: s.length } : {}) }]
  })
  const shapes: Shape[] = body.shapes.map((s) => ({ ...s, id: makeId() }) as Shape)
  const name = nameShape(body, part.name, makeId)
  if (name) shapes.push(name)
  const box = unionBox(shapes.map(shapeBounds)) ?? { x: 0, y: 0, width: 0, height: 0 }
  return fitSymbol({
    drawing: { width: Math.max(SYMBOL_GRID * 2, Math.ceil(box.width)), height: Math.max(SYMBOL_GRID * 2, Math.ceil(box.height)), shapes },
    pins: symbolPins,
    ...(body.showNumbers === false ? { showNumbers: false } : {}),
    ...(body.showNames === false ? { showNames: false } : {})
  })
}

/** 부품 이름 글상자: 도형과 핀 끝점 전체 상자의 오른쪽·위·아래 */
function nameShape(body: TemplateBody, name: string, makeId: () => string): TextShape | undefined {
  if (body.nameAt === 'none') return undefined
  const size = 12
  const text = name || '?'
  const w = Math.ceil(textWidth(text, size) + 8)
  const boxes = [...body.shapes.map((s) => shapeBounds({ ...s, id: '' } as Shape)), ...body.slots.map((s) => ({ x: s.x, y: s.y, width: 0, height: 0 }))]
  const b = unionBox(boxes)!
  const cx = b.x + b.width / 2
  const pos =
    body.nameAt === 'right'
      ? { x: b.x + b.width + 6, y: b.y + b.height / 2 - size * 0.6, align: 'left' as const }
      : body.nameAt === 'top'
        ? { x: cx - w / 2, y: b.y - size * 1.2 - 4, align: 'center' as const }
        : { x: cx - w / 2, y: b.y + b.height + 4, align: 'center' as const }
  return { id: makeId(), type: 'text', x: r2(pos.x), y: r2(pos.y), w, text, fontSize: size, color: INK, bold: true, align: pos.align }
}
