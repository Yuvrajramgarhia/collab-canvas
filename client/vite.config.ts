import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['yjs'] },
  server: {
    port: 5173,
    proxy: {
      '/yjs': { target: 'ws://localhost:1234', ws: true },
      '/api': { target: 'http://localhost:1234' },
    },
  },
})
