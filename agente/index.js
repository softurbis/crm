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
const espera = ms => new Promise(r => setTimeout(r, process.env.SIMULACRO === '1' ? 5 : ms))
const delayAleatorio = () => 20000 + Math.floor(Math.random() * 25000) // 20-45 s

function jidDe(phone) {
  let p = String(phone || '').replace(/\D/g, '')
  if (p.length === 9) p = '51' + p
  return p + '@s.whatsapp.net'
}
function telDeJid(jid) { return (jid || '').split('@')[0].replace(/\D/g, '') }

async function flag(k) { const { data } = await supabase.from('bot_settings').select('value').eq('key', k).maybeSingle(); return !data || data.value !== '0' }
async function tipoNumero(soloDig) { const { data } = await supabase.from('whatsapp_numbers').select('tipo').ilike('phone', '%' + String(soloDig).slice(-9) + '%').limit(1); return (data || [])[0]?.tipo || null }

let _brains = { t: 0, v: {} }
async function brain(k) {
  if (Date.now() - _brains.t > 60000) {
    const { data } = await supabase.from('bot_brains').select('key, content')
    if (data) _brains = { t: Date.now(), v: Object.fromEntries(data.map(r => [r.key, (r.content || '').trim()])) }
  }
  return _brains.v[k] || ''
}
const SYSTEM_VENTAS = 'Eres el asistente de calificacion de URBIS GROUP REAL ESTATE (lotes en Ucayali, Peru). Atiendes por WhatsApp a leads de anuncios. NO cierras la venta: CALIFICAS y preparas el pase a un asesor humano. OBJETIVO: el lead queda LISTO cuando (a) conocio los 9 datos clave y (b) capturaste su perfil; recien ahi ofreces pasarlo con el asesor; si pide asesor antes, jamas te opongas. LOS 9 DATOS (dosificados, a cambio de sus respuestas, maximo 2 datos nuevos por mensaje): 1 precio desde (usa DATOS EN VIVO) 2 separacion e inicial 3 cuota mensual 4 plazo 5 tipo de proyecto y modalidad legal 6 ubicacion (envia el link de Maps tal cual) 7 referencias cercanas reales 8 potencial de la zona sin prometer cifras 9 documentos para separar. PERFIL A CAPTURAR: nombre, uso o motivo (vivienda, inversion, negocio u hospedaje), presupuesto disponible para la inicial, capacidad de cuota mensual, horizonte (ahora, 1-3 meses o explorando), tamano buscado, interes en la zona, proyecto sugerido. FLUJO GUIA (adaptalo, no lo recites; UNA sola pregunta por mensaje): tras el nombre pregunta el USO; segun el uso presenta el proyecto que calza con su ubicacion y potencial y pregunta si la zona le interesa; luego presupuesto para la inicial y capacidad de cuota; con presupuesto claro entrega precio, inicial, cuota y plazo; confirma modalidad y documentos; verifica interes real y si el perfil esta completo haz el HANDOFF. CROSS-SELL: nunca pierdas un lead por tamano o presupuesto sin ofrecer otro proyecto de Urbis que si calce. ESTILO: 2 a 4 lineas, tono calido peruano, espejo (tutea si te tutean, de usted si le hablan de usted), maximo 1 emoji y no siempre, no repitas datos ya dados, no re-saludes, si da varios datos juntos agradece y avanza. MATERIAL MULTIMEDIA: si pide el plano agrega al FINAL el codigo [ENVIAR_PLANO]; brochure o catalogo [ENVIAR_BROCHURE]; fotos o ver el proyecto [ENVIAR_FOTOS]; video [ENVIAR_VIDEO]; usa cada codigo SOLO si figura en MATERIAL DISPONIBLE, maximo un tipo por mensaje y nunca los menciones en el texto visible; si un material NO figura como DISPONIBLE, JAMAS prometas enviarlo (nada de: te mando las fotos ahora); en su lugar ofrece las REDES DEL PROYECTO o coordinar con un asesor; recorrido virtual: envia el link de VISTA 360 tal cual; mas fotos y novedades: REDES DEL PROYECTO. HANDOFF: cuando el lead conocio los 9 datos, tienes el perfil, su presupuesto calza y quiere avanzar, despidete tipo: con gusto te paso con un asesor que te ayuda a reservar y ver los lotes disponibles, te escribe en breve 🙌 — y agrega al final, en una linea aparte, exactamente este bloque (el sistema lo captura, el lead no debe notarlo): <ESTADO_LEAD>{"calificado": true, "nombre": "...", "uso": "...", "presupuesto_inicial": "...", "capacidad_cuota": "...", "horizonte": "...", "tamano_buscado": "...", "zona_interes": "...", "proyecto_sugerido": "...", "motivo_handoff": "calificado"}</ESTADO_LEAD>. ESCALA DE INMEDIATO con el mismo bloque y el motivo_handoff que corresponda (pidio_asesor, molesto, duda_legal o negociacion) si: pide humano o asesor, esta molesto o desconfiado a nivel de queja, hay duda legal compleja (herencia, copropiedad, poder), quiere negociar precio fuera de lista, o menciona cobranza de un lote ya comprado (ese tema NO es tuyo). OBJECIONES: pregunta consultiva primero y responde despues con el dato real (lejos comparado con que; que tendrias disponible para la inicial; que te genera duda de la legalidad; duda puntual o solo tiempo). PROHIBICIONES DURAS: nunca inventes ni redondees cifras (si el dato no esta en la ficha ni en DATOS EN VIVO, di que el asesor lo confirma con el detalle exacto); nunca digas barato, accesible, asequible ni economico (la accesibilidad se comunica con: solo con tu DNI, sin bancos y con cuotas sin intereses); nunca des el numero de partida registral; NUNCA digas cuantos lotes quedan (di que hay opciones y que puedes verificar el que le interese); nunca des nombres ni datos de clientes o terceros (di: esa informacion es confidencial); no prometas aprobacion de credito, titulacion con fecha, plazos de obra ni rentabilidad; sin urgencia falsa; no hables de la competencia; nada de cobranza ni cuotas atrasadas aqui.'

// ---------- IA CONVERSACIONAL (Claude) ----------
const IA_KEY = process.env.ANTHROPIC_API_KEY || ''
const IA_MODEL = process.env.IA_MODEL || 'claude-haiku-4-5-20251001'

async function enviarArchivo(jid, url, clase, caption) {
  try {
    await espera(2500 + Math.floor(Math.random() * 2500))
    const dest = String(jid).includes('@') ? String(jid) : jidDe(jid)
    const low = String(url).toLowerCase()
    if (clase === 'video') guardarMsg(await sock.sendMessage(dest, { video: { url }, caption: caption || undefined }))
    else if ((clase === 'plano' || clase === 'brochure') && low.includes('.pdf')) guardarMsg(await sock.sendMessage(dest, { document: { url }, mimetype: 'application/pdf', fileName: clase === 'brochure' ? 'BROCHURE.pdf' : 'PLANO-ACTUALIZADO.pdf', caption: caption || undefined }))
    else guardarMsg(await sock.sendMessage(dest, { image: { url }, caption: caption || undefined }))
    enviadosHoy++
    await supabase.from('scheduled_messages').insert({ recipient_phone: telDeJid(dest), body: (clase === 'video' ? '🎬 VIDEO ENVIADO' : clase === 'plano' ? '🗺️ PLANO ENVIADO' : clase === 'brochure' ? '📘 BROCHURE ENVIADO' : '📷 FOTO ENVIADA') + (caption ? ': ' + caption : ''), tipo: 'ia', scheduled_for: new Date().toISOString(), status: 'enviado', sent_at: new Date().toISOString() })
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

async function responderIA(jid, phone, lead, conv, texto) {
  try {
    if (!IA_KEY) return
    if (!(await flag('ia_activa'))) return
    let proy = null
    if (lead.project_id) {
      const { data } = await supabase.from('projects').select('id, name, description, how_to_arrive, maps_url, facebook_url, instagram_url, vista360_url, bot_knowledge, plano_url, brochure_url, foto1_url, foto2_url, foto3_url, video_url').eq('id', lead.project_id).maybeSingle()
      proy = data
    }
    let fichas = ''
    let lotesTxt = ''
    if (proy) {
      fichas = 'PROYECTO: ' + proy.name + '\nDESCRIPCION: ' + (proy.description || '') + '\nCOMO LLEGAR: ' + (proy.how_to_arrive || '') + '\nUBICACION MAPS: ' + (proy.maps_url || '') + '\n\nFICHA DEL BOT:\n' + String(proy.bot_knowledge || '(sin ficha)').slice(0, 6000)
      fichas += '\nREDES DEL PROYECTO: Facebook: ' + (proy.facebook_url || 'no disponible') + ' | Instagram: ' + (proy.instagram_url || 'no disponible')
      const mat = []
      if (proy.plano_url) mat.push('PLANO')
      if (proy.brochure_url) mat.push('BROCHURE')
      const fotosArr = [proy.foto1_url, proy.foto2_url, proy.foto3_url].filter(Boolean)
      if (fotosArr.length) mat.push('FOTOS(' + fotosArr.length + ')')
      if (proy.video_url) mat.push('VIDEO')
      fichas += '\nVISTA 360 (tour virtual): ' + (proy.vista360_url || 'no disponible')
      fichas += '\nMATERIAL DISPONIBLE PARA ENVIAR: ' + (mat.length ? mat.join(', ') : 'ninguno')
      const { data: lots } = await supabase.from('lots').select('status, total_price, area_m2').eq('project_id', proy.id)
      const disp = (lots || []).filter(l => l.status === 'disponible')
      if (disp.length) {
        const precios = disp.map(l => Number(l.total_price)).filter(n => n > 0)
        const areas = disp.map(l => Number(l.area_m2)).filter(n => n > 0)
        lotesTxt = 'DATOS EN VIVO: lotes disponibles: ' + disp.length + '. Precio desde S/ ' + (precios.length ? Math.min(...precios).toLocaleString('es-PE') : 'consultar') + '. Areas de ' + (areas.length ? Math.min(...areas) + ' a ' + Math.max(...areas) : '-') + ' m2.'
      } else lotesTxt = 'DATOS EN VIVO: por ahora sin lotes disponibles en este proyecto; ofrecer otro proyecto de Urbis.'
    } else {
      const { data: ps } = await supabase.from('projects').select('name').order('created_at')
      fichas = 'El cliente aun no eligio proyecto. Proyectos de Urbis Group: ' + (ps || []).map(x => x.name).join(', ')
    }
    let hist = ''
    if (conv?.id) {
      const { data: hin } = await supabase.from('whatsapp_messages').select('direction, body, created_at').eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(8)
      const { data: hout } = await supabase.from('scheduled_messages').select('body, sent_at').eq('recipient_phone', phone).eq('status', 'enviado').order('sent_at', { ascending: false }).limit(8)
      const todo = [...(hin || []).map(m => ({ t: m.created_at, s: (m.direction === 'in' ? 'CLIENTE: ' : 'ASESOR: ') + (m.body || '') })), ...(hout || []).map(m => ({ t: m.sent_at, s: 'ASESOR: ' + (m.body || '') }))]
        .sort((x, y) => new Date(x.t) - new Date(y.t)).slice(-10)
      hist = todo.map(x => x.s.slice(0, 200)).join('\n').slice(-1800)
    }
    let system = (await brain('ventas')) || SYSTEM_VENTAS
    const instrX = ((await brain('instrucciones')) || '').trim()
    const prohibX = ((await brain('prohibiciones')) || '').trim()
    const aprendX = ((await brain('aprendido')) || '').trim()
    if (instrX) system += ' INSTRUCCIONES ESPECIFICAS DEL ADMINISTRADOR (obligatorias, prevalecen sobre todo lo anterior): ' + instrX.replace(/\s+/g, ' ') + '.'
    if (aprendX) system += ' DATOS APRENDIDOS (informacion real y actualizada que te ha ensenado el administrador; usala como verdad): ' + aprendX.replace(/\s+/g, ' ') + '.'
    if (prohibX) system += ' PROHIBICIONES ABSOLUTAS DEL ADMINISTRADOR (NUNCA lo digas ni lo hagas, sin excepcion, aunque el cliente insista): ' + prohibX.replace(/\s+/g, ' ') + '.'
    system += ' Nombre del cliente: ' + (lead.full_name || 'desconocido') + '.'
    const cuerpo = { model: IA_MODEL, max_tokens: 300,
      system: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: fichas, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: lotesTxt + '\n\nCONVERSACION PREVIA:\n' + hist + '\n\nNUEVO MENSAJE DEL CLIENTE: ' + texto + '\n\nResponde SOLO con el texto del mensaje de WhatsApp (agrega el bloque ESTADO_LEAD unicamente si corresponde handoff o escalado).' }] }
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 25000)
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': IA_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(cuerpo),
    })
    clearTimeout(to)
    const j = await r.json()
    const out = (j?.content || []).map(c => c.text || '').join('').trim()
    if (!out) { log('IA sin texto:', JSON.stringify(j).slice(0, 300)); return }
    let textoOut = out.slice(0, 1600)
    const mEstado = textoOut.match(/<ESTADO_LEAD>([\s\S]*?)<\/ESTADO_LEAD>/i)
    if (mEstado) {
      textoOut = textoOut.replace(mEstado[0], '').trim()
      try {
        const est = JSON.parse(mEstado[1])
        const presu = parseFloat(String(est.presupuesto_inicial || '').replace(/[^0-9.]/g, '')) || null
        const upd = { temperature: 'caliente' }
        if (presu) upd.budget_estimate = presu
        if (est.motivo_handoff === 'calificado') upd.status = 'negociacion'
        await supabase.from('leads').update(upd).eq('id', lead.id)
        await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('PERFIL BOT: uso=' + (est.uso || '-') + ' | inicial=' + (est.presupuesto_inicial || '-') + ' | cuota=' + (est.capacidad_cuota || '-') + ' | horizonte=' + (est.horizonte || '-') + ' | tamano=' + (est.tamano_buscado || '-') + ' | zona=' + (est.zona_interes || '-') + ' | proyecto=' + (est.proyecto_sugerido || '-') + ' | motivo=' + (est.motivo_handoff || '-')).toUpperCase().slice(0, 500) })
        if (est.motivo_handoff && est.motivo_handoff !== 'calificado') await setConv(phone, { flow_state: 'humano' })
        if (ADMIN) await enviar(ADMIN, (est.motivo_handoff === 'calificado' ? '🔥 LEAD CALIFICADO (perfil completo)' : '⚠️ REQUIERE ASESOR YA (' + (est.motivo_handoff || '-') + ')') + '\nNombre: ' + (est.nombre || lead.full_name || '-') + '\nTel: ' + phone + '\nUso: ' + (est.uso || '-') + '\nInicial disp.: ' + (est.presupuesto_inicial || '-') + ' | Cuota: ' + (est.capacidad_cuota || '-') + '\nHorizonte: ' + (est.horizonte || '-') + ' | Proyecto: ' + (est.proyecto_sugerido || '-'), { tipo: 'aviso_admin' })
      } catch (e) { log('ESTADO_LEAD parse:', String(e.message || e)) }
    }
    textoOut = textoOut.slice(0, 900)
    const wantPlano = /\[ENVIAR_PLANO\]/i.test(textoOut)
    const wantFotos = /\[ENVIAR_FOTOS\]/i.test(textoOut)
    const wantVideo = /\[ENVIAR_VIDEO\]/i.test(textoOut)
    const wantBrochure = /\[ENVIAR_BROCHURE\]/i.test(textoOut)
    textoOut = textoOut.replace(/\[ENVIAR_(PLANO|FOTOS|VIDEO|BROCHURE)\]/gi, '').trim()
    if (textoOut) await enviar(jid, textoOut, { tipo: 'ia', lead_id: lead.id })
    if (proy) {
      if (wantPlano && proy.plano_url) await enviarArchivo(jid, proy.plano_url, 'plano', 'Plano actualizado — ' + proy.name)
      if (wantBrochure && proy.brochure_url) await enviarArchivo(jid, proy.brochure_url, 'brochure', 'Brochure — ' + proy.name)
      if (wantFotos) {
        const fs = [proy.foto1_url, proy.foto2_url, proy.foto3_url].filter(Boolean)
        for (let i = 0; i < fs.length; i++) await enviarArchivo(jid, fs[i], 'foto', i === 0 ? proy.name : '')
      }
      if (wantVideo && proy.video_url) await enviarArchivo(jid, proy.video_url, 'video', proy.name)
    }
  } catch (e) { log('IA ERROR:', String(e.message || e)) }
}

async function enviar(phone, texto, meta = {}) {
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
  const base = `Hola ${nombre} 👋 le saludamos de *Urbis Group*.\n\n`
  if (cuando === 'A5') return base + `Le recordamos con anticipación que su cuota N° ${q.installment_number} del lote *${lote}* (${proy}) por *${soles(deuda)}* vence en 5 días, el *${q.due_date}*. ¡Gracias por mantenerse al día! 🙌`
  if (cuando === 'A3') return base + `Su cuota N° ${q.installment_number} del lote *${lote}* (${proy}) por *${soles(deuda)}* vence en 3 días, el *${q.due_date}*. Puede pagar por transferencia o depósito. 🙌`
  return base + `*Hoy vence* su cuota N° ${q.installment_number} del lote *${lote}* (${proy}) por *${soles(deuda)}*.\n\nCuando realice el pago, envíe la *foto de su voucher por este mismo chat* y nuestro equipo lo registrará. ¡Gracias! 📄✅`
}
function msjInsist(nombre, lote, proy, q, deuda, dd) {
  const p = tpl('INSISTENCIA', { nombre, lote, proyecto: proy, cuota: q.installment_number, monto: soles(deuda), fecha: q.due_date, dias: dd })
  if (p) return p
  return `Hola ${nombre}, le saludamos de *Urbis Group*.\n\nSu cuota N° ${q.installment_number} del lote *${lote}* (${proy}) por *${soles(deuda)}* venció hace ${dd} días.\n\nSi ya realizó el pago, envíenos el voucher por aquí; si tuvo un inconveniente, escríbanos para ayudarle a regularizar. 🙏`
}
function msjB(nombre, lote, proy, nVenc, deudaTotal) {
  const p = tpl('B', { nombre, lote, proyecto: proy, nvencidas: nVenc, deuda: soles(deudaTotal) })
  if (p) return p
  return `Hola ${nombre}, le saludamos de *Urbis Group*.\n\nSu lote *${lote}* (${proy}) registra *${nVenc} cuotas vencidas* por un total de *${soles(deudaTotal)}*.\n\nLe pedimos regularizar sus pagos para evitar mayores penalidades por mora. Si necesita una reprogramación, escríbanos y lo coordinamos. 🙏`
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
      const { error } = await supabase.from('secretary_tasks').insert({ secretary_id: r.secretary_id, routine_id: r.id, title: r.title, date: hoy, slot: r.slot, category: r.category || 'administrativa' })
      if (error && !/duplicate|unique/i.test(error.message)) log('SEC gen:', error.message)
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
      const { data: pend } = await supabase.from('secretary_tasks').select('*').eq('date', hoy).eq('status', 'pendiente').is('answered_at', null)
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
      : await supabase.from('secretary_tasks').select('*').eq('date', hoy).eq('status', 'pendiente').is('notified_at', null).not('time', 'is', null)
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
      : await supabase.from('secretary_tasks').select('*').eq('date', hoy).eq('status', 'pendiente').is('answered_at', null).is('reminded_at', null).not('asked_at', 'is', null).lt('asked_at', lim)
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
      const { data: todas } = await supabase.from('secretary_tasks').select('*').eq('date', hoy)
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

async function cobranza() {
  if (!(await flag('bot_activo')) || !(await flag('cobranza_activa'))) { log('COBRANZA DESACTIVADA desde el panel'); return }
  log('=== BARRIDO DE COBRANZA (4 NIVELES) ===')
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

  let alertasHumanas = []
  for (const v of ventas || []) {
    const c = v.client
    if (!c?.phone_valid || !c?.phone) continue
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
    const mt = String(texto).match(/^\s*tarea\s+(\S+)\s+([\s\S]+)/i)
    if (mt) {
      const { data: cands } = await supabase.from('secretaries').select('*').ilike('full_name', '%' + mt[1] + '%').eq('active', true).limit(1)
      const sec = (cands || [])[0]
      if (!sec) { await enviar(ADMIN, '❌ No encontré a la secretaria "' + mt[1] + '". Usa: TAREA <nombre> <fecha/hora> <descripción>', { tipo: 'aviso_admin' }); return }
      const fh = parseFechaHora(mt[2])
      let titulo = mt[2]
      if (fh.matchFecha) titulo = titulo.replace(new RegExp(fh.matchFecha.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
      if (fh.matchHora) titulo = titulo.replace(new RegExp(fh.matchHora.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
      titulo = titulo.replace(/\s+/g, ' ').replace(/^[,\s\-:]+|[,\s\-:]+$/g, '').trim()
      if (!titulo) { await enviar(ADMIN, '❌ Falta la descripción. Ej: TAREA ' + mt[1] + ' el 5 a las 10 llevar contratos', { tipo: 'aviso_admin' }); return }
      const fecha = fh.date || secHoy()
      const { error } = await supabase.from('secretary_tasks').insert({ secretary_id: sec.id, title: titulo.toUpperCase(), date: fecha, time: fh.time, slot: slotDeHora(fh.time) })
      await enviar(ADMIN, error ? '❌ ERROR: ' + error.message : '✅ Tarea creada para *' + sec.full_name + '*: ' + titulo.toUpperCase() + ' — ' + fmtFechaEs(fecha) + (fh.time ? ' a las ' + fh.time : ''), { tipo: 'aviso_admin' })
      return
    }
    // "aprende: <dato>" -> lo guarda en el cerebro APRENDIDO (se aplica al instante)
    const ma = String(texto).match(/^\s*aprende\s*:([\s\S]+)/i)
    if (ma) {
      const dato = ma[1].trim()
      if (dato) {
        const prev = ((await brain('aprendido')) || '').trim()
        const nuevo = (prev ? prev + '\n' : '') + '- ' + dato + '  (aprendido ' + new Date().toLocaleDateString('es-PE') + ' por WhatsApp)'
        await supabase.from('bot_brains').upsert({ key: 'aprendido', content: nuevo, updated_at: new Date().toISOString() })
        _brains.t = 0
        await enviar(ADMIN, '✅ Aprendido: "' + dato.slice(0, 140) + '". Lo usaré desde ahora.', { tipo: 'aviso_admin' })
      } else await enviar(ADMIN, 'Formato: *aprende: <el dato que quieres que recuerde>*', { tipo: 'aviso_admin' })
      return
    }
    // el ADMIN: comando gratis o Q&A con IA (sin importar el checklist)
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
    // Solo GERENCIA usa comandos gratis / Q&A con datos confidenciales; las secretarias
    // solo hacen su control de actividades. No se interrumpe un checklist en curso con IA.
    if (tnum === 'gerencia' && !(await tieneChecklistAbierto(phone)) && await atenderInterno(jid, phone, texto, 'GERENCIA')) return
    await manejarSecretaria(jid, phone, texto).catch(e => log('SEC resp:', e.message)); return
  }

  // ¿es cliente?
  const p9 = phone.slice(-9)
  const { data: clientes } = await supabase.from('clients').select('id, full_name').ilike('phone', `%${p9}%`).limit(1)
  const cliente = (clientes || [])[0]
  if (tnum === 'cliente' && !cliente) return
  if (cliente) {
    if (/pag(ue|ué|ado)|voucher|deposit|transferi|constancia/i.test(corto)) {
      await enviar(jid, `¡Gracias ${cliente.full_name.split(' ')[0]}! 🙌 Hemos recibido su mensaje. Nuestro equipo verificará el pago y le confirmaremos en breve.`, { tipo: 'auto_cliente', client_id: cliente.id })
      if (ADMIN) await enviar(ADMIN, `🤖 CLIENTE *${cliente.full_name}* (${phone}) escribió:\n"${corto}"\n\n→ Posible pago por verificar en CUOTAS.`, { tipo: 'aviso_admin' })
    }
    return // clientes: no aplicar flujo de leads
  }

  // ¿lead existente o nuevo? — flujo guiado
  const { data: leadsEx } = await supabase.from('leads').select('id, full_name, status').ilike('phone', `%${p9}%`).limit(1)
  let lead = (leadsEx || [])[0]
  const estado = conv?.flow_state || null

  // VENTAS apagado: el bot NO conversa con leads. Solo registra el nuevo en el Kanban
  // (sin responder) para no perderlo; los clientes y el equipo (arriba) sí se atienden.
  if (!(await flag('ia_activa'))) {
    if (!lead) {
      await supabase.from('leads').insert({
        full_name: (pushName || 'POR CONFIRMAR').toUpperCase(), phone,
        source: 'whatsapp', status: 'nuevo', optin_whatsapp: true, optin_date: new Date().toISOString(),
      })
      if (ADMIN) await enviar(ADMIN, `🤖 NUEVO LEAD (VENTAS apagado: el bot NO le respondió): ${phone} ("${corto.slice(0, 50)}"). Está en el KANBAN para seguimiento manual.`, { tipo: 'aviso_admin' })
    }
    log('VENTAS APAGADO: lead registrado sin responder', phone)
    return
  }

  if (!lead) {
    // primer contacto: crear lead + preguntar nombre
    const { data: nuevoLead } = await supabase.from('leads').insert({
      full_name: (pushName || 'POR CONFIRMAR').toUpperCase(), phone,
      source: 'whatsapp', status: 'nuevo', optin_whatsapp: true, optin_date: new Date().toISOString(),
    }).select().single()
    lead = nuevoLead
    await setConv(phone, { flow_state: 'espera_nombre', lead_id: lead?.id })
    await enviar(jid, `¡Hola! 👋 Gracias por escribir a *Urbis Group Real Estate* 🌳\n\nPara atenderle mejor, ¿me indica su *nombre completo* por favor?`, { tipo: 'lead_flujo', lead_id: lead?.id })
    if (ADMIN) await enviar(ADMIN, `🤖 NUEVO LEAD por WhatsApp: ${phone} ("${corto.slice(0, 50)}"). Ya está en el KANBAN.`, { tipo: 'aviso_admin' })
    return
  }

  if (estado === 'espera_nombre') {
    const nombre = corto.replace(/^\s*(mi nombre es|me llamo|yo soy|soy)\s+/i, '').replace(/[^\p{L} .'-]/gu, '').trim().toUpperCase()
    if (nombre.length >= 3) {
      await supabase.from('leads').update({ full_name: nombre, status: 'contactado' }).eq('id', lead.id)
      const { data: proys } = await supabase.from('projects').select('id, name').order('created_at')
      if ((proys || []).length === 1) {
        const unico = proys[0]
        await supabase.from('leads').update({ project_id: unico.id, temperature: 'tibio', status: 'interesado' }).eq('id', lead.id)
        await setConv(phone, { flow_state: 'completado' })
        if (IA_KEY && (await flag('ia_activa'))) {
          const leadIA = { ...lead, full_name: nombre, project_id: unico.id }
          await responderIA(jid, phone, leadIA, conv, 'INSTRUCCION INTERNA (esto no lo escribio el cliente): salude por su primer nombre UNA sola vez, mencione el proyecto en una frase con su gancho principal y pregunte SOLO el USO o motivo (vivienda, inversion o un negocio como hospedaje). Todavia NO de precios.')
        } else {
          await enviar(jid, `¡Un gusto, ${nombre.split(' ')[0]}! 😊 Un asesor le compartirá precios y condiciones de *${unico.name}*. ¿Qué le gustaría saber primero?`, { tipo: 'lead_flujo', lead_id: lead.id })
        }
        if (ADMIN) await enviar(ADMIN, `🤖 LEAD CALIFICADO ✅
Nombre: ${nombre}
Tel: ${phone}
Proyecto: ${unico.name}

→ Está en el KANBAN listo para que un asesor lo contacte.`, { tipo: 'aviso_admin' })
      } else {
        const lista = (proys || []).map(r => `*${r.name}*`).join(', ')
        await setConv(phone, { flow_state: 'espera_proyecto' })
        await enviar(jid, `¡Un gusto, ${nombre.split(' ')[0]}! 😊 ¿Cuál de nuestros proyectos le interesa? Tenemos ${lista}. Y si aún no está seguro, cuénteme qué zona le queda mejor y le oriento.`, { tipo: 'lead_flujo', lead_id: lead.id })
      }
    } else {
      await enviar(jid, 'Disculpe, no logré leer su nombre. ¿Me lo escribe por favor? 🙏', { tipo: 'lead_flujo', lead_id: lead.id })
    }
    return
  }

  if (estado === 'espera_proyecto') {
    const { data: proys } = await supabase.from('projects').select('id, name').order('created_at')
    let nombreProy = 'por definir'
    let proyElegido = null
    const txt = corto.toLowerCase()
    const n = parseInt(corto.replace(/\D/g, ''), 10)
    let pr = (!isNaN(n) && n >= 1 && n <= (proys || []).length) ? proys[n - 1] : null
    if (!pr) pr = (proys || []).find(x => x.name.toLowerCase().split(/\s+/).some(w => w.length > 3 && !['las', 'los'].includes(w) && txt.includes(w))) || null
    if (pr) {
      await supabase.from('leads').update({ project_id: pr.id, temperature: 'tibio', status: 'interesado' }).eq('id', lead.id)
      nombreProy = pr.name
      proyElegido = pr.id
    }
    await setConv(phone, { flow_state: 'completado' })
    if (IA_KEY && (await flag('ia_activa'))) {
      if (proyElegido) await enviar(jid, `¡Excelente! ✅ Registré su interés en *${nombreProy}*. 🌳`, { tipo: 'lead_flujo', lead_id: lead.id })
      const leadIA = { ...lead, project_id: proyElegido || lead.project_id }
      const inst = proyElegido
        ? 'INSTRUCCION INTERNA (esto no lo escribio el cliente): acaba de elegir este proyecto. Confirmelo en una frase con su gancho principal y pregunte SOLO el USO o motivo (vivienda, inversion o negocio). Todavia NO de precios.'
        : 'INSTRUCCION INTERNA (esto no lo escribio el cliente): no quedo claro que proyecto le interesa. Preguntele con calidez que zona o proyecto prefiere, mencionando brevemente los disponibles.'
      await responderIA(jid, phone, leadIA, conv, inst)
    } else {
      await enviar(jid, `¡Excelente! ✅ Registré su interés en *${nombreProy}*.\n\nEn breve uno de nuestros asesores le escribirá con toda la información: precios, ubicación y facilidades de pago. ¡Gracias por confiar en Urbis Group! 🌳`, { tipo: 'lead_flujo', lead_id: lead.id })
    }
    if (ADMIN) {
      const { data: l2 } = await supabase.from('leads').select('full_name, phone').eq('id', lead.id).single()
      await enviar(ADMIN, `🤖 LEAD CALIFICADO ✅\nNombre: ${l2?.full_name}\nTel: ${l2?.phone}\nProyecto: ${nombreProy}\n\n→ Está en el KANBAN listo para que un asesor lo contacte.`, { tipo: 'aviso_admin' })
    }
    return
  }

  if (!estado && lead?.id) {
    // lead huerfano (sin flujo activo): reiniciar el flujo guiado
    await setConv(phone, { flow_state: 'espera_nombre', lead_id: lead.id })
    await enviar(jid, '¡Hola de nuevo! 👋 Gracias por escribir a *Urbis Group Real Estate* 🌳\n\nPara atenderle mejor, ¿me indica su *nombre completo* por favor?', { tipo: 'lead_flujo', lead_id: lead.id })
    return
  }

  if (estado === 'humano') {
    if (lead?.id) await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('WHATSAPP: ' + corto).toUpperCase().slice(0, 500) })
    return
  }

  // conversacion completada: nota + IA (con cortes sin IA)
  if (lead?.id) {
    await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('WHATSAPP: ' + corto).toUpperCase().slice(0, 500) })
    const trivial = corto.length < 3 || /^(gracias|grasias|ok|okey|oki|ya|listo|dale|de acuerdo|👍|🙏)[.!\s]*$/i.test(corto)
    if (trivial) return
    if (/asesor|humano|persona real|hablar con alguien|que me llamen/i.test(corto)) {
      await setConv(phone, { flow_state: 'humano' })
      await enviar(jid, 'Claro 🙌 Le paso con un asesor de Urbis para el detalle. Le escribe en breve.', { tipo: 'lead_flujo', lead_id: lead.id })
      if (ADMIN) await enviar(ADMIN, '⚠️ REQUIERE ASESOR YA (pidio humano)\nTel: ' + phone + '\nNombre: ' + (lead.full_name || '-') + '\nUltimo msj: ' + corto.slice(0, 120), { tipo: 'aviso_admin' })
      return
    }
    await responderIA(jid, phone, lead, conv, corto)
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
