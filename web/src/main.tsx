import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles.css'
import { App, THEME_KEY } from './App'

// 保存してあるテーマを最初の描画前に当てる（ちらつき防止）
try {
  const t = localStorage.getItem(THEME_KEY)
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t
} catch {
  // ストレージが使えない環境では OS の設定に従う
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
