import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // maplibre-gl loads a worker via a relative import.meta.url; Vite's esbuild
  // dependency pre-bundling breaks that resolution, leaving tile parsing stuck.
  // Excluding it from pre-bundling serves it as native ESM instead.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
