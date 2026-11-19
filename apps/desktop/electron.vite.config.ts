import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    // Workspace packages ship TypeScript sources, so bundle them; sql.js stays external for its wasm.
    build: { externalizeDeps: { exclude: ['@fragmemo/core', '@fragmemo/ui'] } }
  },
  preload: {
    build: { externalizeDeps: { exclude: ['@fragmemo/core', '@fragmemo/ui'] } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()]
  }
})
