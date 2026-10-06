import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import geoApi from './server/vitePlugin.js'

// https://vite.dev/config/
// GitHub Pages serves the build under /<repo>/; dev stays at /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.VITE_BASE_PATH || '/b2b-geo-pipeline/' : '/',
  plugins: [
    react(),
    // Local Excel-backed backend at /api (see server/). Replaced by Apps Script later.
    geoApi(),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    // data/*.xlsx is rewritten on every save — don't treat it as a source change.
    watch: { ignored: ['**/data/**'] },
  },
}));
