// 회로도 → PNG (039). 회로도 탭을 열지 않았어도 화면에 붙이지 않은 Konva 무대에서 그린다 (PDF에도 쓴다)
import Konva from 'konva'
import type { Project } from '@core/model'
import { buildSchematicScene } from '@core/schematic'
import { primNode, scenePrims, SCH_COLORS } from './schematicPrims'

/** 둘레 여백 (회로도 단위) */
const MARGIN = 30
/** 긴 변 최대 픽셀 */
const MAX_SIDE = 6000

/** 회로도 전체를 PNG data URL로. 부품이 없으면 null */
export function renderSchematicPng(project: Project): string | null {
  const scene = buildSchematicScene(project)
  const b = scene.bounds
  if (!b || scene.symbols.length === 0) return null
  // 참조명·라벨 글자가 상자 밖으로 조금 나온다
  const x = b.x - MARGIN
  const y = b.y - MARGIN
  const width = b.width + MARGIN * 2
  const height = b.height + MARGIN * 2
  const container = document.createElement('div')
  const stage = new Konva.Stage({ container, width, height })
  try {
    const layer = new Konva.Layer({ x: -x, y: -y })
    stage.add(layer)
    layer.add(new Konva.Rect({ x, y, width, height, fill: SCH_COLORS.background }))
    for (const p of scenePrims(scene)) layer.add(primNode(p) as Konva.Shape | Konva.Group)
    layer.draw()
    const pixelRatio = Math.max(1, Math.min(4, MAX_SIDE / Math.max(width, height)))
    return stage.toDataURL({ x: 0, y: 0, width, height, pixelRatio, mimeType: 'image/png' })
  } finally {
    stage.destroy()
  }
}
