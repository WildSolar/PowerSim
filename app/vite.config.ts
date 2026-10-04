import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

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

// A build ships only the municipalities public/data/index.json lists (and their par): the
// pipeline may have built many more locally, hundreds of megabytes the playtest doesn't need.
function onlyListedMunicipalities(): Plugin {
  let outDir = 'dist'
  return {
    name: 'only-listed-municipalities',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const dataDir = join(outDir, 'data')
      if (!existsSync(dataDir)) return
      const listed = new Set<string>(
        (JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8')) as { slug: string }[]).map((m) => m.slug),
      )
      for (const file of readdirSync(dataDir)) {
        const slug = file.replace(/\.json$/, '')
        if (file.endsWith('.json') && file !== 'index.json' && !listed.has(slug)) rmSync(join(dataDir, file))
      }
      const parDir = join(dataDir, 'par')
      if (existsSync(parDir)) {
        for (const file of readdirSync(parDir)) if (!listed.has(file.replace(/\.json$/, ''))) rmSync(join(parDir, file))
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Where the game is served from: the site's root by default; a GitHub Pages project site sets
  // BASE_PATH=/<repository>/ (.github/workflows/deploy.yml).
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), onlyListedMunicipalities()],
  // MapLibre's worker is an ES module (src/map/MapView.tsx).
  worker: { format: 'es' },
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
