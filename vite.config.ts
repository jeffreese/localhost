import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss()],
  test: {
    env: { NODE_ENV: 'test' },
  },
  server: {
    port: 7770,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:7769',
    },
  },
  resolve: {
    alias: {
      '@shared': '/src/shared',
    },
  },
})
