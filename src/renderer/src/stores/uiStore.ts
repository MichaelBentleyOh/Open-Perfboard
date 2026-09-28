// 화면 상태. 실행 취소 대상이 아니다.
import { create } from 'zustand'
import type { WireTarget } from '@core/ops'
import type { Point } from '@core/geometry'
import type { ClipboardData } from '@core/clipboard'
import type { ImportEntry } from '@core/library'
import type { Supply } from '@core/model'
import type { AttachmentData } from '@core/attachment'
import { msg } from '@core/i18n'

/** 선택된 부품·전선 id 목록 (다중 선택) */
export interface Selection {
  instances: string[]
  wires: string[]
  junctions: string[]
  /** 글 상자 (032) */
  notes: string[]
}

export const EMPTY_SELECTION: Selection = { instances: [], wires: [], junctions: [], notes: [] }

export const selectionCount = (s: Selection) => s.instances.length + s.wires.length + s.junctions.length + s.notes.length

export const WIRE_COLORS = [
  { name: msg('빨강'), value: '#e53935' },
  { name: msg('검정'), value: '#212121' },
  { name: msg('파랑'), value: '#1e88e5' },
  { name: msg('노랑'), value: '#fdd835' },
  { name: msg('초록'), value: '#43a047' },
  { name: msg('주황'), value: '#fb8c00' },
  { name: msg('보라'), value: '#8e24aa' },
  { name: msg('흰색'), value: '#f5f5f5' }
] as const

type Kind = 'instance' | 'wire' | 'junction' | 'note'
const LIST_OF = { instance: 'instances', wire: 'wires', junction: 'junctions', note: 'notes' } as const
const listOf = (kind: Kind) => LIST_OF[kind]

/** 부품 가져오기 대화상자에 보여 줄 내용 */
export interface ImportRequest {
  files: string[]
  plan: ImportEntry[]
  problems: string[]
  /** 대화상자 위쪽 안내 (예: 배선도에 함께 저장된 라이브러리) */
  note?: string
  /** 파일에 들어 있던 첨부 본문. 가져온 부품이 쓰는 것만 저장한다 */
  attachmentData?: AttachmentData
  /** 부속 부품 (027) */
  supplyPlan?: ImportEntry<Supply>[]
}

/** 오래 걸리는 작업 (배선 정리): 진행 창을 띄우고 다른 조작을 막는다 */
export interface BusyTask {
  /** 진행 창 제목 (번역된 문자열) */
  label: string
  done: number
  total: number
  cancel: () => void
}

/** 선택 모드: 고르고 옮기기 · 배선 모드: 핀·전선·접속점에서 전선 잇기와 분기 */
export type Tool = 'select' | 'wire'
export type NetlistMode = 'table' | 'labels'

interface UiState {
  tool: Tool
  /** 모드를 바꾼다. 그리던 전선은 취소 */
  setTool: (tool: Tool) => void
  selection: Selection
  /** 전선을 그리는 중이면 시작점: 핀, 접속점, 또는 기존 전선 위의 점(분기) */
  wireStart: WireTarget | null
  /** 그리는 중인 전선의 꺾임점 (월드 좌표) */
  wirePoints: Point[]
  /** 새 전선을 직각으로 그릴지 */
  wireOrthogonal: boolean
  /** 새 전선 색 */
  wireColor: string
  notice: string | null
  /** 복사한 내용 (앱 안 클립보드, 배선도를 바꿔도 유지) */
  clipboard: ClipboardData | null
  /** 같은 내용을 몇 번째 붙여넣는지 (마우스가 캔버스 밖일 때 비켜 가는 거리) */
  pasteSerial: number
  setClipboard: (c: ClipboardData) => void
  /** 붙여넣기 횟수를 하나 올리고 돌려준다 (1부터) */
  nextPasteSerial: () => number
  select: (s: Selection) => void
  selectOne: (kind: Kind, id: string) => void
  /** Ctrl+클릭: 선택에 넣거나 뺀다 */
  toggle: (kind: Kind, id: string) => void
  clearSelection: () => void
  /** 시작 핀을 정하거나(null이면 그리기 취소) 꺾임점을 비운다 */
  setWireStart: (p: WireTarget | null) => void
  addWirePoint: (p: Point) => void
  /** 마지막 꺾임점 취소. 없으면 false */
  popWirePoint: () => boolean
  setWireOrthogonal: (on: boolean) => void
  setWireColor: (c: string) => void
  notify: (message: string) => void
  /** 열려 있는 부품 가져오기 대화상자 (라이브러리 패널의 가져오기, 배선도 열기) */
  importRequest: ImportRequest | null
  setImportRequest: (r: ImportRequest | null) => void
  /** 결선표 탭: 표 또는 연결 라벨 (025) */
  netlistMode: NetlistMode
  setNetlistMode: (mode: NetlistMode) => void
  /** 연결 라벨 보기에서 이 부품과 이어진 부품만 (null = 모두) */
  labelFocus: string | null
  setLabelFocus: (instanceId: string | null) => void
  /** 글을 고치는 중인 글 상자 (032) */
  editingNote: string | null
  setEditingNote: (id: string | null) => void
  /** 검색 창 (Ctrl+F, 032) */
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  /** 단축키 도움말 (? 버튼, ? / F1 키) */
  helpOpen: boolean
  setHelpOpen: (open: boolean) => void
  /** 앱 버전 (도움말 창에 표시) */
  appVersion: string | null
  setAppVersion: (v: string) => void
  busy: BusyTask | null
  setBusy: (task: BusyTask | null) => void
  setBusyProgress: (done: number, total: number) => void
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined

export const useUiStore = create<UiState>((set, get) => ({
  tool: 'select',
  setTool: (tool) => set({ tool, wireStart: null, wirePoints: [] }),
  selection: EMPTY_SELECTION,
  wireStart: null,
  wirePoints: [],
  wireOrthogonal: true,
  wireColor: WIRE_COLORS[0].value,
  notice: null,
  clipboard: null,
  pasteSerial: 0,
  setClipboard: (clipboard) => set({ clipboard, pasteSerial: 0 }),
  nextPasteSerial: () => {
    const n = get().pasteSerial + 1
    set({ pasteSerial: n })
    return n
  },
  select: (selection) => set({ selection: { ...EMPTY_SELECTION, ...selection } }),
  netlistMode: 'table',
  setNetlistMode: (netlistMode) => set({ netlistMode }),
  labelFocus: null,
  setLabelFocus: (labelFocus) => set({ labelFocus }),
  selectOne: (kind, id) => set({ selection: { ...EMPTY_SELECTION, [listOf(kind)]: [id] } }),
  toggle: (kind, id) => {
    const key = listOf(kind)
    const list = get().selection[key]
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    set({ selection: { ...get().selection, [key]: next } })
  },
  clearSelection: () => set({ selection: EMPTY_SELECTION }),
  setWireStart: (wireStart) => set({ wireStart, wirePoints: [] }),
  addWirePoint: (p) => set({ wirePoints: [...get().wirePoints, p] }),
  popWirePoint: () => {
    const pts = get().wirePoints
    if (pts.length === 0) return false
    set({ wirePoints: pts.slice(0, -1) })
    return true
  },
  setWireOrthogonal: (wireOrthogonal) => set({ wireOrthogonal }),
  setWireColor: (wireColor) => set({ wireColor }),
  importRequest: null,
  setImportRequest: (importRequest) => set({ importRequest }),
  editingNote: null,
  setEditingNote: (editingNote) => set({ editingNote }),
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  helpOpen: false,
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  appVersion: null,
  setAppVersion: (appVersion) => set({ appVersion }),
  busy: null,
  setBusy: (busy) => set({ busy }),
  setBusyProgress: (done, total) => {
    const busy = get().busy
    if (busy) set({ busy: { ...busy, done, total } })
  },
  notify: (notice) => {
    clearTimeout(noticeTimer)
    set({ notice })
    noticeTimer = setTimeout(() => set({ notice: null }), 2500)
  }
}))
