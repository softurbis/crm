import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// PANEL: vive en la raíz de panel.urbisgroupinmobiliaria.com (Cloudflare,
// wrangler.panel.jsonc → npm run build:panel). La web pública se arma aparte
// con vite.publico.config.js. GitHub Pages ya no publica la app (15 sep 2026).
export default defineConfig({
  plugins: [react()],
})
