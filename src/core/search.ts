// 부품·신호 찾기 (032): 모든 배선도에서 참조명·부품 이름·품번·핀 신호·전선 라벨·접속점·글 상자 글을 찾는다.
import { endPosition } from './ends'
import { pinWorldPosition, type Point } from './geometry'
import { pathMidpoint, wirePath } from './wire'
import { noteBounds } from './note'
import type { SheetRef } from './workspace'

export type SearchKind = 'part' | 'pin' | 'wire' | 'junction' | 'note'

export interface SearchHit {
  sheetId: string
  sheetName: string
  kind: SearchKind
  /** 고를 대상: 부품·핀 = 배치 id, 전선, 접속점, 글 상자 id */
  id: string
  /** 목록에 보일 글 (예: "U1 제어 보드", "U1.J1.3 SDA") */
  title: string
  /** 화면을 옮길 곳 (월드 좌표) */
  at: Point
}

const has = (text: string | undefined, q: string) => !!text && text.toLowerCase().includes(q)

/** 찾기. 대소문자 무시, 앞뒤 공백 무시. 빈 검색어면 없음. limit개까지 (배선도 순서 → 종류 순서) */
export function searchSheets(sheets: readonly SheetRef[], query: string, limit = 100): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchHit[] = []
  const push = (h: SearchHit) => hits.length < limit && hits.push(h)
  for (const s of sheets) {
    const p = s.project
    const base = { sheetId: s.id, sheetName: s.name }
    for (const inst of p.instances) {
      const part = p.parts[inst.partId]
      if (!part) continue
      if (has(inst.refDes, q) || has(part.name, q) || has(part.partNumber, q)) {
        push({ ...base, kind: 'part', id: inst.id, title: [inst.refDes, part.name, part.partNumber].filter(Boolean).join(' · '), at: inst })
      }
      for (const pin of part.pins) {
        if (!has(pin.signal, q)) continue
        const connector = part.connectors.find((c) => c.id === pin.connectorId)?.name
        const label = [inst.refDes, connector, pin.number].filter(Boolean).join('.')
        push({ ...base, kind: 'pin', id: inst.id, title: `${label} ${pin.signal}`, at: pinWorldPosition(inst, part, pin) })
      }
    }
    for (const w of p.wires) {
      if (!has(w.label, q)) continue
      const a = endPosition(p, w.from)
      const b = endPosition(p, w.to)
      if (a && b) push({ ...base, kind: 'wire', id: w.id, title: w.label!, at: pathMidpoint(wirePath(a, w.points, b, w.orthogonal)) })
    }
    for (const j of p.junctions ?? []) {
      if (has(j.label, q)) push({ ...base, kind: 'junction', id: j.id, title: j.label, at: j })
    }
    for (const n of p.notes ?? []) {
      if (!has(n.text, q)) continue
      const r = noteBounds(n)
      push({ ...base, kind: 'note', id: n.id, title: n.text.split('\n')[0].slice(0, 60), at: { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
    }
  }
  return hits
}
