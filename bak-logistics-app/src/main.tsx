import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Reload once when a newly deployed service worker takes control — otherwise
// the open tab keeps running the old precached bundle until a manual refresh.
// Guarded so the first-ever install (null -> worker) does not reload.
if ('serviceWorker' in navigator) {
  let hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true
      return
    }
    window.location.reload()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
