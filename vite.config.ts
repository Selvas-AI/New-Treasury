import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // GitHub Pages: https://selvas-ai.github.io/New-Treasury/
  base: '/New-Treasury/',
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
