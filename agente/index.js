// ============================================================
// AGENTE URBIS - WhatsApp no oficial (Baileys) - MULTI-NUMERO
// Modulo 1: cobranza automatica (sale por el numero del proyecto)
// Modulo 2: recepcion y filtro de leads entrantes (un numero por proyecto)
// Cada fila de wa_sessions = un numero vinculado (sesion Baileys propia).
// La sesion CORPORATIVA (is_corporate) lleva seguimiento/gerencia/avisos
// y es el fallback cuando un proyecto no tiene numero propio.
// ============================================================
require('dotenv').config()
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys')
const { createClient } = require('@supabase/supabase-js')
const cron = require('node-cron')
const pino = require('pino')
const qrcode = require('qrcode-terminal')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
let ADMIN = (process.env.ADMIN_PHONE || '').replace(/\D/g, '')

// ===== MODO PRUEBAS (consola / chat virtual) =====
// Mientras una prueba se procesa, TEST_ACTIVE = teléfono de la sesión y
// TEST_PROFILES fuerza la clasificación del número (lead/cliente/secretaria/gerencia).
// En este modo NADA sale por WhatsApp real: todo se captura en scheduled_messages
// bajo el teléfono de la sesión para mostrarlo en la consola.
let TEST_ACTIVE = null
const TEST_PROFILES = new Map()   // últimos 9 dígitos -> tipoNumero ('cliente'|'secretaria'|'gerencia'|null)
// el numero admin se puede cambiar desde el panel (bot_settings.admin_phone); el .env queda de fallback
async function refrescarAdmin() {
  try {
    const { data } = await supabase.from('bot_settings').select('value').eq('key', 'admin_phone').maybeSingle()
    if (data && data.value) { const d = String(data.value).replace(/\D/g, ''); if (d.length >= 9 && d !== ADMIN) { ADMIN = d; log('ADMIN actualizado a', d) } }
  } catch {}
}
refrescarAdmin()
setInterval(refrescarAdmin, 60000)

// re-vinculacion pedida desde el panel VIEJO (bot_settings.wa_relink): aplica a la
// sesion CORPORATIVA. El panel nuevo pide relink por sesion (wa_sessions.relink).
async function chequearRelink() {
  try {
    if ((await ajuste('wa_relink', '0')) !== '1') return
    await setAjuste('wa_relink', '0')
    const S = [...SESSIONS.values()].find(s => s.row.is_corporate)
    if (S && sesId(S)) { await supabase.from('wa_sessions').update({ relink: true }).eq('id', S.row.id); return }
    // modo compat (sin wa_sessions): comportamiento original
    await setAjuste('wa_estado', 'esperando_qr')
    log('RELINK pedido desde el panel: cerrando sesion y borrando credenciales...')
    try { if (S && S.sock) await S.sock.logout() } catch {}
    try { require('fs').rmSync('./auth', { recursive: true, force: true }) } catch {}
    process.exit(0)
  } catch (e) { log('relink:', e.message) }
}
setInterval(chequearRelink, 20000)

// latido POR SESION: el panel muestra "EN LINEA" mientras el timestamp este fresco
setInterval(() => {
  for (const S of SESSIONS.values()) if (S.sock) setSes(S.row, { latido: new Date().toISOString() }).catch(() => {})
}, 30000)

// reinicio pedido desde el panel: sale limpio y pm2 lo levanta de nuevo (la sesion de WhatsApp se conserva)
async function chequearRestart() {
  try {
    if ((await ajuste('wa_restart', '0')) !== '1') return
    await setAjuste('wa_restart', '0')
    log('REINICIO pedido desde el panel...')
    process.exit(0)
  } catch (e) { log('restart:', e.message) }
}
setInterval(chequearRestart, 15000)

// store minimo de mensajes enviados: permite reintentos de cifrado ("Esperando el mensaje").
// Se persiste en disco para que los reintentos sobrevivan a los reinicios del bot.
const _fsm = require('fs')
// el store vive FUERA de las carpetas de credenciales (./auth_s/<sesion>) para
// sobrevivir a los relinks; se migra solo desde la ruta vieja ./auth/msgstore.json
const MSG_STORE_FILE = './msgstore.json'
try { if (!_fsm.existsSync(MSG_STORE_FILE) && _fsm.existsSync('./auth/msgstore.json')) _fsm.copyFileSync('./auth/msgstore.json', MSG_STORE_FILE) } catch {}
const msgStore = new Map()
try {
  if (_fsm.existsSync(MSG_STORE_FILE)) {
    const arr = JSON.parse(_fsm.readFileSync(MSG_STORE_FILE, 'utf8'))
    if (Array.isArray(arr)) for (const [k, v] of arr) msgStore.set(k, v)
  }
} catch {}
function persistMsgStore() {
  try { _fsm.writeFileSync(MSG_STORE_FILE, JSON.stringify([...msgStore].slice(-800))) } catch {}
}
let _msgTimer = null
function guardarMsg(sent) {
  try {
    if (sent && sent.key && sent.key.id) {
      msgStore.set(sent.key.id, sent.message)
      if (msgStore.size > 800) { const k = msgStore.keys().next().value; msgStore.delete(k) }
      if (!_msgTimer) _msgTimer = setTimeout(() => { _msgTimer = null; persistMsgStore() }, 2000)
    }
  } catch {}
}
// al apagar/reiniciar, vaciar lo pendiente a disco
process.on('SIGINT', () => { persistMsgStore(); process.exit(0) })
process.on('SIGTERM', () => { persistMsgStore(); process.exit(0) })
const HIST_DIAS = Number(process.env.HIST_DIAS || 90)   // backup: cuántos días de historial importar
const DIAS_ANTES = Number(process.env.DIAS_ANTES || 3)
const VENCIDAS_CADA = Number(process.env.VENCIDAS_CADA_DIAS || 4)
const MAX_DIA = Number(process.env.MAX_ENVIOS_DIA || 40)

// ===== SESIONES MULTI-NUMERO (wa_sessions) =====
// SESSIONS: session_id -> { row, sock, enviados, iniciando }
// row.id === 'legacy' = modo compatibilidad (sql/30 sin correr): una sola sesion en ./auth.
const SESSIONS = new Map()
const AUTH_BASE = './auth_s'
const sesId = S => (S && S.row && S.row.id && S.row.id !== 'legacy') ? S.row.id : null
const authDirDe = row => row.id === 'legacy' ? './auth' : AUTH_BASE + '/' + row.id
const sesCorporativa = () => {
  for (const s of SESSIONS.values()) if (s.row.is_corporate && s.sock) return s
  for (const s of SESSIONS.values()) if (s.sock) return s
  return null
}
const sesDeProyecto = pid => { if (!pid) return null; for (const s of SESSIONS.values()) if (s.row.project_id === pid && s.sock) return s; return null }
// estado/qr/latido por sesion + espejo en bot_settings para la corporativa
// (asi el panel viejo sigue mostrando el estado hasta que se despliegue el nuevo)
async function setSes(row, campos) {
  if (row.id !== 'legacy') { try { await supabase.from('wa_sessions').update(campos).eq('id', row.id) } catch {} }
  if (row.is_corporate) {
    if ('estado' in campos) await setAjuste('wa_estado', campos.estado).catch(() => {})
    if ('qr' in campos) await setAjuste('wa_qr', campos.qr || '').catch(() => {})
    if ('latido' in campos) await setAjuste('wa_latido', campos.latido).catch(() => {})
  }
}
// que sesion usar para ENVIAR a un numero:
// 1) la del chat existente (continuidad) 2) la del proyecto indicado 3) la corporativa
const _convSesCache = new Map()   // phone -> { t, sesId }
async function sesionPara(phone, meta = {}) {
  if (meta.ses && meta.ses.sock) return meta.ses
  const dig = String(phone).includes('@') ? telDeJid(String(phone)) : String(phone).replace(/\D/g, '')
  if (dig) {
    const hit = _convSesCache.get(dig)
    let sid = (hit && Date.now() - hit.t < 60000) ? hit.sesId : undefined
    if (sid === undefined) {
      try {
        const { data } = await supabase.from('whatsapp_conversations').select('session_id')
          .eq('phone', dig).order('last_message_at', { ascending: false, nullsFirst: false }).limit(1)
        sid = (data && data[0] && data[0].session_id) || null
      } catch { sid = null }
      _convSesCache.set(dig, { t: Date.now(), sesId: sid })
    }
    const s = sid && SESSIONS.get(sid)
    if (s && s.sock) return s
  }
  if (meta.project_id) { const s = sesDeProyecto(meta.project_id); if (s) return s }
  return sesCorporativa()
}
let enviadosHoy = 0
let diaActual = new Date().toDateString()

const log = (...a) => console.log(new Date().toLocaleString('es-PE'), '|', ...a)
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const parseJSON = s => { try { const o = JSON.parse(String(s || '')); return o } catch { return null } }
const matchClaves = (claves, texto) => String(claves || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean).some(k => String(texto || '').toLowerCase().includes(k))
const espera = ms => new Promise(r => setTimeout(r, process.env.SIMULACRO === '1' ? 5 : ms))
const delayAleatorio = () => 20000 + Math.floor(Math.random() * 25000) // 20-45 s
// Pausa entre mensajes del flujo de leads (configurable por proyecto: bot_flow.pausa_seg). correrFlujo la ajusta.
let PAUSA_MS = 3000
// Mutex compartido para que procesarPruebas y avanzarFlujo no se solapen (evita doble envío en pruebas).
let _procPruebasBusy = false

function jidDe(phone) {
  let p = String(phone || '').replace(/\D/g, '')
  if (p.length === 9) p = '51' + p
  return p + '@s.whatsapp.net'
}
function telDeJid(jid) { return (jid || '').split('@')[0].replace(/\D/g, '') }

async function flag(k) { const { data } = await supabase.from('bot_settings').select('value').eq('key', k).maybeSingle(); return !data || data.value !== '0' }
async function tipoNumero(soloDig) {
  const k9 = String(soloDig).slice(-9)
  if (TEST_PROFILES.has(k9)) return TEST_PROFILES.get(k9)   // modo prueba: perfil forzado
  const { data } = await supabase.from('whatsapp_numbers').select('tipo').ilike('phone', '%' + k9 + '%').limit(1); return (data || [])[0]?.tipo || null
}

let _brains = { t: 0, v: {} }
async function brain(k) {
  if (Date.now() - _brains.t > 60000) {
    const { data } = await supabase.from('bot_brains').select('key, content')
    if (data) _brains = { t: Date.now(), v: Object.fromEntries(data.map(r => [r.key, (r.content || '').trim()])) }
  }
  return _brains.v[k] || ''
}
// ---------- IA CONVERSACIONAL (Claude) ----------
const IA_KEY = process.env.ANTHROPIC_API_KEY || ''
const IA_MODEL = process.env.IA_MODEL || 'claude-haiku-4-5-20251001'

// tamaño (bytes) de una URL vía HEAD, con cache — para decidir si un video sale
// como VIDEO o como DOCUMENTO (WhatsApp rechaza videos muy pesados como video,
// pero los acepta sin problema como documento descargable).
const _tamCache = new Map()
async function tamanoDe(url) {
  if (_tamCache.has(url)) return _tamCache.get(url)
  let n = 0
  try { const r = await fetch(url, { method: 'HEAD' }); n = Number(r.headers.get('content-length') || 0) } catch {}
  if (_tamCache.size > 300) _tamCache.clear()
  _tamCache.set(url, n)
  return n
}
const VIDEO_MAX_MB = Number(process.env.VIDEO_MAX_MB || 62)

async function enviarArchivo(jid, url, clase, caption, ses) {
  const etiqueta = (clase === 'video' ? '🎬 VIDEO' : clase === 'plano' ? '🗺️ PLANO' : clase === 'brochure' ? '📘 BROCHURE' : clase === 'documento' ? '📄 DOCUMENTO' : '📷 FOTO') + ' ENVIADO' + (caption ? ': ' + caption : '')
  if (TEST_ACTIVE) {   // modo prueba: no se manda media real, se anota lo que se habría enviado
    await espera(PAUSA_MS)
    await supabase.from('scheduled_messages').insert({ recipient_phone: TEST_ACTIVE, body: etiqueta, tipo: 'test_media', scheduled_for: new Date().toISOString(), status: 'enviado', sent_at: new Date().toISOString() })
    return
  }
  try {
    const S = (ses && ses.sock) ? ses : await sesionPara(jid, {})
    if (!S || !S.sock) { log('MEDIA sin sesion de WhatsApp conectada, no se envia a', jid); return }
    const dest = String(jid).includes('@') ? String(jid) : jidDe(jid)
    // pausa natural con indicador (grabando para video, escribiendo para el resto)
    try { await S.sock.sendPresenceUpdate(clase === 'video' ? 'recording' : 'composing', dest) } catch (e) {}
    await espera(PAUSA_MS)
    try { await S.sock.sendPresenceUpdate('paused', dest) } catch (e) {}
    const low = String(url).toLowerCase()
    const esDoc = (clase === 'plano' || clase === 'brochure' || clase === 'documento') && low.includes('.pdf')
    if (clase === 'video' && (await tamanoDe(url)) > VIDEO_MAX_MB * 1024 * 1024) guardarMsg(await S.sock.sendMessage(dest, { document: { url }, fileName: 'VIDEO.mp4', mimetype: 'video/mp4', caption: caption || undefined }))
    else if (clase === 'video') guardarMsg(await S.sock.sendMessage(dest, { video: { url }, caption: caption || undefined }))
    else if (esDoc) guardarMsg(await S.sock.sendMessage(dest, { document: { url }, mimetype: 'application/pdf', fileName: (clase === 'brochure' ? 'BROCHURE' : clase === 'plano' ? 'PLANO-ACTUALIZADO' : (String(caption || 'DOCUMENTO').replace(/[^\w .-]/g, '').trim().slice(0, 40) || 'DOCUMENTO')) + '.pdf', caption: caption || undefined }))
    else guardarMsg(await S.sock.sendMessage(dest, { image: { url }, caption: caption || undefined }))
    enviadosHoy++; S.enviados = (S.enviados || 0) + 1
    await supabase.from('scheduled_messages').insert({ recipient_phone: telDeJid(dest), body: etiqueta, tipo: 'ia', session_id: sesId(S), scheduled_for: new Date().toISOString(), status: 'enviado', sent_at: new Date().toISOString() })
    log('MEDIA [' + clase + '] enviada a', telDeJid(dest), 'por', S.row.label || 'PRINCIPAL')
  } catch (e) { log('ERROR media', clase, ':', String(e.message || e)) }
}

// ¿este número puede usar el Q&A interno confidencial? Solo GERENCIA y el ADMIN.
async function puedeQA(phone) {
  if (ADMIN && (String(phone).endsWith(ADMIN.slice(-9)) || ADMIN.endsWith(String(phone).slice(-9)))) return true
  return (await tipoNumero(phone)) === 'gerencia'
}

// ¿el mensaje parece una PREGUNTA/consulta (no una respuesta de checklist)?
function pareceConsulta(t) {
  const s = String(t || '')
  return /\?/.test(s) || /(cu[aá]nto|cu[aá]l|cu[aá]les|qu[eé]\b|c[oó]mo\b|cu[aá]ndo|d[oó]nde|hay\s|tienes?|queda|precio|cuesta|disponib|informaci|\binfo\b|\blote|manzana|\bmz\b|\bcliente|deuda|saldo|cuota|vendid|separad)/i.test(s)
}

// ¿la persona está en medio de su checklist de actividades? (para no interrumpirla con Q&A)
async function tieneChecklistAbierto(phone) {
  const { data: sec } = await supabase.from('secretaries').select('id').ilike('phone', '%' + String(phone).slice(-9)).limit(1)
  if (!sec || !sec.length) return false
  const { data: ab } = await supabase.from('secretary_tasks').select('id')
    .eq('secretary_id', sec[0].id).eq('date', secHoy()).eq('status', 'pendiente')
    .is('answered_at', null).not('asked_at', 'is', null).limit(1)
  return !!(ab && ab.length)
}

// Asistente INTERNO para el equipo (asesores/gerencia): consulta el SISTEMA REAL y da datos
// confidenciales (comisiones por cobrar, gastos por proyecto/mes, visitas pendientes, cobranza…).
async function responderInternoIA(jid, phone, texto, quien) {
  try {
    if (!IA_KEY) { log('INTERNO IA: sin ANTHROPIC_API_KEY'); return false }
    log('INTERNO IA: consultando para', quien, phone)
    const hoy = new Date().toISOString().slice(0, 10)
    const anio = hoy.slice(0, 4)
    const { data: proys } = await supabase.from('projects').select('id, name, description, bot_knowledge').order('name')
    const nombreProy = id => (proys || []).find(p => p.id === id)?.name || '—'
    let ctx = ''
    // 1) Proyectos: lotes por estado + rango de precios
    for (const p of (proys || [])) {
      const { data: lots } = await supabase.from('lots').select('status, total_price').eq('project_id', p.id)
      const all = lots || []
      const by = {}
      for (const l of all) by[l.status] = (by[l.status] || 0) + 1
      const precios = all.map(l => Number(l.total_price)).filter(n => n > 0)
      ctx += '\n=== PROYECTO ' + p.name + ' ===\n' + (p.description || '') + '\nFICHA: ' + String(p.bot_knowledge || '(sin ficha)').slice(0, 1200) + '\n'
      ctx += 'LOTES: total ' + all.length + (Object.keys(by).length ? ' | ' + Object.entries(by).map(([k, v]) => k + ':' + v).join(' | ') : '') + '\n'
      if (precios.length) ctx += 'PRECIO lote: S/ ' + Math.min(...precios).toLocaleString('es-PE') + ' a S/ ' + Math.max(...precios).toLocaleString('es-PE') + '\n'
    }
    // 2) Comisiones por cobrar (pendientes)
    const { data: coms } = await supabase.from('commissions')
      .select('amount, status, advisor:advisors(code, full_name), sale:sales(lot:lots(mz, lt, project_id))').eq('status', 'pendiente')
    if (coms && coms.length) {
      const totC = coms.reduce((s, c) => s + Number(c.amount || 0), 0)
      ctx += '\n=== COMISIONES POR COBRAR (pendientes) — total S/ ' + totC.toLocaleString('es-PE') + ' en ' + coms.length + ' ===\n'
      ctx += coms.slice(0, 30).map(c => '- ' + (c.advisor?.full_name || c.advisor?.code || '—') + ': S/ ' + Number(c.amount || 0).toLocaleString('es-PE') + (c.sale?.lot ? ' (Mz ' + c.sale.lot.mz + ' Lt ' + c.sale.lot.lt + ' · ' + nombreProy(c.sale.lot.project_id) + ')' : '')).join('\n') + '\n'
    } else ctx += '\n=== COMISIONES POR COBRAR ===\nNo hay comisiones pendientes.\n'
    // 3) Gastos del año por proyecto y mes
    const { data: gastos } = await supabase.from('expenses').select('project_id, issue_date, amount').gte('issue_date', anio + '-01-01')
    if (gastos && gastos.length) {
      const agg = {}
      for (const g of gastos) { const m = String(g.issue_date || '').slice(0, 7); if (!m) continue; const k = g.project_id + '|' + m; agg[k] = (agg[k] || 0) + Number(g.amount || 0) }
      ctx += '\n=== GASTOS ' + anio + ' (por proyecto y mes) ===\n'
      ctx += Object.entries(agg).sort().map(([k, v]) => { const [pid, m] = k.split('|'); return '- ' + nombreProy(pid) + ' ' + m + ': S/ ' + v.toLocaleString('es-PE') }).join('\n') + '\n'
    }
    // 4) Visitas pendientes (programadas de hoy en adelante)
    const { data: vis } = await supabase.from('visits').select('date, time, client_name, project_id').eq('status', 'programada').gte('date', hoy).order('date').order('time').limit(25)
    if (vis && vis.length) {
      ctx += '\n=== VISITAS PENDIENTES (programadas) ===\n'
      ctx += vis.map(v => '- ' + v.date + ' ' + String(v.time || '').slice(0, 5) + ' · ' + (v.client_name || '—') + ' · ' + nombreProy(v.project_id)).join('\n') + '\n'
    } else ctx += '\n=== VISITAS PENDIENTES ===\nNo hay visitas programadas próximas.\n'
    // 5) Cobranza: cuotas vencidas por proyecto
    const { data: venc } = await supabase.from('installments').select('amount, amount_paid, sale:sales!inner(status, lot:lots!inner(project_id))').eq('status', 'vencido')
    if (venc && venc.length) {
      const agg = {}
      for (const q of venc) { if (q.sale?.status !== 'en_proceso') continue; const pid = q.sale?.lot?.project_id; const d = Number(q.amount) - Number(q.amount_paid); if (d > 0.05) { if (!agg[pid]) agg[pid] = { n: 0, s: 0 }; agg[pid].n++; agg[pid].s += d } }
      const ks = Object.keys(agg)
      if (ks.length) ctx += '\n=== COBRANZA: CUOTAS VENCIDAS ===\n' + ks.map(pid => '- ' + nombreProy(pid) + ': ' + agg[pid].n + ' cuotas, S/ ' + agg[pid].s.toLocaleString('es-PE')).join('\n') + '\n'
    }
    const conf = ((await brain('gerencia')) || '').trim()
    let system = 'Eres el asistente INTERNO de Urbis Group para el equipo (asesores y gerencia). A diferencia del bot de ventas al publico, con el equipo SI das informacion confidencial y detallada: comisiones por cobrar, gastos por proyecto/mes, visitas pendientes, cobranza, disponibilidad y precios de lotes. Responde claro, directo y en espanol, formato WhatsApp corto, con cifras exactas de los DATOS de abajo. NO inventes: si el dato no esta, dilo. Quien pregunta: ' + quien + '.'
    if (conf) system += ' NOTAS INTERNAS DE GERENCIA (extra, si aplica): ' + conf.replace(/\s+/g, ' ') + '.'
    const cuerpo = { model: IA_MODEL, max_tokens: 450,
      system: [
        { type: 'text', text: system },
        { type: 'text', text: 'DATOS INTERNOS EN VIVO (' + hoy + '):\n' + ctx, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: String(texto).slice(0, 600) }] }
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 25000)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': IA_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(cuerpo),
    })
    clearTimeout(to)
    const j = await r.json()
    const out = (j?.content || []).map(c => c.text || '').join('').trim()
    if (!out) { log('INTERNO IA sin texto:', JSON.stringify(j).slice(0, 200)); return false }
    await enviar(jid, out.slice(0, 1200), { tipo: 'interno' })
    log('INTERNO IA respondio a', quien, phone)
    return true
  } catch (e) { log('INTERNO IA ERROR:', String(e.message || e)); return false }
}

// Recordatorio que va al pie de los comandos gratis.
const PIE_COMANDO = '\n\n💡 ¿Necesitas algo más específico? Escríbeme la pregunta en palabras normales — uso IA y cuesta ~$0.005 (medio centavo) por consulta.'

// COMANDOS DIRECTOS: responden leyendo la base y armando una plantilla, SIN IA (gratis).
// Devuelve el texto de respuesta, o null si el mensaje no es un comando conocido.
async function comandoDirecto(texto) {
  try {
    const t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE')
    const { data: proys } = await supabase.from('projects').select('id, name').order('name')
    const nombreProy = id => (proys || []).find(p => p.id === id)?.name || '—'

    if (/^(ayuda|comandos|menu|men[uú]|opciones|help|hola)$/.test(t)) {
      return '📋 *COMANDOS RÁPIDOS (gratis):*\n\n' +
        '• *resumen* — panorama del día (todo en uno)\n' +
        '• *lotes* — disponibles y precios por proyecto\n' +
        '• *comisiones* — por cobrar (total y por asesor)\n' +
        '• *gastos* — del año por proyecto y mes\n' +
        '• *visitas* — programadas próximas\n' +
        '• *vencidas* — cuotas vencidas por proyecto' + PIE_COMANDO
    }

    if (/resumen|reporte|dashboard|panorama|balance|como vamos|c[oó]mo vamos/.test(t)) {
      const hoy = new Date().toISOString().slice(0, 10), mes = hoy.slice(0, 7)
      const [{ data: lots }, { data: sales }, { data: venc }, { data: coms }, { data: gastos }, { data: vis }] = await Promise.all([
        supabase.from('lots').select('status'),
        supabase.from('sales').select('status'),
        supabase.from('installments').select('amount, amount_paid, sale:sales!inner(status)').eq('status', 'vencido'),
        supabase.from('commissions').select('amount').eq('status', 'pendiente'),
        supabase.from('expenses').select('amount, issue_date').gte('issue_date', mes + '-01'),
        supabase.from('visits').select('date, time, client_name, project:projects(name)').eq('status', 'programada').gte('date', hoy).order('date').order('time').limit(3),
      ])
      const disp = (lots || []).filter(l => l.status === 'disponible').length
      const vendidos = (lots || []).filter(l => ['vendido', 'entregado'].includes(l.status)).length
      const enProc = (sales || []).filter(s => s.status === 'en_proceso').length
      const pagadas = (sales || []).filter(s => s.status === 'pagado').length
      let vN = 0, vS = 0
      for (const q of (venc || [])) { if (q.sale?.status !== 'en_proceso') continue; const d = Number(q.amount) - Number(q.amount_paid); if (d > 0.05) { vN++; vS += d } }
      const comTot = (coms || []).reduce((s, c) => s + Number(c.amount || 0), 0)
      const gasTot = (gastos || []).filter(g => String(g.issue_date || '').slice(0, 7) === mes).reduce((s, g) => s + Number(g.amount || 0), 0)
      const prox = (vis || [])[0]
      let out = '📊 *RESUMEN — ' + hoy.split('-').reverse().join('/') + '*\n'
      out += '\n🏘️ Lotes: *' + disp + '* disponibles · ' + vendidos + ' vendidos'
      out += '\n💰 Ventas: *' + enProc + '* en proceso · ' + pagadas + ' pagadas'
      out += '\n⚠️ Vencidas: *' + vN + '* cuotas · ' + soles(vS)
      out += '\n💼 Comisiones por cobrar: *' + soles(comTot) + '*'
      out += '\n💸 Gastos del mes: *' + soles(gasTot) + '*'
      out += '\n📅 Próximas visitas: *' + (vis || []).length + '*' + (prox ? ' (sig: ' + String(prox.date).split('-').reverse().join('/') + ' ' + String(prox.time || '').slice(0, 5) + ' ' + (prox.client_name || '') + ')' : '')
      return out + PIE_COMANDO
    }

    if (/\blotes?\b|disponibl|disponibilidad/.test(t)) {
      let out = '🏘️ *LOTES DISPONIBLES*\n'
      for (const p of (proys || [])) {
        const { data: lots } = await supabase.from('lots').select('status, total_price').eq('project_id', p.id)
        const disp = (lots || []).filter(l => l.status === 'disponible')
        const precios = disp.map(l => Number(l.total_price)).filter(n => n > 0)
        out += '\n*' + p.name + '*: ' + disp.length + ' de ' + (lots || []).length + ' lotes'
        if (precios.length) out += '\n   desde ' + soles(Math.min(...precios)) + ' a ' + soles(Math.max(...precios))
      }
      return out + PIE_COMANDO
    }

    if (/comision/.test(t)) {
      const { data: coms } = await supabase.from('commissions')
        .select('amount, advisor:advisors(code, full_name)').eq('status', 'pendiente')
      if (!coms || !coms.length) return '💼 *COMISIONES POR COBRAR*\nNo hay comisiones pendientes.' + PIE_COMANDO
      const tot = coms.reduce((s, c) => s + Number(c.amount || 0), 0)
      const porAsesor = {}
      for (const c of coms) { const k = c.advisor?.full_name || c.advisor?.code || '—'; porAsesor[k] = (porAsesor[k] || 0) + Number(c.amount || 0) }
      let out = '💼 *COMISIONES POR COBRAR*\nTotal: *' + soles(tot) + '* en ' + coms.length + ' comisiones\n'
      out += Object.entries(porAsesor).sort((a, b) => b[1] - a[1]).map(([k, v]) => '• ' + k + ': ' + soles(v)).join('\n')
      return out + PIE_COMANDO
    }

    if (/gastos?\b/.test(t)) {
      const anio = new Date().toISOString().slice(0, 4)
      const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']
      const mesIdx = meses.findIndex(m => t.includes(m) || t.includes(m.slice(0, 4)))
      const { data: gastos } = await supabase.from('expenses').select('project_id, issue_date, amount').gte('issue_date', anio + '-01-01')
      let filas = (gastos || [])
      if (mesIdx >= 0) filas = filas.filter(g => String(g.issue_date || '').slice(5, 7) === String(mesIdx + 1).padStart(2, '0'))
      if (!filas.length) return '💸 *GASTOS ' + anio + (mesIdx >= 0 ? ' — ' + meses[mesIdx].toUpperCase() : '') + '*\nSin gastos registrados.' + PIE_COMANDO
      const agg = {}
      for (const g of filas) { const k = g.project_id + '|' + String(g.issue_date || '').slice(0, 7); agg[k] = (agg[k] || 0) + Number(g.amount || 0) }
      const totGen = filas.reduce((s, g) => s + Number(g.amount || 0), 0)
      let out = '💸 *GASTOS ' + anio + (mesIdx >= 0 ? ' — ' + meses[mesIdx].toUpperCase() : '') + '*\nTotal: *' + soles(totGen) + '*\n'
      out += Object.entries(agg).sort().map(([k, v]) => { const [pid, m] = k.split('|'); return '• ' + nombreProy(pid) + ' ' + m + ': ' + soles(v) }).join('\n')
      return out + PIE_COMANDO
    }

    if (/visitas?\b/.test(t)) {
      const hoy = new Date().toISOString().slice(0, 10)
      const { data: vis } = await supabase.from('visits').select('date, time, client_name, project:projects(name)')
        .eq('status', 'programada').gte('date', hoy).order('date').order('time').limit(15)
      if (!vis || !vis.length) return '📅 *VISITAS PROGRAMADAS*\nNo hay visitas próximas.' + PIE_COMANDO
      let out = '📅 *VISITAS PROGRAMADAS (' + vis.length + ')*\n'
      out += vis.map(v => '• ' + String(v.date).split('-').reverse().join('/') + ' ' + String(v.time || '').slice(0, 5) + ' · ' + (v.client_name || '—') + ' · ' + (v.project?.name || '—')).join('\n')
      return out + PIE_COMANDO
    }

    if (/vencid|moros|cobranza/.test(t)) {
      const { data: venc } = await supabase.from('installments')
        .select('amount, amount_paid, sale:sales!inner(status, lot:lots!inner(project_id))').eq('status', 'vencido')
      const agg = {}
      for (const q of (venc || [])) {
        if (q.sale?.status !== 'en_proceso') continue
        const pid = q.sale?.lot?.project_id; const d = Number(q.amount) - Number(q.amount_paid)
        if (d > 0.05) { if (!agg[pid]) agg[pid] = { n: 0, s: 0 }; agg[pid].n++; agg[pid].s += d }
      }
      const ks = Object.keys(agg)
      if (!ks.length) return '⚠️ *CUOTAS VENCIDAS*\nNo hay cuotas vencidas. 🎉' + PIE_COMANDO
      const totN = ks.reduce((s, k) => s + agg[k].n, 0), totS = ks.reduce((s, k) => s + agg[k].s, 0)
      let out = '⚠️ *CUOTAS VENCIDAS*\nTotal: *' + totN + ' cuotas · ' + soles(totS) + '*\n'
      out += ks.map(pid => '• ' + nombreProy(pid) + ': ' + agg[pid].n + ' cuotas · ' + soles(agg[pid].s)).join('\n')
      return out + PIE_COMANDO
    }

    if (/\bventas?\b|vendid/.test(t)) {
      const { data: sales } = await supabase.from('sales').select('status, lot:lots(project_id)')
      const by = {}; for (const s of (sales || [])) by[s.status] = (by[s.status] || 0) + 1
      let out = '🏷️ *VENTAS*\nEn proceso: *' + (by.en_proceso || 0) + '* · Pagadas: *' + (by.pagado || 0) + '*' + (by.expropiado ? ' · Expropiadas: ' + by.expropiado : '')
      return out + PIE_COMANDO
    }
    if (/ingres|recaud|cobrado|caja/.test(t)) {
      const mes = new Date().toISOString().slice(0, 7)
      const { data: ing } = await supabase.from('daily_income').select('amount, date').gte('date', mes + '-01')
      const totMes = (ing || []).filter(x => String(x.date || '').slice(0, 7) === mes).reduce((s, x) => s + Number(x.amount || 0), 0)
      return '💵 *INGRESOS DEL MES (' + mes + ')*\nTotal recaudado: *' + soles(totMes) + '* en ' + (ing || []).length + ' pagos.' + PIE_COMANDO
    }
    if (/separacion|separad|apartad/.test(t)) {
      const { data: seps } = await supabase.from('separations').select('amount, status').eq('status', 'vigente')
      const tot = (seps || []).reduce((s, x) => s + Number(x.amount || 0), 0)
      return '📝 *SEPARACIONES VIGENTES*\n*' + (seps || []).length + '* separaciones · ' + soles(tot) + ' apartado.' + PIE_COMANDO
    }
    if (/\bclientes?\b|comprador/.test(t)) {
      const { count } = await supabase.from('clients').select('doc_number', { count: 'exact', head: true })
      return '👥 *CLIENTES*\nTotal registrados: *' + (count || 0) + '*.' + PIE_COMANDO
    }
    if (/cartera|deuda total|por cobrar|saldo total/.test(t)) {
      const { data: ins } = await supabase.from('installments').select('amount, amount_paid, sale:sales!inner(status)').neq('status', 'pagado')
      let tot = 0, n = 0
      for (const q of (ins || [])) { if (q.sale?.status !== 'en_proceso') continue; const d = Number(q.amount) - Number(q.amount_paid); if (d > 0.05) { tot += d; n++ } }
      return '📊 *CARTERA POR COBRAR*\nSaldo pendiente total: *' + soles(tot) + '* en ' + n + ' cuotas.' + PIE_COMANDO
    }
    if (/pipeline|\bleads?\b|prospecto|kanban/.test(t)) {
      const { data: lds } = await supabase.from('leads').select('status')
      const by = {}; for (const l of (lds || [])) by[l.status] = (by[l.status] || 0) + 1
      const orden = ['nuevo', 'contactado', 'interesado', 'visita_agendada', 'negociacion', 'ganado', 'perdido']
      return '📇 *PIPELINE DE LEADS*\n' + (orden.filter(k => by[k]).map(k => '• ' + k.toUpperCase().replace('_', ' ') + ': ' + by[k]).join('\n') || 'Sin leads.') + PIE_COMANDO
    }
    if (/pagos de hoy|ingresos de hoy|recaudado hoy/.test(t)) {
      const hoy = new Date().toISOString().slice(0, 10)
      const { data: ing } = await supabase.from('daily_income').select('amount, date').eq('date', hoy)
      return '💵 *PAGOS DE HOY*\n' + (ing || []).length + ' pagos · ' + soles((ing || []).reduce((s, x) => s + Number(x.amount || 0), 0)) + '.' + PIE_COMANDO
    }
    if (/entregad/.test(t)) {
      const { data: lots } = await supabase.from('lots').select('status')
      return '🏡 *LOTES ENTREGADOS*\nTotal entregados: *' + (lots || []).filter(l => l.status === 'entregado').length + '*.' + PIE_COMANDO
    }
    if (/top asesor|mejor asesor|ranking asesor/.test(t)) {
      const { data: coms } = await supabase.from('commissions').select('amount, advisor:advisors(code, full_name)').eq('status', 'pendiente')
      const by = {}; for (const c of (coms || [])) { const k = c.advisor?.full_name || c.advisor?.code || '—'; by[k] = (by[k] || 0) + Number(c.amount || 0) }
      const arr = Object.entries(by).sort((a, b) => b[1] - a[1])
      if (!arr.length) return '🏆 *TOP ASESOR*\nSin comisiones pendientes.' + PIE_COMANDO
      return '🏆 *TOP ASESOR (comisiones por cobrar)*\n' + arr.slice(0, 5).map(([k, val], i) => (i + 1) + '. ' + k + ': ' + soles(val)).join('\n') + PIE_COMANDO
    }
    if (/pendientes|tareas pend|checklist/.test(t)) {
      const hoyL = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
      const { data: tk } = await supabase.from('secretary_tasks').select('title, time, secretary:secretaries(full_name)').eq('date', hoyL).eq('status', 'pendiente').order('time')
      if (!tk || !tk.length) return '📋 *PENDIENTES DE HOY*\nNo hay tareas pendientes. 🎉' + PIE_COMANDO
      const bySec = {}; for (const x of tk) { const k = x.secretary?.full_name || '—'; (bySec[k] = bySec[k] || []).push(x) }
      let out = '📋 *PENDIENTES DE HOY*\n'
      for (const [k, arr] of Object.entries(bySec)) out += '\n*' + k + '*:\n' + arr.map(x => '• ' + (x.time ? String(x.time).slice(0, 5) + ' ' : '') + x.title).join('\n') + '\n'
      return out + PIE_COMANDO
    }
    if (/cumplimiento|cumplieron|productividad|reporte sec/.test(t)) {
      const hoyL = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
      const { data: tk } = await supabase.from('secretary_tasks').select('status, secretary:secretaries(full_name)').eq('date', hoyL)
      if (!tk || !tk.length) return '📊 *CUMPLIMIENTO DE HOY*\nSin tareas registradas hoy.' + PIE_COMANDO
      const bySec = {}; for (const x of tk) { const k = x.secretary?.full_name || '—'; const s = bySec[k] = bySec[k] || { h: 0, t: 0 }; s.t++; if (x.status === 'hecha') s.h++ }
      let out = '📊 *CUMPLIMIENTO DE HOY*\n'
      for (const [k, s] of Object.entries(bySec)) out += '• ' + k + ': ' + s.h + '/' + s.t + ' (' + Math.round(s.h / s.t * 100) + '%)\n'
      return out + PIE_COMANDO
    }

    return null
  } catch (e) { log('COMANDO ERROR:', String(e.message || e)); return null }
}

// Atiende a gerencia/admin: primero intenta un comando gratis; si no, usa la IA (con costo).
async function atenderInterno(jid, phone, texto, quien) {
  const cmd = await comandoDirecto(texto)
  if (cmd) { await enviar(jid, cmd, { tipo: 'interno' }); log('COMANDO DIRECTO (gratis) a', quien, phone); return true }
  if (pareceConsulta(texto)) return await responderInternoIA(jid, phone, texto, quien)
  return false
}

// Crea una tarea para una secretaria a partir de "<nombre> <fecha/hora> <descripción>".
async function crearTareaSec(jid, resto) {
  const mt = String(resto).match(/^\s*(\S+)\s+([\s\S]+)/)
  if (!mt) { await enviar(jid, '❌ Usa: <palabra> <secretaria> <fecha/hora> <descripción>', { tipo: 'aviso_admin' }); return true }
  const { data: cands } = await supabase.from('secretaries').select('*').ilike('full_name', '%' + mt[1] + '%').eq('active', true).limit(1)
  const sec = (cands || [])[0]
  if (!sec) { await enviar(jid, '❌ No encontré a la secretaria "' + mt[1] + '".', { tipo: 'aviso_admin' }); return true }
  const fh = parseFechaHora(mt[2])
  let titulo = mt[2]
  if (fh.matchFecha) titulo = titulo.replace(new RegExp(fh.matchFecha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
  if (fh.matchHora) titulo = titulo.replace(new RegExp(fh.matchHora.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
  titulo = titulo.replace(/\s+/g, ' ').replace(/^[,\s\-:]+|[,\s\-:]+$/g, '').trim()
  if (!titulo) { await enviar(jid, '❌ Falta la descripción de la tarea.', { tipo: 'aviso_admin' }); return true }
  const fecha = fh.date || secHoy()
  const { error } = await supabase.from('secretary_tasks').insert({ secretary_id: sec.id, title: titulo.toUpperCase(), date: fecha, time: fh.time, slot: slotDeHora(fh.time) })
  await enviar(jid, error ? '❌ ERROR: ' + error.message : '✅ Tarea creada para *' + sec.full_name + '*: ' + titulo.toUpperCase() + ' — ' + fmtFechaEs(fecha) + (fh.time ? ' a las ' + fh.time : ''), { tipo: 'aviso_admin' })
  return true
}
// Reprograma una tarea existente: "<nombre_sec> <parte del título> <nueva fecha/hora>".
async function reprogramarTareaSec(jid, resto) {
  const mt = String(resto).match(/^\s*(\S+)\s+([\s\S]+)/)
  if (!mt) { await enviar(jid, '❌ Usa: <palabra> <secretaria> <parte del título> <nueva fecha/hora>', { tipo: 'aviso_admin' }); return true }
  const { data: cands } = await supabase.from('secretaries').select('*').ilike('full_name', '%' + mt[1] + '%').eq('active', true).limit(1)
  const sec = (cands || [])[0]
  if (!sec) { await enviar(jid, '❌ No encontré a la secretaria "' + mt[1] + '".', { tipo: 'aviso_admin' }); return true }
  const fh = parseFechaHora(mt[2])
  if (!fh.date && !fh.time) { await enviar(jid, '❌ No entendí la nueva fecha/hora.', { tipo: 'aviso_admin' }); return true }
  let filtro = mt[2]
  if (fh.matchFecha) filtro = filtro.replace(new RegExp(fh.matchFecha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
  if (fh.matchHora) filtro = filtro.replace(new RegExp(fh.matchHora.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
  filtro = filtro.replace(/\s+/g, ' ').trim().toUpperCase()
  const hoy = secHoy()
  const { data: tasks } = await supabase.from('secretary_tasks').select('*').eq('secretary_id', sec.id).gte('date', hoy).neq('status', 'hecha').order('date')
  const tarea = (tasks || []).find(t => filtro && String(t.title || '').toUpperCase().includes(filtro)) || (tasks || [])[0]
  if (!tarea) { await enviar(jid, '❌ ' + sec.full_name + ' no tiene esa tarea pendiente.', { tipo: 'aviso_admin' }); return true }
  const nd = fh.date || tarea.date
  await supabase.from('secretary_tasks').update({ date: nd, time: fh.time || tarea.time, slot: fh.time ? slotDeHora(fh.time) : tarea.slot, status: 'pendiente', ask_index: null, asked_at: null, reminded_at: null, answered_at: null, notified_at: null }).eq('id', tarea.id)
  await enviar(jid, '🔄 Reprogramada la tarea de *' + sec.full_name + '*: "' + tarea.title + '" para el ' + fmtFechaEs(nd) + (fh.time ? ' a las ' + fh.time : ''), { tipo: 'aviso_admin' })
  return true
}
// devuelve el texto tras la palabra clave (si el mensaje EMPIEZA con alguna), o null
function restoTrasClave(texto, claves) {
  const t = String(texto || '')
  for (const k of String(claves || '').split(',').map(x => x.trim()).filter(Boolean)) {
    const re = new RegExp('^\\s*' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b\\s*', 'i')
    if (re.test(t)) return t.replace(re, '').trim()
  }
  return null
}

// Comandos privilegiados (ADMIN y GERENCIA): "tarea <nombre> <fecha> <desc>" (palabra fija de fábrica).
async function comandosPrivilegiados(jid, phone, texto) {
  const mt = String(texto).match(/^\s*tarea\s+([\s\S]+)/i)
  if (mt) return await crearTareaSec(jid, mt[1])
  return false
}

// Comandos configurables de GERENCIA (bot_brains 'gerencia_cmd' = JSON):
// [{ claves, tipo:"consulta"|"texto"|"accion", consulta, texto, accion:"crear_tarea"|"reprogramar_tarea" }]
async function comandosGerencia(jid, phone, texto) {
  const cmds = parseJSON(await brain('gerencia_cmd'))
  if (!Array.isArray(cmds) || !cmds.length) return false
  // 1) ACCIONES: deben ir al inicio del mensaje ("<palabra> <argumentos>")
  for (const c of cmds) {
    if (c.tipo === 'accion') {
      const resto = restoTrasClave(texto, c.claves)
      if (resto !== null) return c.accion === 'reprogramar_tarea' ? await reprogramarTareaSec(jid, resto) : await crearTareaSec(jid, resto)
    }
  }
  // 2) CONSULTA / TEXTO: por coincidencia de palabra clave en cualquier parte
  const cmd = cmds.find(c => c.tipo !== 'accion' && matchClaves(c.claves, texto))
  if (!cmd) return false
  if (cmd.tipo === 'texto') { await enviar(jid, String(cmd.texto || '').trim() || '—', { tipo: 'interno' }); return true }
  const resp = await comandoDirecto(cmd.consulta || '')
  if (resp) { await enviar(jid, resp, { tipo: 'interno' }); return true }
  return false
}


async function enviar(phone, texto, meta = {}) {
  // sesion por la que sale: la del chat > la del proyecto (meta.project_id) > corporativa
  const S = TEST_ACTIVE ? null : await sesionPara(phone, meta)
  // pausa natural entre mensajes del flujo (configurable), tanto en real como en la consola de prueba
  if (['lead_flujo', 'ia', 'auto_cliente'].includes(meta.tipo || '')) {
    if (!TEST_ACTIVE && S && S.sock) { try { await S.sock.sendPresenceUpdate('composing', String(phone).includes('@') ? String(phone) : jidDe(phone)) } catch (e) {} }
    await espera(PAUSA_MS)
  }
  // MODO PRUEBA: capturar todo bajo el teléfono de la sesión, sin tocar WhatsApp real.
  if (TEST_ACTIVE) {
    const rp = String(phone).includes('@') ? telDeJid(String(phone)) : String(phone).replace(/\D/g, '')
    const esSesion = rp.slice(-9) === String(TEST_ACTIVE).slice(-9)
    const body = esSesion ? texto : '📨 (aviso interno → +' + rp + '):\n' + texto
    await supabase.from('scheduled_messages').insert({
      recipient_phone: TEST_ACTIVE, body, tipo: 'test_' + (meta.tipo || 'msj'),
      lead_id: meta.lead_id || null, client_id: meta.client_id || null,
      scheduled_for: new Date().toISOString(), status: 'enviado', sent_at: new Date().toISOString(),
    })
    return true
  }
  if (process.env.SIMULACRO === '1') {
    const dig = String(phone).includes('@') ? telDeJid(String(phone)) : String(phone)
    log('[SIM] ' + dig + ' | ' + (meta.tipo || 'msj') + ' | ' + String(texto).replace(/\n+/g, ' ⏎ '))
    return true
  }
  if (!S || !S.sock) { log('SIN SESION DE WHATSAPP CONECTADA, no se envia a', phone); return false }
  if (new Date().toDateString() !== diaActual) { diaActual = new Date().toDateString(); enviadosHoy = 0; for (const x of SESSIONS.values()) x.enviados = 0 }
  if ((S.enviados || 0) >= MAX_DIA && process.env.SIMULACRO !== '1') { log('TOPE DIARIO ALCANZADO en', S.row.label || 'PRINCIPAL', ', no se envia a', phone); return false }
  const soloDig = String(phone).includes('@') ? telDeJid(String(phone)) : String(phone).replace(/\D/g, '')
  if (!ADMIN || soloDig !== String(ADMIN)) {
    const tnumEnv = await tipoNumero(soloDig)
    if (tnumEnv === 'silencio') { log('SILENCIO TOTAL, no se envia a', soloDig); return false }
    if (tnumEnv === 'desactivado' && !['secretaria', 'aviso_admin', 'reporte'].includes(meta.tipo || '')) { log('NUMERO ADMINISTRATIVO: solo avisos internos, no se envia a', soloDig); return false }
  }
  const destJid = String(phone).includes('@') ? String(phone) : jidDe(phone)
  try {
    guardarMsg(await S.sock.sendMessage(destJid, { text: texto }))
    enviadosHoy++; S.enviados = (S.enviados || 0) + 1
    await supabase.from('scheduled_messages').insert({
      recipient_phone: String(phone).includes('@') ? telDeJid(String(phone)) : String(phone), body: texto, tipo: meta.tipo || 'manual',
      installment_id: meta.installment_id || null, client_id: meta.client_id || null,
      lead_id: meta.lead_id || null, sale_id: meta.sale_id || null, session_id: sesId(S),
      scheduled_for: new Date().toISOString(),
      status: 'enviado', sent_at: new Date().toISOString(),
    })
    log('ENVIADO [' + (meta.tipo || 'msj') + '] a', phone, 'por', S.row.label || 'PRINCIPAL')
    return true
  } catch (e) {
    log('ERROR enviando a', phone, e.message)
    await supabase.from('scheduled_messages').insert({
      recipient_phone: String(phone).includes('@') ? telDeJid(String(phone)) : String(phone), body: texto, tipo: meta.tipo || 'manual',
      scheduled_for: new Date().toISOString(), status: 'fallido', last_error: e.message,
    })
    return false
  }
}

// ---------- MODULO 1: COBRANZA (4 NIVELES) ----------
// NIVEL A (al dia):            avisos a 5 y 3 dias antes, y el MISMO dia del vencimiento.
// NIVEL A-INSISTENCIA (1 venc): re-aviso a los 2 y 4 dias de vencida; luego pasa a GESTION HUMANA (alerta al admin).
// NIVEL B (2 vencidas):        recordatorio cada 3 dias hasta que se desactive del panel.
// NIVEL C (3+ vencidas):       mensaje severo cada 3 dias: comunicarse urgente, riesgo conforme a contrato (expropiacion/resolucion).
// El interruptor por venta es sales.auto_cobranza (se apaga desde el Mapa de lotes).

const diasEntre = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000)

async function yaAvisado({ installment_id, sale_id, tipo, dias }) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString()
  let q = supabase.from('scheduled_messages').select('id').eq('tipo', tipo).eq('status', 'enviado').gte('sent_at', desde).limit(1)
  if (installment_id) q = q.eq('installment_id', installment_id)
  if (sale_id) q = q.eq('sale_id', sale_id)
  const { data } = await q
  return (data || []).length > 0
}

let CEREBRO_COB = ''
function seccionDe(md, tag) {
  if (!md) return null
  const partes = ('\n' + md).split(/\n##[ \t]*/)
  for (let i = 1; i < partes.length; i++) {
    const p = partes[i]
    const nl = p.indexOf('\n')
    if (nl < 0) continue
    const head = p.slice(0, nl).trim().split(/[\s(]+/)[0].toUpperCase()
    if (head === String(tag).toUpperCase()) { const cuerpo = p.slice(nl + 1).trim(); if (cuerpo) return cuerpo }
  }
  return null
}
function tpl(tag, vars) {
  let s = seccionDe(CEREBRO_COB, tag)
  if (!s) return null
  for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(v)
  return s
}
function msjA(nombre, lote, proy, q, deuda, cuando) {
  const p = tpl(cuando, { nombre, lote, proyecto: proy, cuota: q.installment_number, monto: soles(deuda), fecha: q.due_date })
  if (p) return p
  const base = `Hola ${nombre} 👋 le saludamos de *Urbis Group* — proyecto *${proy}*.\n\n`
  if (cuando === 'A5') return base + `Le recordamos con anticipación que su cuota N° ${q.installment_number} del lote *${lote}* por *${soles(deuda)}* vence en 5 días, el *${q.due_date}*. ¡Gracias por mantenerse al día! 🙌`
  if (cuando === 'A3') return base + `Su cuota N° ${q.installment_number} del lote *${lote}* por *${soles(deuda)}* vence en 3 días, el *${q.due_date}*. Puede pagar por transferencia o depósito. 🙌`
  return base + `*Hoy vence* su cuota N° ${q.installment_number} del lote *${lote}* por *${soles(deuda)}*.\n\nCuando realice el pago, envíe la *foto de su voucher por este mismo chat* y nuestro equipo lo registrará. ¡Gracias! 📄✅`
}
function msjInsist(nombre, lote, proy, q, deuda, dd) {
  const p = tpl('INSISTENCIA', { nombre, lote, proyecto: proy, cuota: q.installment_number, monto: soles(deuda), fecha: q.due_date, dias: dd })
  if (p) return p
  return `Hola ${nombre}, le saludamos de *Urbis Group* — proyecto *${proy}*.\n\nSu cuota N° ${q.installment_number} del lote *${lote}* por *${soles(deuda)}* venció hace ${dd} días.\n\nSi ya realizó el pago, envíenos el voucher por aquí; si tuvo un inconveniente, escríbanos para ayudarle a regularizar. 🙏`
}
function msjB(nombre, lote, proy, nVenc, deudaTotal) {
  const p = tpl('B', { nombre, lote, proyecto: proy, nvencidas: nVenc, deuda: soles(deudaTotal) })
  if (p) return p
  return `Hola ${nombre}, le saludamos de *Urbis Group* — proyecto *${proy}*.\n\nSu lote *${lote}* registra *${nVenc} cuotas vencidas* por un total de *${soles(deudaTotal)}*.\n\nLe pedimos regularizar sus pagos para evitar mayores penalidades por mora. Si necesita una reprogramación, escríbanos y lo coordinamos. 🙏`
}
function msjC(nombre, lote, proy, nVenc, deudaTotal) {
  const p = tpl('C', { nombre, lote, proyecto: proy, nvencidas: nVenc, deuda: soles(deudaTotal) })
  if (p) return p
  return `⚠️ *AVISO IMPORTANTE - URBIS GROUP* ⚠️\n\nSr(a). ${nombre}: su lote *${lote}* (${proy}) acumula *${nVenc} cuotas vencidas* por *${soles(deudaTotal)}*.\n\nConforme a su contrato, la acumulación de cuotas impagas es causal de resolución y puede derivar en la *pérdida/expropiación del lote* y de los montos pagados.\n\n*Es urgente que se comunique con nosotros HOY* para regularizar o llegar a un acuerdo por escrito. Estamos para ayudarle a conservar su inversión. 📞`
}

// ==================== SECRETARIAS (control de actividades) ====================
const SEC_TZ = { timeZone: 'America/Lima' }
const secHoy = () => new Date().toLocaleDateString('en-CA', SEC_TZ)
const secHora = () => new Date().toLocaleTimeString('en-GB', { ...SEC_TZ, hour: '2-digit', minute: '2-digit' })
const secDow = () => { const d = new Date(new Date().toLocaleString('en-US', SEC_TZ)).getDay(); return d === 0 ? 7 : d }
async function ajuste(k, def) { const { data } = await supabase.from('bot_settings').select('value').eq('key', k).maybeSingle(); return (data && data.value) || def }
async function setAjuste(k, v) { await supabase.from('bot_settings').upsert({ key: k, value: v, updated_at: new Date().toISOString() }) }

function parseFechaHora(txt) {
  const t = String(txt || '').toLowerCase()
  const hoy = new Date(new Date().toLocaleString('en-US', SEC_TZ))
  let d = null
  let matchFecha = ''
  const DSEM = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, 'miércoles': 3, jueves: 4, viernes: 5, sabado: 6, 'sábado': 6 }
  let m
  if ((m = t.match(/pasado\s*ma[ñn]ana/))) { d = new Date(hoy); d.setDate(d.getDate() + 2); matchFecha = m[0] }
  else if ((m = t.match(/ma[ñn]ana/))) { d = new Date(hoy); d.setDate(d.getDate() + 1); matchFecha = m[0] }
  else if ((m = t.match(/\bhoy\b/))) { d = new Date(hoy); matchFecha = m[0] }
  if (!d) for (const [k, v] of Object.entries(DSEM)) { const mm2 = t.match(new RegExp('(?:el\\s+)?' + k)); if (mm2) { d = new Date(hoy); let diff = (v - d.getDay() + 7) % 7; if (!diff) diff = 7; d.setDate(d.getDate() + diff); matchFecha = mm2[0]; break } }
  if (!d && (m = t.match(/\b(\d{1,2})\s*[\/\-]\s*(\d{1,2})\b/))) { d = new Date(hoy.getFullYear(), parseInt(m[2]) - 1, parseInt(m[1])); if (d < hoy && (hoy - d) > 86400000) d.setFullYear(d.getFullYear() + 1); matchFecha = m[0] }
  if (!d && (m = t.match(/(?:el|dia|día|fecha)\s+(\d{1,2})\b/))) { const dd = parseInt(m[1]); d = new Date(hoy.getFullYear(), hoy.getMonth() + (dd < hoy.getDate() ? 1 : 0), dd); matchFecha = m[0] }
  let time = null, matchHora = ''
  const h = t.match(/a\s*las?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|de la tarde|de la noche|de la ma[ñn]ana|hrs|h\b)?/)
  if (h) { let hh = parseInt(h[1]); const mi = h[2] || '00'; const suf = h[3] || ''; if (/(pm|tarde|noche)/.test(suf) && hh < 12) hh += 12; if (hh <= 23) { time = String(hh).padStart(2, '0') + ':' + mi; matchHora = h[0] } }
  return { date: d ? d.toLocaleDateString('en-CA') : null, time, matchFecha, matchHora }
}
const slotDeHora = hhmm => (!hhmm || hhmm < '13:00') ? 'manana' : 'tarde'
// Extrae una actividad EXTRA mencionada junto a la respuesta ("aparte de eso hice X").
// No aplica a preguntas (esas van al Q&A, no se registran como extra).
function extraerExtra(texto) {
  if (pareceConsulta(texto)) return null
  const m = String(texto || '').match(/\b(aparte(?:\s+de\s+eso)?|adem[aá]s|tambi[eé]n|tambien|extra|adicional(?:mente)?|de\s+paso)\b[:,]?\s+(.{6,})/i)
  if (!m) return null
  return m[2].trim().replace(/\s+/g, ' ').slice(0, 200)
}
const fmtFechaEs = iso => { const [y, mo, dd] = iso.split('-'); return dd + '/' + mo + '/' + y }


function secTpl(md, tag, vars, def) {
  let s = seccionDe(md, tag) || def
  for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(v)
  return s
}

// manda el recordatorio de una visita al asesor y/o al cliente.
// tplCliente/tplAsesor: plantillas del panel (bot_settings). Vacío = texto por defecto.
// Variables: {cliente} {cliente_full} {proyecto} {hora} {fecha} {punto} {notas} {cuando} {asesor}
async function mandarRecordatorioVisita(v, fecha, recCliente, recAsesor, cuando, tplCliente, tplAsesor) {
  const hora = String(v.time).slice(0, 5)
  const proy = v.project ? v.project.name : 'el proyecto'
  const nomCli = (v.client_name || '').split(' ')[0]
  const vars = { cliente: nomCli, cliente_full: v.client_name || '', proyecto: proy, hora, fecha: fmtFechaEs(fecha), punto: v.meeting_point || '', notas: v.notes || '', cuando, asesor: (v.encargado_name || '').split(' ')[0] }
  const fill = t => String(t).replace(/\{(\w+)\}/g, (m, k) => vars[k] !== undefined ? vars[k] : m)
  const defAsesor = '📅 *VISITA ' + cuando.toUpperCase() + '* — ' + fmtFechaEs(fecha) + ' a las ' + hora + '\n\nCliente: *' + v.client_name + '* (+' + v.client_phone + ')\nProyecto: *' + proy + '*\nPunto de encuentro: ' + v.meeting_point + (v.notes ? '\nNotas: ' + v.notes : '') + '\n\nConfirma con el cliente. 🙌'
  const defCliente = 'Hola ' + nomCli + ' 👋 le saludamos de *Urbis Group* 🌳\n\nLe recordamos su visita a *' + proy + '* programada para *' + cuando + '* (' + fmtFechaEs(fecha) + ') a las *' + hora + '*.\n\n📍 Punto de encuentro: ' + v.meeting_point + '\n\n¡Lo esperamos! Cualquier consulta, escríbanos por aquí. 🙌'
  const meta = { tipo: 'secretaria', project_id: v.project_id || null }
  if (recAsesor && v.encargado_phone) await enviar(v.encargado_phone, (tplAsesor && tplAsesor.trim()) ? fill(tplAsesor) : defAsesor, meta)
  if (recCliente && v.client_phone) await enviar(v.client_phone, (tplCliente && tplCliente.trim()) ? fill(tplCliente) : defCliente, meta)
}

// Motor PROPIO de recordatorios de visita (independiente de las secretarias).
// Config en bot_settings: vis_activo, vis_dias_antes, vis_dias_hora,
// vis_horas_antes, vis_recordar_cliente, vis_recordar_asesor.
let _visBusy = false
async function visitasTick() {
  if (_visBusy) return
  _visBusy = true
  try {
    if (!(await flag('bot_activo'))) return
    if ((await ajuste('vis_activo', '1')) === '0') return
    const hoy = secHoy(), hhmm = secHora()
    const nowLima = new Date(new Date().toLocaleString('en-US', SEC_TZ))
    const diasAntes = Math.max(0, parseInt(await ajuste('vis_dias_antes', '1')) || 0)
    const diasHora = String(await ajuste('vis_dias_hora', '09:00')).slice(0, 5)
    const horasAntes = Math.max(0, parseInt(await ajuste('vis_horas_antes', '3')) || 0)
    const recCliente = (await ajuste('vis_recordar_cliente', '1')) !== '0'
    const recAsesor = (await ajuste('vis_recordar_asesor', '1')) !== '0'
    const tplCliente = await ajuste('vis_msg_cliente', '')
    const tplAsesor = await ajuste('vis_msg_asesor', '')

    // 1) recordatorio X DÍAS ANTES (a la hora configurada)
    if (diasAntes > 0 && hhmm >= diasHora) {
      const fobj = new Date(nowLima); fobj.setDate(fobj.getDate() + diasAntes)
      const fdia = fobj.toLocaleDateString('en-CA')
      const { data: vs } = await supabase.from('visits').select('*, project:projects(name)')
        .eq('date', fdia).eq('status', 'programada').eq('tipo', 'visita').is('reminded_dia_at', null)
      for (const v of (vs || [])) {
        await supabase.from('visits').update({ reminded_dia_at: new Date().toISOString() }).eq('id', v.id)
        await mandarRecordatorioVisita(v, fdia, recCliente, recAsesor, diasAntes === 1 ? 'mañana' : 'en ' + diasAntes + ' días', tplCliente, tplAsesor)
        log('RECORDATORIO visita (' + diasAntes + 'd antes):', v.client_name, fdia)
      }
    }

    // 2) recordatorio X HORAS ANTES (mismo día, al entrar en la ventana)
    if (horasAntes > 0) {
      const { data: vs } = await supabase.from('visits').select('*, project:projects(name)')
        .eq('date', hoy).eq('status', 'programada').eq('tipo', 'visita').is('reminded_hora_at', null)
      for (const v of (vs || [])) {
        const [vh, vm] = String(v.time).slice(0, 5).split(':').map(Number)
        const visitDt = new Date(nowLima); visitDt.setHours(vh, vm, 0, 0)
        const diffMin = (visitDt - nowLima) / 60000
        if (diffMin > 0 && diffMin <= horasAntes * 60) {
          await supabase.from('visits').update({ reminded_hora_at: new Date().toISOString() }).eq('id', v.id)
          await mandarRecordatorioVisita(v, hoy, recCliente, recAsesor, 'hoy a las ' + String(v.time).slice(0, 5), tplCliente, tplAsesor)
          log('RECORDATORIO visita (' + horasAntes + 'h antes):', v.client_name, hoy)
        }
      }
    }

    // 3) RECONTACTOS del día: el bot le recuerda al asesor que debe llamar
    if (hhmm >= diasHora) {
      const { data: recs } = await supabase.from('visits').select('*, project:projects(name)')
        .eq('date', hoy).eq('tipo', 'recontacto').eq('status', 'programada').is('reminded_dia_at', null)
      for (const r of (recs || [])) {
        await supabase.from('visits').update({ reminded_dia_at: new Date().toISOString() }).eq('id', r.id)
        if (r.encargado_phone) await enviar(r.encargado_phone, '📞 *RECONTACTAR HOY* — ' + fmtFechaEs(hoy) + '\n\nCliente: *' + r.client_name + '* (+' + r.client_phone + ')\nProyecto: *' + (r.project?.name || '-') + '*' + (r.notes ? '\n📝 ' + r.notes : '') + '\n\nQuedaste en contactarlo hoy. 🙌', { tipo: 'secretaria', project_id: r.project_id || null })
        log('RECONTACTO recordado al asesor:', r.client_name, hoy)
      }
    }

    // 4) avisar al ADMIN de las visitas recién CERRADAS con resultado (desde el panel)
    if (ADMIN) {
      const RES_LBL = { pago_inicial: '💰 Pagó inicial', separacion: '🔖 Dio separación', interesado: '🤔 Interesado / lo pensará', no_interesado: '❌ No interesado', no_vino: '😶 No vino / sin respuesta', recontacto: '📅 Recontacto agendado' }
      const { data: cerradas } = await supabase.from('visits').select('*, project:projects(name)')
        .not('resultado', 'is', null).not('closed_at', 'is', null).is('admin_avisado_at', null).limit(20)
      for (const v of (cerradas || [])) {
        await supabase.from('visits').update({ admin_avisado_at: new Date().toISOString() }).eq('id', v.id)
        await enviar(ADMIN, '📋 *VISITA CERRADA*\nCliente: *' + v.client_name + '*\nProyecto: ' + (v.project?.name || '-') + '\nAsesor: ' + (v.encargado_name || '-') + '\nResultado: *' + (RES_LBL[v.resultado] || v.resultado) + '*' + (v.resultado_note ? '\n📝 ' + v.resultado_note : '') + (v.recontacto_date ? '\n📅 Recontactar: ' + fmtFechaEs(v.recontacto_date) : ''), { tipo: 'reporte' })
        log('ADMIN avisado de visita cerrada:', v.client_name, v.resultado)
      }
    }
  } catch (e) { log('visitasTick:', String(e.message || e)) }
  finally { _visBusy = false }
}

async function secretariaTick() {
  try {
    if (!(await flag('bot_activo'))) return
    if (!(await flag('seguimiento_activo'))) return
    const hoy = secHoy(), hhmm = secHora(), dow = secDow()
    const md = await brain('secretaria')
    const { data: secs } = await supabase.from('secretaries').select('*').eq('active', true).neq('seguimiento', false)
    if (!secs || !secs.length) return

    // 1) generar tareas del dia desde las rutinas (idempotente)
    const { data: rutinas } = await supabase.from('secretary_routines').select('*').eq('active', true)
    for (const r of (rutinas || [])) {
      if (!(r.days || []).includes(dow)) continue
      if (!secs.find(s => s.id === r.secretary_id)) continue
      // si ya existe una fila para esta rutina en este día (aunque esté cancelada o editada), no regenerar
      const { data: ex } = await supabase.from('secretary_tasks').select('id').eq('routine_id', r.id).eq('date', hoy).limit(1)
      if (ex && ex.length) continue
      const { error } = await supabase.from('secretary_tasks').insert({ secretary_id: r.secretary_id, routine_id: r.id, title: r.title, date: hoy, slot: r.slot, category: r.category || 'administrativa' })
      if (error && !/duplicate|unique/i.test(error.message)) log('SEC gen:', error.message)
    }

    // 1b) SALUDO MATUTINO (default 07:30): buenos días con TODOS los pendientes del día y su hora
    if ((await ajuste('sec_saludo_activo', '1')) !== '0') {
      const saludoHora = String(await ajuste('sec_saludo_hora', '07:30')).slice(0, 5)
      if (hhmm >= saludoHora && (await ajuste('sec_saludo', '')) !== hoy) {
        await setAjuste('sec_saludo', hoy)
        const { data: hoyTasks } = await supabase.from('secretary_tasks').select('*').eq('date', hoy).eq('status', 'pendiente').neq('cancelada', true)
        const porSec = {}
        for (const tk of (hoyTasks || [])) (porSec[tk.secretary_id] = porSec[tk.secretary_id] || []).push(tk)
        for (const sec of secs) {
          const tareas = (porSec[sec.id] || []).sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')))
          if (!tareas.length) continue   // sin actividades configuradas para hoy = NO se saluda (silencio)
          const nombre = (sec.full_name || '').split(' ')[0]
          const lista = tareas.map(tk => '• ' + (tk.time ? String(tk.time).slice(0, 5) + ' — ' : '') + tk.title).join('\n')
          const msj = secTpl(md, 'SALUDO', { nombre, lista }, '¡Buenos días {nombre}! ☀️ Estos son tus pendientes de hoy:\n\n{lista}\n\n¡Que tengas un gran día! 💪')
          await enviar(sec.phone, msj, { tipo: 'secretaria' })
        }
      }
    }

    // 2) PASES DE LISTA configurables: a cada hora fijada (1 vez al día c/u), re-pregunta
    //    lo que sigue pendiente sin responder. Se configura desde el panel (cerebro Seguimiento).
    let checkins = ['11:00', '16:30']
    try { const c = JSON.parse(await ajuste('sec_checkins', '["11:00","16:30"]')); if (Array.isArray(c) && c.length) checkins = c } catch {}
    for (const horaRaw of checkins) {
      const hora = String(horaRaw).slice(0, 5)
      if (hhmm < hora) continue
      if ((await ajuste('sec_ci_' + hora, '')) === hoy) continue   // ya se hizo hoy a esa hora
      await setAjuste('sec_ci_' + hora, hoy)
      const { data: pend } = await supabase.from('secretary_tasks').select('*').eq('date', hoy).eq('status', 'pendiente').is('answered_at', null).neq('cancelada', true)
      const porSec = {}
      for (const tk of (pend || [])) (porSec[tk.secretary_id] = porSec[tk.secretary_id] || []).push(tk)
      const momento = hhmm < '12:00' ? 'la mañana' : hhmm < '18:00' ? 'la tarde' : 'hoy'
      for (const [sid, tareas] of Object.entries(porSec)) {
        const sec = secs.find(s => s.id === sid)
        if (!sec) continue
        tareas.sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')))
        let n = 0
        const lista = tareas.map(tk => { n++; tk.ask_index = n; return '*' + n + '.* ' + tk.title }).join('\n')
        for (const tk of tareas) await supabase.from('secretary_tasks').update({ ask_index: tk.ask_index, asked_at: new Date().toISOString(), reminded_at: null }).eq('id', tk.id)
        const nombre = (sec.full_name || '').split(' ')[0]
        const msj = secTpl(md, 'PREGUNTA', { nombre, lista, momento }, 'Hola {nombre} 👋 ¿cómo va todo? Pasando lista de tus actividades de {momento}:\n\n{lista}\n\nRespóndeme *LISTO* si ya completaste todo, o los *números* de lo que ya está (ej: 1 y 3). 🙌')
        await enviar(sec.phone, msj, { tipo: 'secretaria' })
      }
    }

    // 2b) aviso puntual de tareas con hora exacta (configurable: se puede apagar)
    const { data: conHora } = (await ajuste('sec_aviso_hora', '1')) === '0' ? { data: [] }
      : await supabase.from('secretary_tasks').select('*').eq('date', hoy).eq('status', 'pendiente').is('notified_at', null).not('time', 'is', null).neq('cancelada', true)
    for (const tk of (conHora || [])) {
      if (hhmm < String(tk.time).slice(0, 5)) continue
      const sec = secs.find(s => s.id === tk.secretary_id)
      if (!sec) continue
      await supabase.from('secretary_tasks').update({ notified_at: new Date().toISOString() }).eq('id', tk.id)
      const nombre = (sec.full_name || '').split(' ')[0]
      await enviar(sec.phone, secTpl(md, 'AVISO_HORA', { nombre, titulo: tk.title, hora: String(tk.time).slice(0, 5) }, '📌 {nombre}, recordatorio: *{titulo}* — programado para las {hora} de hoy. Cuando esté, respóndeme *LISTO*. 🙌'), { tipo: 'secretaria' })
    }

    // 3) recordatorio unico a los 45 min sin respuesta (configurable: se puede apagar)
    const lim = new Date(Date.now() - 45 * 60000).toISOString()
    const { data: sinResp } = (await ajuste('sec_recordatorio', '1')) === '0' ? { data: [] }
      : await supabase.from('secretary_tasks').select('*').eq('date', hoy).eq('status', 'pendiente').is('answered_at', null).is('reminded_at', null).not('asked_at', 'is', null).lt('asked_at', lim).neq('cancelada', true)
    const porSec2 = {}
    for (const tk of (sinResp || [])) (porSec2[tk.secretary_id] = porSec2[tk.secretary_id] || []).push(tk)
    for (const [sid, tareas] of Object.entries(porSec2)) {
      const sec = secs.find(s => s.id === sid)
      if (!sec) continue
      const lista = tareas.map(tk => '*' + tk.ask_index + '.* ' + tk.title).join('\n')
      const nombre = (sec.full_name || '').split(' ')[0]
      for (const tk of tareas) await supabase.from('secretary_tasks').update({ reminded_at: new Date().toISOString() }).eq('id', tk.id)
      await enviar(sec.phone, secTpl(md, 'RECORDATORIO', { nombre, lista }, 'Hola {nombre}, te reenvío el checklist pendiente:\n\n{lista}\n\n¿Cómo vamos? Respóndeme *LISTO* o los números de lo avanzado 💪'), { tipo: 'secretaria' })
    }

    // 3b) feedback de fin de dia: ¿hiciste algo extra? (configurable: se puede apagar)
    const hfeed = await ajuste('hora_feedback_sec', '17:30')
    if ((await ajuste('sec_feedback', '1')) !== '0' && hhmm >= hfeed) {
      // solo se pide feedback a quien SÍ tuvo actividades hoy (sin nada configurado = silencio)
      const { data: fdTasks } = await supabase.from('secretary_tasks').select('secretary_id').eq('date', hoy).neq('cancelada', true)
      const secConTareas = new Set((fdTasks || []).map(t => t.secretary_id))
      for (const sec of secs) {
        if (!secConTareas.has(sec.id)) continue
        if (sec.feedback_asked === hoy) continue
        await supabase.from('secretaries').update({ feedback_asked: hoy }).eq('id', sec.id)
        const nombre = (sec.full_name || '').split(' ')[0]
        await enviar(sec.phone, secTpl(md, 'FEEDBACK', { nombre }, '{nombre}, antes de cerrar el día 📝 ¿hiciste hoy algo EXTRA fuera de tus actividades programadas? Si sí, cuéntame brevemente qué fue; si no, respóndeme *NO*. 🙌'), { tipo: 'secretaria' })
      }
    }

    // (los recordatorios de visita se movieron a visitasTick — motor propio, ya no dependen de secretarias)

    // 3d) separaciones: por vencer (<=2 dias) y vencidas (lote bloqueado) — un barrido al dia
    const hsep = await ajuste('hora_aviso_sep', '09:00')
    if (hhmm >= hsep && (await ajuste('sep_aviso_fecha', '')) !== hoy) {
      await setAjuste('sep_aviso_fecha', hoy)
      const { data: seps } = await supabase.from('separations').select('*, lot:lots(mz, lt), client:clients(full_name)').eq('status', 'vigente')
      const porVencer = [], vencidas = []
      for (const sp of (seps || [])) {
        const lim = sp.extended_until || sp.expiration_date
        if (!lim) continue
        const dias = Math.round((new Date(lim + 'T12:00:00') - new Date(hoy + 'T12:00:00')) / 86400000)
        const item = { sp, lim, dias, lote: sp.lot ? 'Mz ' + sp.lot.mz + ' Lt ' + sp.lot.lt : 'lote', cli: (sp.client && sp.client.full_name) || 'cliente' }
        if (dias < 0) vencidas.push(item)
        else if (dias <= 2) porVencer.push(item)
      }
      const txtDias = d => d === 0 ? 'vence HOY' : d === 1 ? 'vence manana' : 'vence en ' + d + ' dias'
      // aviso individual a la secretaria que registro la separacion (una sola vez por etapa)
      for (const it of porVencer) {
        if (it.sp.aviso_previo_at || !it.sp.created_by) continue
        const creadora = secs.find(s => s.user_id === it.sp.created_by)
        if (!creadora) continue
        await supabase.from('separations').update({ aviso_previo_at: new Date().toISOString() }).eq('id', it.sp.id)
        await enviar(creadora.phone, '⏳ *SEPARACION POR VENCER* — ' + it.lote + '\nCliente: *' + it.cli + '*\nLimite: *' + fmtFechaEs(it.lim) + '* (' + txtDias(it.dias) + ')\n\nCoordina el pago de la inicial, o pide al administrador extender el plazo antes de que el lote se bloquee. 🙌', { tipo: 'secretaria' })
      }
      for (const it of vencidas) {
        if (it.sp.aviso_vencida_at) continue
        await supabase.from('separations').update({ aviso_vencida_at: new Date().toISOString() }).eq('id', it.sp.id)
        const creadora = it.sp.created_by ? secs.find(s => s.user_id === it.sp.created_by) : null
        if (creadora) await enviar(creadora.phone, '🔒 *SEPARACION VENCIDA* — ' + it.lote + '\nCliente: *' + it.cli + '*\nVencio el ' + fmtFechaEs(it.lim) + '.\n\nEl lote quedo BLOQUEADO (no se puede vender ni liberar) hasta que el administrador decida: extender el plazo o marcar perdida.', { tipo: 'secretaria' })
      }
      // resumen agrupado al administrador (se repite cada dia mientras haya vencidas sin resolver)
      if ((porVencer.length || vencidas.length) && ADMIN) {
        let m = '📌 *SEPARACIONES — ' + fmtFechaEs(hoy) + '*\n'
        if (vencidas.length) { m += '\n🔒 *VENCIDAS — lote bloqueado, decide extender o perdida (Mapa de lotes):*\n'; for (const it of vencidas) m += '• ' + it.lote + ' — ' + it.cli + ' (vencio ' + fmtFechaEs(it.lim) + ')\n' }
        if (porVencer.length) { m += '\n⏳ *POR VENCER:*\n'; for (const it of porVencer) m += '• ' + it.lote + ' — ' + it.cli + ' (' + txtDias(it.dias) + ', ' + fmtFechaEs(it.lim) + ')\n' }
        await enviar(ADMIN, m.trim(), { tipo: 'aviso_admin' })
      }
    }

    // 4) resumen diario al administrador
    const hres = await ajuste('hora_resumen_sec', '18:00')
    if (hhmm >= hres && (await ajuste('sec_resumen_fecha', '')) !== hoy) {
      await setAjuste('sec_resumen_fecha', hoy)
      const { data: todas } = await supabase.from('secretary_tasks').select('*').eq('date', hoy).neq('cancelada', true)
      if (todas && todas.length) {
        for (const tk of todas) if (tk.status === 'pendiente' && tk.asked_at && !tk.answered_at) { tk.status = 'sin_respuesta'; await supabase.from('secretary_tasks').update({ status: 'sin_respuesta' }).eq('id', tk.id) }
        let detalle = ''
        for (const sec of secs) {
          const ts = todas.filter(tk => tk.secretary_id === sec.id)
          if (!ts.length) continue
          const extras = ts.filter(tk => tk.category === 'extra').length
          const base = ts.filter(tk => tk.category !== 'extra')
          detalle += '\n*' + sec.full_name + '* — ' + base.filter(tk => tk.status === 'hecha').length + '/' + base.length + ' cumplidas' + (extras ? ' · ' + extras + ' extra(s) 💪' : '') + '\n'
          for (const tk of ts) detalle += (tk.status === 'hecha' ? '  ✅ ' : tk.status === 'no_hecha' ? '  ❌ ' : tk.status === 'sin_respuesta' ? '  😶 ' : '  ⏳ ') + (tk.category === 'gerencia' ? '[G] ' : tk.category === 'extra' ? '[EXTRA] ' : '') + tk.title + '\n'
        }
        if (detalle && ADMIN) await enviar(ADMIN, secTpl(md, 'RESUMEN', { detalle }, '📋 *RESUMEN DEL DÍA — SECRETARIAS*\n{detalle}'), { tipo: 'secretaria' })
      }
    }
  } catch (e) { log('SEC tick:', e.message) }
}

async function manejarSecretaria(jid, phone, texto) {
  const { data: secsm } = await supabase.from('secretaries').select('*').ilike('phone', '%' + String(phone).slice(-9)).limit(1)
  const sec = (secsm || [])[0]
  if (!sec) return
  const hoy = secHoy()
  const md = await brain('secretaria')
  const nombre = (sec.full_name || '').split(' ')[0]
  const { data: abiertas } = await supabase.from('secretary_tasks').select('*').eq('secretary_id', sec.id).eq('date', hoy).eq('status', 'pendiente').is('answered_at', null).not('asked_at', 'is', null).order('ask_index')
  if (!abiertas || !abiertas.length) {
    // ¿esta pendiente su feedback del dia?
    if (sec.feedback_asked === hoy && sec.feedback_done !== hoy) {
      // si es una PREGUNTA no la tomes como "extra". Solo gerencia/admin la responden con datos.
      if (pareceConsulta(texto)) {
        if (await puedeQA(phone) && await atenderInterno(jid, phone, texto, 'GERENCIA')) return
        await enviar(jid, secTpl(md, 'NO_ENTENDI', { nombre }, 'Si hiciste algo EXTRA hoy, cuéntamelo sin forma de pregunta 🙌 (ej: "entregué documentos en la esquina").'), { tipo: 'secretaria' })
        return
      }
      const tf = (texto || '').toLowerCase().trim()
      await supabase.from('secretaries').update({ feedback_done: hoy }).eq('id', sec.id)
      if (/^(no|nada|ninguna|ninguno|no hice|nop|negativo)\b/.test(tf) || tf.length < 3) {
        await enviar(jid, secTpl(md, 'FEEDBACK_NO', { nombre }, '¡Perfecto {nombre}, día cerrado! Gracias por tu trabajo de hoy. 🙌'), { tipo: 'secretaria' })
      } else {
        await supabase.from('secretary_tasks').insert({ secretary_id: sec.id, title: String(texto).slice(0, 200).toUpperCase(), date: hoy, slot: 'tarde', category: 'extra', status: 'hecha', answered_at: new Date().toISOString(), answer: 'REPORTADO EN FEEDBACK DEL DIA' })
        await enviar(jid, secTpl(md, 'FEEDBACK_SI', { nombre }, '💪 ¡Anotado como EXTRA del día, {nombre}! Eso suma a tu productividad. ¡Gracias! 🙌'), { tipo: 'secretaria' })
        if (ADMIN) await enviar(ADMIN, '💪 EXTRA reportado por *' + sec.full_name + '*: ' + String(texto).slice(0, 200), { tipo: 'aviso_admin' })
      }
      return
    }
    return
  }
  const t = (texto || '').toLowerCase()

  // reprogramar: "mueve la 2 para mañana", "la 1 para el 15 a las 10", "cambia la 3 al viernes"
  if (/(reprogram|mueve|muev|cambia|pasa|posterga|para (el |ma[ñn]|pasado|hoy|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|al (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|\d))/.test(t)) {
    const fh = parseFechaHora(t)
    if (fh.date || fh.time) {
      const { data: deHoy } = await supabase.from('secretary_tasks').select('*').eq('secretary_id', sec.id).eq('date', hoy).not('ask_index', 'is', null).order('ask_index')
      let tarea = null
      const mi = t.replace(fh.matchFecha, ' ').replace(fh.matchHora, ' ').match(/(?:la|el|n[°º]?|tarea)?\s*(\d{1,2})\b/)
      if (mi) tarea = (deHoy || []).find(x => x.ask_index === parseInt(mi[1]))
      else if ((deHoy || []).filter(x => x.status === 'pendiente').length === 1) tarea = deHoy.find(x => x.status === 'pendiente')
      if (tarea) {
        const nd = fh.date || hoy
        await supabase.from('secretary_tasks').update({ date: nd, time: fh.time, slot: fh.time ? slotDeHora(fh.time) : tarea.slot, status: 'pendiente', ask_index: null, asked_at: null, reminded_at: null, answered_at: null, notified_at: null, answer: 'REPROGRAMADA POR CHAT: ' + String(texto).slice(0, 200) }).eq('id', tarea.id)
        await enviar(jid, secTpl(md, 'REPROGRAMADA', { nombre, titulo: tarea.title, fecha: fmtFechaEs(nd), hora: fh.time ? ' a las ' + fh.time : '' }, '🔄 Listo {nombre}, moví *{titulo}* para el {fecha}{hora}. Yo te lo recuerdo. 🙌'), { tipo: 'secretaria' })
        if (ADMIN) await enviar(ADMIN, '🔄 *' + sec.full_name + '* reprogramó "' + tarea.title + '" para el ' + fmtFechaEs(nd) + (fh.time ? ' ' + fh.time : ''), { tipo: 'aviso_admin' })
        return
      }
      await enviar(jid, secTpl(md, 'NO_ENTENDI', { nombre }, '{nombre}, no te entendí 😅 Para mover una tarea dime el número y la fecha, ej: *mueve la 2 para mañana a las 10*.'), { tipo: 'secretaria' })
      return
    }
  }

  const nums = [...t.matchAll(/\d+/g)].map(m => parseInt(m[0]))
  const esSi = /(listo|hecho|\bya\b|\bsi\b|\bsí\b|todo|complet|termin|\bok\b)/.test(t)
  const esNo = /(\bno\b|\baun\b|\baún\b|todav|falta)/.test(t)
  let hechas = []
  if (nums.length) hechas = abiertas.filter(x => nums.includes(x.ask_index))
  else if (esSi && !esNo) hechas = abiertas
  if (hechas.length) {
    for (const x of hechas) await supabase.from('secretary_tasks').update({ status: 'hecha', answered_at: new Date().toISOString(), answer: String(texto).slice(0, 300) }).eq('id', x.id)
    // ¿mencionó una actividad EXTRA junto a la respuesta? -> registrarla en el calendario
    const ex = extraerExtra(texto)
    if (ex) {
      await supabase.from('secretary_tasks').insert({ secretary_id: sec.id, title: ex.toUpperCase(), date: hoy, slot: slotDeHora(secHora()), category: 'extra', status: 'hecha', answered_at: new Date().toISOString(), answer: 'REPORTADO JUNTO AL CHECKLIST' })
      if (ADMIN) await enviar(ADMIN, '💪 EXTRA de *' + sec.full_name + '*: ' + ex, { tipo: 'aviso_admin' })
    }
    const resumen = (hechas.length === abiertas.length ? 'todo tu checklist quedó al día' : 'marqué: ' + hechas.map(x => x.title).join(', ')) + (ex ? '. Y anoté como EXTRA: ' + ex : '')
    await enviar(jid, secTpl(md, 'CONFIRMACION', { nombre, resumen }, '✅ ¡Anotado, {nombre}! {resumen}. ¡Gracias! 🙌'), { tipo: 'secretaria' })
  } else if (esNo) {
    for (const x of abiertas) await supabase.from('secretary_tasks').update({ status: 'no_hecha', answered_at: new Date().toISOString(), answer: String(texto).slice(0, 300) }).eq('id', x.id)
    await enviar(jid, secTpl(md, 'PENDIENTE', { nombre }, 'Anotado {nombre}, quedan como pendientes. Cualquier avance escríbeme *LISTO* o los números. 💪'), { tipo: 'secretaria' })
    if (ADMIN) await enviar(ADMIN, '⚠️ *' + sec.full_name + '* reporta pendientes: ' + abiertas.map(x => x.title).join(' | '), { tipo: 'aviso_admin' })
  } else {
    await enviar(jid, secTpl(md, 'NO_ENTENDI', { nombre }, '{nombre}, no te entendí 😅 Respóndeme *LISTO* si completaste todo, o los números de lo que ya está (ej: 1 y 3).'), { tipo: 'secretaria' })
  }
}

// Cobranza CONFIGURABLE por BUCKET de cuotas vencidas (bot_brains 'cobranza_cfg' = JSON):
// { al_dia:{avisos:[{dias,mensaje}]},           <- dias = días ANTES de vencer
//   v1:{avisos:[{dias,mensaje}], repetir:{cada_dias,mensaje}},   <- 1 vencida; dias = días DESPUÉS
//   v2:{...}, v3:{...}, v4:{...} }               <- 2, 3, 4+ vencidas
function tokensCob(msg, v) {
  return String(msg || '').split('{nombre}').join(v.nombre).split('{lote}').join(v.lote).split('{proyecto}').join(v.proy)
    .split('{cuota}').join(v.q?.installment_number ?? '').split('{monto}').join(soles(v.deuda)).split('{fecha}').join(v.q?.due_date ?? '')
    .split('{dias}').join(v.dias ?? '').split('{nvencidas}').join(v.nV ?? '').split('{deuda}').join(soles(v.deuda))
}
// ---- a que numero(s) del cliente escribe el bot ----
// Cada celular tiene su check en la ficha del cliente (phone_bot / phone2_bot) y su validacion.
// Solo se escribe a los que esten MARCADOS y VALIDADOS. Ninguno marcado = no se escribe nada.
function telefonosBot(c) {
  const out = []
  if (c?.phone && c.phone_valid && c.phone_bot !== false) out.push(c.phone)
  if (c?.phone2 && c.phone2_valid && c.phone2_bot) out.push(c.phone2)
  return out
}
async function enviarCliente(c, texto, opts) {
  for (const tel of telefonosBot(c)) await enviar(tel, texto, opts)
}

async function cobranzaVentaCfg(v, cfg, hoyISO) {
  const c = v.client
  const nombre = (c.full_name || '').split(' ')[0]
  const lote = `Mz ${v.lot.mz} Lt ${v.lot.lt}`
  const proy = v.lot.project?.name || 'su proyecto'
  const vencidas = (v.installments || []).filter(i => i.status === 'vencido').sort((a, b) => a.installment_number - b.installment_number)
  const pendientes = (v.installments || []).filter(i => i.status === 'pendiente').sort((a, b) => a.installment_number - b.installment_number)
  const nV = vencidas.length
  // AL DÍA (0 vencidas): avisos X días ANTES sobre la próxima cuota pendiente
  if (nV === 0) {
    const b = cfg.al_dia
    if (!b || !pendientes.length) return
    const q = pendientes[0], d = diasEntre(q.due_date, hoyISO), deuda = Number(q.amount) - Number(q.amount_paid)
    for (const r of (b.avisos || [])) {
      if (Number(r.dias) === d && (r.mensaje || '').trim() && !(await yaAvisado({ installment_id: q.id, tipo: 'cob_al' + d, dias: 25 }))) {
        await enviarCliente(c, tokensCob(r.mensaje, { nombre, lote, proy, q, deuda, nV, dias: d }), { tipo: 'cob_al' + d, installment_id: q.id, sale_id: v.id, client_id: c.id, project_id: v.lot.project?.id })
        await espera(delayAleatorio())
      }
    }
    return
  }
  // 1/2/3/4+ vencidas: bucket correspondiente, sobre la cuota vencida más antigua (dias = días DESPUÉS)
  const key = nV >= 4 ? 'v4' : 'v' + nV
  const b = cfg[key]
  if (!b || !vencidas.length) return
  const q = vencidas[0], dd = diasEntre(hoyISO, q.due_date), deuda = Number(q.amount) - Number(q.amount_paid)
  const vars = { nombre, lote, proy, q, deuda, nV, dias: dd }
  let mando = false
  for (const r of (b.avisos || [])) {
    if (Number(r.dias) === dd && (r.mensaje || '').trim() && !(await yaAvisado({ installment_id: q.id, tipo: 'cob_' + key + '_' + dd, dias: 45 }))) {
      await enviarCliente(c, tokensCob(r.mensaje, vars), { tipo: 'cob_' + key, installment_id: q.id, sale_id: v.id, client_id: c.id, project_id: v.lot.project?.id })
      await espera(delayAleatorio()); mando = true
    }
  }
  const rep = b.repetir
  if (!mando && rep && (rep.mensaje || '').trim() && Number(rep.cada_dias) > 0) {
    const base = Math.max(0, ...(b.avisos || []).map(r => Number(r.dias) || 0))
    const cada = Math.max(1, Number(rep.cada_dias) || 3)
    const over = dd - base
    if (over > 0 && over % cada === 0 && !(await yaAvisado({ installment_id: q.id, tipo: 'cob_' + key + '_rep' + dd, dias: 90 }))) {
      await enviarCliente(c, tokensCob(rep.mensaje, vars), { tipo: 'cob_' + key + '_rep', installment_id: q.id, sale_id: v.id, client_id: c.id, project_id: v.lot.project?.id })
      await espera(delayAleatorio())
    }
  }
}

async function cobranza() {
  if (!(await flag('bot_activo')) || !(await flag('cobranza_activa'))) { log('COBRANZA DESACTIVADA desde el panel'); return }
  log('=== BARRIDO DE COBRANZA ===')
  CEREBRO_COB = await brain('cobranza')
  try { await supabase.rpc('mark_overdue_installments') } catch (e) { log('mark_overdue:', e.message) }
  // tolerancia de redondeo: cuotas con faltante <= S/2 se consideran pagadas (condonacion de residuo)
  try {
    const { data: casi } = await supabase.from('installments').select('id, amount, amount_paid').neq('status', 'pagado').gt('amount_paid', 0)
    let cur = 0
    for (const q of (casi || [])) {
      const falta = Number(q.amount) - Number(q.amount_paid)
      if (falta > 0 && falta <= 2) { await supabase.from('installments').update({ status: 'pagado', amount: q.amount_paid }).eq('id', q.id); cur++ }
    }
    if (cur) log('TOLERANCIA: ' + cur + ' cuotas con residuo <= S/2 marcadas como pagadas')
  } catch (e) { log('tolerancia:', String(e.message || e)) }
  const hoyISO = new Date().toISOString().slice(0, 10)

  const { data: ventas, error } = await supabase.from('sales')
    .select('id, auto_cobranza, client:clients!sales_client_id_fkey(id, full_name, phone, phone_valid, phone_bot, phone2, phone2_valid, phone2_bot), lot:lots!inner(mz, lt, project:projects(id, name)), installments(id, installment_number, amount, amount_paid, due_date, status)')
    .eq('status', 'en_proceso').eq('auto_cobranza', true)
  if (error) { log('ERROR consultando ventas:', error.message); return }

  const cfg = parseJSON(await brain('cobranza_cfg'))
  const usarCfg = cfg && (cfg.al_dia || cfg.v1 || cfg.v2 || cfg.v3 || cfg.v4)
  let alertasHumanas = []
  for (const v of ventas || []) {
    const c = v.client
    if (!telefonosBot(c).length) continue   // ningun celular marcado/validado = el bot no le escribe
    // COBRANZA por número: si la sesión del proyecto de este lote tiene la cobranza apagada, se salta
    const sCob = sesDeProyecto(v.lot?.project?.id) || sesCorporativa()
    if (sCob?.row && sCob.row.cobranza_activo === false) continue
    if (usarCfg) { await cobranzaVentaCfg(v, cfg, hoyISO); continue }   // reglas por días configurables
    const nombre = (c.full_name || '').split(' ')[0]
    const lote = `Mz ${v.lot.mz} Lt ${v.lot.lt}`
    const proy = v.lot.project?.name || 'su proyecto'
    const vencidas = (v.installments || []).filter(i => i.status === 'vencido').sort((a, b) => a.installment_number - b.installment_number)
    const pendientes = (v.installments || []).filter(i => i.status === 'pendiente').sort((a, b) => a.installment_number - b.installment_number)
    const nV = vencidas.length
    const deudaVenc = vencidas.reduce((s, i) => s + Number(i.amount) - Number(i.amount_paid), 0)

    if (nV >= 3) {
      // NIVEL C: severo cada 3 dias
      if (!(await yaAvisado({ sale_id: v.id, tipo: 'nivel_C', dias: 3 }))) {
        await enviarCliente(c, msjC(nombre, lote, proy, nV, deudaVenc), { tipo: 'nivel_C', sale_id: v.id, client_id: c.id, project_id: v.lot.project?.id })
        await espera(delayAleatorio())
      }
    } else if (nV === 2) {
      // NIVEL B: cada 3 dias
      if (!(await yaAvisado({ sale_id: v.id, tipo: 'nivel_B', dias: 3 }))) {
        await enviarCliente(c, msjB(nombre, lote, proy, nV, deudaVenc), { tipo: 'nivel_B', sale_id: v.id, client_id: c.id, project_id: v.lot.project?.id })
        await espera(delayAleatorio())
      }
    } else if (nV === 1) {
      // NIVEL A-INSISTENCIA: dias +2 y +4; al dia +5 alerta de gestion humana (una vez)
      const q = vencidas[0]
      const dd = diasEntre(hoyISO, q.due_date)
      const deuda = Number(q.amount) - Number(q.amount_paid)
      if (dd === 2 && !(await yaAvisado({ installment_id: q.id, tipo: 'insist_2', dias: 30 }))) {
        await enviarCliente(c, msjInsist(nombre, lote, proy, q, deuda, dd), { tipo: 'insist_2', installment_id: q.id, sale_id: v.id, client_id: c.id, project_id: v.lot.project?.id })
        await espera(delayAleatorio())
      } else if (dd === 4 && !(await yaAvisado({ installment_id: q.id, tipo: 'insist_4', dias: 30 }))) {
        await enviarCliente(c, msjInsist(nombre, lote, proy, q, deuda, dd), { tipo: 'insist_4', installment_id: q.id, sale_id: v.id, client_id: c.id, project_id: v.lot.project?.id })
        await espera(delayAleatorio())
      } else if (dd >= 5 && !(await yaAvisado({ sale_id: v.id, tipo: 'gestion_humana', dias: 45 }))) {
        await supabase.from('scheduled_messages').insert({
          recipient_phone: 'PANEL', body: 'PASA A GESTION HUMANA', tipo: 'gestion_humana',
          sale_id: v.id, client_id: c.id, scheduled_for: new Date().toISOString(), status: 'enviado', sent_at: new Date().toISOString(),
        })
        alertasHumanas.push(`• ${c.full_name} — ${lote} (${soles(deuda)}, venció ${q.due_date})`)
      }
    } else if (pendientes.length) {
      // NIVEL A: 5 / 3 / 0 dias antes del proximo vencimiento
      const q = pendientes[0]
      const d = diasEntre(q.due_date, hoyISO)
      const deuda = Number(q.amount) - Number(q.amount_paid)
      const mapa = { 5: 'A5', 3: 'A3', 0: 'A0' }
      const cuando = mapa[d]
      if (cuando && !(await yaAvisado({ installment_id: q.id, tipo: cuando, dias: 20 }))) {
        await enviarCliente(c, msjA(nombre, lote, proy, q, deuda, cuando), { tipo: cuando, installment_id: q.id, sale_id: v.id, client_id: c.id, project_id: v.lot.project?.id })
        await espera(delayAleatorio())
      }
    }
  }

  log('=== FIN BARRIDO (enviados hoy:', enviadosHoy, ') ===')
  if (ADMIN) {
    let rep = `🤖 AGENTE URBIS - Cobranza del día lista. Enviados hoy: ${enviadosHoy}.`
    if (alertasHumanas.length) rep += `\n\n🙋 *REQUIEREN GESTIÓN HUMANA* (1 cuota vencida, sin pago tras insistencias):\n` + alertasHumanas.join('\n')
    await enviar(ADMIN, rep, { tipo: 'reporte' })
  }
}

// ---------- MODULO 2: LEADS ENTRANTES ----------
// La conversacion ahora es por (telefono, sesion): el mismo numero puede chatear
// con el WhatsApp de Cashibo Y el de Pucallpa sin mezclarse. Sin sesion dada se
// usa la conversacion mas reciente del telefono (compatibilidad).
async function estadoConv(phone, ses) {
  let q = supabase.from('whatsapp_conversations').select('*').eq('phone', phone)
  const sid = sesId(ses)
  if (sid) q = q.eq('session_id', sid)
  const { data } = await q.order('last_message_at', { ascending: false, nullsFirst: false }).limit(1)
  return (data || [])[0] || null
}
async function setConv(phone, campos, ses) {
  const existe = await estadoConv(phone, ses)
  if (existe) { const { error } = await supabase.from('whatsapp_conversations').update({ ...campos, last_message_at: new Date().toISOString() }).eq('id', existe.id); if (error) log('DB conv upd:', error.message) }
  else {
    const S = (ses && ses.row) ? ses : sesCorporativa()
    const { error } = await supabase.from('whatsapp_conversations').insert({
      phone, session_id: sesId(S), project_id: (S && S.row && S.row.project_id) || null,
      ...campos, last_message_at: new Date().toISOString(),
    })
    if (error) log('DB conv ins:', error.message)
  }
}

// ===== FLUJO DE VENTAS GUIADO (sin IA / sin tokens) =====
async function detectarProyecto(texto) {
  // solo proyectos HABILITADOS para el bot (projects.bot_enabled). Los deshabilitados
  // no se detectan ni se listan; si queda uno solo, pedirProyecto lo usa directo.
  const { data: proys } = await supabase.from('projects').select('id, name').eq('bot_enabled', true).order('created_at')
  const txt = String(texto || '').toLowerCase()
  // palabras genéricas que NO identifican un proyecto (ciudad/relleno). "Pucallpa" NO va aquí:
  // es lo que distingue "Las Praderas de Pucallpa" de "Las Praderas de Cashibo".
  const stop = ['las', 'los', 'del', 'de', 'la', 'el', 'y', 'en', 'sobre', 'info', 'informacion', 'información', 'proyecto', 'mas', 'más', 'lote', 'lotes', 'para', 'quiero', 'hola', 'buenas']
  // puntúa cada proyecto por cuántas de sus palabras distintivas aparecen en el texto
  const scored = (proys || []).map(p => {
    const words = p.name.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stop.includes(w))
    const hits = words.filter(w => txt.includes(w)).length
    return { p, hits }
  }).filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits)
  // un ganador claro (o único match); si hay empate al tope, es ambiguo -> null (se preguntará)
  let pr = null
  if (scored.length === 1) pr = scored[0].p
  else if (scored.length >= 2 && scored[0].hits > scored[1].hits) pr = scored[0].p
  return { proys: proys || [], pr }
}

// Deriva el lead a un asesor humano y corta la conversación automática.
async function pasarAsesor(ses, jid, phone, lead, motivo) {
  await setConv(phone, { flow_state: 'humano' }, ses)
  await supabase.from('leads').update({ status: 'negociacion', temperature: 'caliente' }).eq('id', lead.id).then(() => {}).catch(() => {})
  const primer = (lead.full_name && lead.full_name !== 'POR CONFIRMAR') ? ', ' + lead.full_name.split(' ')[0] : ''
  await enviar(jid, `¡Con gusto${primer}! 🙌 Te paso con un *asesor especializado* que te ayudará con precios, disponibilidad y a coordinar tu visita. Te escribe en breve. 🌳`, { tipo: 'lead_flujo', lead_id: lead.id, ses })
  const { data: l2 } = await supabase.from('leads').select('full_name, project:projects(name, lead_notify_phone)').eq('id', lead.id).maybeSingle()
  const msj = '📞 *LEAD PIDE ASESOR*\nProyecto: ' + (l2?.project?.name || '-') + '\nNombre: ' + (l2?.full_name || '-') + '\nTel: ' + phone + '\nMotivo: ' + motivo + '\n\n→ Está en el KANBAN, contáctalo pronto.'
  const asesor = String(l2?.project?.lead_notify_phone || '').replace(/\D/g, '')
  const destinos = new Set(); if (ADMIN) destinos.add(ADMIN); if (asesor.length >= 9) destinos.add(asesor)
  for (const d of destinos) await enviar(d, msj, { tipo: 'aviso_admin' })   // avisos internos: por su propio chat/corporativa
}


// ============ FLUJO CONFIGURABLE POR PROYECTO (projects.bot_flow) ============
// steps[]: { id, tipo:'mensaje'|'pregunta', texto, media[], pasar_asesor,
//            opciones[{label, claves, ir_a, pasar_asesor}] }
// Biblioteca de material del flujo: media_lib=[{id,tipo:'imagen'|'video'|'link',url,desc}]; los pasos
// y el bombardeo referencian por id. Envía cada item según su tipo.
async function enviarMediaLib(ses, jid, lib, ids) {
  if (!Array.isArray(ids) || !ids.length) return
  const byId = {}; for (const it of (lib || [])) byId[String(it.id)] = it
  for (const id of ids) {
    const it = byId[String(id)]
    if (!it || !it.url) continue
    if (it.tipo === 'video') await enviarArchivo(jid, it.url, 'video', it.desc || '', ses)
    else if (it.tipo === 'pdf') await enviarArchivo(jid, it.url, 'documento', it.desc || '', ses)
    else if (it.tipo === 'link') await enviar(jid, (it.desc ? '*' + it.desc + '*\n' : '') + it.url, { tipo: 'lead_flujo', ses })
    else await enviarArchivo(jid, it.url, 'foto', it.desc || '', ses)
  }
}
function parseFlow(proy) {
  try { const f = proy?.bot_flow; const o = typeof f === 'string' ? JSON.parse(f) : f; return (o && Array.isArray(o.steps) && o.steps.length) ? o : null } catch { return null }
}
// bot_flow crudo (aunque no tenga pasos) — para los textos de bienvenida / pedir nombre
function parseFlowRaw(proy) { try { const f = proy?.bot_flow; return typeof f === 'string' ? JSON.parse(f) : (f || null) } catch { return null } }
// texto configurable del proyecto con fallback y variable {proyecto}
function textoFlujo(flow, key, def, proyName) {
  const t = (flow && flow[key] && String(flow[key]).trim()) ? String(flow[key]) : def
  return t.split('{proyecto}').join(proyName || 'nuestros proyectos')
}
const pasoPorId = (flow, id) => (flow.steps || []).find(s => String(s.id) === String(id))
const idxDePaso = (flow, id) => (flow.steps || []).findIndex(s => String(s.id) === String(id))
// ejecuta pasos desde un índice; envía mensajes+adjuntos y se detiene en la 1ª pregunta (o al final)
async function correrFlujo(ses, jid, phone, lead, proy, flow, idx) {
  const steps = flow.steps || []
  PAUSA_MS = Math.max(0, Math.round(Number(flow.pausa_seg ?? 3) * 1000))   // pausa entre mensajes de este flujo
  let guard = 0
  while (idx >= 0 && idx < steps.length && guard++ < 50) {
    const s = steps[idx]
    if (s.texto) {
      const primerNom = (lead.full_name && lead.full_name !== 'POR CONFIRMAR') ? lead.full_name.split(' ')[0] : ''
      const txt = String(s.texto).split('{proyecto}').join(proy?.name || 'nuestro proyecto').split('{nombre}').join(primerNom)
      await enviar(jid, txt, { tipo: 'lead_flujo', lead_id: lead.id, ses })
    }
    await enviarMediaLib(ses, jid, flow.media_lib || [], s.media)
    if (s.pasar_asesor) { await pasarAsesor(ses, jid, phone, lead, 'flujo'); return }
    if (s.tipo === 'pregunta') {
      // una pregunta SIEMPRE espera la respuesta del lead (tenga opciones cerradas o sea abierta)
      if ((s.opciones || []).length) {
        const ops = s.opciones.map((o, i) => (i + 1) + '. ' + o.label).join('\n')
        await enviar(jid, ops + '\n\n_(responde con el número o en tus palabras)_', { tipo: 'lead_flujo', lead_id: lead.id, ses })
      }
      await setConv(phone, { flow_state: 'flow', flow_step: String(s.id), flow_reasks: 0 }, ses)
      return
    }
    idx++
  }
  await supabase.from('leads').update({ status: 'interesado', temperature: 'caliente' }).eq('id', lead.id)
  await setConv(phone, { flow_state: 'completado', flow_step: null }, ses)
  await finalizarLead(ses, jid, phone, lead)
}
// arranca el flujo del proyecto (100% configurable desde el panel).
// Sin flujo configurado en el panel: no se inventa nada; se registra el lead y se avisa al asesor.
async function iniciarFlujoProyecto(ses, jid, phone, lead) {
  const { data: proy } = await supabase.from('projects').select('*').eq('id', lead.project_id).maybeSingle()
  await setConv(phone, { project_id: lead.project_id || null }, ses)   // el chat queda etiquetado con su proyecto
  const flow = parseFlow(proy)
  if (proy && flow) { await correrFlujo(ses, jid, phone, lead, proy, flow, 0); return }
  await setConv(phone, { flow_state: 'completado', flow_step: null }, ses)
  await finalizarLead(ses, jid, phone, lead)
}
// Único paso fijo aparte del reconocimiento automático: si no se identificó el proyecto, preguntar cuál.
// Con un solo proyecto no se pregunta; con varios, se listan y se elige por número o palabra clave.
// (Solo pasa en la sesión CORPORATIVA sin proyecto: en los números por proyecto nunca se pregunta.)
async function pedirProyecto(ses, jid, phone, lead, proys) {
  const lista = proys || []
  // ningún proyecto habilitado para el bot: no hay nada que ofrecer → a un asesor
  if (lista.length === 0) { await pasarAsesor(ses, jid, phone, lead, 'sin_proyectos_bot'); return }
  if (lista.length === 1) {
    await supabase.from('leads').update({ project_id: lista[0].id }).eq('id', lead.id)
    lead.project_id = lista[0].id
    await iniciarFlujoProyecto(ses, jid, phone, lead)
    return
  }
  await setConv(phone, { flow_state: 'espera_proyecto' }, ses)
  await enviar(jid, `¡Hola! 👋 ¿Sobre qué proyecto quieres información?${lista.map((p, i) => `\n${i + 1}. *${p.name}*`).join('')}\n\nRespóndeme con el número o el nombre.`, { tipo: 'lead_flujo', lead_id: lead.id, ses })
}
// respuesta del lead dentro de un flujo (número o palabra clave -> rama)
async function responderFlujo(ses, jid, phone, lead, conv, corto) {
  const { data: proy } = await supabase.from('projects').select('*').eq('id', lead.project_id).maybeSingle()
  const flow = parseFlow(proy)
  const step = flow ? pasoPorId(flow, conv.flow_step) : null
  if (!proy || !flow || !step) { await setConv(phone, { flow_state: 'completado', flow_step: null }, ses); await finalizarLead(ses, jid, phone, lead); return }
  const ops = step.opciones || []
  // pregunta ABIERTA (sin opciones): acepta cualquier respuesta, la guarda y avanza al siguiente paso
  if (!ops.length) {
    await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('P: ' + (step.texto || '') + ' → R: ' + corto).slice(0, 500) })
    if (step.pasar_asesor) { await pasarAsesor(ses, jid, phone, lead, 'flujo'); return }
    await correrFlujo(ses, jid, phone, lead, proy, flow, idxDePaso(flow, step.id) + 1)
    return
  }
  let elegida = null
  const soloNum = /^\s*\d+\s*$/.test(corto)
  const n = parseInt(corto.replace(/\D/g, ''), 10)
  if (soloNum && n >= 1 && n <= ops.length) elegida = ops[n - 1]
  if (!elegida) { const t = corto.toLowerCase(); elegida = ops.find(o => String(o.claves || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean).some(k => t.includes(k))) }
  if (!elegida) {
    const opsTxt = ops.map((o, i) => (i + 1) + '. ' + o.label).join('\n')
    await enviar(jid, 'No te entendí bien 😅 Elige una opción:\n' + opsTxt + '\n\n_(responde con el número o en tus palabras)_', { tipo: 'lead_flujo', lead_id: lead.id, ses })
    return
  }
  await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('P: ' + (step.texto || '') + ' → R: ' + elegida.label).slice(0, 500) })
  if (elegida.pasar_asesor || step.pasar_asesor) { await pasarAsesor(ses, jid, phone, lead, 'flujo'); return }
  let nextIdx = elegida.ir_a ? idxDePaso(flow, elegida.ir_a) : (idxDePaso(flow, step.id) + 1)
  if (nextIdx < 0) nextIdx = idxDePaso(flow, step.id) + 1
  await correrFlujo(ses, jid, phone, lead, proy, flow, nextIdx)
}
async function finalizarLead(ses, jid, phone, lead) {
  // Sin mensaje de cierre fijo al cliente: si quieres una despedida, ponla como último paso del flujo (panel).
  // Aquí solo se registra y se avisa al asesor.
  const { data: acts } = await supabase.from('lead_activities').select('note').eq('lead_id', lead.id).order('created_at')
  const { data: l2 } = await supabase.from('leads').select('full_name, project:projects(name, lead_notify_phone)').eq('id', lead.id).maybeSingle()
  // Solo las RESPUESTAS de las preguntas cerradas (notas "P: <pregunta> → R: <respuesta>"),
  // sin PREFERENCIA ni ruido del chat. Se muestran como "pregunta → respuesta" para el asesor.
  const resp = (acts || [])
    .filter(a => /^P: /.test(a.note))
    .map(a => '• ' + a.note.replace(/^P:\s*/, '').replace(/\s*→\s*R:\s*/, ' → '))
    .join('\n')
  const msj = '🔥 *LEAD CALIFICADO*\nProyecto: ' + (l2?.project?.name || '-') + '\nNombre: ' + (l2?.full_name || '-') + '\nTel: ' + phone + (resp ? '\n\n📝 *Respuestas:*\n' + resp : '') + '\n\n→ Ya está en el KANBAN.'
  const asesor = String(l2?.project?.lead_notify_phone || '').replace(/\D/g, '')
  const destinos = new Set()
  if (ADMIN) destinos.add(ADMIN)
  if (asesor.length >= 9) destinos.add(asesor)            // asesor asignado del proyecto
  for (const d of destinos) await enviar(d, msj, { tipo: 'aviso_admin' })
}

async function manejarEntrante(ses, jid, jidPN, texto, pushName, media, waId) {
  let phone = telDeJid(jidPN || jid)
  // LID sin numero real: recuperar el telefono verdadero desde la conversacion ya registrada
  if (!jidPN && String(jid).endsWith('@lid')) {
    const lidDig = telDeJid(jid)
    const { data: cLid } = await supabase.from('whatsapp_conversations').select('phone').ilike('wa_jid', '%' + lidDig + '%').not('phone', 'ilike', lidDig).limit(1)
    if (cLid && cLid[0] && cLid[0].phone) { phone = String(cLid[0].phone); log('LID mapeado a', phone) }
  }
  if (!texto && !media) return
  const corto = String(texto || '').trim().slice(0, 400)
  log('ENTRANTE de', phone, 'por', ses?.row?.label || 'PRINCIPAL', ':', corto.slice(0, 60) || ('[' + (media?.tipo || 'media') + ']'))
  // registrar SIEMPRE la conversacion y el mensaje entrante (incluido el ADMIN, para verlo en el panel)
  let conv = await estadoConv(phone, ses)
  if (!conv) { await setConv(phone, { wa_jid: jid }, ses); conv = await estadoConv(phone, ses) }
  else await supabase.from('whatsapp_conversations').update({ wa_jid: jid, last_message_at: new Date().toISOString() }).eq('id', conv.id)
  // tráfico REAL de WhatsApp sobre una conversación que quedó marcada como PRUEBA
  // (la marcó la consola de pruebas): promoverla a real, si no el auto-avance del
  // flujo enviaría en modo simulacro y el lead nunca recibiría los mensajes.
  if (!TEST_ACTIVE && conv?.is_test) {
    await supabase.from('whatsapp_conversations').update({ is_test: false }).eq('id', conv.id).then(() => {}, () => {})
    if (conv.lead_id) await supabase.from('leads').update({ is_test: false }).eq('id', conv.lead_id).then(() => {}, () => {})
    conv.is_test = false
    log('CONVERSACION real des-marcada de PRUEBA:', phone)
  }
  await supabase.from('whatsapp_messages').insert({
    conversation_id: conv?.id || null, direction: 'in', body: corto || null, delivery_status: 'recibido',
    media_url: media?.url || null, media_type: media?.tipo || null, media_name: media?.name || null,
    meta_message_id: waId ? String(waId) : null,   // id de WhatsApp: evita duplicar con el backup de historial
  }).then(() => {}).catch(() => {})
  _convSesCache.delete(phone)   // refrescar el cache de ruteo (la conv acaba de moverse/crearse)
  // solo media sin texto: queda registrada para verla en el panel; no hay nada que responder
  if (!corto) return

  if (phone === ADMIN) {
    if (await comandosPrivilegiados(jid, phone, texto)) return
    // el ADMIN: comandos configurables, comando gratis o Q&A con IA (sin importar el checklist)
    if (await comandosGerencia(jid, phone, texto)) return
    if (await atenderInterno(jid, phone, texto, 'GERENCIA')) return
    // si el admin esta registrado en el control de actividades, sus respuestas tambien cuentan
    await manejarSecretaria(jid, phone, texto).catch(() => {})
    return
  }
  // PALABRA DE SEGURIDAD: "iniciourbis2026" reinicia el bot para este chat (modo prueba)
  if (corto.toLowerCase() === 'iniciourbis2026') {
    const { data: convR } = await supabase.from('whatsapp_conversations').select('id, lead_id').eq('phone', phone).maybeSingle()
    const { data: leadsR } = await supabase.from('leads').select('id').ilike('phone', `%${phone.slice(-9)}%`)
    for (const L of (leadsR || [])) {
      await supabase.from('lead_activities').delete().eq('lead_id', L.id)
      await supabase.from('scheduled_messages').update({ lead_id: null }).eq('lead_id', L.id)
      await supabase.from('leads').delete().eq('id', L.id)
    }
    if (convR) {
      await supabase.from('whatsapp_messages').delete().eq('conversation_id', convR.id)
      await supabase.from('whatsapp_conversations').delete().eq('id', convR.id)
    }
    await enviar(jid, '🔄 BOT REINICIADO PARA ESTE CHAT (modo prueba). Escriba cualquier mensaje para comenzar de nuevo.', { tipo: 'reporte' })
    log('RESET iniciourbis2026 para', phone)
    return
  }

  if (!(await flag('bot_activo'))) { log('BOT APAGADO: ignorando a', phone); return }
  const tnum = await tipoNumero(phone)
  if (tnum === 'silencio') { log('SILENCIO TOTAL: ignorando a', phone); return }
  if (tnum === 'desactivado') { log('NUMERO ADMINISTRATIVO: sin respuesta a', phone); return }
  if (tnum === 'secretaria' || tnum === 'gerencia') {
    // GERENCIA (Victor/Alex): comandos privilegiados (tarea/aprende), comandos gratis y Q&A;
    // las secretarias solo hacen su control de actividades. No se interrumpe un checklist con IA.
    if (tnum === 'gerencia') {
      if (await comandosPrivilegiados(jid, phone, texto)) return
      if (!(await tieneChecklistAbierto(phone))) {
        if (await comandosGerencia(jid, phone, texto)) return           // comandos configurables (palabra clave -> consulta o texto)
        if (await atenderInterno(jid, phone, texto, 'GERENCIA')) return  // comandos gratis + IA de respaldo
      }
    }
    await manejarSecretaria(jid, phone, texto).catch(e => log('SEC resp:', e.message)); return
  }

  // CHAT EN MODO HUMANO: alguien del panel atiende este chat — el bot se calla
  // por completo aquí (leads y clientes). Vuelve con el botón "Devolver al bot".
  if (conv && conv.modo === 'humano') {
    if (conv.lead_id) await supabase.from('lead_activities').insert({ lead_id: conv.lead_id, note: ('WHATSAPP: ' + corto).toUpperCase().slice(0, 500) }).then(() => {}).catch(() => {})
    log('MODO HUMANO: sin respuesta automatica a', phone)
    return
  }

  // ¿es cliente?
  const p9 = phone.slice(-9)
  const { data: clientes } = await supabase.from('clients').select('id, full_name').ilike('phone', `%${p9}%`).limit(1)
  const cliente = (clientes || [])[0]
  if (tnum === 'cliente' && !cliente) return
  if (cliente) {
    // COBRANZA por número: si la cobranza de esta sesión está apagada, no se
    // auto-responde al cliente (el mensaje queda registrado para atención humana).
    if (ses?.row && ses.row.cobranza_activo === false) { log('COBRANZA DEL NUMERO APAGADA (' + (ses.row.label || 'PRINCIPAL') + '): sin auto-respuesta a cliente', phone); return }
    const primer = (cliente.full_name || '').split(' ')[0]
    // Flujo de respuesta configurable (bot_brains 'cobranza_flow' = JSON):
    // [{ claves:"ya pague, voucher", accion:"responder"|"asesor", respuesta:"..." }]
    const reglas = parseJSON(await brain('cobranza_flow'))
    if (Array.isArray(reglas) && reglas.length) {
      const r = reglas.find(x => matchClaves(x.claves, corto))
      if (r) {
        await enviar(jid, String(r.respuesta || '').trim() || (r.accion === 'asesor' ? 'Con gusto, un asesor se comunicará contigo en breve. 🙌' : '¡Gracias! 🙌 Recibido.'), { tipo: 'auto_cliente', client_id: cliente.id, ses })
        if (ADMIN) await enviar(ADMIN, (r.accion === 'asesor' ? '📞 CLIENTE PIDE AYUDA/ASESOR' : '🤖 CLIENTE') + ` *${cliente.full_name}* (${phone}):\n"${corto}"`, { tipo: 'aviso_admin' })
        return
      }
    }
    // por defecto: reconocer "ya pagué"
    if (/pag(ue|ué|ado)|voucher|deposit|transferi|constancia/i.test(corto)) {
      await enviar(jid, `¡Gracias ${primer}! 🙌 Hemos recibido su mensaje. Nuestro equipo verificará el pago y le confirmaremos en breve.`, { tipo: 'auto_cliente', client_id: cliente.id, ses })
      if (ADMIN) await enviar(ADMIN, `🤖 CLIENTE *${cliente.full_name}* (${phone}) escribió:\n"${corto}"\n\n→ Posible pago por verificar en CUOTAS.`, { tipo: 'aviso_admin' })
    }
    return // clientes: no aplicar flujo de leads
  }

  // ¿lead existente o nuevo? — flujo guiado
  const { data: leadsEx } = await supabase.from('leads').select('id, full_name, status, project_id').ilike('phone', `%${p9}%`).limit(1)
  let lead = (leadsEx || [])[0]
  const estado = conv?.flow_state || null

  // VENTAS apagado: el bot NO conversa con leads. Solo registra el nuevo en el Kanban
  // (sin responder) para no perderlo; los clientes y el equipo (arriba) sí se atienden.
  // LEADS por número: si el global LEADS está apagado O el de esta sesión, el
  // lead se registra en silencio (sin responderle) para no perderlo del Kanban.
  if (!(await flag('ia_activa')) || (ses?.row && ses.row.leads_activo === false)) {
    // Registro SILENCIOSO en el Kanban (sin avisar al admin, para no llenar de reportes).
    // Solo si parece un teléfono real (evita crear "leads" por LIDs de personas registradas).
    if (!lead && /^\d{9,13}$/.test(phone) && phone.length <= 13) {
      await supabase.from('leads').insert({
        full_name: (pushName || 'POR CONFIRMAR').toUpperCase(), phone,
        source: 'whatsapp', status: 'nuevo', optin_whatsapp: true, optin_date: new Date().toISOString(),
      }).then(() => {}).catch(() => {})
    }
    log('VENTAS APAGADO: no se atiende como lead', phone)
    return
  }

  // ESCALADA INMEDIATA: si en CUALQUIER momento pide asesor/humano, corta y lo deriva ya.
  if (lead && estado && estado !== 'humano' && estado !== 'completado' &&
      /\basesor|humano|persona real|hablar con (alguien|un)|que me llamen|ll[aá]men|vendedor|encargado|un agente/i.test(corto)) {
    await pasarAsesor(ses, jid, phone, lead, 'pidio_asesor')
    return
  }

  // Proyecto de ESTA sesión: en los números por proyecto el bot nunca pregunta
  // "¿qué proyecto?" — el número al que escribieron YA define el proyecto.
  const proyDeSesion = ses?.row?.project_id || null

  // 1) PRIMER CONTACTO: el número define el proyecto (o se reconoce del texto); luego corre el flujo del panel.
  if (!lead) {
    let pr = null, proys = []
    if (proyDeSesion) pr = { id: proyDeSesion, name: ses?.row?.label || '' }
    else { const d = await detectarProyecto(corto); pr = d.pr; proys = d.proys }
    const { data: nuevoLead } = await supabase.from('leads').insert({
      full_name: (pushName || 'POR CONFIRMAR').toUpperCase(), phone,
      source: 'whatsapp', status: 'nuevo', project_id: pr?.id || null,
      optin_whatsapp: true, optin_date: new Date().toISOString(),
    }).select().single()
    lead = nuevoLead
    if (ADMIN) await enviar(ADMIN, `🤖 NUEVO LEAD: ${phone}${pr && pr.name ? ' · interesado en ' + pr.name : ''} ("${corto.slice(0, 50)}").`, { tipo: 'aviso_admin' })
    if (pr) { await iniciarFlujoProyecto(ses, jid, phone, lead); return }   // proyecto identificado → directo al flujo del panel
    await pedirProyecto(ses, jid, phone, lead, proys)                       // no identificado → pedir cuál (solo corporativa)
    return
  }

  // 2) PROYECTO (si no se detectó al inicio o quedó ambiguo — solo pasa en la corporativa)
  if (estado === 'espera_proyecto') {
    const { proys } = await detectarProyecto('')
    const n = parseInt(corto.replace(/\D/g, ''), 10)
    let pr = (!isNaN(n) && n >= 1 && n <= proys.length) ? proys[n - 1] : null
    if (!pr) pr = (await detectarProyecto(corto)).pr
    if (!pr) { await enviar(jid, 'No identifiqué el proyecto 🤔 Escríbeme el número de la lista, por favor.', { tipo: 'lead_flujo', lead_id: lead.id, ses }); return }
    await supabase.from('leads').update({ project_id: pr.id, status: 'interesado', temperature: 'tibio' }).eq('id', lead.id)
    lead.project_id = pr.id
    // Proyecto elegido → arranca directo el flujo del panel (sin pregunta INFO/ASESOR)
    await iniciarFlujoProyecto(ses, jid, phone, lead)
    return
  }

  // 3) DENTRO DEL FLUJO CONFIGURABLE DEL PROYECTO (pasos con ramas y palabras clave)
  if (estado === 'flow') {
    await responderFlujo(ses, jid, phone, lead, conv, corto)
    return
  }

  // 4) lead sin estado EN ESTA CONVERSACIÓN: si escribió al número de un proyecto,
  // ese proyecto manda (aunque antes haya preguntado por otro); si no, se re-reconoce.
  if (!estado && lead?.id) {
    if (proyDeSesion) {
      if (lead.project_id !== proyDeSesion) {
        await supabase.from('leads').update({ project_id: proyDeSesion }).eq('id', lead.id)
        lead.project_id = proyDeSesion
      }
      await iniciarFlujoProyecto(ses, jid, phone, lead)
      return
    }
    if (lead.project_id) { await iniciarFlujoProyecto(ses, jid, phone, lead); return }
    const { pr, proys } = await detectarProyecto(corto)
    if (pr) { await supabase.from('leads').update({ project_id: pr.id }).eq('id', lead.id); lead.project_id = pr.id; await iniciarFlujoProyecto(ses, jid, phone, lead); return }
    await pedirProyecto(ses, jid, phone, lead, proys)
    return
  }

  // 6) COMPLETADO / HUMANO (sin IA)
  if (estado === 'humano') {
    if (lead?.id) await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('WHATSAPP: ' + corto).toUpperCase().slice(0, 500) })
    return
  }
  if (lead?.id) {
    await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('WHATSAPP: ' + corto).toUpperCase().slice(0, 500) })
    const trivial = corto.length < 3 || /^(gracias|grasias|ok|okey|oki|ya|listo|dale|de acuerdo|👍|🙏)[.!\s]*$/i.test(corto)
    if (trivial) return
    if (/asesor|humano|persona real|hablar con alguien|que me llamen|llamen/i.test(corto)) {
      await setConv(phone, { flow_state: 'humano' }, ses)
      await enviar(jid, 'Claro 🙌 Le paso con un asesor de Urbis. Te escribe en breve.', { tipo: 'lead_flujo', lead_id: lead.id, ses })
      if (ADMIN) await enviar(ADMIN, '⚠️ PIDIÓ ASESOR\nTel: ' + phone + '\nNombre: ' + (lead.full_name || '-') + '\nÚltimo msj: ' + corto.slice(0, 120), { tipo: 'aviso_admin' })
      return
    }
    await enviar(jid, 'Gracias por tu mensaje 🙌 Un asesor de Urbis revisará tu consulta y te responderá pronto. Si es urgente escribe *ASESOR*.', { tipo: 'lead_flujo', lead_id: lead.id, ses })
  }
}

// ---------- CONEXION ----------
// extensión de archivo para la media entrante (según tipo y mimetype)
function extDe(tipo, mimetype, nombre) {
  const deNombre = String(nombre || '').split('.').pop()
  if (tipo === 'document' && deNombre && deNombre.length <= 5) return deNombre.toLowerCase()
  const sub = String(mimetype || '').split('/')[1] || ''
  if (sub) return sub.split(';')[0].replace('jpeg', 'jpg').replace('quicktime', 'mov').slice(0, 5) || 'bin'
  return tipo === 'image' ? 'jpg' : tipo === 'video' ? 'mp4' : tipo === 'audio' ? 'ogg' : tipo === 'sticker' ? 'webp' : 'bin'
}

// media de un mensaje de WhatsApp (foto/video/audio/documento) → descarga a Storage
async function extraerMedia(sock, m, msg) {
  const mm = msg.imageMessage || msg.videoMessage || msg.documentMessage || msg.audioMessage || msg.stickerMessage
  if (!mm) return null
  const mtipo = msg.imageMessage ? 'image' : msg.videoMessage ? 'video' : msg.documentMessage ? 'document' : msg.audioMessage ? 'audio' : 'sticker'
  const media = { tipo: mtipo, name: msg.documentMessage?.fileName || null, caption: mm.caption || '' }
  try {
    if (Number(mm.fileLength || 0) <= 50 * 1024 * 1024) {   // tope de subida de Supabase Storage
      const buff = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
      const ruta = 'wa-chat/' + telDeJid(m.key.remoteJid || '') + '/' + Date.now() + '.' + extDe(mtipo, mm.mimetype, media.name)
      const { error } = await supabase.storage.from('urbis-files').upload(ruta, buff, { contentType: mm.mimetype || undefined, upsert: true })
      if (!error) media.url = supabase.storage.from('urbis-files').getPublicUrl(ruta).data.publicUrl
      else log('media (storage):', error.message)
    } else log('media muy pesada, no se descarga (', mm.fileLength, 'bytes )')
  } catch (e) { log('media:', String(e.message || e)) }
  // sin URL (muy pesada o falló la descarga): dejar rastro en el chat para que se sepa que llegó algo
  if (!media.url && !media.caption) {
    const mb = Math.round(Number(mm.fileLength || 0) / 1024 / 1024)
    media.caption = '[' + (mtipo === 'video' ? '🎬 Video' : mtipo === 'image' ? '🖼️ Imagen' : mtipo === 'audio' ? '🎙️ Audio' : '📄 Archivo') + (mb ? ' de ' + mb + ' MB' : '') + ' recibido — muy pesado para verlo en el panel; revisar en el celular del chip]'
  }
  return media
}

// Mensaje tecleado desde el CELULAR del chip (fromMe que NO envió este proceso):
// se registra en el chat del panel como "📲 CELULAR" y el bot se calla en ese chat
// (mismo criterio que al responder desde el panel). Mensajes a números internos
// (secretarias/gerencia/admin) se registran pero no callan nada.
async function registrarDesdeCelular(S, m) {
  const jid = m.key.remoteJid || ''
  let phone = telDeJid(jid)
  if (jid.endsWith('@lid')) {
    const { data: cLid } = await supabase.from('whatsapp_conversations').select('phone').ilike('wa_jid', '%' + phone + '%').not('phone', 'ilike', phone).limit(1)
    if (cLid && cLid[0] && cLid[0].phone) phone = String(cLid[0].phone)
  }
  if (!phone) return
  const msg = m.message || {}
  const media = await extraerMedia(S.sock, m, msg)
  const texto = String(msg.conversation || msg.extendedTextMessage?.text || (media && media.caption) || '').trim().slice(0, 1000)
  if (!texto && !media) return
  let conv = await estadoConv(phone, S)
  if (!conv) { await setConv(phone, { wa_jid: jid }, S); conv = await estadoConv(phone, S) }
  else await supabase.from('whatsapp_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
  await supabase.from('whatsapp_messages').insert({
    conversation_id: conv?.id || null, direction: 'out', body: texto || null, delivery_status: 'celular',
    media_url: media?.url || null, media_type: media?.tipo || null, media_name: media?.name || null,
    meta_message_id: m.key?.id ? String(m.key.id) : null,
  }).then(() => {}).catch(() => {})
  const tnum = await tipoNumero(phone)
  const esInterno = ['secretaria', 'gerencia', 'desactivado', 'silencio'].includes(tnum || '') || (ADMIN && phone.slice(-9) === ADMIN.slice(-9))
  if (conv && conv.modo !== 'humano' && !esInterno) {
    await supabase.from('whatsapp_conversations').update({ modo: 'humano', humano_desde: new Date().toISOString() }).eq('id', conv.id)
    log('CHAT EN MODO HUMANO (respuesta desde el celular):', phone)
  }
  log('CELULAR -> registrado a', phone, 'por', S.row.label || 'PRINCIPAL')
}

// Agenda del chip: WhatsApp sincroniza los contactos del celular al agente
// (name = como está guardado en la agenda; notify = como se pone la persona).
// Se guardan en wa_contacts para que el panel muestre "📇 En el celular: X".
async function guardarContactos(S, cts) {
  try {
    const conNombre = [], soloPush = []
    for (const c of (cts || [])) {
      if (!c || !c.id || !String(c.id).endsWith('@s.whatsapp.net')) continue
      const phone = telDeJid(c.id)
      if (!phone || phone.length < 9) continue
      const base = { phone, session_id: sesId(S), updated_at: new Date().toISOString() }
      if (c.name) conNombre.push({ ...base, nombre: String(c.name).slice(0, 120), ...(c.notify ? { push_name: String(c.notify).slice(0, 120) } : {}) })
      else if (c.notify) soloPush.push({ ...base, push_name: String(c.notify).slice(0, 120) })
    }
    // upsert por lotes: solo pisa las columnas que vienen (no borra el nombre al llegar solo el push)
    for (let i = 0; i < conNombre.length; i += 200) await supabase.from('wa_contacts').upsert(conNombre.slice(i, i + 200))
    const push1 = soloPush.filter(x => x.push_name)
    for (let i = 0; i < push1.length; i += 200) await supabase.from('wa_contacts').upsert(push1.slice(i, i + 200))
    if (conNombre.length || push1.length) log('AGENDA [' + (S.row.label || 'PRINCIPAL') + ']: ' + conNombre.length + ' con nombre, ' + push1.length + ' solo alias')
  } catch (e) { log('contactos:', String(e.message || e)) }
}

// ---------- ETIQUETAS DE WHATSAPP BUSINESS (best-effort) ----------
// Solo funciona si el chip es WhatsApp Business. Con Baileys es inestable, así
// que TODO va con try/catch: si falla, se registra y no se rompe nada más.
const hashColor = s => { let h = 0; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return h % 20 }

// catálogo de labels que existen en la cuenta (llega por el evento labels.edit)
async function guardarLabel(S, label) {
  if (!label || label.id === undefined || label.id === null) return
  try {
    await supabase.from('wa_labels').upsert({
      wa_id: String(label.id), session_id: sesId(S),
      name: label.name || null, color: typeof label.color === 'number' ? label.color : null,
      deleted: !!label.deleted, updated_at: new Date().toISOString(),
    }, { onConflict: 'wa_id,session_id' })
    // back-fill: chats que YA venían con esta label del celular pero sin nombre resuelto
    if (label.name && !label.deleted && sesId(S)) {
      await supabase.from('whatsapp_conversations').update({ tag: String(label.name).toUpperCase() })
        .eq('session_id', sesId(S)).eq('wa_label_id', String(label.id)).is('tag', null)
    }
  } catch (e) { log('label save:', String(e.message || e)) }
}

// una asociación chat↔label que YA existía en el celular → reflejarla en el panel (tag)
async function aplicarAsociacionLabel(S, assoc, tipo) {
  if (!assoc || assoc.type !== 'label_jid' || !assoc.chatId || !sesId(S)) return
  const jid = String(assoc.chatId)
  if (!jid.endsWith('@s.whatsapp.net')) return   // solo chats 1-a-1
  const phone = telDeJid(jid)
  if (!phone || phone.length < 9) return
  let conv = await estadoConv(phone, S)
  if (!conv) { await setConv(phone, { wa_jid: jid }, S); conv = await estadoConv(phone, S) }
  if (!conv) return
  if (tipo === 'remove') {
    if (String(conv.wa_label_id) === String(assoc.labelId)) await supabase.from('whatsapp_conversations').update({ tag: null, wa_label_id: null }).eq('id', conv.id)
    return
  }
  const { data: lab } = await supabase.from('wa_labels').select('name').eq('session_id', sesId(S)).eq('wa_id', String(assoc.labelId)).maybeSingle()
  const nombre = (lab && lab.name) ? String(lab.name).toUpperCase() : null
  await supabase.from('whatsapp_conversations').update({ wa_label_id: String(assoc.labelId), ...(nombre ? { tag: nombre } : {}) }).eq('id', conv.id)
  if (nombre) log('ETIQUETA previa del celular:', nombre, '→', phone)
}

// texto representativo de un mensaje histórico (sin descargar media) + su fecha
function extraerHistMsg(m) {
  const msg = m.message || {}
  let body = msg.conversation || msg.extendedTextMessage?.text || ''
  if (!body) {
    if (msg.imageMessage) body = msg.imageMessage.caption ? '🖼️ ' + msg.imageMessage.caption : '[🖼️ Imagen]'
    else if (msg.videoMessage) body = msg.videoMessage.caption ? '🎬 ' + msg.videoMessage.caption : '[🎬 Video]'
    else if (msg.documentMessage) body = '[📄 ' + (msg.documentMessage.fileName || 'Documento') + ']'
    else if (msg.audioMessage) body = '[🎙️ Audio]'
    else if (msg.stickerMessage) body = '[🩵 Sticker]'
    else if (msg.locationMessage) body = '[📍 Ubicación]'
    else if (msg.contactMessage || msg.contactsArrayMessage) body = '[📇 Contacto]'
  }
  let ts = m.messageTimestamp
  if (ts && typeof ts === 'object') ts = ts.low != null ? ts.low : (ts.toNumber ? ts.toNumber() : 0)   // Long
  const at = ts ? new Date(Number(ts) * 1000).toISOString() : new Date().toISOString()
  return { body, at }
}

// BACKUP: vuelca el historial que WhatsApp sincroniza al vincular (chats 1-a-1)
async function importarHistorial(S, h) {
  const msgs = h.messages || []
  if (!msgs.length || !sesId(S)) return
  try {
    // 1) agrupar mensajes por teléfono (solo chats 1-a-1; nada de grupos/estados)
    const porTel = new Map()
    for (const m of msgs) {
      const jid = m.key?.remoteJid || ''
      if (!jid.endsWith('@s.whatsapp.net')) continue
      const phone = telDeJid(jid)
      if (!phone || phone.length < 9) continue
      if (!porTel.has(phone)) porTel.set(phone, { jid, msgs: [] })
      porTel.get(phone).msgs.push(m)
    }
    if (!porTel.size) return
    const phones = [...porTel.keys()]
    // 2) conversaciones existentes de esta sesión
    const idPorTel = new Map()
    for (let i = 0; i < phones.length; i += 100) {
      const { data } = await supabase.from('whatsapp_conversations').select('id, phone').eq('session_id', sesId(S)).in('phone', phones.slice(i, i + 100))
      for (const c of (data || [])) idPorTel.set(c.phone, c.id)
    }
    // 3) crear las que faltan
    const faltan = phones.filter(p => !idPorTel.has(p))
    for (let i = 0; i < faltan.length; i += 100) {
      const nuevas = faltan.slice(i, i + 100).map(p => ({ phone: p, wa_jid: porTel.get(p).jid, session_id: sesId(S), project_id: S.row.project_id || null, last_message_at: new Date().toISOString() }))
      const { data } = await supabase.from('whatsapp_conversations').insert(nuevas).select('id, phone')
      for (const c of (data || [])) idPorTel.set(c.phone, c.id)
    }
    // 4) filas de mensajes (dedup por meta_message_id; solo lo RECIENTE para no
    //    inflar la base ni el egress — configurable con HIST_DIAS, 90 por defecto)
    const corte = Date.now() - HIST_DIAS * 86400000
    const rows = []
    for (const [phone, info] of porTel) {
      const cid = idPorTel.get(phone)
      if (!cid) continue
      for (const m of info.msgs) {
        if (!m.key?.id) continue
        const cont = extraerHistMsg(m)
        if (!cont.body) continue
        if (new Date(cont.at).getTime() < corte) continue   // más viejo que el corte: se omite
        rows.push({ conversation_id: cid, direction: m.key.fromMe ? 'out' : 'in', body: cont.body.slice(0, 1000), meta_message_id: String(m.key.id), delivery_status: 'historial', created_at: cont.at })
      }
    }
    let n = 0
    for (let i = 0; i < rows.length; i += 300) {
      const lote = rows.slice(i, i + 300)
      const { error } = await supabase.from('whatsapp_messages').upsert(lote, { onConflict: 'conversation_id,meta_message_id', ignoreDuplicates: true })
      if (!error) n += lote.length; else log('hist upsert:', error.message)
    }
    log('HISTORIAL [' + (S.row.label || 'PRINCIPAL') + ']: ' + porTel.size + ' chats, ' + rows.length + ' msjs' + (h.progress != null ? ' (' + h.progress + '%)' : '') + (h.isLatest ? ' [FIN]' : ''))
    supabase.from('wa_sessions').update({ hist_ultimo: new Date().toISOString() }).eq('id', S.row.id).then(() => {}, () => {})
  } catch (e) { log('historial:', String(e.message || e)) }
}

// refleja la etiqueta 🏷️ del panel como label de WhatsApp en el chat del celular
async function aplicarLabelChat(S, conv, etiqueta) {
  if (!S.sock || !sesId(S)) return
  const jid = conv.wa_jid || jidDe(conv.phone)
  // quitar la label anterior que puso el panel (para que el chat tenga solo una de estado)
  if (conv.wa_label_id) { try { await S.sock.removeChatLabel(jid, String(conv.wa_label_id)) } catch (e) { log('rm label:', String(e.message || e)) } }
  if (!etiqueta) { await supabase.from('whatsapp_conversations').update({ wa_label_id: null }).eq('id', conv.id); return }
  // ¿ya existe una label con ese nombre en la cuenta? (mapeo por nombre)
  const { data: exist } = await supabase.from('wa_labels').select('wa_id').eq('session_id', sesId(S)).eq('deleted', false).ilike('name', etiqueta).limit(1)
  let labelId = exist && exist[0] && exist[0].wa_id
  if (!labelId) {   // crearla
    const { data: all } = await supabase.from('wa_labels').select('wa_id').eq('session_id', sesId(S))
    const maxId = Math.max(5, ...(all || []).map(x => parseInt(x.wa_id, 10) || 0))
    labelId = String(maxId + 1)
    try {
      await S.sock.addLabel(jid, { id: labelId, name: etiqueta, color: hashColor(etiqueta) })
      await supabase.from('wa_labels').upsert({ wa_id: labelId, session_id: sesId(S), name: etiqueta, color: hashColor(etiqueta), deleted: false, updated_at: new Date().toISOString() }, { onConflict: 'wa_id,session_id' })
      log('LABEL creada:', etiqueta, '=', labelId)
    } catch (e) { log('crear label (¿el chip es WhatsApp Business?):', String(e.message || e)); return }
  }
  try {
    await S.sock.addChatLabel(jid, String(labelId))
    await supabase.from('whatsapp_conversations').update({ wa_label_id: String(labelId) }).eq('id', conv.id)
    log('LABEL', etiqueta, 'puesta a', conv.phone)
  } catch (e) { log('poner label:', String(e.message || e)) }
}

// levanta UNA sesión Baileys (una por número/fila de wa_sessions)
async function iniciarSesion(row) {
  const prev = SESSIONS.get(row.id)
  if (prev && (prev.sock || prev.iniciando)) return
  const S = prev || { row, sock: null, enviados: 0 }
  S.row = row; S.iniciando = true
  SESSIONS.set(row.id, S)
  const authDir = authDirDe(row)
  try {
    _fsm.mkdirSync(AUTH_BASE, { recursive: true })
    // primera vez de la corporativa: heredar las credenciales viejas (./auth) sin re-escanear
    if (row.id !== 'legacy' && row.is_corporate && !_fsm.existsSync(authDir) && _fsm.existsSync('./auth')) {
      _fsm.renameSync('./auth', authDir)
      log('Credenciales ./auth migradas a', authDir, '(sesion corporativa)')
    }
  } catch (e) { log('migracion auth:', String(e.message || e)) }
  try {
    const { state, saveCreds } = await useMultiFileAuthState(authDir)
    const { version } = await fetchLatestBaileysVersion()
    const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), browser: ['URBIS ' + (row.label || 'AGENTE'), 'Chrome', '120.0'], getMessage: async key => msgStore.get(key && key.id) })
    S.sock = sock; S.iniciando = false

    sock.ev.on('creds.update', saveCreds)
    // agenda del chip → wa_contacts (sync inicial y cambios en caliente)
    sock.ev.on('contacts.upsert', cts => { guardarContactos(S, cts).catch(() => {}) })
    sock.ev.on('contacts.update', cts => { guardarContactos(S, cts).catch(() => {}) })
    // sync inicial al vincular: agenda + BACKUP del historial de chats
    sock.ev.on('messaging-history.set', h => {
      if (h?.contacts?.length) guardarContactos(S, h.contacts).catch(() => {})
      if (h?.messages?.length) importarHistorial(S, h).catch(() => {})
    })
    // etiquetas de WhatsApp Business del chip → wa_labels + asociaciones previas
    sock.ev.on('labels.edit', l => { guardarLabel(S, l).catch(() => {}) })
    sock.ev.on('labels.association', ev => { aplicarAsociacionLabel(S, ev?.association, ev?.type).catch(() => {}) })
    sock.ev.on('connection.update', async u => {
      if (u.qr) {
        console.log('\n============================================')
        console.log('  [' + (row.label || 'PRINCIPAL') + '] ESCANEA ESTE QR (el QR tambien sale en el panel)')
        console.log('============================================\n')
        qrcode.generate(u.qr, { small: true })
        setSes(row, { estado: 'esperando_qr', qr: u.qr }).catch(() => {})
      }
      if (u.connection === 'open') {
        const num = String(sock.user?.id || '').split(':')[0].replace(/\D/g, '')
        log('✅ [' + (row.label || 'PRINCIPAL') + '] CONECTADO A WHATSAPP' + (num ? ' (+' + num + ')' : ''))
        setSes(row, { estado: 'conectado', qr: '', latido: new Date().toISOString(), ...(num ? { phone: num } : {}) }).catch(() => {})
        // aviso al admin como MÁXIMO 1 vez por hora y solo por la corporativa (evita spam)
        if (ADMIN && row.is_corporate) {
          try {
            const last = await ajuste('wa_aviso_conectado', '')
            if (!last || (Date.now() - new Date(last).getTime()) > 3600000) {
              await setAjuste('wa_aviso_conectado', new Date().toISOString())
              enviar(ADMIN, '🤖 AGENTE URBIS conectado y en servicio.', { tipo: 'reporte' })
            }
          } catch {}
        }
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode
        log('[' + (row.label || 'PRINCIPAL') + '] conexion cerrada, codigo', code)
        S.sock = null
        if (code !== DisconnectReason.loggedOut) { log('reconectando', row.label || 'PRINCIPAL', '...'); setTimeout(() => iniciarSesion(S.row).catch(() => {}), 5000) }
        else { setSes(row, { estado: 'cerrado', qr: '' }).catch(() => {}); log('SESION CERRADA DESDE EL TELEFONO. Usa VINCULAR en el panel para re-escanear.') }
      }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return
      for (const m of messages) {
        try {
          const jid = m.key.remoteJid || ''
          if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue
          if (m.key.fromMe) {
            // lo envió el propio bot (está en el store) → nada; si no, fue tecleado
            // desde el CELULAR del chip → registrarlo en el panel y callar al bot ahí
            if (!msgStore.has(m.key.id)) await registrarDesdeCelular(S, m).catch(e => log('celular:', String(e.message || e)))
            continue
          }
          const msg = m.message || {}
          // media entrante (foto/video/audio/documento): se descarga a Storage para verla en el panel
          const media = await extraerMedia(sock, m, msg)
          const texto = msg.conversation || msg.extendedTextMessage?.text || (media && media.caption) || ''
          const k = m.key || {}
          let alt = String(k.remoteJidAlt || k.participantAlt || k.senderPn || k.participantPn || '')
          if (alt && !alt.includes('@')) alt = alt + '@s.whatsapp.net'
          const jidPN = jid.endsWith('@s.whatsapp.net') ? jid : (alt.endsWith('@s.whatsapp.net') ? alt : null)
          if (!jidPN) log('AVISO LID sin numero real. key=', JSON.stringify(k))
          try { await manejarEntrante(S, jid, jidPN, texto, m.pushName, media, m.key?.id) } catch (e) { log('ERROR FLUJO:', e.message); log(e.stack || '') }
        } catch (e) { log('error procesando entrante:', e.message) }
      }
    })
  } catch (e) {
    S.iniciando = false
    log('ERROR iniciando sesion', row.label || row.id, ':', String(e.message || e))
    setTimeout(() => iniciarSesion(S.row).catch(() => {}), 15000)
  }
}

// vigila wa_sessions: levanta sesiones nuevas, apaga desactivadas y atiende relink/restart por sesión
async function supervisarSesiones() {
  let rows = []
  try {
    const { data, error } = await supabase.from('wa_sessions').select('*').eq('activo', true)
    if (error) return          // tabla aún no existe (sql/30 sin correr): seguir en modo compat
    rows = data || []
  } catch { return }
  if (!rows.length) return     // sin filas: el modo compat (legacy) sigue corriendo
  const vivos = new Set(rows.map(r => r.id))
  for (const [id, S] of SESSIONS) {
    if (!vivos.has(id)) {      // desactivada/borrada (o la legacy al aparecer filas reales)
      try { if (S.sock) S.sock.end?.(new Error('sesion desactivada')) } catch {}
      S.sock = null
      SESSIONS.delete(id)
      log('SESION APAGADA:', S.row.label || id)
    }
  }
  for (const r of rows) {
    const S = SESSIONS.get(r.id)
    if (S) S.row = r           // refrescar label/project_id/is_corporate en caliente
    if (r.relink) {            // re-vincular ESTE numero: borrar credenciales y pedir QR
      await supabase.from('wa_sessions').update({ relink: false, estado: 'esperando_qr', qr: '' }).eq('id', r.id)
      try { if (S && S.sock) await S.sock.logout().catch(() => {}) } catch {}
      try { _fsm.rmSync(authDirDe(r), { recursive: true, force: true }) } catch {}
      if (S) S.sock = null
      SESSIONS.delete(r.id)
      iniciarSesion({ ...r, relink: false }).catch(() => {})
      continue
    }
    if (r.restart) {           // reiniciar SOLO esta sesion (credenciales intactas)
      await supabase.from('wa_sessions').update({ restart: false }).eq('id', r.id)
      try { if (S && S.sock) S.sock.end?.(new Error('restart')) } catch {}
      if (S) S.sock = null
      SESSIONS.delete(r.id)
      iniciarSesion({ ...r, restart: false }).catch(() => {})
      continue
    }
    if (!S) iniciarSesion(r).catch(() => {})
  }
}

async function arrancar() {
  let rows = []
  try {
    const { data, error } = await supabase.from('wa_sessions').select('*').eq('activo', true)
    if (!error) rows = data || []
  } catch {}
  if (!rows.length) {
    // sql/30 sin correr o sin filas: modo compatibilidad — una sola sesion en ./auth como siempre
    log('AVISO: sin wa_sessions (¿falta correr sql/30?). Modo single-sesion de compatibilidad.')
    rows = [{ id: 'legacy', is_corporate: true, label: 'PRINCIPAL', project_id: null, activo: true }]
  }
  for (const r of rows) iniciarSesion(r).catch(e => log('init', r.label || r.id, ':', String(e.message || e)))
  setInterval(() => { supervisarSesiones().catch(() => {}) }, 20000)

  // crons GLOBALES (una sola vez, no por sesión)
  const [hh, mm] = (process.env.HORA_COBRANZA || '09:00').split(':')
  cron.schedule(`${Number(mm)} ${Number(hh)} * * *`, cobranza, { timezone: 'America/Lima' })
  cron.schedule('* * * * *', secretariaTick, { timezone: 'America/Lima' })
  cron.schedule('* * * * *', visitasTick, { timezone: 'America/Lima' })
  log(`Agente iniciado (${rows.length} sesion(es)). Cobranza diaria a las ${hh}:${mm} (hora Lima).`)

  if (process.env.RUN_NOW === '1') { await espera(8000); cobranza() }
}

if (process.env.SIMULACRO === '1') {
  (async () => {
    log('=== SIMULACRO DE COBRANZA (no se envia nada) ===')
    try { await cobranza() } catch (e) { log('ERROR simulacro:', String(e.message || e)) }
    log('=== FIN DEL SIMULACRO ===')
    process.exit(0)
  })()
} else {
  arrancar()
}


// ---------- SALIENTES DESDE EL PANEL ----------
// manual_panel: texto/adjuntos por la sesión del chat (y el chat pasa a MODO HUMANO).
// edit_panel:  edita un mensaje ya enviado (WhatsApp lo permite hasta 15 min).
// vcard_panel: manda la tarjeta del contacto al chat "Tú" del celular del chip,
//              para guardarlo en la agenda con 2 toques.
async function procesarSalientesPanel() {
  if (!SESSIONS.size) return
  const { data } = await supabase.from('scheduled_messages')
    .select('id, recipient_phone, body, media_url, media_type, media_name, session_id, conversation_id, sender_id, tipo, wa_msg_id')
    .in('tipo', ['manual_panel', 'edit_panel', 'vcard_panel', 'label_panel']).eq('status', 'pendiente').order('scheduled_for').limit(10)
  for (const m of (data || [])) {
    try {
      let conv = null
      if (m.conversation_id) {
        const { data: c } = await supabase.from('whatsapp_conversations').select('id, wa_jid, phone, session_id, modo, wa_label_id').eq('id', m.conversation_id).maybeSingle()
        conv = c || null
      }
      if (!conv) {
        const { data: c } = await supabase.from('whatsapp_conversations').select('id, wa_jid, phone, session_id, modo, wa_label_id')
          .eq('phone', m.recipient_phone).order('last_message_at', { ascending: false, nullsFirst: false }).limit(1)
        conv = (c || [])[0] || null
      }
      const S = (m.session_id && SESSIONS.get(m.session_id)) || (conv?.session_id && SESSIONS.get(conv.session_id)) || sesCorporativa()
      if (!S || !S.sock) throw new Error('sin sesion de WhatsApp conectada')
      const destino = conv?.wa_jid || m.recipient_phone
      const destJid = String(destino).includes('@') ? destino : jidDe(destino)

      // --- etiqueta 🏷️ del panel → label de WhatsApp Business (best-effort) ---
      if (m.tipo === 'label_panel') {
        if (!conv) throw new Error('sin conversacion')
        await aplicarLabelChat(S, conv, (m.body || '').trim() || null)
        await supabase.from('scheduled_messages').update({ status: 'enviado', sent_at: new Date().toISOString(), session_id: sesId(S) }).eq('id', m.id)
        continue
      }

      // --- tarjeta de contacto al chat "Tú" del celular del chip ---
      if (m.tipo === 'vcard_panel') {
        const num = String(m.recipient_phone).replace(/\D/g, '')
        const nombre = (m.body || '').trim() || '+' + num
        const selfJid = jidDe(telDeJid(S.sock.user?.id || ''))
        const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:' + nombre + '\nTEL;type=CELL;type=VOICE;waid=' + num + ':+' + num + '\nEND:VCARD'
        await S.sock.sendMessage(selfJid, { contacts: { displayName: nombre, contacts: [{ displayName: nombre, vcard }] } })
        await supabase.from('scheduled_messages').update({ status: 'enviado', sent_at: new Date().toISOString(), session_id: sesId(S) }).eq('id', m.id)
        log('PANEL -> CONTACTO "' + nombre + '" enviado al celular de', S.row.label || 'PRINCIPAL')
        continue
      }

      // --- edición de un mensaje ya enviado (wa_msg_id = id del original) ---
      if (m.tipo === 'edit_panel') {
        if (!m.wa_msg_id) throw new Error('sin id del mensaje a editar')
        await S.sock.sendMessage(destJid, { text: m.body || '', edit: { remoteJid: destJid, fromMe: true, id: m.wa_msg_id } })
        await supabase.from('scheduled_messages').update({ status: 'enviado', sent_at: new Date().toISOString(), session_id: sesId(S) }).eq('id', m.id)
        // el mensaje original muestra el texto nuevo y la marca de editado
        await supabase.from('scheduled_messages').update({ body: m.body || '', edited_at: new Date().toISOString() }).eq('wa_msg_id', m.wa_msg_id).eq('tipo', 'manual_panel')
        log('PANEL -> EDITADO mensaje', m.wa_msg_id, 'de', m.recipient_phone)
        continue
      }

      // --- mensaje normal (texto o adjunto) ---
      let sent = null
      if (m.media_url) {
        const cap = (m.body || '').trim() || undefined
        const mt = m.media_type || 'image'
        if (mt === 'video' && (await tamanoDe(m.media_url)) > VIDEO_MAX_MB * 1024 * 1024)
          sent = await S.sock.sendMessage(destJid, { document: { url: m.media_url }, fileName: m.media_name || 'VIDEO.mp4', mimetype: 'video/mp4', caption: cap })
        else if (mt === 'video') sent = await S.sock.sendMessage(destJid, { video: { url: m.media_url }, caption: cap })
        else if (mt === 'audio') sent = await S.sock.sendMessage(destJid, { audio: { url: m.media_url }, mimetype: 'audio/mpeg' })
        else if (mt === 'document') sent = await S.sock.sendMessage(destJid, { document: { url: m.media_url }, fileName: m.media_name || 'DOCUMENTO', mimetype: String(m.media_name || '').toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream', caption: cap })
        else sent = await S.sock.sendMessage(destJid, { image: { url: m.media_url }, caption: cap })
      } else {
        sent = await S.sock.sendMessage(destJid, { text: m.body })
      }
      guardarMsg(sent)
      await supabase.from('scheduled_messages').update({ status: 'enviado', sent_at: new Date().toISOString(), session_id: sesId(S), conversation_id: m.conversation_id || conv?.id || null, wa_msg_id: sent?.key?.id || null }).eq('id', m.id)
      // un humano respondió: el bot se calla en este chat hasta que lo devuelvan con el botón
      if (conv && conv.modo !== 'humano') {
        await supabase.from('whatsapp_conversations').update({ modo: 'humano', humano_por: m.sender_id || null, humano_desde: new Date().toISOString() }).eq('id', conv.id)
        log('CHAT EN MODO HUMANO:', conv.phone)
      }
      log('PANEL -> ENVIADO a', m.recipient_phone, 'por', S.row.label || 'PRINCIPAL')
    } catch (e) {
      await supabase.from('scheduled_messages').update({ status: 'fallido', last_error: String(e.message || e) }).eq('id', m.id)
      log('PANEL -> ERROR a', m.recipient_phone, String(e.message || e))
    }
  }
}
setInterval(() => { procesarSalientesPanel().catch(() => {}) }, 5000)

// ---------- AUTO-AVANZAR dentro del flujo: si el lead no responde en N seg/min, pasa al siguiente paso ----------
// (No hay re-insistencia; solo se espera el tiempo del paso y se ejecuta su acción: siguiente / mensaje / asesor.)
async function avanzarFlujo() {
  if (_procPruebasBusy) return                       // no solaparse con el procesamiento de pruebas
  _procPruebasBusy = true
  try {
    if (!(await flag('bot_activo')) || !(await flag('ia_activa'))) return
    const { data } = await supabase.from('whatsapp_conversations')
      .select('id, phone, wa_jid, lead_id, flow_step, last_message_at, is_test, session_id, modo')
      .eq('flow_state', 'flow').limit(30)
    for (const c of (data || [])) {
      try {
        if (c.modo === 'humano') continue                 // lo atiende una persona: el bot no avanza
        const ses = (c.session_id && SESSIONS.get(c.session_id)) || sesCorporativa()
        if (ses?.row && ses.row.leads_activo === false) continue   // leads de ese número apagado
        const { data: lead } = await supabase.from('leads').select('id, project_id, full_name').eq('id', c.lead_id).maybeSingle()
        if (!lead) continue
        const { data: proy } = await supabase.from('projects').select('*').eq('id', lead.project_id).maybeSingle()
        const flow = parseFlow(proy)
        if (!flow) continue
        const step = pasoPorId(flow, c.flow_step)
        if (!step) continue
        // tiempo de espera de este paso (o el global). 0/vacío = espera indefinida (no avanza solo).
        const num = Number(step.reask_min ?? flow.reask_min ?? 0)
        if (!num || num <= 0) continue
        const unit = step.reask_unit ?? flow.reask_unit ?? 'min'
        const reMs = num * (unit === 'seg' ? 1000 : 60000)
        if (Date.now() - new Date(c.last_message_at).getTime() < reMs) continue   // aún no vence el tiempo
        const jid = c.wa_jid || jidDe(c.phone)
        const acc = step.sin_respuesta || 'siguiente'
        const correr = async () => {
          if (acc === 'asesor') { await pasarAsesor(ses, jid, c.phone, lead, 'sin_respuesta'); return }
          if (acc === 'mensaje' && (step.sin_respuesta_texto || '').trim()) await enviar(c.phone, step.sin_respuesta_texto.trim(), { tipo: 'lead_flujo', lead_id: c.lead_id, ses })
          await correrFlujo(ses, jid, c.phone, lead, proy, flow, idxDePaso(flow, step.id) + 1)   // avanza al siguiente paso
        }
        log('AVANZA FLUJO (sin respuesta en ' + num + unit + ') de', c.phone, '·', c.is_test ? '[PRUEBA: NO manda real]' : '[real]')
        if (c.is_test) { TEST_ACTIVE = c.phone; try { await correr() } finally { TEST_ACTIVE = null } }
        else await correr()
      } catch (e) { log('avanzar:', String(e.message || e)) }
    }
  } finally { _procPruebasBusy = false }
}
setInterval(() => { avanzarFlujo().catch(() => {}) }, 8000)

// ---------- CONSOLA DE PRUEBAS (chat virtual, sin WhatsApp real) ----------
async function purgarPruebas() {
  const { data: ls } = await supabase.from('leads').select('id').eq('is_test', true)
  for (const l of (ls || [])) {
    await supabase.from('lead_activities').delete().eq('lead_id', l.id)
    await supabase.from('scheduled_messages').update({ lead_id: null }).eq('lead_id', l.id)
    await supabase.from('leads').delete().eq('id', l.id)
  }
  const { data: cs } = await supabase.from('whatsapp_conversations').select('id, phone').eq('is_test', true)
  for (const c of (cs || [])) {
    await supabase.from('whatsapp_messages').delete().eq('conversation_id', c.id)
    await supabase.from('scheduled_messages').delete().eq('recipient_phone', c.phone)
    await supabase.from('whatsapp_conversations').delete().eq('id', c.id)
  }
  await supabase.from('clients').delete().eq('is_test', true)
  await supabase.from('bot_test_messages').delete().neq('status', 'pendiente')
  log('[TEST] datos de prueba purgados: leads=' + (ls || []).length + ' convs=' + (cs || []).length)
}

// Cobranza SCOPED a un solo cliente (para el botón "simular cobranza"): misma lógica
// de 4 niveles que la real, pero sin dedup (siempre muestra el mensaje que enviaría).
async function cobranzaTest(clientId, sessionPhone) {
  if (!clientId) { await enviar(sessionPhone, '(prueba) Elige un cliente para simular su cobranza.', { tipo: 'test' }); return }
  CEREBRO_COB = await brain('cobranza')
  const hoyISO = new Date().toISOString().slice(0, 10)
  const { data: ventas } = await supabase.from('sales')
    .select('id, client:clients!sales_client_id_fkey(id, full_name, phone), lot:lots!inner(mz, lt, project:projects(name)), installments(id, installment_number, amount, amount_paid, due_date, status)')
    .eq('client_id', clientId).eq('status', 'en_proceso')
  if (!ventas || !ventas.length) { await enviar(sessionPhone, '(prueba) Este cliente no tiene ventas en proceso; no hay cobranza que simular.', { tipo: 'test' }); return }
  for (const v of ventas) {
    const c = v.client
    const nombre = (c?.full_name || '').split(' ')[0]
    const lote = `Mz ${v.lot.mz} Lt ${v.lot.lt}`
    const proy = v.lot.project?.name || 'su proyecto'
    const vencidas = (v.installments || []).filter(i => i.status === 'vencido').sort((a, b) => a.installment_number - b.installment_number)
    const pendientes = (v.installments || []).filter(i => i.status === 'pendiente').sort((a, b) => a.installment_number - b.installment_number)
    const nV = vencidas.length
    const deudaVenc = vencidas.reduce((s, i) => s + Number(i.amount) - Number(i.amount_paid), 0)
    if (nV >= 3) await enviar(sessionPhone, msjC(nombre, lote, proy, nV, deudaVenc), { tipo: 'nivel_C', client_id: c.id })
    else if (nV === 2) await enviar(sessionPhone, msjB(nombre, lote, proy, nV, deudaVenc), { tipo: 'nivel_B', client_id: c.id })
    else if (nV === 1) { const q = vencidas[0]; await enviar(sessionPhone, msjInsist(nombre, lote, proy, q, Number(q.amount) - Number(q.amount_paid), diasEntre(hoyISO, q.due_date)), { tipo: 'insist', client_id: c.id }) }
    else if (pendientes.length) {
      const q = pendientes[0]; const d = diasEntre(q.due_date, hoyISO); const deuda = Number(q.amount) - Number(q.amount_paid)
      const cuando = d <= 0 ? 'A0' : d <= 3 ? 'A3' : 'A5'
      await enviar(sessionPhone, msjA(nombre, lote, proy, q, deuda, cuando) + (d > 5 ? '\n\n(prueba: en real este aviso recién sale a 5 días de vencer; hoy faltan ' + d + ')' : ''), { tipo: 'nivel_A', client_id: c.id })
    } else await enviar(sessionPhone, '(prueba) El lote ' + lote + ' no tiene cuotas pendientes.', { tipo: 'test' })
  }
}

// Pase de lista SCOPED a una secretaria (botón "pasar lista"): marca sus tareas de hoy
// como preguntadas para que sus respuestas (LISTO/números) se puedan probar.
async function pasarListaTest(secId, sessionPhone) {
  if (!secId) { await enviar(sessionPhone, '(prueba) Elige una secretaria para pasarle lista.', { tipo: 'test' }); return }
  const md = await brain('secretaria')
  const { data: sec } = await supabase.from('secretaries').select('*').eq('id', secId).maybeSingle()
  if (!sec) { await enviar(sessionPhone, '(prueba) No encontré esa secretaria.', { tipo: 'test' }); return }
  const nombre = (sec.full_name || '').split(' ')[0]
  const hoy = secHoy()
  const { data: pend } = await supabase.from('secretary_tasks').select('*').eq('secretary_id', secId).eq('date', hoy).eq('status', 'pendiente').is('answered_at', null).order('slot')
  if (!pend || !pend.length) { await enviar(sessionPhone, '(prueba) ' + nombre + ' no tiene actividades pendientes hoy. Asígnale tareas en Seguimiento (o con "tarea ' + nombre.toLowerCase() + ' …") y vuelve a pasar lista.', { tipo: 'test' }); return }
  let idx = 0
  for (const tk of pend) { idx++; tk.ask_index = idx; await supabase.from('secretary_tasks').update({ ask_index: idx, asked_at: new Date().toISOString(), reminded_at: null }).eq('id', tk.id) }
  const lista = pend.map(t => t.ask_index + '. ' + t.title).join('\n')
  await enviar(sessionPhone, secTpl(md, 'PREGUNTA', { nombre, lista, momento: 'hoy' }, 'Hola {nombre} 👋 ¿cómo va todo? Pasando lista de tus actividades de {momento}:\n\n{lista}\n\nRespóndeme *LISTO* si ya completaste todo, o los *números* de lo que ya está (ej: 1 y 3). 🙌'), { tipo: 'secretaria' })
}

async function procesarPruebas() {
  const { data } = await supabase.from('bot_test_messages').select('*').eq('status', 'pendiente').order('created_at').limit(5)
  for (const t of (data || [])) {
    const ph = String(t.session_phone).replace(/\D/g, '')
    const d9 = ph.slice(-9)
    const prof = t.profile || 'lead'
    try {
      if (prof === 'purge') { await purgarPruebas(); await supabase.from('bot_test_messages').update({ status: 'procesado', processed_at: new Date().toISOString() }).eq('id', t.id); continue }

      TEST_ACTIVE = ph
      if (prof === 'cobranza_now') { TEST_PROFILES.set(d9, 'cliente'); await cobranzaTest(t.emulate_id, ph) }
      else if (prof === 'pasar_lista_now') { TEST_PROFILES.set(d9, 'secretaria'); await pasarListaTest(t.emulate_id, ph) }
      else {
        // lead nuevo: igual que WhatsApp real, el proyecto se DETECTA del mensaje.
        // Si el mensaje no identifica uno (o es ambiguo entre varios), queda en null y el
        // bot PREGUNTA cuál (no se fuerza el del dropdown).
        if (prof === 'lead') {
          const { data: exL } = await supabase.from('leads').select('id').ilike('phone', '%' + d9 + '%').limit(1)
          if (!exL || !exL.length) {
            const { pr } = await detectarProyecto(t.text || '')
            await supabase.from('leads').insert({ full_name: 'POR CONFIRMAR', phone: ph, source: 'whatsapp', status: 'nuevo', project_id: pr?.id || null, is_test: true, optin_whatsapp: true, optin_date: new Date().toISOString() }).then(() => {}).catch(() => {})
          }
        }
        const tipo = prof === 'cliente' ? 'cliente' : prof === 'secretaria' ? 'secretaria' : prof === 'gerencia' ? 'gerencia' : null
        TEST_PROFILES.set(d9, tipo)
        const jid = jidDe(ph)
        // pseudo-sesión de prueba (TEST_ACTIVE evita tocar WhatsApp real de todos modos)
        const sesTest = sesCorporativa() || { row: { id: 'legacy', is_corporate: true, label: 'PRUEBA', project_id: null }, sock: null }
        await manejarEntrante(sesTest, jid, jid, t.text || '', prof === 'lead' ? undefined : 'PRUEBA')
        // marcar como PRUEBA solo las sesiones sintéticas (lead/gerencia). Cliente/secretaria
        // usan el teléfono REAL de la entidad emulada, así que NO se marcan (son datos reales).
        if (prof === 'lead' || prof === 'gerencia') {
          await supabase.from('leads').update({ is_test: true }).ilike('phone', '%' + d9 + '%').eq('is_test', false).then(() => {}).catch(() => {})
          await supabase.from('whatsapp_conversations').update({ is_test: true }).eq('phone', ph).then(() => {}).catch(() => {})
        }
      }
      await supabase.from('bot_test_messages').update({ status: 'procesado', processed_at: new Date().toISOString() }).eq('id', t.id)
    } catch (e) {
      log('[TEST] error:', String(e.message || e))
      await supabase.from('bot_test_messages').update({ status: 'error', error: String(e.message || e) }).eq('id', t.id)
    } finally {
      TEST_ACTIVE = null
      TEST_PROFILES.delete(d9)
    }
  }
}
setInterval(async () => { if (_procPruebasBusy) return; _procPruebasBusy = true; try { await procesarPruebas() } catch (e) {} finally { _procPruebasBusy = false } }, 3000)
