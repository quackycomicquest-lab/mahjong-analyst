import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setupViewport } from './viewport'

// iPhone は開いた時から横画面（縦持ちなら画面ごと回す）
setupViewport()

// オフライン対応：本番ビルドでのみ Service Worker を登録する（開発中はキャッシュで混乱しないよう登録しない）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* 登録できなくても通常どおり使える */
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
