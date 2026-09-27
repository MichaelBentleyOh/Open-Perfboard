// window.api.attachments 어댑터: 공유 파일에 넣을 본문 모으기, 받은 본문 저장, 있는지 확인
import { create } from 'zustand'
import { base64ToBytes, bytesToBase64, type AttachmentData } from '@core/attachment'

/** 첨부 폴더가 바뀐 횟수. 바뀌면 "있음/없음" 표시를 다시 확인한다 */
export const useAttachmentRevision = create<{ n: number; bump: () => void }>((set, get) => ({
  n: 0,
  bump: () => set({ n: get().n + 1 })
}))

/** 이 PC에 있는 첨부의 본문을 base64로 모은다 (없는 것은 건너뜀) */
export async function collectAttachmentData(ids: readonly string[]): Promise<AttachmentData> {
  const present = await window.api.attachments.exists([...ids])
  const data: AttachmentData = {}
  for (const id of present) data[id] = bytesToBase64(await window.api.attachments.read(id))
  return data
}

/**
 * 공유 파일에서 온 본문을 첨부 폴더에 넣는다. only를 주면 그 id만.
 * main이 해시·형식·크기를 다시 확인하고, 맞지 않는 것은 건너뛴다. 저장한 개수를 돌려준다
 */
export async function putAttachmentData(data: AttachmentData | undefined, only?: readonly string[]): Promise<number> {
  if (!data) return 0
  let n = 0
  for (const [id, b64] of Object.entries(data)) {
    if (only && !only.includes(id)) continue
    try {
      await window.api.attachments.put(id, base64ToBytes(b64))
      n++
    } catch {
      // 잘못된 본문은 건너뛴다 (목록에는 남고 "파일 없음"으로 보인다)
    }
  }
  if (n > 0) useAttachmentRevision.getState().bump()
  return n
}
