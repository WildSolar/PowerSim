import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/inter-tight'
import './index.css'
import App from './App.tsx'
import { installCrashHandlers } from './sim/crash'

installCrashHandlers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
