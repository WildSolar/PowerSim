import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The build's identity, embedded in every save so a save only ever loads into the exact
// build that wrote it: the git commit, marked "+dirty" when the working tree had changes.
function gameVersion(): string {
  try {
    const hash = execSync('git rev-parse --short HEAD').toString().trim()
    const dirty = execSync('git status --porcelain --untracked-files=no').toString().trim() !== ''
    return dirty ? `${hash}+dirty` : hash
  } catch {
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __GAME_VERSION__: JSON.stringify(gameVersion()),
  },
  // maplibre-gl loads a worker via a relative import.meta.url; Vite's esbuild
  // dependency pre-bundling breaks that resolution, leaving tile parsing stuck.
  // Excluding it from pre-bundling serves it as native ESM instead.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
