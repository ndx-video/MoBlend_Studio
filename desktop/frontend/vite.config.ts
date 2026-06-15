import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // For Wails production builds (embedded assets), use relative paths so
  // /assets/ references resolve correctly from the custom wails:// scheme.
  base: './',
})
