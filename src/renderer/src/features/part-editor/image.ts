import type { Drawing, PartImage } from '@core/model'
import { edgeColor, removeBackground } from '@core/background'
import { hexToRgb, rgbToHex } from '@core/color'
import { t } from '@/i18n'

/** 긴 변이 이보다 크면 줄여서 저장한다 (프로젝트 파일 크기 관리) */
const MAX_SIDE = 1600

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(t('이미지를 읽지 못했습니다')))
    img.src = src
  })
}

/** 사용자가 고른 사진 파일을 data URL로 읽고, 너무 크면 줄인다 */
export async function readImageFile(file: File, maxSide = MAX_SIDE): Promise<PartImage> {
  if (!file.type.startsWith('image/')) throw new Error(t('이미지 파일이 아닙니다'))
  const data = await readAsDataUrl(file)
  const img = await loadHtmlImage(data)
  const { naturalWidth: w, naturalHeight: h } = img
  const scale = Math.min(1, maxSide / Math.max(w, h))
  if (scale === 1) return { data, width: w, height: h }

  const width = Math.round(w * scale)
  const height = Math.round(h * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  return { data: canvas.toDataURL(type, 0.9), width, height }
}

/** 사진(data URL)의 픽셀 */
async function readPixels(src: string): Promise<{ ctx: CanvasRenderingContext2D; pixels: ImageData }> {
  const img = await loadHtmlImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  return { ctx, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height) }
}

/** 사진 가장자리 색 (#rrggbb). 크로마키의 기본 키 색. 가장자리가 모두 투명하면 흰색 */
export async function photoEdgeColor(src: string): Promise<string> {
  const { pixels } = await readPixels(src)
  const c = edgeColor({ data: pixels.data, width: pixels.width, height: pixels.height })
  return c ? rgbToHex(c) : '#ffffff'
}

/** 사진(data URL)에서 키 색(#rrggbb)을 지운 PNG data URL (core/background.ts) */
export async function removeImageBackground(src: string, tolerance: number, key: string): Promise<string> {
  const { ctx, pixels } = await readPixels(src)
  const { width, height } = pixels
  const out = removeBackground({ data: pixels.data, width, height }, tolerance, hexToRgb(key))
  ctx.putImageData(new ImageData(out, width, height), 0, 0)
  return ctx.canvas.toDataURL('image/png')
}

/** 초안의 사진과 그림 원본 */
type Photo = { image?: PartImage; drawing?: Drawing }

/**
 * 부품·부속 부품 초안의 사진과 그림 속 사진 도형에서 키 색을 지운다.
 * 그림에 사진 말고 다른 도형도 있으면 rebake = true (저장할 때 그림에서 다시 구워야 한다)
 */
export async function draftWithoutBackground(d: Photo, tolerance: number, key: string): Promise<{ draft: Photo; rebake: boolean }> {
  const image = d.image && { ...d.image, data: await removeImageBackground(d.image.data, tolerance, key) }
  const drawing = d.drawing && {
    ...d.drawing,
    shapes: await Promise.all(
      d.drawing.shapes.map(async (s) => (s.type === 'image' ? { ...s, src: await removeImageBackground(s.src, tolerance, key) } : s))
    )
  }
  return { draft: { image, drawing }, rebake: (d.drawing?.shapes.length ?? 0) > 1 }
}

const transparencyCache = new WeakMap<HTMLImageElement, boolean>()
/** 투명한 곳이 있는 사진인지 (배경을 지운 PNG). 작게 줄여 알파를 본다, 사진마다 한 번만 */
export function hasTransparency(img: HTMLImageElement): boolean {
  const cached = transparencyCache.get(img)
  if (cached !== undefined) return cached
  const k = Math.min(1, 128 / Math.max(img.naturalWidth, img.naturalHeight, 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let found = false
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      found = true
      break
    }
  }
  transparencyCache.set(img, found)
  return found
}

/** 투명 배경을 나타내는 바둑판 무늬 (Konva fillPatternImage용, 그림판·핀 캔버스) */
export function checkerPattern(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 16, 16)
  g.fillStyle = '#eceff1'
  g.fillRect(0, 0, 8, 8)
  g.fillRect(8, 8, 8, 8)
  return c
}
