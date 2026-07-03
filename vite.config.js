import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base '/crm/' solo en produccion (GitHub Pages); en local sigue siendo '/'
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/crm/' : '/',
}))
