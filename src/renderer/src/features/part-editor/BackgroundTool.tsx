import { useRef, useState } from 'react'
import type { Drawing, PartImage } from '@core/model'
import { BACKGROUND_TOLERANCE_DEFAULT, BACKGROUND_TOLERANCE_MAX } from '@core/background'
import { draftWithoutBackground, photoEdgeColor } from './image'
import { useT } from '@/i18n'

/** 초안의 사진과 그림 원본 (둘 다 바꾼다) */
export type Photo = { image?: PartImage; drawing?: Drawing }

/** Chromium 스포이트 (화면 아무 곳의 색을 집는다) */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }
const eyeDropper = (): EyeDropperCtor | undefined => (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper

interface Props {
  draft: Photo
  /** 바뀐 사진·그림 (초안에 둘 다 넣는다). rebake = 그림에 사진 말고 다른 도형도 있어 저장할 때 그림에서 다시 구워야 한다 */
  onChange: (photo: Photo, rebake: boolean) => void
  onError: (message: string) => void
}

/**
 * 사진 배경 지우기 (크로마키, core/background.ts): 배경색(키 색)과 비슷한 색을 사진 전체에서 투명하게.
 * 누르면 가장자리 색을 키 색으로 바로 지운다. 키 색(직접 고르기·스포이트)과 허용 범위를 바꾸면 처음 사진에서 다시 지운다
 */
export function BackgroundTool({ draft, onChange, onError }: Props) {
  const t = useT()
  /** 배경을 지우기 전 초안 (조절하는 동안 있음) */
  const [original, setOriginal] = useState<Photo | null>(null)
  const [key, setKey] = useState('#ffffff')
  const [tolerance, setTolerance] = useState(BACKGROUND_TOLERANCE_DEFAULT)
  const [busy, setBusy] = useState(false)
  /** 마지막 요청만 반영 (허용 범위를 빨리 움직일 때) */
  const request = useRef(0)

  const run = async (from: Photo, tol: number, k: string) => {
    const id = ++request.current
    setBusy(true)
    try {
      const r = await draftWithoutBackground(from, tol, k)
      if (id === request.current) onChange(r.draft, r.rebake)
    } catch (e) {
      onError((e as Error).message)
    } finally {
      if (id === request.current) setBusy(false)
    }
  }
  const rerun = (tol: number, k: string) => {
    setTolerance(tol)
    setKey(k)
    if (original) run(original, tol, k)
  }

  if (!draft.image) return null
  if (!original) {
    return (
      <button
        onClick={async () => {
          const from = { image: draft.image, drawing: draft.drawing }
          try {
            const k = await photoEdgeColor(draft.image!.data)
            setOriginal(from)
            setKey(k)
            run(from, tolerance, k)
          } catch (e) {
            onError((e as Error).message)
          }
        }}
        title={t('배경색(크로마키)을 사진 전체에서 투명하게 합니다')}
      >
        {t('배경 지우기')}
      </button>
    )
  }
  const Picker = eyeDropper()
  return (
    <div className="background-tool" role="group" aria-label={t('배경 지우기')}>
      <label className="check" title={t('지울 배경색 (처음에는 사진 가장자리 색)')}>
        {t('배경색')}
        <input type="color" className="swatch-input" aria-label={t('배경색')} value={key} onChange={(e) => rerun(tolerance, e.target.value)} />
      </label>
      {Picker && (
        <button
          className="icon"
          title={t('스포이트: 화면에서 지울 색 집기')}
          aria-label={t('스포이트')}
          onClick={async () => {
            try {
              const r = await new Picker().open()
              rerun(tolerance, r.sRGBHex)
            } catch {
              // Esc로 취소
            }
          }}
        >
          ⌖
        </button>
      )}
      <label className="check">
        {t('허용 범위')}
        <input
          type="range"
          aria-label={t('허용 범위')}
          min={0}
          max={BACKGROUND_TOLERANCE_MAX}
          value={tolerance}
          onChange={(e) => rerun(Number(e.target.value), key)}
        />
      </label>
      {busy && <span className="muted">{t('지우는 중…')}</span>}
      <button
        onClick={() => {
          request.current++
          setBusy(false)
          onChange(original, false)
          setOriginal(null)
        }}
      >
        {t('원래대로')}
      </button>
      <button className="primary" disabled={busy} onClick={() => setOriginal(null)}>
        {t('완료')}
      </button>
    </div>
  )
}
