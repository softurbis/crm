import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// WEB PÚBLICA (propiedades + landing), publicada aparte del panel:
//   npm run build:publico   → dist-publico/
//   npm run preview:publico → la prueba en http://localhost:4174
// Solo entra lo que importa src/publico.jsx: el visitante no descarga el CRM.
// Vite pasa a import.meta.env las variables VITE_* que ya existen al arrancar:
// con esta, lib/supabase.js crea el cliente sin sesión.
process.env.VITE_SOLO_PUBLICO = '1'

export default defineConfig({
  plugins: [react()],
  base: '/',
  // public/ trae documentos internos (presentacion.html, la plantilla Excel):
  // lo único público se copia después (scripts/sitio-publicado.mjs)
  publicDir: false,
  build: {
    outDir: 'dist-publico',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./publico.html', import.meta.url)) },
  },
})
