// ============================================================================
// NOTAS DE VOZ → TEXTO, con Groq (Whisper)                           [sep 2026]
// ----------------------------------------------------------------------------
// Claude no escucha audio. Cuando un lead del agente de ventas manda una nota de
// voz, se pasa a texto aquí y el agente la lee como si la hubiera escuchado. La
// transcripción queda guardada (whatsapp_messages.transcripcion, sql/93): no se
// vuelve a pagar en cada turno y en el panel se lee lo que dijo el cliente.
//
// .env:  GROQ_API_KEY          (sin ella, el agente pide que le escriban, como antes)
//        GROQ_WHISPER_MODEL    opcional: whisper-large-v3 (por defecto, el más fiel)
//                              o whisper-large-v3-turbo (más rápido y barato)
//
// Se le pasa a Groq la DIRECCIÓN del audio (R2 es público): el servidor no lo
// carga en memoria. En agosto el droplet mató al bot por memoria.
//
// Prueba desde el droplet, sin mandarle nada a nadie:
//   node transcribir.js prueba     transcribe la última nota de voz que llegó
// ============================================================================
require('dotenv').config()

const URL_API = 'https://api.groq.com/openai/v1/audio/transcriptions'
const MODELO = process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3'
// nombres que Whisper escribiría mal sin contexto
const CONTEXTO = 'Conversación por WhatsApp con Urbis Group sobre lotes de terreno en Pucallpa, Ucayali: Las Praderas de Cashibo, Las Brisas de Cashibo, Neshuya, Campo Verde. Manzana, lote, metros cuadrados, inicial, cuotas, soles, separar, visita.'

const disponible = () => !!process.env.GROQ_API_KEY

class ErrorTranscripcion extends Error {
  constructor(msg, status) { super(msg); this.status = status }
}

async function transcribir(urlAudio) {
  if (!disponible()) return null
  const form = new FormData()
  form.append('url', urlAudio)
  form.append('model', MODELO)
  form.append('language', 'es')
  form.append('prompt', CONTEXTO)
  form.append('response_format', 'json')
  form.append('temperature', '0')
  const r = await fetch(URL_API, { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY }, body: form })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const detalle = j?.error?.message || JSON.stringify(j).slice(0, 200)
    if (r.status === 401) throw new ErrorTranscripcion('la clave de Groq no es válida', 401)
    if (r.status === 429) throw new ErrorTranscripcion('se llegó al límite de uso de Groq', 429)
    throw new ErrorTranscripcion('Groq ' + r.status + ': ' + detalle, r.status)
  }
  return String(j.text || '').replace(/\s+/g, ' ').trim()
}

module.exports = { transcribir, disponible, MODELO }

// --- PRUEBA DESDE EL DROPLET -------------------------------------------------
if (require.main === module) {
  const cmd = process.argv[2]
  if (cmd !== 'prueba') { console.log('Uso: node transcribir.js prueba'); process.exit(1) }
  ;(async () => {
    if (!disponible()) { console.log('❌ Falta GROQ_API_KEY en el .env'); process.exit(1) }
    const { createClient } = require('@supabase/supabase-js')
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    const { data, error } = await supabase.from('whatsapp_messages').select('id, media_url, created_at')
      .eq('direction', 'in').eq('media_type', 'audio').not('media_url', 'is', null)
      .order('created_at', { ascending: false }).limit(1)
    if (error) { console.log('❌ ' + error.message); process.exit(1) }
    if (!data || !data.length) { console.log('No hay notas de voz guardadas todavía: mándale una al número de un proyecto y vuelve a probar.'); return }
    const a = data[0]
    console.log('Nota de voz del ' + new Date(a.created_at).toLocaleString('es-PE', { timeZone: 'America/Lima' }) + ' · modelo ' + MODELO)
    const t0 = Date.now()
    try {
      const texto = await transcribir(a.media_url)
      console.log('✅ La clave de Groq funciona (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)')
      console.log('   Dice: "' + (texto || '(no se entienden palabras)') + '"')
    } catch (e) { console.log('❌ ' + e.message) }
  })().catch(e => { console.log('❌ ' + String(e.message || e)); process.exit(1) })
}
