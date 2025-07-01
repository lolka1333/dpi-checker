import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/dpi-checker/', // замените на название вашего репозитория
  server: {
    port: 3000,
    open: true,
    https: false
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    outDir: 'dist'
  }
})