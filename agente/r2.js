// ============================================================================
// GUARDADO DE ARCHIVOS DEL DROPLET → Cloudflare R2
// ----------------------------------------------------------------------------
// Existia dos veces: el bot de Baileys (index.js) sí subia a R2, pero el motor
// de la Cloud API (leads_api.js) guardaba DIRECTO en Supabase Storage — nadie lo
// noto hasta que el bucket de Supabase llego al 83% de su GB gratis. Por eso la
// logica vive aca una sola vez: el que suba archivos usa esto y no se puede
// "olvidar" de R2.
//
// .env del droplet: R2_WORKER, R2_BOT_SECRET, R2_PUBLIC_URL
// ============================================================================
const R2_WORKER = (process.env.R2_WORKER || '').replace(/\/$/, '')
const R2_BOT_SECRET = process.env.R2_BOT_SECRET || ''
const R2_PUBLIC = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')

const urlR2 = ruta => R2_PUBLIC + '/' + ruta.split('/').map(encodeURIComponent).join('/')

// ¿esta configurado? si no, ni se intenta (y quien llama sabe que va a Supabase)
const r2Listo = () => !!(R2_WORKER && R2_BOT_SECRET)

// Devuelve la URL publica si el archivo YA esta en R2. Sirve de deduplicacion:
// las rutas del bot llevan la huella sha256 del contenido, asi que el mismo
// archivo nunca se sube dos veces.
async function yaEnR2(ruta) {
  if (!R2_PUBLIC) return null
  try {
    const r = await fetch(urlR2(ruta), { method: 'HEAD' })
    return r.ok ? urlR2(ruta) : null
  } catch { return null }
}

// Sube por el Worker (que valida la clave del bot). Devuelve la URL o null si no
// se pudo: quien llama decide el respaldo. NUNCA lanza.
async function subirAR2(ruta, buffer, mime, log = () => {}) {
  const ya = await yaEnR2(ruta)
  if (ya) return ya
  if (!r2Listo()) return null
  try {
    const fd = new FormData()
    fd.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), ruta.split('/').pop())
    fd.append('ruta', ruta)
    const r = await fetch(R2_WORKER + '/subir', { method: 'POST', headers: { 'X-Urbis-Bot': R2_BOT_SECRET }, body: fd })
    if (r.ok) return (await r.json()).url
    log('R2 respondio ' + r.status)
    return null
  } catch (e) {
    log('R2 no disponible (' + String(e.message || e) + ')')
    return null
  }
}

module.exports = { subirAR2, yaEnR2, urlR2, r2Listo }
