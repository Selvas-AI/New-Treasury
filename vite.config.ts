import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isProd = process.env.NODE_ENV === 'production'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // 로컬 dev: /New-Treasury/ (기존 LAN 경로 유지)
  // GitHub Pages 빌드: / (upgraded-journey-*.pages.github.io 루트)
  base: isProd ? '/' : '/New-Treasury/',
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
