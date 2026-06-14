import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  base: '/New-Treasury/',
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5175,
    strictPort: true,   // 포트 고정 — 5175 점유 시 5176으로 바뀌어 LAN 링크가 깨지는 문제 방지(점유 시 실패)
    host: true,
    // Chrome이 JS 모듈을 캐싱해서 구버전 코드가 실행되는 문제 방지
    headers: { 'Cache-Control': 'no-store' },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})