import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Root from './app/Root'
import './styles.css'

// #root 안의 정적 로딩 화면(index.html)은 React가 그리면서 같은 모양의 SplashScreen으로 바뀐다
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
