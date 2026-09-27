// 성능 측정용 시험 배선도. 크기만 정하면 같은 배선도가 매번 똑같이 만들어진다 (고정 시드).
// E2E(Playwright)에서도 쓰므로 상대 경로로 가져온다
import type { Junction, PartDef, PartInstance, Project, Wire, WireEnd } from '../../src/core/model'
import { PROJECT_FILE_VERSION } from '../../src/core/model'

export interface SynthOptions {
  /** 전선 수 */
  wires: number
  /** 부품 하나에 달린 전선 수 (부품 수 = wires / wiresPerPart) */
  wiresPerPart?: number
  /** 서로 다른 부품 정의 수 (사진은 정의마다 하나) */
  partKinds?: number
  /** 부품 사진 base64 길이 (실제 사진 크기 흉내) */
  imageBytes?: number
  /** 실제 사진 data URL (주면 imageBytes 대신) */
  imageData?: string
  /** 접속점에서 끝나는 전선 비율 */
  junctionRatio?: number
}

/** 결정적 난수 (mulberry32) */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PINS_PER_PART = 16
const CELL = 420

export function synthProject(opts: SynthOptions): Project {
  const { wires: wireCount, wiresPerPart = 4, partKinds = 20, imageBytes = 200_000, junctionRatio = 0.05, imageData } = opts
  const rand = rng(wireCount)
  const kinds = Math.max(1, Math.min(partKinds, wireCount))
  const parts: Record<string, PartDef> = {}
  for (let k = 0; k < kinds; k++) {
    const id = `part${k}`
    parts[id] = {
      id,
      name: `부품 ${k}`,
      refPrefix: 'U',
      image: { data: imageData ?? `data:image/png;base64,${'A'.repeat(imageBytes)}`, width: 800, height: 600 },
      connectors: [],
      pins: Array.from({ length: PINS_PER_PART }, (_, i) => ({
        id: `p${i}`,
        number: String(i + 1),
        // 위·아래 가장자리에 8개씩
        x: 0.1 + (i % 8) * 0.1,
        y: i < 8 ? 0.05 : 0.95
      }))
    }
  }

  const partCount = Math.max(2, Math.ceil(wireCount / wiresPerPart))
  const cols = Math.ceil(Math.sqrt(partCount))
  const rows = Math.ceil(partCount / cols)
  const instances: PartInstance[] = Array.from({ length: partCount }, (_, i) => ({
    id: `i${i}`,
    partId: `part${i % kinds}`,
    refDes: `U${i + 1}`,
    x: (i % cols) * CELL,
    y: Math.floor(i / cols) * CELL,
    rotation: 0,
    scale: 1
  }))

  const junctions: Junction[] = []
  const wires: Wire[] = []
  const pinOf = (inst: number): WireEnd => ({ instanceId: `i${inst}`, pinId: `p${Math.floor(rand() * PINS_PER_PART)}` })
  for (let w = 0; w < wireCount; w++) {
    const a = Math.floor(rand() * partCount)
    // 가까운 부품끼리 (실제 배선도처럼): 이웃 2칸 이내
    const ax = a % cols
    const ay = Math.floor(a / cols)
    let b = a
    for (let tries = 0; tries < 10 && b === a; tries++) {
      const bx = Math.min(cols - 1, Math.max(0, ax + Math.floor(rand() * 5) - 2))
      const by = Math.min(rows - 1, Math.max(0, ay + Math.floor(rand() * 5) - 2))
      b = by * cols + bx
      if (b >= partCount) b = a
    }
    if (b === a) b = (a + 1) % partCount
    let to: WireEnd = pinOf(b)
    if (rand() < junctionRatio) {
      const id = `j${junctions.length}`
      junctions.push({ id, x: Math.round(((ax + 0.5) * CELL) / 10) * 10, y: Math.round(((ay + 0.5) * CELL) / 10) * 10, label: `SP${junctions.length + 1}` })
      to = { junctionId: id }
    }
    const midX = Math.round(((ax + (b % cols)) * CELL) / 2 / 10) * 10 + 5
    wires.push({ id: `w${w}`, from: pinOf(a), to, color: '#e11d48', width: 2, orthogonal: true, points: [{ x: midX, y: ay * CELL }] })
  }

  return { version: PROJECT_FILE_VERSION, name: `synth-${wireCount}`, parts, instances, wires, junctions }
}
