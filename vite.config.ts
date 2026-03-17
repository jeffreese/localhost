import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:7770',
    },
  },
  resolve: {
    alias: {
      '@shared': '/src/shared',
    },
  },
})
