import { describe, expect, it } from 'vitest'
import {
  addAttachments,
  attachmentIdsOf,
  base64ToBytes,
  bytesToBase64,
  formatBytes,
  removeAttachment,
  renameAttachment,
  sniffAttachmentType,
  titleFromFileName
} from '@core/attachment'
import { readLibraryFile, serializeLibrary } from '@core/library'
import { finalizeDraft } from '@core/part'
import { PROJECT_FILE_VERSION, type Attachment } from '@core/model'
import { parsePart, parseProjectFile, serializePart, serializeProject } from '@core/serialize'
import { loadSample, makePart } from '../helpers'

const bytes = (...v: number[]) => new Uint8Array(v)
const ascii = (s: string) => new TextEncoder().encode(s)
const ID_A = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)
const pdf: Attachment = { id: ID_A, name: '데이터시트', type: 'pdf', size: 1234 }
const png: Attachment = { id: ID_B, name: '핀아웃', type: 'png', size: 99 }

describe('형식 판별 (파일 내용으로)', () => {
  it('PDF, PNG, JPEG, WEBP', () => {
    expect(sniffAttachmentType(ascii('%PDF-1.7\n...'))).toBe('pdf')
    expect(sniffAttachmentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('png')
    expect(sniffAttachmentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
    expect(sniffAttachmentType(ascii('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp')
  })

  it('확장자만 바꾼 다른 파일은 거부', () => {
    expect(sniffAttachmentType(ascii('PK\x03\x04zip'))).toBeUndefined()
    expect(sniffAttachmentType(ascii('<html>'))).toBeUndefined()
    expect(sniffAttachmentType(ascii('RIFF\0\0\0\0WAVE'))).toBeUndefined()
    expect(sniffAttachmentType(new Uint8Array())).toBeUndefined()
  })
})

describe('도우미', () => {
  it('크기 표시, 파일 이름 → 제목', () => {
    expect([formatBytes(512), formatBytes(1536), formatBytes(2 * 1024 * 1024), formatBytes(1024)]).toEqual(['512 B', '1.5 KB', '2 MB', '1 KB'])
    expect(titleFromFileName('ESP32 datasheet.v2.pdf')).toBe('ESP32 datasheet.v2')
    expect(titleFromFileName('noext')).toBe('noext')
  })

  it('base64 왕복 (큰 파일 포함)', () => {
    const big = new Uint8Array(200_000).map((_, i) => (i * 31) % 256)
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big)
    expect(bytesToBase64(ascii('%PDF'))).toBe('JVBERg==')
  })

  it('추가(중복 건너뜀)·제목 바꾸기·삭제, 입력은 그대로', () => {
    const part = makePart('p')
    const a = addAttachments(part, [pdf, png, pdf])
    expect(a.attachments!.map((x) => x.id)).toEqual([ID_A, ID_B])
    expect(addAttachments(a, [pdf])).toBe(a)
    expect(renameAttachment(a, ID_A, '  Rev.C  ').attachments![0].name).toBe('Rev.C')
    expect(renameAttachment(a, ID_A, ' ')).toBe(a)
    expect(removeAttachment(a, ID_A).attachments).toEqual([png])
    expect('attachments' in removeAttachment(removeAttachment(a, ID_A), ID_B)).toBe(false)
    expect(part.attachments).toBeUndefined()
    expect(attachmentIdsOf([a, makePart('q', { attachments: [png] })])).toEqual([ID_A, ID_B])
  })

  it('부품 편집기에서 저장하면 첨부가 남는다', () => {
    expect(finalizeDraft(makePart('p', { attachments: [pdf] }))!.attachments).toEqual([pdf])
    expect('attachments' in finalizeDraft(makePart('p'))!).toBe(false)
  })
})

describe('파일 포맷 v5', () => {
  it('부품 첨부 목록 왕복, 잘못된 id·형식 거부', () => {
    const part = makePart('p', { attachments: [pdf, png] })
    const r = parsePart(serializePart(part))
    expect(r.ok && r.value.attachments).toEqual([pdf, png])
    const bad = JSON.parse(serializePart(part))
    bad.attachments[0].id = '../../evil'
    bad.attachments[1].type = 'exe'
    const e = parsePart(JSON.stringify(bad))
    expect(e.ok ? [] : e.errors).toEqual(['attachments[0].id: 첨부 id가 올바르지 않습니다', 'attachments[1].type: 지원하지 않는 첨부 형식입니다'])
  })

  it('배선도 파일의 첨부 본문 왕복, 예전 파일은 빈 본문, 잘못된 본문 거부', () => {
    expect(PROJECT_FILE_VERSION).toBeGreaterThanOrEqual(5)
    const p = loadSample()
    const data = { [ID_A]: bytesToBase64(ascii('%PDF-1.4')) }
    const r = parseProjectFile(serializeProject(p, [], data))
    expect(r.ok && r.value.attachmentData).toEqual(data)
    expect(r.ok && r.value.project).toEqual(p)
    expect('attachmentData' in JSON.parse(serializeProject(p))).toBe(false)
    const old = parseProjectFile(serializeProject(p))
    expect(old.ok && old.value.attachmentData).toEqual({})
    const raw = JSON.parse(serializeProject(p, [], data))
    raw.attachmentData = { 'not-an-id': 'AAAA' }
    const bad = parseProjectFile(JSON.stringify(raw))
    expect(bad.ok ? [] : bad.errors).toEqual(['attachmentData.not-an-id: 첨부 본문이 올바르지 않습니다'])
  })

  it('라이브러리 묶음 파일의 첨부 본문 왕복', () => {
    const data = { [ID_B]: bytesToBase64(bytes(0x89, 0x50, 0x4e, 0x47)) }
    const r = readLibraryFile(serializeLibrary([makePart('p', { attachments: [png] })], data), 'x.opblib')
    expect(r.parts[0].attachments).toEqual([png])
    expect(r.attachmentData).toEqual(data)
    expect(r.problems).toEqual([])
    expect('attachmentData' in JSON.parse(serializeLibrary([makePart('p')]))).toBe(false)
  })
})
