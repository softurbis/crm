// ============================================================================
// VERIFICAR META Y CLAUDE DESDE EL DROPLET — sin mostrar ningun token
// ----------------------------------------------------------------------------
//   node cobranza_meta.js verificar            estado del numero (¿coexistencia?)
//   node cobranza_meta.js suscribir WABA_ID    conecta la app a la cuenta de WhatsApp
//   node cobranza_meta.js plantillas WABA_ID   plantillas y si Meta ya las aprobo
//   node cobranza_meta.js ia                   prueba la clave de Claude (cuesta centesimas de centavo)
// Lee el .env de esta carpeta. Nada de esto envia mensajes a clientes.
// ============================================================================
require('dotenv').config()
const WA = require('./cloudapi')

const [, , cmd, arg] = process.argv
const ok = t => console.log('✅ ' + t)
const mal = t => console.log('❌ ' + t)
const nota = t => console.log('   ' + t)

async function verificar() {
  if (!process.env.WA_PHONE_NUMBER_ID || !process.env.WA_TOKEN) { mal('Faltan WA_PHONE_NUMBER_ID o WA_TOKEN en el .env'); return }
  let d
  try { d = await WA.infoNumero() }
  catch (e) {
    // algunos campos solo existen para ciertas cuentas: se reintenta con lo basico
    nota('(reintento con campos basicos: ' + e.message.slice(0, 120) + ')')
    d = await WA.infoNumero('display_phone_number,verified_name,name_status,quality_rating,status')
  }
  ok('El token funciona y ve el numero ' + (d.display_phone_number || '?'))
  nota('Nombre visible: ' + (d.verified_name || '?') + '  (' + (d.name_status || 'sin dato') + ')')
  nota('Estado: ' + (d.status || '?') + ' · calidad: ' + (d.quality_rating || 'sin calificacion') + ' · plataforma: ' + (d.platform_type || '?'))
  if (d.is_on_biz_app === true && d.platform_type === 'CLOUD_API') ok('COEXISTENCIA: la app del celular y la API conviven en este numero. La secretaria sigue usando su app.')
  else if (d.is_on_biz_app === false) nota('No esta en coexistencia: el numero solo funciona por la API (no en una app de celular).')
  else nota('Meta no informo si hay coexistencia (is_on_biz_app): avisale a Claude con esta salida.')
  if (d.throughput) nota('Velocidad maxima: ' + JSON.stringify(d.throughput))
}

async function suscribir() {
  if (!arg) { mal('Falta el id de la cuenta de WhatsApp: node cobranza_meta.js suscribir WABA_ID'); return }
  const r = await WA.suscribirApp(arg)
  if (r.success) ok('La app quedo suscrita a la cuenta ' + arg + ': Meta ya manda los mensajes al webhook')
  const l = await WA.appsSuscritas(arg)
  nota('Apps suscritas: ' + (l.data || []).map(a => (a.whatsapp_business_api_data?.name || a.name || '?')).join(', '))
}

async function plantillas() {
  if (!arg) { mal('Falta el id de la cuenta de WhatsApp: node cobranza_meta.js plantillas WABA_ID'); return }
  const r = await WA.listarPlantillas(arg)
  const lista = r.data || []
  if (!lista.length) { nota('No hay plantillas creadas todavia.'); return }
  for (const p of lista) console.log((p.status === 'APPROVED' ? '✅' : p.status === 'REJECTED' ? '❌' : '⏳') + ' ' + p.name + ' · ' + p.status + ' · ' + p.category + ' · ' + p.language)
}

async function probarIA() {
  const clave = process.env.COBRANZA_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!clave) { mal('No hay COBRANZA_ANTHROPIC_API_KEY ni ANTHROPIC_API_KEY en el .env'); return }
  if (!process.env.COBRANZA_ANTHROPIC_API_KEY) nota('Ojo: se esta usando la clave GENERAL. Lo recomendado es COBRANZA_ANTHROPIC_API_KEY.')
  const { Anthropic } = require('@anthropic-ai/sdk')
  const ia = new Anthropic({ apiKey: clave })
  try {
    const r = await ia.messages.create({ model: 'claude-haiku-4-5', max_tokens: 5, messages: [{ role: 'user', content: 'Responde solo: ok' }] })
    ok('La clave de Claude funciona (' + r.model + ')')
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) mal('La clave es invalida o fue anulada')
    else if (e instanceof Anthropic.PermissionDeniedError) mal('La clave no tiene permiso (¿workspace sin credito o con limite alcanzado?)')
    else if (e instanceof Anthropic.RateLimitError) mal('Limite alcanzado: revisa el limite de gasto del workspace')
    else mal('Error de Claude: ' + (e.status || '') + ' ' + String(e.message).slice(0, 200))
  }
}

const cmds = { verificar, suscribir, plantillas, ia: probarIA }
if (!cmds[cmd]) {
  console.log('Uso: node cobranza_meta.js verificar | suscribir WABA_ID | plantillas WABA_ID | ia')
  process.exit(1)
}
cmds[cmd]().catch(e => { mal(String(e.message || e).slice(0, 400)); process.exit(1) })
