import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Lokales Dev-Proxy: leitet /api/* an einen lokal laufenden Worker weiter
      // (z. B. `npx wrangler dev worker/travel-conditions.js`).
      // Im Production-Build greift die Pages/Worker-Route.
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
