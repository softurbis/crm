// ============================================================================
// VERIFICAR Y ARMAR META DESDE EL DROPLET — sin mostrar ningun token
// ----------------------------------------------------------------------------
//   node cobranza_meta.js listo               TODO de una: numero, cuenta, webhook, plantillas y Claude
//   node cobranza_meta.js verificar           estado del numero (¿coexistencia?)
//   node cobranza_meta.js waba                encuentra el id de la cuenta de WhatsApp
//   node cobranza_meta.js crear_plantillas    crea en Meta las 5 plantillas de cobranza
//   node cobranza_meta.js plantillas [WABA]   plantillas y si Meta ya las aprobo
//   node cobranza_meta.js suscribir [WABA]    conecta la app a la cuenta (webhook)
//   node cobranza_meta.js textos              los textos, para pegarlos a mano
//   node cobranza_meta.js ia                  prueba la clave de Claude (cuesta centesimas de centavo)
// Lee el .env de esta carpeta. Nada de esto le envia mensajes a un cliente.
// ============================================================================
require('dotenv').config()
const WA = require('./cloudapi')
const { PLANTILLAS, comoSeVe, paraMeta } = require('./plantillas_cobranza')

const [, , cmd, arg] = process.argv
const ok = t => console.log('✅ ' + t)
const mal = t => console.log('❌ ' + t)
const nota = t => console.log('   ' + t)
const titulo = t => console.log('\n=== ' + t + ' ===')
const IDIOMA = process.env.WA_PLANTILLA_IDIOMA || 'es'

function hayToken() {
  if (process.env.WA_PHONE_NUMBER_ID && process.env.WA_TOKEN) return true
  mal('Faltan WA_PHONE_NUMBER_ID o WA_TOKEN en el .env')
  return false
}

async function verificar() {
  if (!hayToken()) return
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

// Devuelve el id de la cuenta de WhatsApp: el del argumento, el del .env o el que encuentre solo.
async function cuenta(silencioso = false) {
  if (arg) return arg
  const r = await WA.buscarWaba()
  if (r.id) { if (!silencioso) ok('Cuenta de WhatsApp (WABA): ' + r.id + '   [la encontro por ' + r.via + ']'); return r.id }
  if (r.varias) {
    mal('Este token alcanza VARIAS cuentas de WhatsApp: ' + r.varias.join(', '))
    nota('Elige una y pasala: node cobranza_meta.js ' + (cmd || 'plantillas') + ' ' + r.varias[0])
    return null
  }
  mal('No pude averiguar el id de la cuenta de WhatsApp')
  for (const i of r.intentos) nota('· ' + i)
  nota('Sacalo de Administrador de WhatsApp → Configuracion de la cuenta (o del asset_id= de la URL) y pasalo:')
  nota('node cobranza_meta.js ' + (cmd || 'plantillas') + ' EL_ID')
  return null
}

async function waba() {
  if (!hayToken()) return
  const id = await cuenta()
  if (!id) return
  try {
    const c = await WA.infoCuenta(id)
    nota('Nombre de la cuenta: ' + (c.name || '?'))
  } catch (e) { nota('(no pude leer el nombre de la cuenta: ' + e.message.slice(0, 90) + ')') }
  try {
    const n = await WA.numerosDe(id)
    const propio = (n.data || []).some(x => String(x.id) === String(process.env.WA_PHONE_NUMBER_ID))
    nota('Numeros de la cuenta: ' + (n.data || []).map(x => x.display_phone_number).join(', '))
    if (propio) ok('El numero del .env pertenece a esta cuenta')
    else mal('OJO: el numero del .env NO figura en esta cuenta. Revisa WA_PHONE_NUMBER_ID.')
  } catch (e) { nota('(no pude listar los numeros: ' + e.message.slice(0, 90) + ')') }
  nota('Para no volver a buscarlo, en el .env: WA_WABA_ID=' + id)
}

async function suscribir() {
  if (!hayToken()) return
  const id = await cuenta()
  if (!id) return
  const r = await WA.suscribirApp(id)
  if (r.success) ok('La app quedo suscrita a la cuenta ' + id + ': Meta ya manda los mensajes al webhook')
  const l = await WA.appsSuscritas(id)
  nota('Apps suscritas: ' + ((l.data || []).map(a => (a.whatsapp_business_api_data?.name || a.name || '?')).join(', ') || 'ninguna'))
}

const icono = s => s === 'APPROVED' ? '✅' : s === 'REJECTED' ? '❌' : s === 'PAUSED' || s === 'DISABLED' ? '🛑' : '⏳'

async function plantillas() {
  if (!hayToken()) return
  const id = await cuenta()
  if (!id) return
  const lista = (await WA.listarPlantillas(id)).data || []
  const nuestras = PLANTILLAS.map(p => p.nombre)
  if (!lista.length) { nota('No hay plantillas creadas todavia. Creaalas con: node cobranza_meta.js crear_plantillas'); return }
  for (const p of lista.filter(x => nuestras.includes(x.name)).concat(lista.filter(x => !nuestras.includes(x.name))))
    console.log(icono(p.status) + ' ' + p.name + ' · ' + p.status + ' · ' + p.category + ' · ' + p.language
      + (p.rejected_reason && p.rejected_reason !== 'NONE' ? ' · motivo: ' + p.rejected_reason : '')
      + (nuestras.includes(p.name) ? '' : '   (no es de cobranza)'))
  const faltan = nuestras.filter(n => !lista.some(x => x.name === n))
  if (faltan.length) nota('FALTAN por crear: ' + faltan.join(', '))
  const aprobadas = lista.filter(x => nuestras.includes(x.name) && x.status === 'APPROVED')
  if (aprobadas.length === nuestras.length) ok('Las 5 plantillas de cobranza estan aprobadas. Sus nombres ya estan en el panel (sql/107): se pueden prender los avisos.')
  else if (!faltan.length) nota('Meta todavia esta revisando alguna. Suele tardar de minutos a 24 h.')
}

async function crearPlantillas() {
  if (!hayToken()) return
  const id = await cuenta()
  if (!id) return
  let ya = []
  try { ya = (await WA.listarPlantillas(id)).data || [] } catch (e) { nota('(no pude leer las existentes: ' + e.message.slice(0, 90) + ')') }
  for (const p of PLANTILLAS) {
    const existe = ya.find(x => x.name === p.nombre && x.language === IDIOMA)
    if (existe) { nota(icono(existe.status) + ' ' + p.nombre + ' ya existe (' + existe.status + '): no se toca') ; continue }
    try {
      const r = await WA.crearPlantilla(id, paraMeta(p, IDIOMA))
      ok(p.nombre + ' creada · ' + (r.status || 'PENDING') + (r.category ? ' · ' + r.category : ''))
      if (r.category && r.category !== 'UTILITY') nota('   ⚠ Meta la puso en ' + r.category + ' y no en Utilidad: avisale a Claude.')
    } catch (e) { mal(p.nombre + ': ' + e.message.slice(0, 220)) }
  }
  console.log('')
  nota('Meta las revisa sola (de minutos a 24 h). Para ver como van:')
  nota('node cobranza_meta.js plantillas')
}

function textos() {
  for (const p of PLANTILLAS) {
    titulo(p.nombre)
    console.log('Cuando sale: ' + p.cuando)
    console.log('Categoria: Utilidad · Idioma: Español · sin encabezado, sin pie, sin botones (la linea en cursiva va dentro del cuerpo)')
    console.log('\nCUERPO (pegar tal cual):\n' + p.cuerpo)
    console.log('\nEJEMPLOS: ' + p.ejemplo.map((e, i) => '{{' + (i + 1) + '}} ' + e).join(' · '))
    console.log('ASI LE LLEGA AL CLIENTE:\n' + comoSeVe(p))
  }
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

// Todo el chequeo de una sola vez: es la salida que se le pasa a Claude.
async function listo() {
  const paso = async (t, f) => { titulo(t); try { await f() } catch (e) { mal(String(e.message || e).slice(0, 300)) } }
  await paso('NUMERO', verificar)
  await paso('CUENTA DE WHATSAPP', waba)
  await paso('WEBHOOK (apps suscritas)', async () => {
    if (!hayToken()) return
    const id = await cuenta(true)
    if (!id) return
    const l = await WA.appsSuscritas(id)
    const apps = (l.data || []).map(a => (a.whatsapp_business_api_data?.name || a.name || '?'))
    if (apps.length) ok('Suscritas: ' + apps.join(', '))
    else mal('Ninguna app suscrita: los mensajes de los clientes NO llegan. Corre: node cobranza_meta.js suscribir')
  })
  await paso('PLANTILLAS', plantillas)
  await paso('CLAUDE', probarIA)
  titulo('FIN')
  nota('Copia todo esto y pegaselo a Claude.')
}

const cmds = { listo, verificar, waba, suscribir, plantillas, crear_plantillas: crearPlantillas, textos, ia: probarIA }
if (!cmds[cmd]) {
  console.log('Uso: node cobranza_meta.js listo | verificar | waba | crear_plantillas | plantillas [WABA] | suscribir [WABA] | textos | ia')
  process.exit(1)
}
Promise.resolve(cmds[cmd]()).catch(e => { mal(String(e.message || e).slice(0, 400)); process.exit(1) })
