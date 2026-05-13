import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, '/api'),
      },
      // Runtime-configurable branding assets served by the backend
      // from DATA_DIR/branding/. In production, FastAPI serves both
      // the built frontend and /branding on the same port, so no
      // proxy is needed there.
      '/branding': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
