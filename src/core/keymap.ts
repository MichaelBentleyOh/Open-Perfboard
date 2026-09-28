// 단축키 목록. 실제 동작(renderer/app/shortcuts.ts)과 도움말(HelpDialog)이 모두 이 목록을 쓴다
// → 도움말과 동작이 어긋나지 않는다. 단축키를 추가·변경할 때는 여기만 고친다.
// 순수 데이터: 키 조합, 분류, 설명(한국어 원문, 표시할 때 번역)
import { msg } from './i18n'

export interface Combo {
  /** KeyboardEvent.key (소문자로 비교). code와 둘 중 하나 */
  key?: string
  /** KeyboardEvent.code (숫자패드처럼 자리로 구분할 때) */
  code?: string
  ctrl?: boolean
  /** undefined = 상관없음 ('?'처럼 Shift를 눌러야 나오는 글자) */
  shift?: boolean
  /** 같은 동작의 다른 키(자판에 따라 다른 글자). 동작은 하지만 도움말에는 보이지 않는다 */
  alias?: boolean
}

/**
 * 어디서 동작하나
 * - always: 입력칸에서 글을 쓰는 중에도 (파일 명령)
 * - app: 입력칸 밖, 어느 탭에서나
 * - diagram: 입력칸 밖, 배선도 탭에서만 (BOM·결선표 탭에서는 무시)
 */
export type ShortcutScope = 'always' | 'app' | 'diagram'

export type ShortcutId =
  | 'new' | 'open' | 'save' | 'saveAs' | 'pdf'
  | 'undo' | 'redo' | 'copy' | 'cut' | 'paste' | 'selectAll' | 'delete'
  | 'selectMode' | 'wireMode' | 'escape' | 'wireBack'
  | 'rotate' | 'rotateBack' | 'flipH' | 'flipV' | 'grow' | 'shrink'
  | 'zoom100' | 'zoomIn' | 'zoomOut' | 'fit'
  | 'help'
  | 'textBox' | 'search'

export interface Shortcut {
  id: ShortcutId
  group: string
  description: string
  combos: Combo[]
  scope: ShortcutScope
}

const G = {
  file: msg('파일'),
  edit: msg('편집'),
  mode: msg('모드·배선'),
  part: msg('부품'),
  view: msg('화면'),
  help: msg('도움말')
}

const ctrl = (key: string, shift = false): Combo => ({ key, ctrl: true, shift })
const plain = (key: string, shift = false): Combo => ({ key, shift })

/**
 * 순서가 중요하다: 같은 키가 여러 항목에 있으면(예: Backspace = 꺾임점 취소 또는 삭제)
 * 앞의 항목이 먼저 처리하고, 그 항목이 할 일이 없으면 다음 항목으로 넘어간다.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'new', group: G.file, description: msg('새로 만들기'), combos: [ctrl('n')], scope: 'always' },
  { id: 'open', group: G.file, description: msg('열기'), combos: [ctrl('o')], scope: 'always' },
  { id: 'save', group: G.file, description: msg('저장'), combos: [ctrl('s')], scope: 'always' },
  { id: 'saveAs', group: G.file, description: msg('다른 이름으로 저장'), combos: [ctrl('s', true)], scope: 'always' },
  { id: 'pdf', group: G.file, description: msg('PDF 내보내기'), combos: [ctrl('p')], scope: 'always' },

  { id: 'undo', group: G.edit, description: msg('실행 취소'), combos: [ctrl('z')], scope: 'app' },
  { id: 'redo', group: G.edit, description: msg('다시 실행'), combos: [ctrl('y')], scope: 'app' },
  { id: 'copy', group: G.edit, description: msg('복사'), combos: [ctrl('c')], scope: 'diagram' },
  { id: 'cut', group: G.edit, description: msg('잘라내기'), combos: [ctrl('x')], scope: 'diagram' },
  { id: 'paste', group: G.edit, description: msg('붙여넣기 (마우스 위치)'), combos: [ctrl('v')], scope: 'diagram' },
  { id: 'selectAll', group: G.edit, description: msg('전체 선택'), combos: [ctrl('a')], scope: 'diagram' },
  { id: 'textBox', group: G.edit, description: msg('글 상자 추가 (화면 가운데)'), combos: [plain('t')], scope: 'diagram' },
  { id: 'search', group: G.edit, description: msg('부품·신호 찾기 (모든 배선도)'), combos: [ctrl('f')], scope: 'app' },

  { id: 'selectMode', group: G.mode, description: msg('선택 모드 (고르기·옮기기)'), combos: [plain('v')], scope: 'diagram' },
  { id: 'wireMode', group: G.mode, description: msg('배선 모드 (잇기·분기)'), combos: [plain('w')], scope: 'diagram' },
  { id: 'escape', group: G.mode, description: msg('그리기 취소 → 한 번 더 누르면 선택 모드'), combos: [{ key: 'escape' }], scope: 'app' },
  // wireBack이 delete보다 먼저: 전선을 그리는 중이면 Backspace는 꺾임점 취소
  { id: 'wireBack', group: G.mode, description: msg('그리는 중: 마지막 꺾임점 취소'), combos: [plain('backspace')], scope: 'diagram' },
  { id: 'delete', group: G.edit, description: msg('선택한 것 삭제'), combos: [plain('delete'), plain('backspace')], scope: 'diagram' },

  { id: 'rotate', group: G.part, description: msg('시계 방향 90° 회전'), combos: [plain('r')], scope: 'diagram' },
  { id: 'rotateBack', group: G.part, description: msg('반시계 방향 90° 회전'), combos: [plain('r', true)], scope: 'diagram' },
  { id: 'flipH', group: G.part, description: msg('좌우 반전'), combos: [plain('f')], scope: 'diagram' },
  { id: 'flipV', group: G.part, description: msg('상하 반전'), combos: [plain('f', true)], scope: 'diagram' },
  { id: 'grow', group: G.part, description: msg('부품·글 상자 크게'), combos: [plain(']')], scope: 'diagram' },
  { id: 'shrink', group: G.part, description: msg('부품·글 상자 작게'), combos: [plain('[')], scope: 'diagram' },

  { id: 'zoom100', group: G.view, description: msg('배율 100%'), combos: [ctrl('0')], scope: 'diagram' },
  {
    id: 'zoomIn',
    group: G.view,
    description: msg('확대'),
    combos: [{ key: '=', ctrl: true }, { key: '+', ctrl: true, alias: true }, { code: 'NumpadAdd' }],
    scope: 'diagram'
  },
  {
    id: 'zoomOut',
    group: G.view,
    description: msg('축소'),
    combos: [{ key: '-', ctrl: true }, { key: '_', ctrl: true, alias: true }, { code: 'NumpadSubtract' }],
    scope: 'diagram'
  },
  { id: 'fit', group: G.view, description: msg('전체 보기'), combos: [{ key: 'home' }], scope: 'diagram' },

  { id: 'help', group: G.help, description: msg('이 도움말'), combos: [{ key: '?' }, { key: 'f1' }], scope: 'app' }
]

/** 도움말에 보일 마우스 조작 */
export const MOUSE_HELP: readonly { gesture: string; description: string }[] = [
  { gesture: msg('휠'), description: msg('확대/축소 (마우스 위치 기준)') },
  { gesture: msg('휠 버튼 드래그 · Space+드래그'), description: msg('화면 이동') },
  { gesture: msg('빈 곳 드래그'), description: msg('여러 개 선택 (선택 모드)') },
  { gesture: msg('Ctrl/Shift+클릭'), description: msg('선택에 추가·빼기') },
  { gesture: msg('부품·접속점 드래그'), description: msg('옮기기 (선택 모드)') },
  { gesture: msg('핀 클릭 → 핀 클릭'), description: msg('전선 잇기 (배선 모드, 빈 곳 클릭 = 꺾기)') },
  { gesture: msg('전선 클릭 · 끌어서 핀에 놓기'), description: msg('분기 (배선 모드)') },
  { gesture: msg('선택한 전선 더블클릭'), description: msg('꺾임점 추가 (손잡이 끌기 = 이동, 손잡이 더블클릭 = 삭제)') },
  { gesture: msg('부품함의 부품 → 캔버스로 끌기'), description: msg('부품 배치') },
  { gesture: msg('글 상자 두 번 누르기'), description: msg('글 고치기 (Ctrl+Enter 적용, Esc 취소)') },
  { gesture: msg('Alt 누르고 끌기'), description: msg('격자 맞춤을 잠시 반대로') },
  { gesture: msg('모서리 손잡이 끌기'), description: msg('크기 바꾸기 (선택한 부품·글 상자 하나)') }
]

/** 키 이벤트가 조합과 맞는지. Alt가 눌렸으면 어떤 단축키도 아니다 */
export function matchCombo(
  e: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  c: Combo
): boolean {
  if (e.altKey) return false
  if ((e.ctrlKey || e.metaKey) !== !!c.ctrl) return false
  if (c.shift !== undefined && e.shiftKey !== c.shift) return false
  if (c.code !== undefined) return e.code === c.code
  return c.key !== undefined && e.key.toLowerCase() === c.key
}

const KEY_LABEL: Record<string, string> = {
  escape: 'Esc',
  delete: 'Delete',
  backspace: 'Backspace',
  home: 'Home',
  f1: 'F1',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −'
}

/** 표시용: "Ctrl+Shift+S", "Num +" */
export function formatCombo(c: Combo): string {
  const name = c.code ? KEY_LABEL[c.code] ?? c.code : KEY_LABEL[c.key ?? ''] ?? (c.key ?? '').toUpperCase()
  return [c.ctrl ? 'Ctrl' : '', c.shift ? 'Shift' : '', name].filter(Boolean).join('+')
}
