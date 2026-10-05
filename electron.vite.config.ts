import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Config estándar de electron-vite: separa el build en 3 bloques
// (main = proceso principal de Electron, preload = puente seguro
// hacia el renderer, renderer = la UI en React).
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()]
  }
})
