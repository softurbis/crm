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

async function flag(k) { const { data } = await supabase.from('bot_settings').select('value').eq('key', k).maybeSingle(); return !data || data.value !== '0' }
async function tipoNumero(soloDig) { const { data } = await supabase.from('whatsapp_numbers').select('tipo').ilike('phone', '%' + String(soloDig).slice(-9) + '%').limit(1); return (data || [])[0]?.tipo || null }

// ---------- IA CONVERSACIONAL (Claude) ----------
const IA_KEY = process.env.ANTHROPIC_API_KEY || ''
const IA_MODEL = process.env.IA_MODEL || 'claude-haiku-4-5-20251001'

async function enviarArchivo(jid, url, clase, caption) {
  try {
    await espera(2500 + Math.floor(Math.random() * 2500))
    const dest = String(jid).includes('@') ? String(jid) : jidDe(jid)
    const low = String(url).toLowerCase()
    if (clase === 'video') await sock.sendMessage(dest, { video: { url }, caption: caption || undefined })
    else if (clase === 'plano' && low.includes('.pdf')) await sock.sendMessage(dest, { document: { url }, mimetype: 'application/pdf', fileName: 'PLANO-ACTUALIZADO.pdf', caption: caption || undefined })
    else await sock.sendMessage(dest, { image: { url }, caption: caption || undefined })
    enviadosHoy++
    await supabase.from('scheduled_messages').insert({ recipient_phone: telDeJid(dest), body: (clase === 'video' ? '🎬 VIDEO ENVIADO' : clase === 'plano' ? '🗺️ PLANO ENVIADO' : '📷 FOTO ENVIADA') + (caption ? ': ' + caption : ''), tipo: 'ia', scheduled_for: new Date().toISOString(), status: 'enviado', sent_at: new Date().toISOString() })
    log('MEDIA [' + clase + '] enviada a', telDeJid(dest))
  } catch (e) { log('ERROR media', clase, ':', String(e.message || e)) }
}

async function responderIA(jid, phone, lead, conv, texto) {
  try {
    if (!IA_KEY) return
    if (!(await flag('ia_activa'))) return
    let proy = null
    if (lead.project_id) {
      const { data } = await supabase.from('projects').select('id, name, description, how_to_arrive, maps_url, facebook_url, instagram_url, bot_knowledge, plano_url, foto1_url, foto2_url, foto3_url, video_url').eq('id', lead.project_id).maybeSingle()
      proy = data
    }
    let fichas = ''
    let lotesTxt = ''
    if (proy) {
      fichas = 'PROYECTO: ' + proy.name + '\nDESCRIPCION: ' + (proy.description || '') + '\nCOMO LLEGAR: ' + (proy.how_to_arrive || '') + '\nUBICACION MAPS: ' + (proy.maps_url || '') + '\n\nFICHA DEL BOT:\n' + String(proy.bot_knowledge || '(sin ficha)').slice(0, 6000)
      fichas += '\nREDES DEL PROYECTO: Facebook: ' + (proy.facebook_url || 'no disponible') + ' | Instagram: ' + (proy.instagram_url || 'no disponible')
      const mat = []
      if (proy.plano_url) mat.push('PLANO')
      const fotosArr = [proy.foto1_url, proy.foto2_url, proy.foto3_url].filter(Boolean)
      if (fotosArr.length) mat.push('FOTOS(' + fotosArr.length + ')')
      if (proy.video_url) mat.push('VIDEO')
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
    const system = 'Eres el asesor virtual de WhatsApp de URBIS GROUP REAL ESTATE (venta de lotes en Ucayali, Peru). ESTILO: SIEMPRE trate de USTED (le, su; JAMAS tutee). NO vuelva a saludar si ya hay conversacion previa: nada de repetir Hola + nombre en cada mensaje; continue la conversacion con naturalidad. Maximo 4-5 lineas estilo WhatsApp, 1-2 emojis maximo. USE LOS DATOS: cuando pregunten precios o condiciones, responda con las cifras concretas de la FICHA y de DATOS EN VIVO (precio desde, separacion, inicial, cuota mensual, plazos) y recien despues invite a la visita; NO sea evasivo si el dato existe. Solo si un dato no esta en la ficha ni en DATOS EN VIVO, diga que un asesor se lo confirma. ESTRATEGIA DE VENTA: primero INFORME con generosidad — entregue toda la informacion que pidan (precio desde, separacion, inicial, cuotas, medidas de lote, cuantos disponibles, ubicacion con link, papeles, redes) sin apurar el cierre. Termine cada mensaje con una pregunta que invite a seguir conversando sobre SU necesidad (zona, tamano, uso: vivienda o negocio, presupuesto) — NO ofrezca la visita en cada mensaje. SOLO cuando el cliente ya recibio bastante informacion y muestra interes real (pregunta como separar, como pagar, como visitar, o lleva varias preguntas seguidas), ofrezca el CIERRE preguntando cual prefiere: agendar una VISITA al proyecto o que un asesor lo LLAME para darle el detalle. Cuando pidan ubicacion o como llegar, envie el link de Maps tal cual aparece en la ficha; si quieren ver fotos, otros proyectos o saber mas de Urbis, comparta los links de REDES DEL PROYECTO. REGLAS INQUEBRANTABLES: nunca diga barato, accesible, asequible ni economico; nunca de el numero de partida registral; nunca de nombres ni datos de clientes o terceros (diga: esa informacion es confidencial); no prometa rentabilidad, valorizacion garantizada ni titulo con fecha; no invente precios, descuentos ni promociones; NUNCA diga cuantos lotes quedan disponibles (si preguntan disponibilidad, diga que hay opciones y que puede verificar el lote que le interese); DOSIFIQUE: maximo 2 datos nuevos por mensaje, nunca entregue toda la informacion de golpe. MATERIAL MULTIMEDIA: si el cliente pide el plano, agregue al FINAL de su mensaje el codigo [ENVIAR_PLANO]; si pide fotos o quiere ver como es el proyecto, agregue [ENVIAR_FOTOS]; si pide video, agregue [ENVIAR_VIDEO]. Use cada codigo SOLO si ese material figura en MATERIAL DISPONIBLE, maximo un tipo por mensaje, y jamas mencione los codigos en el texto visible. Nombre del cliente: ' + (lead.full_name || 'desconocido') + '.'
    const cuerpo = { model: IA_MODEL, max_tokens: 350, system, messages: [{ role: 'user', content: fichas + '\n' + lotesTxt + '\n\nCONVERSACION PREVIA:\n' + hist + '\n\nNUEVO MENSAJE DEL CLIENTE: ' + texto + '\n\nResponde SOLO con el texto del mensaje de WhatsApp.' }] }
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
    let textoOut = out.slice(0, 900)
    const wantPlano = /\[ENVIAR_PLANO\]/i.test(textoOut)
    const wantFotos = /\[ENVIAR_FOTOS\]/i.test(textoOut)
    const wantVideo = /\[ENVIAR_VIDEO\]/i.test(textoOut)
    textoOut = textoOut.replace(/\[ENVIAR_(PLANO|FOTOS|VIDEO)\]/gi, '').trim()
    if (textoOut) await enviar(jid, textoOut, { tipo: 'ia', lead_id: lead.id })
    if (proy) {
      if (wantPlano && proy.plano_url) await enviarArchivo(jid, proy.plano_url, 'plano', 'Plano actualizado — ' + proy.name)
      if (wantFotos) {
        const fs = [proy.foto1_url, proy.foto2_url, proy.foto3_url].filter(Boolean)
        for (let i = 0; i < fs.length; i++) await enviarArchivo(jid, fs[i], 'foto', i === 0 ? proy.name : '')
      }
      if (wantVideo && proy.video_url) await enviarArchivo(jid, proy.video_url, 'video', proy.name)
    }
  } catch (e) { log('IA ERROR:', String(e.message || e)) }
}

async function enviar(phone, texto, meta = {}) {
  if (new Date().toDateString() !== diaActual) { diaActual = new Date().toDateString(); enviadosHoy = 0 }
  if (enviadosHoy >= MAX_DIA) { log('TOPE DIARIO ALCANZADO, no se envia a', phone); return false }
  const soloDig = String(phone).includes('@') ? telDeJid(String(phone)) : String(phone).replace(/\D/g, '')
  if (!ADMIN || soloDig !== String(ADMIN)) {
    if ((await tipoNumero(soloDig)) === 'desactivado') { log('NUMERO DESACTIVADO, no se envia a', soloDig); return false }
  }
  const destJid = String(phone).includes('@') ? String(phone) : jidDe(phone)
  if (['lead_flujo', 'ia', 'auto_cliente'].includes(meta.tipo || '')) {
    try { await sock.sendPresenceUpdate('composing', destJid) } catch (e) {}
    await espera(4000 + Math.floor(Math.random() * 8000))
  }
  try {
    await sock.sendMessage(destJid, { text: texto })
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
  if (!(await flag('bot_activo')) || !(await flag('cobranza_activa'))) { log('COBRANZA DESACTIVADA desde el panel'); return }
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
  if (existe) { const { error } = await supabase.from('whatsapp_conversations').update({ ...campos, last_message_at: new Date().toISOString() }).eq('phone', phone); if (error) log('DB conv upd:', error.message) }
  else { const { error } = await supabase.from('whatsapp_conversations').insert({ phone, ...campos, last_message_at: new Date().toISOString() }); if (error) log('DB conv ins:', error.message) }
}

async function manejarEntrante(jid, jidPN, texto, pushName) {
  const phone = telDeJid(jidPN || jid)
  if (!texto || phone === ADMIN) return
  const corto = texto.trim().slice(0, 400)
  log('ENTRANTE de', phone, ':', corto.slice(0, 60))

  // PALABRA DE SEGURIDAD: "mapero" reinicia el bot para este chat (modo prueba)
  if (corto.toLowerCase() === 'mapero') {
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
    log('RESET mapero para', phone)
    return
  }

  // registrar SIEMPRE la conversacion y el mensaje entrante (aunque el bot no responda)
  let conv = await estadoConv(phone)
  if (!conv) { await setConv(phone, { wa_jid: jid }); conv = await estadoConv(phone) }
  else await supabase.from('whatsapp_conversations').update({ wa_jid: jid, last_message_at: new Date().toISOString() }).eq('id', conv.id)
  await supabase.from('whatsapp_messages').insert({
    conversation_id: conv?.id || null, direction: 'in', body: corto, delivery_status: 'recibido',
  }).then(() => {}).catch(() => {})

  if (!(await flag('bot_activo'))) { log('BOT APAGADO: ignorando a', phone); return }
  const tnum = await tipoNumero(phone)
  if (tnum === 'desactivado' || tnum === 'secretaria') { log('NUMERO ' + tnum.toUpperCase() + ': sin respuesta a', phone); return }

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
      await supabase.from('leads').update({ full_name: nombre }).eq('id', lead.id)
      const { data: proys } = await supabase.from('projects').select('id, name').order('created_at')
      if ((proys || []).length === 1) {
        const unico = proys[0]
        await supabase.from('leads').update({ project_id: unico.id, temperature: 'tibio' }).eq('id', lead.id)
        await setConv(phone, { flow_state: 'completado' })
        if (IA_KEY && (await flag('ia_activa'))) {
          const leadIA = { ...lead, full_name: nombre, project_id: unico.id }
          await responderIA(jid, phone, leadIA, conv, 'INSTRUCCION INTERNA (esto no lo escribio el cliente): salude por su primer nombre UNA sola vez, presente el proyecto en una frase con su gancho principal, y de SOLO 3 datos: lote desde (precio de DATOS EN VIVO), cuota mensual referencial y tamano de lote desde. Nada mas. Cierre con UNA pregunta sobre su necesidad (por ejemplo: para casa de campo, para vivir o como inversion).')
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
      await supabase.from('leads').update({ project_id: pr.id, temperature: 'tibio' }).eq('id', lead.id)
      nombreProy = pr.name
      proyElegido = pr.id
    }
    await setConv(phone, { flow_state: 'completado' })
    if (IA_KEY && (await flag('ia_activa'))) {
      if (proyElegido) await enviar(jid, `¡Excelente! ✅ Registré su interés en *${nombreProy}*. 🌳`, { tipo: 'lead_flujo', lead_id: lead.id })
      const leadIA = { ...lead, project_id: proyElegido || lead.project_id }
      const inst = proyElegido
        ? 'INSTRUCCION INTERNA (esto no lo escribio el cliente): acaba de elegir este proyecto. Presente el proyecto en una frase con su gancho y de SOLO 3 datos: lote desde (precio de DATOS EN VIVO), cuota mensual referencial y tamano de lote desde. Nada mas. Cierre con UNA pregunta sobre su necesidad.'
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

  // conversacion completada: nota en el lead + respuesta con IA
  if (lead?.id) {
    await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('WHATSAPP: ' + corto).toUpperCase().slice(0, 500) })
    await responderIA(jid, phone, lead, conv, corto)
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
  log(`Agente iniciado. Cobranza diaria programada a las ${hh}:${mm} (hora Lima).`)

  if (process.env.RUN_NOW === '1') { await espera(8000); cobranza() }
}

iniciar()


// ---------- SALIENTES DESDE EL PANEL ----------
async function procesarSalientesPanel() {
  if (!sock) return
  const { data } = await supabase.from('scheduled_messages').select('id, recipient_phone, body').eq('tipo', 'manual_panel').eq('status', 'pendiente').order('scheduled_for').limit(10)
  for (const m of (data || [])) {
    try {
      const { data: c } = await supabase.from('whatsapp_conversations').select('wa_jid').eq('phone', m.recipient_phone).maybeSingle()
      const destino = c?.wa_jid || m.recipient_phone
      await sock.sendMessage(String(destino).includes('@') ? destino : jidDe(destino), { text: m.body })
      await supabase.from('scheduled_messages').update({ status: 'enviado', sent_at: new Date().toISOString() }).eq('id', m.id)
      log('PANEL -> ENVIADO a', m.recipient_phone)
    } catch (e) {
      await supabase.from('scheduled_messages').update({ status: 'fallido', last_error: String(e.message || e) }).eq('id', m.id)
      log('PANEL -> ERROR a', m.recipient_phone, String(e.message || e))
    }
  }
}
setInterval(() => { procesarSalientesPanel().catch(() => {}) }, 5000)
