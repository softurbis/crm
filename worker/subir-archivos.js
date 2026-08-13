/**
 * WORKER DE SUBIDA A R2 — Urbis Control
 * ---------------------------------------------------------------------------
 * El panel es una web estática (GitHub Pages): no puede guardar las llaves de
 * R2. Este Worker es el intermediario: recibe el archivo, comprueba que quien
 * sube es un usuario con sesión válida del CRM (token de Supabase) y lo guarda
 * en el bucket. Las LECTURAS no pasan por aquí — van directo a la URL pública.
 *
 * Configuración en el panel de Cloudflare (Workers → Settings):
 *   Variables:  SUPABASE_URL, SUPABASE_ANON_KEY, PUBLIC_URL, ORIGENES
 *   Binding R2: nombre BUCKET  →  bucket urbis-files
 */

const cors = origen => ({
  'Access-Control-Allow-Origin': origen,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
})

// Solo se aceptan subidas desde los orígenes autorizados (el panel y pruebas locales).
function origenOk(req, env) {
  const o = req.headers.get('Origin') || ''
  const lista = (env.ORIGENES || 'https://softurbis.github.io,http://localhost:5173').split(',').map(s => s.trim())
  return lista.includes(o) ? o : null
}

// La sesión la valida Supabase: si el token no sirve, no se sube nada.
async function usuarioValido(req, env) {
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return false
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY },
  })
  return r.ok
}

export default {
  async fetch(req, env) {
    const origen = origenOk(req, env)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origen || 'null') })
    if (!origen) return new Response('origen no autorizado', { status: 403 })

    const url = new URL(req.url)
    if (req.method !== 'POST' || url.pathname !== '/subir') {
      return new Response('usa POST /subir', { status: 404, headers: cors(origen) })
    }
    if (!(await usuarioValido(req, env))) {
      return new Response(JSON.stringify({ error: 'sesión inválida' }), { status: 401, headers: { ...cors(origen), 'Content-Type': 'application/json' } })
    }

    try {
      const form = await req.formData()
      const file = form.get('file')
      let ruta = String(form.get('ruta') || '').replace(/^\/+/, '')
      if (!file || typeof file === 'string') return new Response(JSON.stringify({ error: 'falta el archivo' }), { status: 400, headers: { ...cors(origen), 'Content-Type': 'application/json' } })
      // la ruta la arma el panel; se limpia por si acaso (nada de subir un nivel)
      ruta = ruta.split('/').filter(p => p && p !== '.' && p !== '..').join('/')
      if (!ruta) return new Response(JSON.stringify({ error: 'falta la ruta' }), { status: 400, headers: { ...cors(origen), 'Content-Type': 'application/json' } })

      await env.BUCKET.put(ruta, file.stream(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
      })
      const publica = `${env.PUBLIC_URL.replace(/\/$/, '')}/${ruta.split('/').map(encodeURIComponent).join('/')}`
      return new Response(JSON.stringify({ url: publica, ruta }), { headers: { ...cors(origen), 'Content-Type': 'application/json' } })
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500, headers: { ...cors(origen), 'Content-Type': 'application/json' } })
    }
  },
}
