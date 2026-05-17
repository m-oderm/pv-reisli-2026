import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Im Dev leitet Vite /api/* an einen separat laufenden Worker weiter,
      // z. B. via `npx wrangler dev worker/travel-conditions.js`. In Production
      // übernimmt die Worker-Route aus wrangler.jsonc.
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
