// ============================================================
// AGENTE URBIS - WhatsApp no oficial (Baileys)
// Modulo 1: cobranza automatica (3 dias antes + vencidas)
// Modulo 2: recepcion y filtro de leads entrantes
// ============================================================
require('dotenv').config()
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
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

// re-vinculacion pedida desde el panel: cierra sesion, borra credenciales y renace pidiendo QR
async function chequearRelink() {
  try {
    if ((await ajuste('wa_relink', '0')) !== '1') return
    await setAjuste('wa_relink', '0')
    await setAjuste('wa_estado', 'esperando_qr')
    log('RELINK pedido desde el panel: cerrando sesion y borrando credenciales...')
    try { if (sock) await sock.logout() } catch {}
    try { require('fs').rmSync('./auth', { recursive: true, force: true }) } catch {}
    process.exit(0)
  } catch (e) { log('relink:', e.message) }
}
setInterval(chequearRelink, 20000)

// latido: el panel muestra "EN LINEA" mientras este timestamp este fresco
setAjuste('wa_latido', new Date().toISOString()).catch(() => {})
setInterval(() => setAjuste('wa_latido', new Date().toISOString()).catch(() => {}), 30000)

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
const MSG_STORE_FILE = './auth/msgstore.json'
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
const DIAS_ANTES = Number(process.env.DIAS_ANTES || 3)
const VENCIDAS_CADA = Number(process.env.VENCIDAS_CADA_DIAS || 4)
const MAX_DIA = Number(process.env.MAX_ENVIOS_DIA || 40)

let sock = null
let enviadosHoy = 0
let diaActual = new Date().toDateString()

const log = (...a) => console.log(new Date().toLocaleString('es-PE'), '|', ...a)
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const parseJSON = s => { try { const o = JSON.parse(String(s || '')); return o } catch { return null } }
const matchClaves = (claves, texto) => String(claves || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean).some(k => String(texto || '').toLowerCase().includes(k))
const espera = ms => new Promise(r => setTimeout(r, process.env.SIMULACRO === '1' ? 5 : ms))
const delayAleatorio = () => 20000 + Math.floor(Math.random() * 25000) // 20-45 s

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

async function enviarArchivo(jid, url, clase, caption) {
  const etiqueta = (clase === 'video' ? '🎬 VIDEO' : clase === 'plano' ? '🗺️ PLANO' : clase === 'brochure' ? '📘 BROCHURE' : clase === 'documento' ? '📄 DOCUMENTO' : '📷 FOTO') + ' ENVIADO' + (caption ? ': ' + caption : '')
  if (TEST_ACTIVE) {   // modo prueba: no se manda media real, se anota lo que se habría enviado
    await supabase.from('scheduled_messages').insert({ recipient_phone: TEST_ACTIVE, body: etiqueta, tipo: 'test_media', scheduled_for: new Date().toISOString(), status: 'enviado', sent_at: new Date().toISOString() })
    return
  }
  try {
    const dest = String(jid).includes('@') ? String(jid) : jidDe(jid)
    // pausa natural con indicador (grabando para video, escribiendo para el resto)
    try { await sock.sendPresenceUpdate(clase === 'video' ? 'recording' : 'composing', dest) } catch (e) {}
    await espera(3000 + Math.floor(Math.random() * 3000))
    try { await sock.sendPresenceUpdate('paused', dest) } catch (e) {}
    const low = String(url).toLowerCase()
    const esDoc = (clase === 'plano' || clase === 'brochure' || clase === 'documento') && low.includes('.pdf')
    if (clase === 'video') guardarMsg(await sock.sendMessage(dest, { video: { url }, caption: caption || undefined }))
    else if (esDoc) guardarMsg(await sock.sendMessage(dest, { document: { url }, mimetype: 'application/pdf', fileName: (clase === 'brochure' ? 'BROCHURE' : clase === 'plano' ? 'PLANO-ACTUALIZADO' : (String(caption || 'DOCUMENTO').replace(/[^\w .-]/g, '').trim().slice(0, 40) || 'DOCUMENTO')) + '.pdf', caption: caption || undefined }))
    else guardarMsg(await sock.sendMessage(dest, { image: { url }, caption: caption || undefined }))
    enviadosHoy++
    await supabase.from('scheduled_messages').insert({ recipient_phone: telDeJid(dest), body: etiqueta, tipo: 'ia', scheduled_for: new Date().toISOString(), status: 'enviado', sent_at: new Date().toISOString() })
    log('MEDIA [' + clase + '] enviada a', telDeJid(dest))
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
  if (new Date().toDateString() !== diaActual) { diaActual = new Date().toDateString(); enviadosHoy = 0 }
  if (enviadosHoy >= MAX_DIA && process.env.SIMULACRO !== '1') { log('TOPE DIARIO ALCANZADO, no se envia a', phone); return false }
  const soloDig = String(phone).includes('@') ? telDeJid(String(phone)) : String(phone).replace(/\D/g, '')
  if (!ADMIN || soloDig !== String(ADMIN)) {
    const tnumEnv = await tipoNumero(soloDig)
    if (tnumEnv === 'silencio') { log('SILENCIO TOTAL, no se envia a', soloDig); return false }
    if (tnumEnv === 'desactivado' && !['secretaria', 'aviso_admin', 'reporte'].includes(meta.tipo || '')) { log('NUMERO ADMINISTRATIVO: solo avisos internos, no se envia a', soloDig); return false }
  }
  const destJid = String(phone).includes('@') ? String(phone) : jidDe(phone)
  if (['lead_flujo', 'ia', 'auto_cliente'].includes(meta.tipo || '')) {
    try { await sock.sendPresenceUpdate('composing', destJid) } catch (e) {}
    await espera(4000 + Math.floor(Math.random() * 8000))
  }
  try {
    guardarMsg(await sock.sendMessage(destJid, { text: texto }))
    enviadosHoy++
    await supabase.from('scheduled_messages').insert({
      recipient_phone: String(phone).includes('@') ? telDeJid(String(phone)) : String(phone), body: texto, tipo: meta.tipo || 'manual',
      installment_id: meta.installment_id || null, client_id: meta.client_id || null,
      lead_id: meta.lead_id || null, scheduled_for: new Date().toISOString(),
      status: 'enviado', sent_at: new Date().toISOString(),
    })
    log('ENVIADO [' + (meta.tipo || 'msj') + '] a', phone)
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
          const nombre = (sec.full_name || '').split(' ')[0]
          const lista = tareas.length
            ? tareas.map(tk => '• ' + (tk.time ? String(tk.time).slice(0, 5) + ' — ' : '') + tk.title).join('\n')
            : '(sin actividades programadas hoy)'
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
      for (const sec of secs) {
        if (sec.feedback_asked === hoy) continue
        await supabase.from('secretaries').update({ feedback_asked: hoy }).eq('id', sec.id)
        const nombre = (sec.full_name || '').split(' ')[0]
        await enviar(sec.phone, secTpl(md, 'FEEDBACK', { nombre }, '{nombre}, antes de cerrar el día 📝 ¿hiciste hoy algo EXTRA fuera de tus actividades programadas? Si sí, cuéntame brevemente qué fue; si no, respóndeme *NO*. 🙌'), { tipo: 'secretaria' })
      }
    }

    // 3c) recordatorio de visitas de MAÑANA (al encargado y al cliente)
    const man = new Date(new Date().toLocaleString('en-US', SEC_TZ)); man.setDate(man.getDate() + 1)
    const fmanana = man.toLocaleDateString('en-CA')
    const { data: visitas } = await supabase.from('visits').select('*, project:projects(name)').eq('date', fmanana).eq('status', 'programada').is('reminded_at', null)
    for (const v of (visitas || [])) {
      await supabase.from('visits').update({ reminded_at: new Date().toISOString() }).eq('id', v.id)
      const hora = String(v.time).slice(0, 5)
      const proy = v.project ? v.project.name : 'el proyecto'
      const nomCli = (v.client_name || '').split(' ')[0]
      if (v.encargado_phone) await enviar(v.encargado_phone, '📅 *VISITA MAÑANA* — ' + fmtFechaEs(fmanana) + ' a las ' + hora + '\n\nCliente: *' + v.client_name + '* (+' + v.client_phone + ')\nProyecto: *' + proy + '*\nPunto de encuentro: ' + v.meeting_point + (v.notes ? '\nNotas: ' + v.notes : '') + '\n\nConfirma con el cliente hoy. 🙌', { tipo: 'secretaria' })
      if (v.client_phone) await enviar(v.client_phone, 'Hola ' + nomCli + ' 👋 le saludamos de *Urbis Group* 🌳\n\nLe recordamos su visita a *' + proy + '* programada para *mañana ' + fmtFechaEs(fmanana) + ' a las ' + hora + '*.\n\n📍 Punto de encuentro: ' + v.meeting_point + '\n\n¡Lo esperamos! Cualquier consulta, escríbanos por aquí. 🙌', { tipo: 'secretaria' })
    }

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
        await enviar(c.phone, tokensCob(r.mensaje, { nombre, lote, proy, q, deuda, nV, dias: d }), { tipo: 'cob_al' + d, installment_id: q.id, sale_id: v.id, client_id: c.id })
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
      await enviar(c.phone, tokensCob(r.mensaje, vars), { tipo: 'cob_' + key, installment_id: q.id, sale_id: v.id, client_id: c.id })
      await espera(delayAleatorio()); mando = true
    }
  }
  const rep = b.repetir
  if (!mando && rep && (rep.mensaje || '').trim() && Number(rep.cada_dias) > 0) {
    const base = Math.max(0, ...(b.avisos || []).map(r => Number(r.dias) || 0))
    const cada = Math.max(1, Number(rep.cada_dias) || 3)
    const over = dd - base
    if (over > 0 && over % cada === 0 && !(await yaAvisado({ installment_id: q.id, tipo: 'cob_' + key + '_rep' + dd, dias: 90 }))) {
      await enviar(c.phone, tokensCob(rep.mensaje, vars), { tipo: 'cob_' + key + '_rep', installment_id: q.id, sale_id: v.id, client_id: c.id })
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
    .select('id, auto_cobranza, client:clients!sales_client_id_fkey(id, full_name, phone, phone_valid), lot:lots!inner(mz, lt, project:projects(name)), installments(id, installment_number, amount, amount_paid, due_date, status)')
    .eq('status', 'en_proceso').eq('auto_cobranza', true)
  if (error) { log('ERROR consultando ventas:', error.message); return }

  const cfg = parseJSON(await brain('cobranza_cfg'))
  const usarCfg = cfg && (cfg.al_dia || cfg.v1 || cfg.v2 || cfg.v3 || cfg.v4)
  let alertasHumanas = []
  for (const v of ventas || []) {
    const c = v.client
    if (!c?.phone_valid || !c?.phone) continue
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
        await enviar(c.phone, msjC(nombre, lote, proy, nV, deudaVenc), { tipo: 'nivel_C', sale_id: v.id, client_id: c.id })
        await espera(delayAleatorio())
      }
    } else if (nV === 2) {
      // NIVEL B: cada 3 dias
      if (!(await yaAvisado({ sale_id: v.id, tipo: 'nivel_B', dias: 3 }))) {
        await enviar(c.phone, msjB(nombre, lote, proy, nV, deudaVenc), { tipo: 'nivel_B', sale_id: v.id, client_id: c.id })
        await espera(delayAleatorio())
      }
    } else if (nV === 1) {
      // NIVEL A-INSISTENCIA: dias +2 y +4; al dia +5 alerta de gestion humana (una vez)
      const q = vencidas[0]
      const dd = diasEntre(hoyISO, q.due_date)
      const deuda = Number(q.amount) - Number(q.amount_paid)
      if (dd === 2 && !(await yaAvisado({ installment_id: q.id, tipo: 'insist_2', dias: 30 }))) {
        await enviar(c.phone, msjInsist(nombre, lote, proy, q, deuda, dd), { tipo: 'insist_2', installment_id: q.id, sale_id: v.id, client_id: c.id })
        await espera(delayAleatorio())
      } else if (dd === 4 && !(await yaAvisado({ installment_id: q.id, tipo: 'insist_4', dias: 30 }))) {
        await enviar(c.phone, msjInsist(nombre, lote, proy, q, deuda, dd), { tipo: 'insist_4', installment_id: q.id, sale_id: v.id, client_id: c.id })
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
        await enviar(c.phone, msjA(nombre, lote, proy, q, deuda, cuando), { tipo: cuando, installment_id: q.id, sale_id: v.id, client_id: c.id })
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
async function estadoConv(phone) {
  const { data } = await supabase.from('whatsapp_conversations').select('*').eq('phone', phone).maybeSingle()
  return data
}
async function setConv(phone, campos) {
  const existe = await estadoConv(phone)
  if (existe) { const { error } = await supabase.from('whatsapp_conversations').update({ ...campos, last_message_at: new Date().toISOString() }).eq('phone', phone); if (error) log('DB conv upd:', error.message) }
  else { const { error } = await supabase.from('whatsapp_conversations').insert({ phone, ...campos, last_message_at: new Date().toISOString() }); if (error) log('DB conv ins:', error.message) }
}

// ===== FLUJO DE VENTAS GUIADO (sin IA / sin tokens) =====
async function detectarProyecto(texto) {
  const { data: proys } = await supabase.from('projects').select('id, name').order('created_at')
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
async function pasarAsesor(jid, phone, lead, motivo) {
  await setConv(phone, { flow_state: 'humano' })
  await supabase.from('leads').update({ status: 'negociacion', temperature: 'caliente' }).eq('id', lead.id).then(() => {}).catch(() => {})
  const primer = (lead.full_name && lead.full_name !== 'POR CONFIRMAR') ? ', ' + lead.full_name.split(' ')[0] : ''
  await enviar(jid, `¡Con gusto${primer}! 🙌 Te paso con un *asesor especializado* que te ayudará con precios, disponibilidad y a coordinar tu visita. Te escribe en breve. 🌳`, { tipo: 'lead_flujo', lead_id: lead.id })
  const { data: l2 } = await supabase.from('leads').select('full_name, project:projects(name, lead_notify_phone)').eq('id', lead.id).maybeSingle()
  const msj = '📞 *LEAD PIDE ASESOR*\nProyecto: ' + (l2?.project?.name || '-') + '\nNombre: ' + (l2?.full_name || '-') + '\nTel: ' + phone + '\nMotivo: ' + motivo + '\n\n→ Está en el KANBAN, contáctalo pronto.'
  const asesor = String(l2?.project?.lead_notify_phone || '').replace(/\D/g, '')
  const destinos = new Set(); if (ADMIN) destinos.add(ADMIN); if (asesor.length >= 9) destinos.add(asesor)
  for (const d of destinos) await enviar(d, msj, { tipo: 'aviso_admin' })
}


// ============ FLUJO CONFIGURABLE POR PROYECTO (projects.bot_flow) ============
// steps[]: { id, tipo:'mensaje'|'pregunta', texto, media[], pasar_asesor,
//            opciones[{label, claves, ir_a, pasar_asesor}] }
// Biblioteca de material del flujo: media_lib=[{id,tipo:'imagen'|'video'|'link',url,desc}]; los pasos
// y el bombardeo referencian por id. Envía cada item según su tipo.
async function enviarMediaLib(jid, lib, ids) {
  if (!Array.isArray(ids) || !ids.length) return
  const byId = {}; for (const it of (lib || [])) byId[String(it.id)] = it
  for (const id of ids) {
    const it = byId[String(id)]
    if (!it || !it.url) continue
    if (it.tipo === 'video') await enviarArchivo(jid, it.url, 'video', it.desc || '')
    else if (it.tipo === 'pdf') await enviarArchivo(jid, it.url, 'documento', it.desc || '')
    else if (it.tipo === 'link') await enviar(jid, (it.desc ? '*' + it.desc + '*\n' : '') + it.url, { tipo: 'lead_flujo' })
    else await enviarArchivo(jid, it.url, 'foto', it.desc || '')
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
async function correrFlujo(jid, phone, lead, proy, flow, idx) {
  const steps = flow.steps || []
  let guard = 0
  while (idx >= 0 && idx < steps.length && guard++ < 50) {
    const s = steps[idx]
    if (s.texto) {
      const primerNom = (lead.full_name && lead.full_name !== 'POR CONFIRMAR') ? lead.full_name.split(' ')[0] : ''
      const txt = String(s.texto).split('{proyecto}').join(proy?.name || 'nuestro proyecto').split('{nombre}').join(primerNom)
      await enviar(jid, txt, { tipo: 'lead_flujo', lead_id: lead.id })
    }
    await enviarMediaLib(jid, flow.media_lib || [], s.media)
    if (s.pasar_asesor) { await pasarAsesor(jid, phone, lead, 'flujo'); return }
    if (s.tipo === 'pregunta' && (s.opciones || []).length) {
      const ops = s.opciones.map((o, i) => (i + 1) + '. ' + o.label).join('\n')
      await enviar(jid, ops + '\n\n_(responde con el número o en tus palabras)_', { tipo: 'lead_flujo', lead_id: lead.id })
      await setConv(phone, { flow_state: 'flow', flow_step: String(s.id), flow_reasks: 0 })
      return
    }
    idx++
  }
  await supabase.from('leads').update({ status: 'interesado', temperature: 'caliente' }).eq('id', lead.id)
  await setConv(phone, { flow_state: 'completado', flow_step: null })
  await finalizarLead(jid, phone, lead)
}
// arranca el flujo del proyecto (100% configurable desde el panel).
// Sin flujo configurado en el panel: no se inventa nada; se registra el lead y se avisa al asesor.
async function iniciarFlujoProyecto(jid, phone, lead) {
  const { data: proy } = await supabase.from('projects').select('*').eq('id', lead.project_id).maybeSingle()
  const flow = parseFlow(proy)
  if (proy && flow) { await correrFlujo(jid, phone, lead, proy, flow, 0); return }
  await setConv(phone, { flow_state: 'completado', flow_step: null })
  await finalizarLead(jid, phone, lead)
}
// respuesta del lead dentro de un flujo (número o palabra clave -> rama)
async function responderFlujo(jid, phone, lead, conv, corto) {
  const { data: proy } = await supabase.from('projects').select('*').eq('id', lead.project_id).maybeSingle()
  const flow = parseFlow(proy)
  const step = flow ? pasoPorId(flow, conv.flow_step) : null
  if (!proy || !flow || !step) { await setConv(phone, { flow_state: 'completado', flow_step: null }); await finalizarLead(jid, phone, lead); return }
  const ops = step.opciones || []
  let elegida = null
  const soloNum = /^\s*\d+\s*$/.test(corto)
  const n = parseInt(corto.replace(/\D/g, ''), 10)
  if (soloNum && n >= 1 && n <= ops.length) elegida = ops[n - 1]
  if (!elegida) { const t = corto.toLowerCase(); elegida = ops.find(o => String(o.claves || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean).some(k => t.includes(k))) }
  if (!elegida) {
    const opsTxt = ops.map((o, i) => (i + 1) + '. ' + o.label).join('\n')
    await enviar(jid, 'No te entendí bien 😅 Elige una opción:\n' + opsTxt + '\n\n_(responde con el número o en tus palabras)_', { tipo: 'lead_flujo', lead_id: lead.id })
    return
  }
  await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('P: ' + (step.texto || '') + ' → R: ' + elegida.label).slice(0, 500) })
  if (elegida.pasar_asesor || step.pasar_asesor) { await pasarAsesor(jid, phone, lead, 'flujo'); return }
  let nextIdx = elegida.ir_a ? idxDePaso(flow, elegida.ir_a) : (idxDePaso(flow, step.id) + 1)
  if (nextIdx < 0) nextIdx = idxDePaso(flow, step.id) + 1
  await correrFlujo(jid, phone, lead, proy, flow, nextIdx)
}
async function finalizarLead(jid, phone, lead) {
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

async function manejarEntrante(jid, jidPN, texto, pushName) {
  let phone = telDeJid(jidPN || jid)
  // LID sin numero real: recuperar el telefono verdadero desde la conversacion ya registrada
  if (!jidPN && String(jid).endsWith('@lid')) {
    const lidDig = telDeJid(jid)
    const { data: cLid } = await supabase.from('whatsapp_conversations').select('phone').ilike('wa_jid', '%' + lidDig + '%').not('phone', 'ilike', lidDig).limit(1)
    if (cLid && cLid[0] && cLid[0].phone) { phone = String(cLid[0].phone); log('LID mapeado a', phone) }
  }
  if (!texto) return
  const corto = texto.trim().slice(0, 400)
  log('ENTRANTE de', phone, ':', corto.slice(0, 60))
  // registrar SIEMPRE la conversacion y el mensaje entrante (incluido el ADMIN, para verlo en el panel)
  let conv = await estadoConv(phone)
  if (!conv) { await setConv(phone, { wa_jid: jid }); conv = await estadoConv(phone) }
  else await supabase.from('whatsapp_conversations').update({ wa_jid: jid, last_message_at: new Date().toISOString() }).eq('id', conv.id)
  await supabase.from('whatsapp_messages').insert({
    conversation_id: conv?.id || null, direction: 'in', body: corto, delivery_status: 'recibido',
  }).then(() => {}).catch(() => {})

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

  // ¿es cliente?
  const p9 = phone.slice(-9)
  const { data: clientes } = await supabase.from('clients').select('id, full_name').ilike('phone', `%${p9}%`).limit(1)
  const cliente = (clientes || [])[0]
  if (tnum === 'cliente' && !cliente) return
  if (cliente) {
    const primer = (cliente.full_name || '').split(' ')[0]
    // Flujo de respuesta configurable (bot_brains 'cobranza_flow' = JSON):
    // [{ claves:"ya pague, voucher", accion:"responder"|"asesor", respuesta:"..." }]
    const reglas = parseJSON(await brain('cobranza_flow'))
    if (Array.isArray(reglas) && reglas.length) {
      const r = reglas.find(x => matchClaves(x.claves, corto))
      if (r) {
        await enviar(jid, String(r.respuesta || '').trim() || (r.accion === 'asesor' ? 'Con gusto, un asesor se comunicará contigo en breve. 🙌' : '¡Gracias! 🙌 Recibido.'), { tipo: 'auto_cliente', client_id: cliente.id })
        if (ADMIN) await enviar(ADMIN, (r.accion === 'asesor' ? '📞 CLIENTE PIDE AYUDA/ASESOR' : '🤖 CLIENTE') + ` *${cliente.full_name}* (${phone}):\n"${corto}"`, { tipo: 'aviso_admin' })
        return
      }
    }
    // por defecto: reconocer "ya pagué"
    if (/pag(ue|ué|ado)|voucher|deposit|transferi|constancia/i.test(corto)) {
      await enviar(jid, `¡Gracias ${primer}! 🙌 Hemos recibido su mensaje. Nuestro equipo verificará el pago y le confirmaremos en breve.`, { tipo: 'auto_cliente', client_id: cliente.id })
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
  if (!(await flag('ia_activa'))) {
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
    await pasarAsesor(jid, phone, lead, 'pidio_asesor')
    return
  }

  // 1) PRIMER CONTACTO: detectar proyecto del mensaje (ej. "info sobre X"), crear lead, pedir nombre
  if (!lead) {
    const { pr } = await detectarProyecto(corto)
    const { data: nuevoLead } = await supabase.from('leads').insert({
      full_name: (pushName || 'POR CONFIRMAR').toUpperCase(), phone,
      source: 'whatsapp', status: 'nuevo', project_id: pr?.id || null,
      optin_whatsapp: true, optin_date: new Date().toISOString(),
    }).select().single()
    lead = nuevoLead
    await setConv(phone, { flow_state: 'espera_nombre', lead_id: lead?.id })
    // La bienvenida ya NO va aquí: es el 1er paso del flujo del panel. Lo único fijo es pedir el nombre.
    const { data: pfW } = pr ? await supabase.from('projects').select('bot_flow').eq('id', pr.id).maybeSingle() : { data: null }
    const flowW = parseFlowRaw(pfW)
    const pide = textoFlujo(flowW, 'pide_nombre', '¡Hola! 👋 Gracias por escribir a *Urbis Group Real Estate*. Para atenderte mejor, ¿me dices tu *nombre*? _(o escribe *prefiero no decirlo* y seguimos igual)_', pr?.name)
    await enviar(jid, pide, { tipo: 'lead_flujo', lead_id: lead?.id })
    if (ADMIN) await enviar(ADMIN, `🤖 NUEVO LEAD: ${phone}${pr ? ' · interesado en ' + pr.name : ''} ("${corto.slice(0, 50)}").`, { tipo: 'aviso_admin' })
    return
  }

  // 2) NOMBRE (con opción "prefiero no decirlo")
  if (estado === 'espera_nombre') {
    const declina = /prefiero no|no.*(decir|dar)|omitir|an[oó]nimo|reservado|luego te digo|despu[eé]s|no quiero dar/i.test(corto)
    let nombre = null
    if (declina) {
      await supabase.from('leads').update({ status: 'contactado' }).eq('id', lead.id)
      if (lead.project_id) {
        const { data: pfN } = await supabase.from('projects').select('bot_flow').eq('id', lead.project_id).maybeSingle()
        const noNom = parseFlowRaw(pfN)?.no_nombre
        if (noNom && String(noNom).trim()) await enviar(jid, String(noNom).trim(), { tipo: 'lead_flujo', lead_id: lead.id })
      }
    } else {
      nombre = corto.replace(/^\s*(mi nombre es|me llamo|yo soy|soy)\s+/i, '').replace(/[^\p{L} .'-]/gu, '').trim().toUpperCase()
      if (nombre.length < 2) nombre = null   // no insistir: si no es un nombre claro, seguimos como anónimo
      await supabase.from('leads').update({ status: 'contactado', ...(nombre ? { full_name: nombre } : {}) }).eq('id', lead.id)
    }
    if (!lead.project_id) {
      const { proys } = await detectarProyecto('')
      if (proys.length === 1) { await supabase.from('leads').update({ project_id: proys[0].id }).eq('id', lead.id); lead.project_id = proys[0].id }
      else {
        await setConv(phone, { flow_state: 'espera_proyecto' })
        await enviar(jid, `${nombre ? '¡Un gusto, ' + nombre.split(' ')[0] + '! ' : '¡Perfecto! '}😊 ¿Qué proyecto te interesa?${proys.map((p, i) => `\n${i + 1}. *${p.name}*`).join('')}\n\nRespóndeme con el número o el nombre.`, { tipo: 'lead_flujo', lead_id: lead.id })
        return
      }
    }
    // Nombre capturado + proyecto conocido → arranca directo el flujo del panel (sin pregunta INFO/ASESOR)
    await iniciarFlujoProyecto(jid, phone, lead)
    return
  }

  // 2b) PROYECTO (si no se detectó al inicio o quedó ambiguo)
  if (estado === 'espera_proyecto') {
    const { proys } = await detectarProyecto('')
    const n = parseInt(corto.replace(/\D/g, ''), 10)
    let pr = (!isNaN(n) && n >= 1 && n <= proys.length) ? proys[n - 1] : null
    if (!pr) pr = (await detectarProyecto(corto)).pr
    if (!pr) { await enviar(jid, 'No identifiqué el proyecto 🤔 Escríbeme el número de la lista, por favor.', { tipo: 'lead_flujo', lead_id: lead.id }); return }
    await supabase.from('leads').update({ project_id: pr.id, status: 'interesado', temperature: 'tibio' }).eq('id', lead.id)
    lead.project_id = pr.id
    // Proyecto elegido → arranca directo el flujo del panel (sin pregunta INFO/ASESOR)
    await iniciarFlujoProyecto(jid, phone, lead)
    return
  }

  // 3) DENTRO DEL FLUJO CONFIGURABLE DEL PROYECTO (pasos con ramas y palabras clave)
  if (estado === 'flow') {
    await responderFlujo(jid, phone, lead, conv, corto)
    return
  }

  // 4) lead huérfano sin estado: reiniciar
  if (!estado && lead?.id) {
    await setConv(phone, { flow_state: 'espera_nombre', lead_id: lead.id })
    await enviar(jid, '¡Hola de nuevo! 👋 Para atenderte mejor, ¿me dices tu *nombre*? _(o *prefiero no decirlo*)_', { tipo: 'lead_flujo', lead_id: lead.id })
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
      await setConv(phone, { flow_state: 'humano' })
      await enviar(jid, 'Claro 🙌 Le paso con un asesor de Urbis. Te escribe en breve.', { tipo: 'lead_flujo', lead_id: lead.id })
      if (ADMIN) await enviar(ADMIN, '⚠️ PIDIÓ ASESOR\nTel: ' + phone + '\nNombre: ' + (lead.full_name || '-') + '\nÚltimo msj: ' + corto.slice(0, 120), { tipo: 'aviso_admin' })
      return
    }
    await enviar(jid, 'Gracias por tu mensaje 🙌 Un asesor de Urbis revisará tu consulta y te responderá pronto. Si es urgente escribe *ASESOR*.', { tipo: 'lead_flujo', lead_id: lead.id })
  }
}

// ---------- CONEXION ----------
async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const { version } = await fetchLatestBaileysVersion()
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), browser: ['URBIS AGENTE', 'Chrome', '120.0'], getMessage: async key => msgStore.get(key && key.id) })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', u => {
    if (u.qr) {
      console.log('\n============================================')
      console.log('  ESCANEA ESTE QR CON EL WHATSAPP DEL AGENTE')
      console.log('  (WhatsApp > Dispositivos vinculados > Vincular)')
      console.log('============================================\n')
      qrcode.generate(u.qr, { small: true })
      setAjuste('wa_qr', u.qr).catch(() => {})
      setAjuste('wa_estado', 'esperando_qr').catch(() => {})
    }
    if (u.connection === 'open') {
      log('✅ CONECTADO A WHATSAPP')
      setAjuste('wa_qr', '').catch(() => {})
      setAjuste('wa_estado', 'conectado').catch(() => {})
      if (ADMIN) enviar(ADMIN, '🤖 AGENTE URBIS conectado y en servicio.', { tipo: 'reporte' })
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode
      log('conexion cerrada, codigo', code)
      if (code !== DisconnectReason.loggedOut) { log('reconectando...'); setTimeout(iniciar, 5000) }
      else log('SESION CERRADA DESDE EL TELEFONO. Borra la carpeta auth/ y vuelve a escanear.')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const m of messages) {
      try {
        if (m.key.fromMe) continue
        const jid = m.key.remoteJid || ''
        if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue
        const texto = m.message?.conversation || m.message?.extendedTextMessage?.text || ''
        const k = m.key || {}
        let alt = String(k.remoteJidAlt || k.participantAlt || k.senderPn || k.participantPn || '')
        if (alt && !alt.includes('@')) alt = alt + '@s.whatsapp.net'
        const jidPN = jid.endsWith('@s.whatsapp.net') ? jid : (alt.endsWith('@s.whatsapp.net') ? alt : null)
        if (!jidPN) log('AVISO LID sin numero real. key=', JSON.stringify(k))
        try { await manejarEntrante(jid, jidPN, texto, m.pushName) } catch (e) { log('ERROR FLUJO:', e.message); log(e.stack || '') }
      } catch (e) { log('error procesando entrante:', e.message) }
    }
  })

  // cron diario de cobranza
  const [hh, mm] = (process.env.HORA_COBRANZA || '09:00').split(':')
  cron.schedule(`${Number(mm)} ${Number(hh)} * * *`, cobranza, { timezone: 'America/Lima' })
  cron.schedule('* * * * *', secretariaTick, { timezone: 'America/Lima' })
  log(`Agente iniciado. Cobranza diaria programada a las ${hh}:${mm} (hora Lima).`)

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
  iniciar()
}


// ---------- SALIENTES DESDE EL PANEL ----------
async function procesarSalientesPanel() {
  if (!sock) return
  const { data } = await supabase.from('scheduled_messages').select('id, recipient_phone, body').eq('tipo', 'manual_panel').eq('status', 'pendiente').order('scheduled_for').limit(10)
  for (const m of (data || [])) {
    try {
      const { data: c } = await supabase.from('whatsapp_conversations').select('wa_jid').eq('phone', m.recipient_phone).maybeSingle()
      const destino = c?.wa_jid || m.recipient_phone
      guardarMsg(await sock.sendMessage(String(destino).includes('@') ? destino : jidDe(destino), { text: m.body }))
      await supabase.from('scheduled_messages').update({ status: 'enviado', sent_at: new Date().toISOString() }).eq('id', m.id)
      log('PANEL -> ENVIADO a', m.recipient_phone)
    } catch (e) {
      await supabase.from('scheduled_messages').update({ status: 'fallido', last_error: String(e.message || e) }).eq('id', m.id)
      log('PANEL -> ERROR a', m.recipient_phone, String(e.message || e))
    }
  }
}
setInterval(() => { procesarSalientesPanel().catch(() => {}) }, 5000)

// ---------- RE-PREGUNTAR dentro del flujo del proyecto (si no responde) ----------
async function reaskFlow() {
  if (TEST_ACTIVE) return
  if (!(await flag('bot_activo')) || !(await flag('ia_activa'))) return
  const { data } = await supabase.from('whatsapp_conversations')
    .select('id, phone, wa_jid, lead_id, flow_step, flow_reasks, last_message_at')
    .eq('flow_state', 'flow').neq('is_test', true).limit(30)
  for (const c of (data || [])) {
    try {
      const { data: lead } = await supabase.from('leads').select('id, project_id, full_name').eq('id', c.lead_id).maybeSingle()
      if (!lead) continue
      const { data: proy } = await supabase.from('projects').select('*').eq('id', lead.project_id).maybeSingle()
      const flow = parseFlow(proy)
      if (!flow) continue
      const step = pasoPorId(flow, c.flow_step)
      if (!step) continue
      // re-pregunta POR PASO (si el paso no la define, usa la global del flujo como default)
      const reMin = Number(step.reask_min ?? flow.reask_min) || 5
      const maxRe = Number(step.reask_veces ?? flow.max_reasks ?? 1)
      if (new Date(c.last_message_at).getTime() > Date.now() - reMin * 60000) continue   // aún no vence el intervalo
      const jid = c.wa_jid || jidDe(c.phone)
      if ((c.flow_reasks || 0) < maxRe) {
        // RE-PREGUNTAR
        const ops = (step.opciones || []).map((o, i) => (i + 1) + '. ' + o.label).join('\n')
        const texto = (step.reask_text || flow.reask_text || '¿Sigues por ahí? 😊').trim() + (step.texto ? '\n\n' + step.texto : '') + (ops ? '\n' + ops : '')
        await enviar(c.phone, texto, { tipo: 'lead_flujo', lead_id: c.lead_id })
        await supabase.from('whatsapp_conversations').update({ flow_reasks: (c.flow_reasks || 0) + 1, last_message_at: new Date().toISOString() }).eq('id', c.id)
      } else {
        // AGOTÓ LAS RE-PREGUNTAS -> acción configurable: siguiente / mensaje / asesor
        const acc = step.sin_respuesta || 'siguiente'
        if (acc === 'asesor') { await pasarAsesor(jid, c.phone, lead, 'sin_respuesta'); continue }
        if (acc === 'mensaje' && (step.sin_respuesta_texto || '').trim()) await enviar(c.phone, step.sin_respuesta_texto.trim(), { tipo: 'lead_flujo', lead_id: c.lead_id })
        await correrFlujo(jid, c.phone, lead, proy, flow, idxDePaso(flow, step.id) + 1)   // avanza al siguiente paso
      }
    } catch (e) { log('reask:', String(e.message || e)) }
  }
}
setInterval(() => { reaskFlow().catch(() => {}) }, 60000)

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
        // lead nuevo: pre-crear con el proyecto elegido (marca is_test); saluda y salta "¿qué proyecto?"
        if (prof === 'lead') {
          const { data: exL } = await supabase.from('leads').select('id').ilike('phone', '%' + d9 + '%').limit(1)
          if (!exL || !exL.length) await supabase.from('leads').insert({ full_name: 'POR CONFIRMAR', phone: ph, source: 'whatsapp', status: 'nuevo', project_id: t.project_id || null, is_test: true, optin_whatsapp: true, optin_date: new Date().toISOString() }).then(() => {}).catch(() => {})
        }
        const tipo = prof === 'cliente' ? 'cliente' : prof === 'secretaria' ? 'secretaria' : prof === 'gerencia' ? 'gerencia' : null
        TEST_PROFILES.set(d9, tipo)
        const jid = jidDe(ph)
        await manejarEntrante(jid, jid, t.text || '', prof === 'lead' ? undefined : 'PRUEBA')
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
setInterval(() => { procesarPruebas().catch(() => {}) }, 3000)
