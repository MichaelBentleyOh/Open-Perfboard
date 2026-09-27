// 부품 첨부(데이터시트 PDF, 핀아웃 그림). 파일 본문은 라이브러리의 첨부 폴더에 두고,
// 부품 정의에는 목록(메타데이터)만 둔다. id = 내용의 SHA-256(소문자 16진수 64자) → 같은 파일은 하나.
import type { Attachment, AttachmentType, PartDef } from './model'

/** 파일 하나 최대 크기 */
export const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024

export const ATTACHMENT_ID = /^[0-9a-f]{64}$/

export const ATTACHMENT_TYPES: readonly AttachmentType[] = ['pdf', 'png', 'jpeg', 'webp']

export const isAttachmentType = (v: unknown): v is AttachmentType =>
  typeof v === 'string' && (ATTACHMENT_TYPES as readonly string[]).includes(v)

/** 저장할 때 쓰는 확장자 */
export const attachmentExt = (type: AttachmentType): string => (type === 'jpeg' ? 'jpg' : type)

export const isImageAttachment = (type: AttachmentType): boolean => type !== 'pdf'

const MIME: Record<AttachmentType, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
}
export const attachmentMime = (type: AttachmentType): string => MIME[type]

const startsWith = (b: Uint8Array, sig: readonly number[], offset = 0) => sig.every((v, i) => b[offset + i] === v)

/** 파일 내용(첫 바이트)으로 형식을 판별한다. 확장자는 믿지 않는다. 모르는 형식이면 undefined */
export function sniffAttachmentType(bytes: Uint8Array): AttachmentType | undefined {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf' // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp' // RIFF....WEBP
  return undefined
}

/** 부품들이 쓰는 첨부 id (중복 없이, 처음 나온 순서) */
export function attachmentIdsOf(parts: Iterable<PartDef>): string[] {
  const ids: string[] = []
  for (const p of parts) for (const a of p.attachments ?? []) if (!ids.includes(a.id)) ids.push(a.id)
  return ids
}

/** 1536 → "1.5 KB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, '')} KB`
  return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`
}

/** 파일 이름에서 확장자를 뺀 제목 */
export const titleFromFileName = (name: string): string => name.replace(/\.[^.\\/]+$/, '').trim() || name

// ---------------------------------------------------------------- 공유 파일(.opb, .opblib)에 넣는 본문

/** 첨부 id → base64 본문 */
export type AttachmentData = Record<string, string>

/** 바이트 → base64 (큰 파일도 스택이 넘치지 않게 나눠서) */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ---------------------------------------------------------------- 부품 편집기용 연산 (입력을 바꾸지 않음)

type HasAttachments = { attachments?: Attachment[] }

/** 목록 끝에 추가. 이미 있는 파일(같은 id)은 건너뛴다 */
export function addAttachments<P extends HasAttachments>(part: P, list: readonly Attachment[]): P {
  const current = part.attachments ?? []
  const fresh = list.filter((a, i) => !current.some((c) => c.id === a.id) && list.findIndex((b) => b.id === a.id) === i)
  return fresh.length ? { ...part, attachments: [...current, ...fresh] } : part
}

export function removeAttachment<P extends HasAttachments>(part: P, id: string): P {
  const next = (part.attachments ?? []).filter((a) => a.id !== id)
  if (next.length > 0) return { ...part, attachments: next }
  const { attachments: _removed, ...rest } = part
  return rest as P
}

/** 제목 바꾸기. 빈 제목은 무시 */
export function renameAttachment<P extends HasAttachments>(part: P, id: string, name: string): P {
  const title = name.trim()
  if (!title) return part
  return { ...part, attachments: (part.attachments ?? []).map((a) => (a.id === id ? { ...a, name: title } : a)) }
}
