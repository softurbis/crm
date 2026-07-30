// ============================================================
// CLOUD API DE WHATSAPP (oficial de Meta) — transporte de cobranza
// ------------------------------------------------------------
// Reemplaza a Baileys SOLO como via de envio/recepcion: el panel,
// las tablas (whatsapp_*) y la logica de cobranza no cambian.
//
// Config en .env (junto a este archivo, NUNCA al repo):
//   WA_PHONE_NUMBER_ID = id del numero (Meta > WhatsApp > API Setup)
//   WA_TOKEN           = token de acceso (temporal para probar; permanente despues)
//   WA_VERIFY_TOKEN    = palabra secreta que tu eliges para el webhook
//   WA_API_VERSION     = opcional, por defecto v23.0
//
// Prueba en seco (con el numero de TEST de Meta, gratis):
//   node cloudapi.js --test --to 51XXXXXXXXX
//   (manda la plantilla de ejemplo "hello_world" que Meta trae aprobada)
// ============================================================
require('dotenv').config()
const http = require('http')

const VER = process.env.WA_API_VERSION || 'v23.0'
const PHONE_ID = process.env.WA_PHONE_NUMBER_ID
const TOKEN = process.env.WA_TOKEN
const VERIFY = process.env.WA_VERIFY_TOKEN || 'urbis-verifica'
const BASE = `https://graph.facebook.com/${VER}`

async function api(ruta, body, metodo = 'POST') {
  const r = await fetch(`${BASE}/${ruta}`, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`CloudAPI ${r.status}: ${JSON.stringify(j.error || j).slice(0, 300)}`)
  return j
}

// --- ENVIOS ------------------------------------------------------------------
// plantilla aprobada (cobranza fuera de ventana). params = textos de {{1}}, {{2}}...
async function enviarPlantilla(to, nombre, params = [], idioma = 'es') {
  return api(`${PHONE_ID}/messages`, {
    messaging_product: 'whatsapp', to: String(to).replace(/\D/g, ''),
    type: 'template',
    template: {
      name: nombre, language: { code: idioma },
      ...(params.length ? { components: [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: String(t) })) }] } : {}),
    },
  })
}

// texto libre (solo valido dentro de la ventana de 24h tras un mensaje del cliente)
async function enviarTexto(to, body) {
  return api(`${PHONE_ID}/messages`, {
    messaging_product: 'whatsapp', to: String(to).replace(/\D/g, ''),
    type: 'text', text: { body: String(body).slice(0, 4096), preview_url: false },
  })
}

// media por URL publica (imagen/documento) dentro de ventana
async function enviarMedia(to, url, tipo = 'image', caption = '') {
  return api(`${PHONE_ID}/messages`, {
    messaging_product: 'whatsapp', to: String(to).replace(/\D/g, ''),
    type: tipo, [tipo]: { link: url, ...(caption ? { caption } : {}) },
  })
}

// --- WEBHOOK (recepcion) -----------------------------------------------------
// Meta manda: mensajes entrantes de clientes + estados (sent/delivered/read).
// `alRecibir(msg)` y `alEstado(st)` los conecta el bot a las tablas del panel.
function servidorWebhook({ puerto = 8090, alRecibir = () => {}, alEstado = () => {} } = {}) {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (req.method === 'GET' && url.pathname === '/webhook') {
      // verificacion inicial de Meta: devolver el challenge si el token coincide
      if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === VERIFY) {
        res.writeHead(200); res.end(url.searchParams.get('hub.challenge') || ''); return
      }
      res.writeHead(403); res.end(); return
    }
    if (req.method === 'POST' && url.pathname === '/webhook') {
      let cuerpo = ''
      req.on('data', c => { cuerpo += c })
      req.on('end', async () => {
        res.writeHead(200); res.end()   // responder rapido; procesar despues
        try {
          const data = JSON.parse(cuerpo)
          for (const e of data.entry || []) for (const ch of e.changes || []) {
            const v = ch.value || {}
            for (const m of v.messages || []) await alRecibir(m, v)
            for (const s of v.statuses || []) await alEstado(s, v)
          }
        } catch (err) { console.error('webhook:', err.message) }
      })
      return
    }
    res.writeHead(404); res.end()
  })
  srv.listen(puerto, () => console.log('Webhook Cloud API escuchando en puerto', puerto))
  return srv
}

// media entrante: Meta da un media_id -> URL temporal -> binario (para subir a Storage)
async function bajarMedia(mediaId) {
  const meta = await api(mediaId, null, 'GET')
  const r = await fetch(meta.url, { headers: { Authorization: 'Bearer ' + TOKEN } })
  if (!r.ok) throw new Error('bajar media: HTTP ' + r.status)
  return { buffer: Buffer.from(await r.arrayBuffer()), mime: meta.mime_type || 'application/octet-stream' }
}

module.exports = { enviarPlantilla, enviarTexto, enviarMedia, servidorWebhook, bajarMedia }

// --- PRUEBA EN SECO ----------------------------------------------------------
if (require.main === module && process.argv.includes('--test')) {
  const to = process.argv[process.argv.indexOf('--to') + 1]
  if (!PHONE_ID || !TOKEN) { console.error('Faltan WA_PHONE_NUMBER_ID / WA_TOKEN en .env'); process.exit(1) }
  if (!to || to.replace(/\D/g, '').length < 11) { console.error('Uso: node cloudapi.js --test --to 51XXXXXXXXX'); process.exit(1) }
  enviarPlantilla(to, 'hello_world', [], 'en_US')
    .then(r => console.log('ENVIADO OK. id:', r.messages?.[0]?.id, '\nSi el mensaje llega a ese WhatsApp, la Cloud API quedo operativa.'))
    .catch(e => console.error('FALLO:', e.message))
}
