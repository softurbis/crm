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
const ADMIN = (process.env.ADMIN_PHONE || '').replace(/\D/g, '')
const DIAS_ANTES = Number(process.env.DIAS_ANTES || 3)
const VENCIDAS_CADA = Number(process.env.VENCIDAS_CADA_DIAS || 4)
const MAX_DIA = Number(process.env.MAX_ENVIOS_DIA || 40)

let sock = null
let enviadosHoy = 0
let diaActual = new Date().toDateString()

const log = (...a) => console.log(new Date().toLocaleString('es-PE'), '|', ...a)
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const espera = ms => new Promise(r => setTimeout(r, ms))
const delayAleatorio = () => 20000 + Math.floor(Math.random() * 25000) // 20-45 s

function jidDe(phone) {
  let p = String(phone || '').replace(/\D/g, '')
  if (p.length === 9) p = '51' + p
  return p + '@s.whatsapp.net'
}
function telDeJid(jid) { return (jid || '').split('@')[0].replace(/\D/g, '') }

async function enviar(phone, texto, meta = {}) {
  if (new Date().toDateString() !== diaActual) { diaActual = new Date().toDateString(); enviadosHoy = 0 }
  if (enviadosHoy >= MAX_DIA) { log('TOPE DIARIO ALCANZADO, no se envia a', phone); return false }
  try {
    await sock.sendMessage(jidDe(phone), { text: texto })
    enviadosHoy++
    await supabase.from('scheduled_messages').insert({
      recipient_phone: String(phone), body: texto, tipo: meta.tipo || 'manual',
      installment_id: meta.installment_id || null, client_id: meta.client_id || null,
      lead_id: meta.lead_id || null, scheduled_for: new Date().toISOString(),
      status: 'enviado', sent_at: new Date().toISOString(),
    })
    log('ENVIADO [' + (meta.tipo || 'msj') + '] a', phone)
    return true
  } catch (e) {
    log('ERROR enviando a', phone, e.message)
    await supabase.from('scheduled_messages').insert({
      recipient_phone: String(phone), body: texto, tipo: meta.tipo || 'manual',
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

function msjA(nombre, lote, proy, q, deuda, cuando) {
  const base = `Hola ${nombre} 👋 le saludamos de *Urbis Group*.\n\n`
  if (cuando === 'A5') return base + `Le recordamos con anticipación que su cuota N° ${q.installment_number} del lote *${lote}* (${proy}) por *${soles(deuda)}* vence en 5 días, el *${q.due_date}*. ¡Gracias por mantenerse al día! 🙌`
  if (cuando === 'A3') return base + `Su cuota N° ${q.installment_number} del lote *${lote}* (${proy}) por *${soles(deuda)}* vence en 3 días, el *${q.due_date}*. Puede pagar por transferencia o depósito. 🙌`
  return base + `*Hoy vence* su cuota N° ${q.installment_number} del lote *${lote}* (${proy}) por *${soles(deuda)}*.\n\nCuando realice el pago, envíe la *foto de su voucher por este mismo chat* y nuestro equipo lo registrará. ¡Gracias! 📄✅`
}
function msjInsist(nombre, lote, proy, q, deuda, dd) {
  return `Hola ${nombre}, le saludamos de *Urbis Group*.\n\nSu cuota N° ${q.installment_number} del lote *${lote}* (${proy}) por *${soles(deuda)}* venció hace ${dd} días.\n\nSi ya realizó el pago, envíenos el voucher por aquí; si tuvo un inconveniente, escríbanos para ayudarle a regularizar. 🙏`
}
function msjB(nombre, lote, proy, nVenc, deudaTotal) {
  return `Hola ${nombre}, le saludamos de *Urbis Group*.\n\nSu lote *${lote}* (${proy}) registra *${nVenc} cuotas vencidas* por un total de *${soles(deudaTotal)}*.\n\nLe pedimos regularizar sus pagos para evitar mayores penalidades por mora. Si necesita una reprogramación, escríbanos y lo coordinamos. 🙏`
}
function msjC(nombre, lote, proy, nVenc, deudaTotal) {
  return `⚠️ *AVISO IMPORTANTE - URBIS GROUP* ⚠️\n\nSr(a). ${nombre}: su lote *${lote}* (${proy}) acumula *${nVenc} cuotas vencidas* por *${soles(deudaTotal)}*.\n\nConforme a su contrato, la acumulación de cuotas impagas es causal de resolución y puede derivar en la *pérdida/expropiación del lote* y de los montos pagados.\n\n*Es urgente que se comunique con nosotros HOY* para regularizar o llegar a un acuerdo por escrito. Estamos para ayudarle a conservar su inversión. 📞`
}

async function cobranza() {
  log('=== BARRIDO DE COBRANZA (4 NIVELES) ===')
  try { await supabase.rpc('mark_overdue_installments') } catch (e) { log('mark_overdue:', e.message) }
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
  if (existe) await supabase.from('whatsapp_conversations').update({ ...campos, last_message_at: new Date().toISOString() }).eq('phone', phone)
  else await supabase.from('whatsapp_conversations').insert({ phone, ...campos, last_message_at: new Date().toISOString() })
}

async function manejarEntrante(jid, texto, pushName) {
  const phone = telDeJid(jid)
  if (!texto || phone === ADMIN) return
  const corto = texto.trim().slice(0, 400)
  log('ENTRANTE de', phone, ':', corto.slice(0, 60))

  // PALABRA DE SEGURIDAD: "mapero" reinicia el bot para este chat (modo prueba)
  if (corto.toLowerCase() === 'mapero') {
    const { data: convR } = await supabase.from('whatsapp_conversations').select('id, lead_id').eq('phone', phone).maybeSingle()
    if (convR?.lead_id) {
      await supabase.from('lead_activities').delete().eq('lead_id', convR.lead_id)
      await supabase.from('scheduled_messages').update({ lead_id: null }).eq('lead_id', convR.lead_id)
      await supabase.from('leads').delete().eq('id', convR.lead_id)
    }
    if (convR) {
      await supabase.from('whatsapp_messages').delete().eq('conversation_id', convR.id)
      await supabase.from('whatsapp_conversations').delete().eq('id', convR.id)
    }
    await enviar(phone, '🔄 BOT REINICIADO PARA ESTE CHAT (modo prueba). Escriba cualquier mensaje para comenzar de nuevo.', { tipo: 'reporte' })
    log('RESET mapero para', phone)
    return
  }

  // guardar el mensaje entrante
  const conv = await estadoConv(phone)
  await supabase.from('whatsapp_messages').insert({
    conversation_id: conv?.id || null, direction: 'in', body: corto, delivery_status: 'recibido',
  }).then(() => {}).catch(() => {})

  // ¿es cliente?
  const p9 = phone.slice(-9)
  const { data: clientes } = await supabase.from('clients').select('id, full_name').ilike('phone', `%${p9}%`).limit(1)
  const cliente = (clientes || [])[0]
  if (cliente) {
    if (/pag(ue|ué|ado)|voucher|deposit|transferi|constancia/i.test(corto)) {
      await enviar(phone, `¡Gracias ${cliente.full_name.split(' ')[0]}! 🙌 Hemos recibido su mensaje. Nuestro equipo verificará el pago y le confirmaremos en breve.`, { tipo: 'auto_cliente', client_id: cliente.id })
      if (ADMIN) await enviar(ADMIN, `🤖 CLIENTE *${cliente.full_name}* (${phone}) escribió:\n"${corto}"\n\n→ Posible pago por verificar en CUOTAS.`, { tipo: 'aviso_admin' })
    }
    return // clientes: no aplicar flujo de leads
  }

  // ¿lead existente o nuevo? — flujo guiado
  const { data: leadsEx } = await supabase.from('leads').select('id, full_name, lead_status').ilike('phone', `%${p9}%`).limit(1)
  let lead = (leadsEx || [])[0]
  const estado = conv?.flow_state || null

  if (!lead) {
    // primer contacto: crear lead + preguntar nombre
    const { data: nuevoLead } = await supabase.from('leads').insert({
      full_name: (pushName || 'POR CONFIRMAR').toUpperCase(), phone,
      source: 'whatsapp', lead_status: 'nuevo', optin_whatsapp: true, optin_date: new Date().toISOString(),
    }).select().single()
    lead = nuevoLead
    await setConv(phone, { flow_state: 'espera_nombre', lead_id: lead?.id })
    await enviar(phone, `¡Hola! 👋 Gracias por escribir a *Urbis Group Real Estate* 🌳\n\nPara atenderle mejor, ¿me indica su *nombre completo* por favor?`, { tipo: 'lead_flujo', lead_id: lead?.id })
    if (ADMIN) await enviar(ADMIN, `🤖 NUEVO LEAD por WhatsApp: ${phone} ("${corto.slice(0, 50)}"). Ya está en el KANBAN.`, { tipo: 'aviso_admin' })
    return
  }

  if (estado === 'espera_nombre') {
    const nombre = corto.replace(/[^\p{L} .'-]/gu, '').trim().toUpperCase()
    if (nombre.length >= 3) {
      await supabase.from('leads').update({ full_name: nombre }).eq('id', lead.id)
      const { data: proys } = await supabase.from('projects').select('id, name').order('created_at')
      const lista = (proys || []).map((r, i) => `*${i + 1}*. ${r.name}`).join('\n')
      await setConv(phone, { flow_state: 'espera_proyecto' })
      await enviar(phone, `¡Un gusto, ${nombre.split(' ')[0]}! 😊\n\n¿Qué proyecto le interesa? Responda con el número:\n${lista}\n*0*. Aún no estoy seguro`, { tipo: 'lead_flujo', lead_id: lead.id })
    } else {
      await enviar(phone, 'Disculpe, no logré leer su nombre. ¿Me lo escribe por favor? 🙏', { tipo: 'lead_flujo', lead_id: lead.id })
    }
    return
  }

  if (estado === 'espera_proyecto') {
    const n = parseInt(corto.replace(/\D/g, ''), 10)
    const { data: proys } = await supabase.from('projects').select('id, name').order('created_at')
    let nombreProy = 'por definir'
    if (!isNaN(n) && n >= 1 && n <= (proys || []).length) {
      const pr = proys[n - 1]
      await supabase.from('leads').update({ project_id: pr.id, temperature: 'tibio' }).eq('id', lead.id)
      nombreProy = pr.name
    }
    await setConv(phone, { flow_state: 'completado' })
    await enviar(phone, `¡Excelente! ✅ Registré su interés en *${nombreProy}*.\n\nEn breve uno de nuestros asesores le escribirá con toda la información: precios, ubicación y facilidades de pago. ¡Gracias por confiar en Urbis Group! 🌳`, { tipo: 'lead_flujo', lead_id: lead.id })
    if (ADMIN) {
      const { data: l2 } = await supabase.from('leads').select('full_name, phone').eq('id', lead.id).single()
      await enviar(ADMIN, `🤖 LEAD CALIFICADO ✅\nNombre: ${l2?.full_name}\nTel: ${l2?.phone}\nProyecto: ${nombreProy}\n\n→ Está en el KANBAN listo para que un asesor lo contacte.`, { tipo: 'aviso_admin' })
    }
    return
  }

  // conversacion ya completada: guardar como nota en el lead
  if (lead?.id) {
    await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('WHATSAPP: ' + corto).toUpperCase().slice(0, 500) })
  }
}

// ---------- CONEXION ----------
async function iniciar() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const { version } = await fetchLatestBaileysVersion()
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), browser: ['URBIS AGENTE', 'Chrome', '120.0'] })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', u => {
    if (u.qr) {
      console.log('\n============================================')
      console.log('  ESCANEA ESTE QR CON EL WHATSAPP DEL AGENTE')
      console.log('  (WhatsApp > Dispositivos vinculados > Vincular)')
      console.log('============================================\n')
      qrcode.generate(u.qr, { small: true })
    }
    if (u.connection === 'open') {
      log('✅ CONECTADO A WHATSAPP')
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
        await manejarEntrante(jid, texto, m.pushName)
      } catch (e) { log('error procesando entrante:', e.message) }
    }
  })

  // cron diario de cobranza
  const [hh, mm] = (process.env.HORA_COBRANZA || '09:00').split(':')
  cron.schedule(`${Number(mm)} ${Number(hh)} * * *`, cobranza, { timezone: 'America/Lima' })
  log(`Agente iniciado. Cobranza diaria programada a las ${hh}:${mm} (hora Lima).`)

  if (process.env.RUN_NOW === '1') { await espera(8000); cobranza() }
}

iniciar()
