import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/inter-tight'
import './index.css'
import App from './App.tsx'
import { installCrashHandlers } from './sim/crash'
import { initAnalytics } from './analytics'
import { sound } from './audio/sound'
import { music } from './audio/music'
import { installClickSounds } from './audio/sfx'

installCrashHandlers()
initAnalytics()
sound.init()
music.init()
installClickSounds()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
