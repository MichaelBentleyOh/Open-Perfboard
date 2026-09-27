// 부품 첨부 저장소: <라이브러리>/attachments/<sha256>.<확장자>. 같은 내용은 한 파일.
// 형식 판별·id 규칙은 core/attachment.ts. 여기서는 바이트를 읽고 쓰고 해시만 계산한다.
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  ATTACHMENT_ID,
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  attachmentExt,
  sniffAttachmentType,
  titleFromFileName
} from '../../core/attachment'
import type { Attachment, AttachmentType } from '../../core/model'
import { writeFileAtomic } from '../fsutil'
import { mt } from '../locale'

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function assertId(id: string): void {
  if (!ATTACHMENT_ID.test(id)) throw new Error(`잘못된 첨부 id: ${id.slice(0, 16)}`)
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false
  )

/** 첨부 파일 경로와 형식. 없으면 undefined */
export async function findAttachment(dir: string, id: string): Promise<{ path: string; type: AttachmentType } | undefined> {
  assertId(id)
  for (const type of ATTACHMENT_TYPES) {
    const path = join(dir, `${id}.${attachmentExt(type)}`)
    if (await exists(path)) return { path, type }
  }
  return undefined
}

/** 크기·형식을 확인하고 해시로 저장한다. 같은 내용이 이미 있으면 다시 쓰지 않는다 */
async function store(dir: string, bytes: Uint8Array): Promise<{ id: string; type: AttachmentType }> {
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(mt('파일이 너무 큽니다 ({size}MB)', { size: Math.round(bytes.length / 1024 / 1024) }))
  const type = sniffAttachmentType(bytes)
  if (!type) throw new Error(mt('PDF, PNG, JPG, WEBP 파일만 첨부할 수 있습니다'))
  const id = sha256(bytes)
  const path = join(dir, `${id}.${attachmentExt(type)}`)
  if (!(await exists(path))) {
    await mkdir(dir, { recursive: true })
    await writeFileAtomic(path, bytes)
  }
  return { id, type }
}

/** 사용자가 고른 파일을 첨부 폴더로 복사한다 */
export async function importAttachmentFile(dir: string, file: string): Promise<Attachment> {
  const s = await stat(file)
  if (s.size > MAX_ATTACHMENT_BYTES) throw new Error(mt('파일이 너무 큽니다 ({size}MB)', { size: Math.round(s.size / 1024 / 1024) }))
  const bytes = await readFile(file)
  const { id, type } = await store(dir, bytes)
  return { id, name: titleFromFileName(basename(file)), type, size: bytes.length }
}

/** 공유 파일(.opb/.opblib)에서 온 본문. 내용의 해시가 id와 같아야 저장한다 */
export async function putAttachment(dir: string, id: string, bytes: Uint8Array): Promise<void> {
  assertId(id)
  if (sha256(bytes) !== id) throw new Error(mt('첨부 파일 내용이 목록과 다릅니다'))
  await store(dir, bytes)
}

export async function readAttachment(dir: string, id: string): Promise<Uint8Array> {
  const found = await findAttachment(dir, id)
  if (!found) throw new Error(mt('첨부 파일을 찾을 수 없습니다'))
  return readFile(found.path)
}

/** 이 PC에 있는 첨부 id만 */
export async function existingAttachments(dir: string, ids: readonly string[]): Promise<string[]> {
  const out: string[] = []
  for (const id of ids) if (ATTACHMENT_ID.test(id) && (await findAttachment(dir, id))) out.push(id)
  return out
}
