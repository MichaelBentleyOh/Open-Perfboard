import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import type { PartDef, Project } from '../../src/core/model'
import { serializePart } from '../../src/core/serialize'

/** 실제 사용자 데이터를 건드리지 않도록 임시 폴더를 만든다 */
export function makeTempDir(prefix = 'opb-e2e-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}
export const makeUserDataDir = () => makeTempDir()

/**
 * 빌드된 앱(out/)을 지정한 userData로 실행한다.
 * 닫기 확인은 기본으로 "저장 안 함", 렌더러의 confirm은 "확인"으로 자동 응답해 테스트가 멈추지 않게 한다.
 */
/**
 * 앱 실행 명령. 보통은 빌드 결과(out/)를 electron으로, OPB_E2E_EXE가 있으면 설치 파일과 같은 포장된 앱(win-unpacked)으로
 * (npm run test:packaged)
 */
export function appCommand(args: string[] = []): { executablePath?: string; command: string; args: string[] } {
  const exe = process.env['OPB_E2E_EXE']
  if (exe) return { executablePath: exe, command: exe, args }
  return { command: electronPath as unknown as string, args: ['.', ...args] }
}

export async function launchApp(userData: string, o: { args?: string[]; env?: Record<string, string> } = {}) {
  const { executablePath, args } = appCommand(o.args)
  const app = await electron.launch({ executablePath, args, env: { ...process.env, OPB_USER_DATA: userData, ...o.env } })
  await stubDialogs(app, { messageBox: 1 })
  const win = await app.firstWindow()
  // confirm/alert는 위 stub(main의 showMessageBox)이 처리한다.
  // 리스너가 없으면 Playwright가 직접 닫으려다 실패하므로 빈 리스너를 둔다.
  win.on('dialog', () => {})
  return { app, win }
}

/** main 프로세스의 네이티브 대화상자를 자동 응답으로 바꾼다 */
export async function stubDialogs(
  app: ElectronApplication,
  o: { save?: string; open?: string; messageBox?: number }
): Promise<void> {
  await app.evaluate(({ dialog }, o) => {
    if (o.save !== undefined) {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: o.save })) as typeof dialog.showSaveDialog
    }
    if (o.open !== undefined) {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [o.open] })) as typeof dialog.showOpenDialog
    }
    if (o.messageBox !== undefined) {
      // 렌더러의 confirm/alert도 내부적으로 showMessageBox를 쓴다 → 닫기 확인(저장 안 함 버튼)에만 지정한 응답,
      // 나머지(confirm 등)는 "확인"(0)으로 응답한다
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const opts = args.find((a): a is { buttons?: string[] } => !!a && typeof a === 'object' && 'message' in a)
        const isCloseGuard = opts?.buttons?.some((b) => b === '저장 안 함' || b === "Don't Save") ?? false
        return { response: isCloseGuard ? o.messageBox : 0, checkboxChecked: false }
      }) as typeof dialog.showMessageBox
    }
  }, o)
}

/** 핀 2개(J1.1 VCC, J1.2 GND)짜리 테스트 부품을 라이브러리 폴더에 미리 넣는다 (id를 바꾸면 다른 부품으로 추가) */
export function seedLibrary(userData: string, overrides: Partial<PartDef> = {}): void {
  const photo = readFileSync(join(__dirname, '../fixtures/part-photo.png')).toString('base64')
  const part: PartDef = {
    id: 'test-mcu',
    name: '테스트 MCU',
    partNumber: 'TM-01',
    image: { data: `data:image/png;base64,${photo}`, width: 256, height: 256 },
    connectors: [{ id: 'j1', name: 'J1', type: 'JST-XH 2P' }],
    pins: [
      { id: 'a', number: '1', signal: 'VCC', connectorId: 'j1', x: 0.2, y: 0.5 },
      { id: 'b', number: '2', signal: 'GND', connectorId: 'j1', x: 0.8, y: 0.5 }
    ],
    ...overrides
  }
  mkdirSync(join(userData, 'library'), { recursive: true })
  writeFileSync(join(userData, 'library', `${part.id}.json`), serializePart(part))
}

/** 라이브러리 항목을 캔버스의 화면 좌표에 떨어뜨린다 (HTML5 드래그 이벤트) */
export async function dropPart(win: Page, name: string, x: number, y: number) {
  await win.evaluate(
    ({ name, x, y }) => {
      const item = [...document.querySelectorAll('.part-item')].find((li) => li.textContent?.includes(name))!
      const target = document.querySelector('[data-testid=diagram-canvas]')!
      const dataTransfer = new DataTransfer()
      item.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
      const at = { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y }
      target.dispatchEvent(new DragEvent('dragover', at))
      target.dispatchEvent(new DragEvent('drop', at))
    },
    { name, x, y }
  )
}

/**
 * 화면이 한 번 다시 그려질 때까지 기다린다.
 * Konva는 새로 그린 도형을 다음 프레임에 클릭 판정에 넣는다 → 방금 만든 도형을 바로 누를 때 필요
 */
export const nextFrame = (win: Page) =>
  win.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

export const getProject = (win: Page): Promise<Project> => win.evaluate(() => window.__opbCanvas!.getProject())

/** 툴바에서 모드를 고른다 (선택 모드는 선택을 유지한다) */
export async function setMode(win: Page, mode: 'select' | 'wire') {
  await win.getByRole('group', { name: '모드' }).getByRole('button', { name: mode === 'select' ? '↖ 선택' : '✎ 배선' }).click()
  await nextFrame(win) // 모드에 따라 핀·부품의 클릭 판정이 바뀐다 (다음 프레임에 반영)
}

/** 핀 클릭 = 배선 시작/끝. 배선 모드가 아니면 먼저 배선 모드로 바꾼다 */
export async function clickPin(win: Page, instanceId: string, pinId: string) {
  const wiring = await win.getByRole('button', { name: '✎ 배선' }).getAttribute('aria-pressed')
  if (wiring !== 'true') await setMode(win, 'wire')
  const p = await win.evaluate(([i, p]) => window.__opbCanvas!.pinClientPosition(i, p), [instanceId, pinId])
  expect(p).not.toBeNull()
  await win.mouse.click(p!.x, p!.y)
}

/** 테스트 MCU 두 개를 놓고 U1.J1.2 → U2.J1.1을 잇는다 */
export async function buildTwoPartDiagram(win: Page) {
  await expect(win.getByTestId('part-list')).toContainText('테스트 MCU')
  const box = (await win.getByTestId('diagram-canvas').boundingBox())!
  await dropPart(win, '테스트 MCU', box.x + box.width * 0.3, box.y + box.height / 2)
  await dropPart(win, '테스트 MCU', box.x + box.width * 0.7, box.y + box.height / 2)
  const [u1, u2] = (await getProject(win)).instances.map((i) => i.id)
  await clickPin(win, u1, 'b')
  await clickPin(win, u2, 'a')
  expect((await getProject(win)).wires).toHaveLength(1)
  await setMode(win, 'select')
  return { u1, u2 }
}
