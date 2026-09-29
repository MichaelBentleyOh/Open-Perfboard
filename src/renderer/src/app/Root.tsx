import { useCallback, useEffect, useState } from 'react'
import App from './App'
import { SplashScreen } from '@/features/start/SplashScreen'
import { HomeScreen } from '@/features/start/HomeScreen'
import { RecoveryDialog } from '@/features/recovery/RecoveryDialog'
import { StudioScreen } from '@/features/studio/StudioScreen'
import { useStudioStore } from '@/stores/studioStore'
import { documentName, isDirtyNow, useDocumentStore, useIsDirty } from '@/stores/documentStore'
import { useUiStore } from '@/stores/uiStore'
import { useLocaleStore } from '@/i18n'
import { openFilePayload, saveDocument } from './fileCommands'
import type { RecoveryEntry, StartupResult } from './startup'

/**
 * 화면 전환 (036): 로딩 → 홈 → 배선도.
 * 창 제목·닫기 확인·파일 연결처럼 화면과 상관없이 늘 필요한 일은 여기서 한다.
 */
export default function Root() {
  const screen = useUiStore((s) => s.screen)
  const locale = useLocaleStore((s) => s.locale)
  const name = documentName(useDocumentStore((s) => s.filePath))
  const dirty = useIsDirty()
  // 부품 작업실에서 연 .opblib 파일의 저장 안 한 변경 (037a)
  const studioDirty = useStudioStore((s) => s.dirty)
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([])

  // 창 제목과 main의 닫기 확인에 변경 여부를 알린다
  useEffect(() => {
    document.title = `${dirty ? '* ' : ''}${name} — Open Perfboard`
  }, [dirty, name])
  useEffect(() => window.api.app.setDirty(dirty || studioDirty), [dirty, studioDirty])

  // main의 대화상자(열기·저장·닫기 확인)도 같은 언어로
  useEffect(() => {
    document.documentElement.lang = locale
    window.api.app.setLocale(locale)
  }, [locale])

  // 닫기 확인에서 "저장"을 고른 경우
  useEffect(
    () =>
      window.api.app.onSaveAndClose(async () => {
        // 배선도와 작업실 부품함 파일 중 바뀐 것을 저장하고, 모두 저장됐을 때만 닫는다
        if (isDirtyNow() && !(await saveDocument())) return
        if (useStudioStore.getState().dirty && !(await useStudioStore.getState().saveFile())) return
        window.api.app.closeNow()
      }),
    []
  )

  // 이미 켜져 있을 때 .opb를 더블클릭하면 이 창에서 연다 (열면 배선도 화면으로)
  useEffect(() => window.api.app.onOpenFile((file) => void openFilePayload(file)), [])

  const onStarted = useCallback(async (r: StartupResult) => {
    setRecovery(r.recovery)
    // .opb로 켰으면 홈을 건너뛰고 그 배선도 (여는 데 성공하면 배선도 화면으로 바뀐다)
    if (r.openFile) await openFilePayload(r.openFile)
    if (useUiStore.getState().screen === 'splash') useUiStore.getState().setScreen('home')
  }, [])

  return (
    <>
      {screen === 'splash' && <SplashScreen onDone={onStarted} />}
      {screen === 'home' && <HomeScreen />}
      {screen === 'diagram' && <App />}
      {screen === 'studio' && <StudioScreen />}
      {screen !== 'splash' && recovery.length > 0 && <RecoveryDialog initial={recovery} />}
    </>
  )
}
