import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installChunkErrorHandler } from './lib/appUpdate'

// 배포 후 남아 있는 옛 탭이 사라진 청크를 요청하면 새로고침 안내를 띄운다.
installChunkErrorHandler()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
