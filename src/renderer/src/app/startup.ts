// 앱 시작 작업 (036). 시작 화면의 진행 막대가 이 단계 목록을 따라 찬다.
import { msg } from '@core/i18n'
import { useLibraryStore } from '@/stores/libraryStore'
import { useSupplyStore } from '@/stores/supplyStore'
import { useUiStore } from '@/stores/uiStore'
import { startAutosave } from './autosave'

export type RecoveryEntry = Awaited<ReturnType<Window['api']['recovery']['list']>>[number]
export type OpenFile = Awaited<ReturnType<Window['api']['app']['takeOpenFile']>>

export interface StartupResult {
  /** 지난 실행이 남긴 복구 사본 */
  recovery: RecoveryEntry[]
  /** .opb를 더블클릭해 켰으면 그 파일 */
  openFile: OpenFile
}

interface Step {
  label: string
  run: (r: StartupResult) => Promise<void>
}

const STEPS: Step[] = [
  {
    label: msg('설정 읽는 중…'),
    run: async () => {
      const { version, autosaveMs } = await window.api.app.config()
      useUiStore.getState().setAppVersion(version)
      startAutosave(autosaveMs) // 앱이 끝날 때까지 돈다
    }
  },
  { label: msg('부품함 읽는 중…'), run: () => useLibraryStore.getState().load() },
  { label: msg('부속 부품 읽는 중…'), run: () => useSupplyStore.getState().load() },
  {
    label: msg('작업 복구 확인 중…'),
    run: async (r) => {
      r.recovery = await window.api.recovery.list().catch(() => [])
    }
  },
  {
    label: msg('열 파일 확인 중…'),
    run: async (r) => {
      r.openFile = await window.api.app.takeOpenFile()
    }
  }
]

/** 막대의 처음 몫: 화면(번들) 준비는 index.html 단계에서 이미 끝났다 */
export const STARTUP_BASE = 0.1

let running: Promise<StartupResult> | null = null
let report: (label: string | null, progress: number) => void = () => {}
/** 마지막으로 알린 상태: 화면이 다시 붙으면 막대가 뒤로 가지 않게 바로 알려 준다 */
let last: [string | null, number] | null = null

/**
 * 시작 작업을 차례로 한다. onStep(다음 단계 문구, 진행 0~1)을 단계마다 부른다.
 * 한 번만 실행한다 (개발 모드 StrictMode가 화면을 두 번 붙여도 부품함을 두 번 읽거나 자동 저장을 두 번 켜지 않게). 다시 부르면 알림 대상만 바꾼다.
 * 한 단계가 실패해도 앱은 켜져야 하므로 멈추지 않는다 (부품함 오류는 부품함 창이 보여 준다).
 */
export function runStartup(onStep: (label: string | null, progress: number) => void): Promise<StartupResult> {
  report = onStep
  if (last) onStep(...last)
  running ??= run()
  return running
}

function notify(label: string | null, progress: number): void {
  last = [label, progress]
  report(label, progress)
}

async function run(): Promise<StartupResult> {
  const result: StartupResult = { recovery: [], openFile: null }
  for (const [i, step] of STEPS.entries()) {
    notify(step.label, STARTUP_BASE + ((1 - STARTUP_BASE) * i) / STEPS.length)
    try {
      await step.run(result)
    } catch (e) {
      console.error(e)
    }
  }
  notify(null, 1)
  return result
}