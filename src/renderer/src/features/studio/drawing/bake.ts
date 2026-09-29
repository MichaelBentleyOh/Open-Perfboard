// 그림 원본 → PNG (부품 사진). 화면에 붙이지 않은 Konva 무대에서 그린다.
import Konva from 'konva'
import type { Drawing, PartImage } from '@core/model'
import { loadDrawingImages, shapeNode } from './shapeNodes'

/** 부품 사진의 긴 변 최대 픽셀 (사진 불러오기와 같은 한도) */
export const PART_BAKE_MAX = 1600
/** 부속 부품 사진은 목록·BOM 확인용이라 작게 */
export const SUPPLY_BAKE_MAX = 480

/**
 * 그림을 PNG data URL로 굽는다. width/height는 그림판 크기(비율과 핀 좌표의 기준)이고,
 * 실제 픽셀은 선명하게 2배까지, 긴 변이 maxSide를 넘지 않게.
 */
export async function bakeDrawing(d: Drawing, maxSide = PART_BAKE_MAX): Promise<PartImage> {
  const images = await loadDrawingImages(d)
  const container = document.createElement('div')
  const stage = new Konva.Stage({ container, width: d.width, height: d.height })
  try {
    const layer = new Konva.Layer()
    stage.add(layer)
    if (d.background) layer.add(new Konva.Rect({ x: 0, y: 0, width: d.width, height: d.height, fill: d.background }))
    for (const s of d.shapes) layer.add(shapeNode(s, images))
    layer.draw()
    const pixelRatio = Math.min(2, maxSide / Math.max(d.width, d.height))
    const data = stage.toDataURL({ x: 0, y: 0, width: d.width, height: d.height, pixelRatio, mimeType: 'image/png' })
    return { data, width: d.width, height: d.height }
  } finally {
    stage.destroy()
  }
}
