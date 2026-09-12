import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { registerServiceWorker } from './lib/pwa'
import { appliedStyleInfo } from './lib/grabber'
import { autoConfigure, isNativeApp } from './lib/portview'
import { installGlobalHandlers } from './lib/bugReport'
import './index.css'

// Phase 5: globale Fehlerfalle + Bug-Report-Export (Banner + Download).
installGlobalHandlers()

registerServiceWorker()

// Importierten UI-Style wieder anwenden (offline – liegt im localStorage) und in
// der nativen App den Server-Port automatisch bestimmen lassen, bevor die ersten
// Netz-Aufrufe abgesetzt werden. Beides darf den Start niemals blockieren.
try {
  appliedStyleInfo()
  if (isNativeApp() && !new URLSearchParams(location.search).has('noportview')) {
    void autoConfigure({ force: false })
  }
} catch {
  /* PortView/Style sind optional */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
