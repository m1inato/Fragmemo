import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'electron-vite'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(__filename)

/**
 * Everything the main process loads from disk at runtime ships next to its bundle, so the
 * packaged app needs no node_modules: the sql.js wasm and the kuromoji dictionary.
 */
function runtimeAssets(): Plugin {
  const sqlWasm = join(dirname(require.resolve('sql.js')), 'sql-wasm.wasm')
  const dictDir = join(dirname(require.resolve('kuromoji/package.json')), 'dict')
  return {
    name: 'fragmemo-runtime-assets',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sql-wasm.wasm', source: readFileSync(sqlWasm) })
      for (const f of readdirSync(dictDir)) {
        this.emitFile({ type: 'asset', fileName: `dict/${f}`, source: readFileSync(join(dictDir, f)) })
      }
    }
  }
}

export default defineConfig({
  main: {
    // Bundle every dependency (workspace sources included); only electron and Node builtins stay external.
    build: { externalizeDeps: false },
    plugins: [runtimeAssets()]
  },
  preload: {
    build: { externalizeDeps: false }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()]
  }
})
