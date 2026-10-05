import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Root from './app/Root'
import './styles.css'

// window.confirm/alert는 main의 메시지 상자로 띄운다. Windows에서 렌더러 자체 대화상자가 닫힌 뒤
// 입력칸에 글이 안 써지는 일이 있어서다 (창을 다른 곳에 눌렀다 와야 풀림). 부르는 쪽은 그대로 쓴다
// 파일 고르기·색 고르기(OS 대화상자)가 닫힌 뒤에도 같은 일이 있어, 닫히면 포커스를 돌려받는다
if (window.api?.dialog) {
  window.confirm = (message?: string) => window.api.dialog.confirm(String(message ?? ''))
  window.alert = (message?: unknown) => window.api.dialog.alert(String(message ?? ''))
  const afterOsDialog = (e: Event) => {
    const el = e.target
    if (el instanceof HTMLInputElement && (el.type === 'file' || el.type === 'color')) setTimeout(() => window.api.dialog.refocus(), 0)
  }
  document.addEventListener('change', afterOsDialog, true)
  // 파일 고르기를 취소하면 change 대신 cancel
  document.addEventListener('cancel', afterOsDialog, true)
}

// #root 안의 정적 로딩 화면(index.html)은 React가 그리면서 같은 모양의 SplashScreen으로 바뀐다
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
