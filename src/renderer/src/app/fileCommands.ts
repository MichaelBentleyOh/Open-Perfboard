// 파일 메뉴 명령: 새로 만들기, 열기, 저장, 내보내기.
// 흐름: core로 직렬화/검증 → window.api로 파일 I/O → 스토어 갱신
import type { PartDef, Supply } from '@core/model'
import { renderSchematicPng } from '@/features/schematic/schematicRender'
import { emptyProject } from '@core/ops'
import { serializeProject } from '@core/serialize'
import { embedLibrary, importSummary, planImport } from '@core/library'
import type { ParseResult } from '@core/serialize'
import { buildScopedBom, buildScopedNetlist, netlistColumns, parseDocumentText, parseWorkspaceZip, serializeWorkspaceZip, type OpenedDocument } from '@core/workspace'
import { currentSheets, scopedSheets, useWorkspaceStore } from '@/stores/workspaceStore'
import { workspaceMeta } from './autosave'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSupplyStore } from '@/stores/supplyStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { attachmentIdsOf } from '@core/attachment'
import { collectAttachmentData, putAttachmentData } from '@/services/attachmentService'
import { toCsv } from '@core/csv'
import { bomCsv, bomXlsx } from '@core/bom'
import { projectCurrency } from '@core/money'
import { useProjectStore } from '@/stores/projectStore'
import { documentName, isBundle, isDirtyNow, useDocumentStore } from '@/stores/documentStore'
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

function load(doc: Pick<OpenedDocument, 'projects' | 'active' | 'scope'>, filePath: string | null): void {
  useWorkspaceStore.getState().load(doc.projects, doc.active, doc.scope)
  useDocumentStore.getState().markSaved(filePath)
  // 어디서 열었든(홈·파일 메뉴·파일 연결) 연 배선도를 보여 준다 (036)
  useUiStore.getState().setScreen('diagram')
}

/** 파일 내용(.opb 문자열 또는 .zip 바이트)을 읽는다 */
function parseContent(content: string | Uint8Array): ParseResult<OpenedDocument> {
  return typeof content === 'string' ? parseDocumentText(content, t) : parseWorkspaceZip(content, t)
}

/** 입력 중인 칸의 값을 반영시킨다 (속성 패널은 포커스가 빠질 때 반영) */
function commitPendingInput(): void {
  const el = document.activeElement
  if (el instanceof HTMLElement) el.blur()
}

export function newDocument(): void {
  if (!confirmDiscard()) return
  load({ projects: [emptyProject(t('배선도 1'))], active: 0 }, null)
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
async function openContent(path: string, content: string | Uint8Array): Promise<void> {
  const r = parseContent(content)
  if (!r.ok) {
    const more = r.errors.length > 5 ? `\n${t('… 외 {n}건', { n: r.errors.length - 5 })}` : ''
    window.alert(`${t('파일을 열 수 없습니다.')}\n\n${r.errors.slice(0, 5).join('\n')}${more}`)
    return
  }
  load(r.value, path)
  // 함께 저장된 첨부 본문 → 이 PC의 첨부 폴더 (배선도의 데이터시트를 바로 볼 수 있게)
  await putAttachmentData(r.value.attachmentData)
  const supplies = [...r.value.supplies, ...r.value.projects.flatMap((p) => Object.values(p.supplies ?? {}))]
  offerCarriedParts(r.value.library, path, supplies)
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
    const r = parseDocumentText(content, t)
    if (!r.ok) {
      window.alert(`${t('복구 사본을 열 수 없습니다.')}\n${r.errors.slice(0, 5).join('\n')}`)
      return false
    }
    useWorkspaceStore.getState().load(r.value.projects, r.value.active, r.value.scope)
    useDocumentStore.getState().markRecovered(meta.filePath)
    useUiStore.getState().setScreen('diagram')
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
function offerCarriedParts(parts: PartDef[], filePath: string, supplies: Supply[] = []): void {
  const plan = planImport(useLibraryStore.getState().parts, parts)
  const supplyPlan = planImport(useSupplyStore.getState().supplies, supplies)
  const s = importSummary(plan)
  const ss = importSummary(supplyPlan)
  if (s.new + s.changed + ss.new + ss.changed === 0) return
  useUiStore.getState().setImportRequest({
    files: [filePath.split(/[\\/]/).pop() ?? filePath],
    plan,
    supplyPlan,
    problems: [],
    note: t('이 배선도에 함께 저장된 부품 중 내 부품함에 없는 부품이 있습니다. 가져올까요?')
  })
}

/**
 * 저장에 성공하면 true. saveAs면 항상 경로를 묻는다.
 * 배선도가 하나면 .opb, 여럿이면(또는 이미 .zip이면) .zip 묶음 (030). .opb였는데 배선도가 늘었으면 .zip 경로를 새로 묻는다
 */
export async function saveDocument(saveAs = false): Promise<boolean> {
  commitPendingInput()
  const meta = workspaceMeta()
  const { filePath } = useDocumentStore.getState()
  const name = documentName(filePath)
  const bundle = isBundle(filePath, meta.projects.length)
  const askPath = saveAs || (bundle && !!filePath && !/\.zip$/i.test(filePath))
  try {
    const parts = meta.projects.flatMap((p) => Object.values(p.parts))
    // 설정이 켜져 있으면 첨부 본문도 (배선도의 부품 + 함께 넣는 라이브러리 부품)
    const withData = useSettingsStore.getState().embedAttachments
    let content: string | Uint8Array
    if (bundle) {
      // 부품함·부속 부품·첨부는 묶음 안 library.opblib 하나에
      const library = useLibraryStore.getState().parts
      const data = withData ? await collectAttachmentData(attachmentIdsOf([...parts, ...library])) : {}
      content = serializeWorkspaceZip(meta.projects, meta, { library, supplies: useSupplyStore.getState().supplies, attachmentData: data })
    } else {
      // 내 부품 라이브러리 전체를 함께 넣는다 → 다른 PC에서 열어도 부품을 가져올 수 있다
      const project = meta.projects[0]
      const library = embedLibrary(project, useLibraryStore.getState().parts)
      const data = withData ? await collectAttachmentData(attachmentIdsOf([...parts, ...library])) : {}
      content = serializeProject(project, library, data)
    }
    const saved = await window.api.project.save(askPath ? null : filePath, content, name)
    if (!saved) return false
    useDocumentStore.getState().markSaved(saved)
    notify(t('저장했습니다: {name}', { name: saved.split(/[\\/]/).pop() ?? '' }))
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

/** BOM·결선표 범위의 배선도 (030) */
const inScope = () => scopedSheets(currentSheets(), useWorkspaceStore.getState().scope)

export function exportBomCsv(): Promise<void> {
  return exportFile('csv', 'BOM', bomCsv(buildScopedBom(inScope()), t))
}

/** BOM 엑셀: 금액·합계가 수식이라 엑셀에서 고치면 다시 계산된다 */
export function exportBomXlsx(): Promise<void> {
  const project = useProjectStore.getState().project
  return exportFile('xlsx', 'BOM', bomXlsx(buildScopedBom(inScope()), t, projectCurrency(project)))
}

export function exportNetlistCsv(): Promise<void> {
  const sheets = inScope()
  return exportFile('csv', t('결선표'), toCsv(buildScopedNetlist(sheets), netlistColumns(sheets.length > 1), t))
}

export async function exportPng(): Promise<void> {
  const url = await exportCanvasPng()
  if (!url) {
    notify(t('내보낼 부품이 없습니다'))
    return
  }
  await exportFile('png', t('배선도'), dataUrlBytes(url))
}

/** 회로도 (039): 회로도 탭을 열지 않았어도 그린다 */
export async function exportSchematicPng(): Promise<void> {
  const url = renderSchematicPng(useProjectStore.getState().project)
  if (!url) {
    notify(t('내보낼 부품이 없습니다'))
    return
  }
  await exportFile('png', t('회로도'), dataUrlBytes(url))
}

const dataUrlBytes = (url: string) => {
  const bin = atob(url.slice(url.indexOf(',') + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export interface PdfSettings {
  title: string
  author: string
  notes: string
  paper: PaperSize
  landscape: boolean
  include: { diagram: boolean; schematic: boolean; bom: boolean; netlist: boolean }
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
    schematicPng: s.include.schematic ? (renderSchematicPng(project) ?? undefined) : undefined,
    bom: s.include.bom ? buildScopedBom(inScope()) : undefined,
    currency: projectCurrency(project),
    netlist: s.include.netlist ? buildScopedNetlist(inScope()) : undefined,
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
