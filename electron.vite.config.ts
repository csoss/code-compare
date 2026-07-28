import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/main.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('electron/preload.ts') } }
  },
  renderer: {
    root: 'src',
    plugins: [react()],
    resolve: {
      alias: { '@': resolve('src') }
    },
    build: { rollupOptions: { input: resolve('src/index.html') } }
  }
})
