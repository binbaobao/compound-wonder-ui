import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {

      '/cwt': {
        target: 'http://127.0.0.1:18818',
        changeOrigin: true
      },
      '/cw': {
        target: 'http://127.0.0.1:18818',
        changeOrigin: true
      },
      '/backtest': {
        target: 'http://127.0.0.1:18818',
        changeOrigin: true
      }
    }
  }
})
