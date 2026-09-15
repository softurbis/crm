import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en el archivo .env')
}

// La web pública se compila aparte (vite.publico.config.js) y ahí no se guarda
// ni se lee sesión: una página abierta a cualquiera no tiene a su alcance nada
// del personal. El panel sigue igual que siempre.
const soloPublico = import.meta.env.VITE_SOLO_PUBLICO === '1'

export const supabase = createClient(url, key, soloPublico
  ? { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  : undefined)
