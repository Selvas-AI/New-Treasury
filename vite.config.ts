import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // 커스텀 도메인 루트 서빙: https://treasury.selvas.com/
  // (과거 https://selvas-ai.github.io/New-Treasury/ 경로는 base '/New-Treasury/' 였음)
  base: '/',
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5175,
    strictPort: true,
    host: true,
    headers: { 'Cache-Control': 'no-store' },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
