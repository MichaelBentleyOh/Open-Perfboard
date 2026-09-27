// 파일 메뉴 명령: 새로 만들기, 열기, 저장, 내보내기.
// 흐름: core로 직렬화/검증 → window.api로 파일 I/O → 스토어 갱신
import type { PartDef, Project } from '@core/model'
import { emptyProject } from '@core/ops'
import { parseProjectFile, serializeProject } from '@core/serialize'
import { carriedParts, embedLibrary, importSummary, planImport } from '@core/library'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { attachmentIdsOf } from '@core/attachment'
import { collectAttachmentData, putAttachmentData } from '@/services/attachmentService'
import { toCsv } from '@core/csv'
import { bomCsv, bomXlsx, buildBom } from '@core/bom'
import { NETLIST_COLUMNS, buildNetlist } from '@core/netlist'
import { useProjectStore } from '@/stores/projectStore'
import { documentName, isDirtyNow, useDocumentStore } from '@/stores/documentStore'
import { WIRE_COLORS, useUiStore } from '@/stores/uiStore'
import { buildReportHtml, type PaperSize } from '@core/report'
import { exportCanvasPng } from '@/features/canvas/canvasExport'
import { t, useLocaleStore } from '@/i18n'

/** main이 읽어 준 파일 (파일 연결·최근 파일). 읽지 못했으면 error */
export type OpenFilePayload = Awaited<ReturnType<Window['api']['recent']['open']>>

const notify = (m: string) => useUiStore.getState().notify(m)
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 저장하지 않은 변경이 있으면 버려도 되는지 묻는다 */
function confirmDiscard(): boolean {
  return !isDirtyNow() || window.confirm(t('저장하지 않은 변경 내용이 있습니다.\n버리고 계속할까요?'))
}

function load(project: Project, filePath: string | null): void {
  useProjectStore.getState().reset(project)
  useDocumentStore.getState().markSaved(project, filePath)
  const ui = useUiStore.getState()
  ui.clearSelection()
  ui.setWireStart(null)
}

/** 입력 중인 칸의 값을 반영시킨다 (속성 패널은 포커스가 빠질 때 반영) */
function commitPendingInput(): void {
  const el = document.activeElement
  if (el instanceof HTMLElement) el.blur()
}

export function newDocument(): void {
  if (!confirmDiscard()) return
  load(emptyProject(t('새 배선도')), null)
}

export async function openDocument(): Promise<void> {
  if (!confirmDiscard()) return
  try {
    const file = await window.api.project.open()
    if (file) await openContent(file.path, file.content)
  } catch (e) {
    window.alert(`${t('파일을 열 수 없습니다.')}\n${errorText(e)}`)
  }
}

/** 읽은 배선도 파일 내용을 연다 (열기 대화상자·최근 파일·파일 연결 공통) */
async function openContent(path: string, content: string): Promise<void> {
  const r = parseProjectFile(content, t)
  if (!r.ok) {
    const more = r.errors.length > 5 ? `\n${t('… 외 {n}건', { n: r.errors.length - 5 })}` : ''
    window.alert(`${t('파일을 열 수 없습니다.')}\n\n${r.errors.slice(0, 5).join('\n')}${more}`)
    return
  }
  load(r.value.project, path)
  // 함께 저장된 첨부 본문 → 이 PC의 첨부 폴더 (배선도의 데이터시트를 바로 볼 수 있게)
  await putAttachmentData(r.value.attachmentData)
  offerCarriedParts(carriedParts(r.value), path)
}

/** 파일 연결(.opb 더블클릭)로 받은 파일을 연다 */
export async function openFilePayload(file: OpenFilePayload): Promise<void> {
  if ('error' in file) {
    window.alert(`${t('파일을 열 수 없습니다.')}\n${file.path}\n${file.error}`)
    return
  }
  if (!confirmDiscard()) return
  try {
    await openContent(file.path, file.content)
  } catch (e) {
    window.alert(`${t('파일을 열 수 없습니다.')}\n${errorText(e)}`)
  }
}

/** 최근 파일 열기. 없어진 파일이면 목록에서 뺀다 */
export async function openRecent(path: string): Promise<void> {
  if (!confirmDiscard()) return
  try {
    const file = await window.api.recent.open(path)
    if ('error' in file) {
      await window.api.recent.remove(path)
      notify(t('파일을 찾을 수 없어 최근 목록에서 뺐습니다: {name}', { name: documentName(path) }))
      return
    }
    await openContent(file.path, file.content)
  } catch (e) {
    window.alert(`${t('파일을 열 수 없습니다.')}\n${errorText(e)}`)
  }
}

/** 복구 사본을 연다: 원래 경로는 그대로, 상태는 "저장 안 됨". 열었으면 true */
export async function openRecovered(id: string): Promise<boolean> {
  try {
    const { meta, content } = await window.api.recovery.take(id)
    const r = parseProjectFile(content, t)
    if (!r.ok) {
      window.alert(`${t('복구 사본을 열 수 없습니다.')}\n${r.errors.slice(0, 5).join('\n')}`)
      return false
    }
    useProjectStore.getState().reset(r.value.project)
    useDocumentStore.getState().markRecovered(meta.filePath)
    const ui = useUiStore.getState()
    ui.clearSelection()
    ui.setWireStart(null)
    return true
  } catch (e) {
    window.alert(`${t('복구 사본을 열 수 없습니다.')}\n${errorText(e)}`)
    return false
  }
}

/**
 * 배선도에 함께 저장된 부품 중 내 라이브러리에 없거나 내용이 다른 것이 있으면 가져오기 대화상자를 연다.
 * 다른 PC에서 만든 배선도를 열었을 때 그 사람의 부품 라이브러리를 받아 쓰게 한다.
 */
function offerCarriedParts(parts: PartDef[], filePath: string): void {
  const plan = planImport(useLibraryStore.getState().parts, parts)
  const s = importSummary(plan)
  if (s.new + s.changed === 0) return
  useUiStore.getState().setImportRequest({
    files: [filePath.split(/[\\/]/).pop() ?? filePath],
    plan,
    problems: [],
    note: t('이 배선도에 함께 저장된 부품 중 내 부품함에 없는 부품이 있습니다. 가져올까요?')
  })
}

/** 저장에 성공하면 true. saveAs면 항상 경로를 묻는다 */
export async function saveDocument(saveAs = false): Promise<boolean> {
  commitPendingInput()
  const project = useProjectStore.getState().project
  const { filePath } = useDocumentStore.getState()
  const name = documentName(filePath)
  try {
    // 내 부품 라이브러리 전체를 함께 넣는다 → 다른 PC에서 열어도 부품을 가져올 수 있다
    const library = embedLibrary(project, useLibraryStore.getState().parts)
    // 설정이 켜져 있으면 첨부 본문도 (배선도의 부품 + 함께 넣는 라이브러리 부품)
    const data = useSettingsStore.getState().embedAttachments
      ? await collectAttachmentData(attachmentIdsOf([...Object.values(project.parts), ...library]))
      : {}
    const content = serializeProject({ ...project, name }, library, data)
    const saved = await window.api.project.save(saveAs ? null : filePath, content, name)
    if (!saved) return false
    // 새 이름으로 저장했으면 파일 안의 문서 이름도 맞춘다 (경로는 저장 대화상자에서 정해진다)
    const finalName = documentName(saved)
    if (finalName !== name) {
      await window.api.project.save(saved, serializeProject({ ...project, name: finalName }, library, data), finalName)
    }
    useDocumentStore.getState().markSaved(project, saved)
    notify(t('저장했습니다: {name}', { name: documentName(saved) }))
    return true
  } catch (e) {
    window.alert(`${t('저장하지 못했습니다.')}\n${errorText(e)}`)
    return false
  }
}

async function exportFile(kind: 'csv' | 'xlsx' | 'png', suffix: string, data: string | Uint8Array): Promise<void> {
  const name = `${documentName(useDocumentStore.getState().filePath)}-${suffix}`
  try {
    const saved = await window.api.export.save(kind, name, data)
    if (saved) notify(t('내보냈습니다: {name}', { name: saved.split(/[\\/]/).pop() ?? '' }))
  } catch (e) {
    window.alert(`${t('내보내지 못했습니다.')}\n${errorText(e)}`)
  }
}

export function exportBomCsv(): Promise<void> {
  const project = useProjectStore.getState().project
  return exportFile('csv', 'BOM', bomCsv(buildBom(project), t))
}

/** BOM 엑셀: 금액·합계가 수식이라 엑셀에서 고치면 다시 계산된다 */
export function exportBomXlsx(): Promise<void> {
  const project = useProjectStore.getState().project
  return exportFile('xlsx', 'BOM', bomXlsx(buildBom(project), t))
}

export function exportNetlistCsv(): Promise<void> {
  const project = useProjectStore.getState().project
  return exportFile('csv', t('결선표'), toCsv(buildNetlist(project), NETLIST_COLUMNS, t))
}

export async function exportPng(): Promise<void> {
  const url = await exportCanvasPng()
  if (!url) {
    notify(t('내보낼 부품이 없습니다'))
    return
  }
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  await exportFile('png', t('배선도'), bytes)
}

export interface PdfSettings {
  title: string
  author: string
  notes: string
  paper: PaperSize
  landscape: boolean
  include: { diagram: boolean; bom: boolean; netlist: boolean }
}

const colorName = (hex: string) => {
  const name = WIRE_COLORS.find((c) => c.value === hex)?.name
  return name ? t(name) : hex
}

/** 배선도·BOM·결선표를 PDF 한 파일로. 작성자·비고는 문서에 저장된다 (실행 취소 가능) */
export async function exportPdf(s: PdfSettings): Promise<boolean> {
  const store = useProjectStore.getState()
  const meta = store.project.meta ?? {}
  if ((meta.author ?? '') !== s.author.trim() || (meta.notes ?? '') !== s.notes.trim()) {
    store.setMeta({ author: s.author, notes: s.notes })
  }
  const project = useProjectStore.getState().project
  let diagramPng: string | undefined
  if (s.include.diagram) {
    diagramPng = (await exportCanvasPng()) ?? undefined
    if (!diagramPng && project.instances.length > 0) {
      window.alert(t('배선도 이미지를 만들지 못했습니다.'))
      return false
    }
  }
  const { filePath } = useDocumentStore.getState()
  const html = buildReportHtml({
    title: s.title.trim() || documentName(filePath),
    author: s.author.trim() || undefined,
    notes: s.notes,
    date: new Date().toLocaleDateString(useLocaleStore.getState().locale === 'en' ? 'en-US' : 'ko-KR'),
    fileName: filePath ? filePath.split(/[\/]/).pop() : undefined,
    paper: s.paper,
    landscape: s.landscape,
    diagramPng,
    bom: s.include.bom ? buildBom(project) : undefined,
    netlist: s.include.netlist ? buildNetlist(project) : undefined,
    counts: { parts: project.instances.length, wires: project.wires.length },
    colorName,
    t,
    lang: useLocaleStore.getState().locale
  })
  try {
    const saved = await window.api.export.pdf(html, { pageSize: s.paper, landscape: s.landscape }, s.title.trim() || documentName(filePath))
    if (!saved) return false
    notify(t('PDF로 내보냈습니다: {name}', { name: saved.split(/[\\/]/).pop() ?? '' }))
    return true
  } catch (e) {
    window.alert(`${t('PDF를 만들지 못했습니다.')}\n${errorText(e)}`)
    return false
  }
}
