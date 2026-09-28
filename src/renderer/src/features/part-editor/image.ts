import type { PartImage } from '@core/model'
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
