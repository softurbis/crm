// ============================================================
// MOTOR DE LEADS SOBRE LA CLOUD API OFICIAL (sin Baileys)
// ------------------------------------------------------------
// Porta el flujo configurable del panel (projects.bot_flow) al webhook de la
// API oficial de Meta. MISMAS tablas de siempre (whatsapp_conversations,
// whatsapp_messages, scheduled_messages, leads, lead_activities): el panel,
// la bandeja y el kanban no cambian en nada.
//
// Correr:  node leads_api.js          (o bajo pm2: pm2 start leads_api.js --name leads-api)
// .env:    SUPABASE_URL, SUPABASE_SERVICE_KEY,
//          WA_PHONE_NUMBER_ID, WA_TOKEN, WA_VERIFY_TOKEN, WA_PUERTO (opc, 8090)
//
// Notas honestas de la migración (vs Baileys):
//  - Respuestas a leads: GRATIS (siempre llegan dentro de la ventana de 24h).
//  - Avisos internos a admin/asesor: la API solo permite texto libre si esa
//    persona escribió al número en las últimas 24h. Si la ventana está cerrada
//    el aviso queda como "fallido" aquí, pero el lead SIEMPRE queda en el
//    kanban y en la bandeja del panel (no se pierde nada). Fase B: plantilla
//    utility para avisos internos.
//  - edit_panel / vcard_panel / label_panel eran trucos de Baileys: se marcan
//    fallidos con motivo claro. El envío normal del panel (texto/adjuntos) SÍ va.
// ============================================================
require('dotenv').config()
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const { enviarTexto, enviarMedia, servidorWebhook, bajarMedia } = require('./cloudapi')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const espera = ms => new Promise(r => setTimeout(r, ms))
let PAUSA_MS = 3000
let ADMIN = (process.env.ADMIN_PHONE || '').replace(/\D/g, '')

// admin configurable desde el panel (bot_settings.admin_phone), igual que el bot
async function refrescarAdmin() {
  try {
    const { data } = await supabase.from('bot_settings').select('value').eq('key', 'admin_phone').maybeSingle()
    if (data && data.value) { const d = String(data.value).replace(/\D/g, ''); if (d.length >= 9) ADMIN = d }
  } catch {}
}
refrescarAdmin(); setInterval(refrescarAdmin, 60000)

async function flag(key) {
  try {
    const { data } = await supabase.from('bot_settings').select('value').eq('key', key).maybeSingle()
    return data ? String(data.value) === '1' : true   // sin fila = prendido
  } catch { return true }
}
async function tipoNumero(phone) {
  const p9 = String(phone).slice(-9)
  const { data } = await supabase.from('whatsapp_numbers').select('tipo').ilike('phone', `%${p9}%`).limit(1)
  return (data && data[0] && data[0].tipo) || null
}

// ---------- conversaciones (sin session_id: este canal es la API oficial) ----------
async function estadoConv(phone) {
  const { data } = await supabase.from('whatsapp_conversations').select('*').eq('phone', phone)
    .order('last_message_at', { ascending: false, nullsFirst: false }).limit(1)
  return (data || [])[0] || null
}
async function setConv(phone, campos) {
  const existe = await estadoConv(phone)
  if (existe) { const { error } = await supabase.from('whatsapp_conversations').update({ ...campos, last_message_at: new Date().toISOString() }).eq('id', existe.id); if (error) log('DB conv upd:', error.message) }
  else {
    const { error } = await supabase.from('whatsapp_conversations').insert({ phone, ...campos, last_message_at: new Date().toISOString() })
    if (error) log('DB conv ins:', error.message)
  }
}

// ---------- ENVIAR (texto libre por la ventana de 24h) ----------
async function enviar(phone, texto, meta = {}) {
  const dig = String(phone).replace(/\D/g, '')
  if (['lead_flujo', 'auto_cliente'].includes(meta.tipo || '')) await espera(PAUSA_MS)
  try {
    const r = await enviarTexto(dig, texto)
    await supabase.from('scheduled_messages').insert({
      recipient_phone: dig, body: texto, tipo: meta.tipo || 'manual',
      lead_id: meta.lead_id || null, client_id: meta.client_id || null,
      scheduled_for: new Date().toISOString(), status: 'enviado', sent_at: new Date().toISOString(),
      wa_msg_id: r.messages?.[0]?.id || null,
    })
    log('ENVIADO [' + (meta.tipo || 'msj') + '] a', dig)
    return true
  } catch (e) {
    // tipico: ventana de 24h cerrada (avisos internos) -> queda fallido pero nada se pierde
    await supabase.from('scheduled_messages').insert({
      recipient_phone: dig, body: texto, tipo: meta.tipo || 'manual',
      scheduled_for: new Date().toISOString(), status: 'fallido', last_error: String(e.message || e).slice(0, 300),
    })
    log('ERROR enviando a', dig, e.message)
    return false
  }
}
// material del flujo (media_lib): imagen/video/pdf por URL publica; link como texto
async function enviarMediaLib(phone, lib, ids, lead) {
  if (!Array.isArray(ids) || !ids.length) return
  const byId = {}; for (const it of (lib || [])) byId[String(it.id)] = it
  for (const id of ids) {
    const it = byId[String(id)]
    if (!it || !it.url) continue
    await espera(PAUSA_MS)
    try {
      if (it.tipo === 'link') { await enviar(phone, (it.desc ? '*' + it.desc + '*\n' : '') + it.url, { tipo: 'lead_flujo', lead_id: lead?.id }); continue }
      const tipo = it.tipo === 'video' ? 'video' : it.tipo === 'pdf' ? 'document' : 'image'
      const r = await enviarMedia(String(phone).replace(/\D/g, ''), it.url, tipo, it.desc || '')
      await supabase.from('scheduled_messages').insert({
        recipient_phone: String(phone).replace(/\D/g, ''), body: it.desc || '[📎 adjunto del flujo]', tipo: 'lead_flujo',
        media_url: it.url, media_type: tipo, lead_id: lead?.id || null,
        scheduled_for: new Date().toISOString(), status: 'enviado', sent_at: new Date().toISOString(),
        wa_msg_id: r.messages?.[0]?.id || null,
      })
    } catch (e) { log('media_lib', id, ':', e.message) }
  }
}

// ============ FLUJO CONFIGURABLE (port fiel de index.js) ============
function parseFlow(proy) {
  try { const f = proy?.bot_flow; const o = typeof f === 'string' ? JSON.parse(f) : f; return (o && Array.isArray(o.steps) && o.steps.length) ? o : null } catch { return null }
}
const pasoPorId = (flow, id) => (flow.steps || []).find(s => String(s.id) === String(id))
const idxDePaso = (flow, id) => (flow.steps || []).findIndex(s => String(s.id) === String(id))

async function correrFlujo(phone, lead, proy, flow, idx) {
  const steps = flow.steps || []
  PAUSA_MS = Math.max(0, Math.round(Number(flow.pausa_seg ?? 3) * 1000))
  let guard = 0
  while (idx >= 0 && idx < steps.length && guard++ < 50) {
    const s = steps[idx]
    if (s.texto) {
      const primerNom = (lead.full_name && lead.full_name !== 'POR CONFIRMAR') ? lead.full_name.split(' ')[0] : ''
      const txt = String(s.texto).split('{proyecto}').join(proy?.name || 'nuestro proyecto').split('{nombre}').join(primerNom)
      await enviar(phone, txt, { tipo: 'lead_flujo', lead_id: lead.id })
    }
    await enviarMediaLib(phone, flow.media_lib || [], s.media, lead)
    if (s.pasar_asesor) { await pasarAsesor(phone, lead, 'flujo'); return }
    if (s.tipo === 'pregunta') {
      if ((s.opciones || []).length) {
        const ops = s.opciones.map((o, i) => (i + 1) + '. ' + o.label).join('\n')
        await enviar(phone, ops + '\n\n_(responde con el número o en tus palabras)_', { tipo: 'lead_flujo', lead_id: lead.id })
      }
      await setConv(phone, { flow_state: 'flow', flow_step: String(s.id), flow_reasks: 0 })
      return
    }
    idx++
  }
  await supabase.from('leads').update({ status: 'interesado', temperature: 'caliente' }).eq('id', lead.id)
  await setConv(phone, { flow_state: 'completado', flow_step: null })
  await finalizarLead(phone, lead)
}
async function iniciarFlujoProyecto(phone, lead) {
  const { data: proy } = await supabase.from('projects').select('*').eq('id', lead.project_id).maybeSingle()
  await setConv(phone, { project_id: lead.project_id || null })
  const flow = parseFlow(proy)
  if (proy && flow) { await correrFlujo(phone, lead, proy, flow, 0); return }
  await setConv(phone, { flow_state: 'completado', flow_step: null })
  await finalizarLead(phone, lead)
}
async function pedirProyecto(phone, lead, proys) {
  const lista = proys || []
  if (lista.length === 0) { await pasarAsesor(phone, lead, 'sin_proyectos_bot'); return }
  if (lista.length === 1) {
    await supabase.from('leads').update({ project_id: lista[0].id }).eq('id', lead.id)
    lead.project_id = lista[0].id
    await iniciarFlujoProyecto(phone, lead)
    return
  }
  await setConv(phone, { flow_state: 'espera_proyecto' })
  await enviar(phone, `¡Hola! 👋 ¿Sobre qué proyecto quieres información?${lista.map((p, i) => `\n${i + 1}. *${p.name}*`).join('')}\n\nRespóndeme con el número o el nombre.`, { tipo: 'lead_flujo', lead_id: lead.id })
}
async function responderFlujo(phone, lead, conv, corto) {
  const { data: proy } = await supabase.from('projects').select('*').eq('id', lead.project_id).maybeSingle()
  const flow = parseFlow(proy)
  const step = flow ? pasoPorId(flow, conv.flow_step) : null
  if (!proy || !flow || !step) { await setConv(phone, { flow_state: 'completado', flow_step: null }); await finalizarLead(phone, lead); return }
  const ops = step.opciones || []
  if (!ops.length) {
    await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('P: ' + (step.texto || '') + ' → R: ' + corto).slice(0, 500) })
    if (step.pasar_asesor) { await pasarAsesor(phone, lead, 'flujo'); return }
    await correrFlujo(phone, lead, proy, flow, idxDePaso(flow, step.id) + 1)
    return
  }
  let elegida = null
  const soloNum = /^\s*\d+\s*$/.test(corto)
  const n = parseInt(corto.replace(/\D/g, ''), 10)
  if (soloNum && n >= 1 && n <= ops.length) elegida = ops[n - 1]
  if (!elegida) { const t = corto.toLowerCase(); elegida = ops.find(o => String(o.claves || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean).some(k => t.includes(k))) }
  if (!elegida) {
    const opsTxt = ops.map((o, i) => (i + 1) + '. ' + o.label).join('\n')
    await enviar(phone, 'No te entendí bien 😅 Elige una opción:\n' + opsTxt + '\n\n_(responde con el número o en tus palabras)_', { tipo: 'lead_flujo', lead_id: lead.id })
    return
  }
  await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('P: ' + (step.texto || '') + ' → R: ' + elegida.label).slice(0, 500) })
  if (elegida.pasar_asesor || step.pasar_asesor) { await pasarAsesor(phone, lead, 'flujo'); return }
  let nextIdx = elegida.ir_a ? idxDePaso(flow, elegida.ir_a) : (idxDePaso(flow, step.id) + 1)
  if (nextIdx < 0) nextIdx = idxDePaso(flow, step.id) + 1
  await correrFlujo(phone, lead, proy, flow, nextIdx)
}
async function finalizarLead(phone, lead) {
  const { data: acts } = await supabase.from('lead_activities').select('note').eq('lead_id', lead.id).order('created_at')
  const { data: l2 } = await supabase.from('leads').select('full_name, project:projects(name, lead_notify_phone)').eq('id', lead.id).maybeSingle()
  const resp = (acts || []).filter(a => /^P: /.test(a.note))
    .map(a => '• ' + a.note.replace(/^P:\s*/, '').replace(/\s*→\s*R:\s*/, ' → ')).join('\n')
  const msj = '🔥 *LEAD CALIFICADO*\nProyecto: ' + (l2?.project?.name || '-') + '\nNombre: ' + (l2?.full_name || '-') + '\nTel: ' + phone + (resp ? '\n\n📝 *Respuestas:*\n' + resp : '') + '\n\n→ Ya está en el KANBAN.'
  const asesor = String(l2?.project?.lead_notify_phone || '').replace(/\D/g, '')
  const destinos = new Set(); if (ADMIN) destinos.add(ADMIN); if (asesor.length >= 9) destinos.add(asesor)
  for (const d of destinos) await enviar(d, msj, { tipo: 'aviso_admin' })
}
async function detectarProyecto(texto) {
  const { data: proys } = await supabase.from('projects').select('id, name').eq('bot_enabled', true).order('created_at')
  const txt = String(texto || '').toLowerCase()
  const stop = ['las', 'los', 'del', 'de', 'la', 'el', 'y', 'en', 'sobre', 'info', 'informacion', 'información', 'proyecto', 'mas', 'más', 'lote', 'lotes', 'para', 'quiero', 'hola', 'buenas']
  const scored = (proys || []).map(p => {
    const words = p.name.toLowerCase().split(/\s+/).filter(w => w.length > 3 && !stop.includes(w))
    return { p, hits: words.filter(w => txt.includes(w)).length }
  }).filter(x => x.hits > 0).sort((a, b) => b.hits - a.hits)
  let pr = null
  if (scored.length === 1) pr = scored[0].p
  else if (scored.length >= 2 && scored[0].hits > scored[1].hits) pr = scored[0].p
  return { proys: proys || [], pr }
}
async function pasarAsesor(phone, lead, motivo) {
  await setConv(phone, { flow_state: 'humano' })
  await supabase.from('leads').update({ status: 'negociacion', temperature: 'caliente' }).eq('id', lead.id).then(() => {}, () => {})
  const primer = (lead.full_name && lead.full_name !== 'POR CONFIRMAR') ? ', ' + lead.full_name.split(' ')[0] : ''
  await enviar(phone, `¡Con gusto${primer}! 🙌 Te paso con un *asesor especializado* que te ayudará con precios, disponibilidad y a coordinar tu visita. Te escribe en breve. 🌳`, { tipo: 'lead_flujo', lead_id: lead.id })
  const { data: l2 } = await supabase.from('leads').select('full_name, project:projects(name, lead_notify_phone)').eq('id', lead.id).maybeSingle()
  const msj = '📞 *LEAD PIDE ASESOR*\nProyecto: ' + (l2?.project?.name || '-') + '\nNombre: ' + (l2?.full_name || '-') + '\nTel: ' + phone + '\nMotivo: ' + motivo + '\n\n→ Está en el KANBAN, contáctalo pronto.'
  const asesor = String(l2?.project?.lead_notify_phone || '').replace(/\D/g, '')
  const destinos = new Set(); if (ADMIN) destinos.add(ADMIN); if (asesor.length >= 9) destinos.add(asesor)
  for (const d of destinos) await enviar(d, msj, { tipo: 'aviso_admin' })
}

// ---------- media entrante -> Storage con deduplicacion (wa-chat/_unicos) ----------
const extDeMime = m => (String(m || '').split('/')[1] || 'bin').split(';')[0].replace('jpeg', 'jpg').slice(0, 5)
async function guardarMediaEntrante(mediaId, mime, nombre) {
  const { buffer, mime: mimeReal } = await bajarMedia(mediaId)
  const huella = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32)
  const ruta = 'wa-chat/_unicos/' + huella + '.' + extDeMime(mime || mimeReal)
  const { data: ya } = await supabase.storage.from('urbis-files').list('wa-chat/_unicos', { search: huella, limit: 1 })
  if (!ya || !ya.length) {
    const { error } = await supabase.storage.from('urbis-files').upload(ruta, buffer, { contentType: mime || mimeReal, upsert: true })
    if (error) throw new Error(error.message)
  }
  return supabase.storage.from('urbis-files').getPublicUrl(ruta).data.publicUrl
}

// ---------- ENTRANTE (webhook de Meta) ----------
async function manejarEntrante(m) {
  const phone = String(m.from || '').replace(/\D/g, '')
  if (!phone) return
  // dedupe: Meta reintenta webhooks; si ya registramos este wamid, ignorar
  const { data: dup } = await supabase.from('whatsapp_messages').select('id').eq('meta_message_id', m.id).limit(1)
  if (dup && dup.length) return

  // texto + media segun el tipo del mensaje
  let texto = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || ''
  let media = null
  const mm = m.image || m.video || m.audio || m.document || m.sticker
  if (mm) {
    const tipo = m.image ? 'image' : m.video ? 'video' : m.audio ? 'audio' : m.document ? 'document' : 'sticker'
    media = { tipo, name: m.document?.filename || null, caption: mm.caption || '' }
    if (!texto) texto = mm.caption || ''
    try { media.url = await guardarMediaEntrante(mm.id, mm.mime_type, media.name) }
    catch (e) { log('media entrante:', e.message); media.caption = media.caption || '[📎 adjunto recibido — no se pudo guardar]' }
  }
  const corto = String(texto || '').trim().slice(0, 400)
  log('ENTRANTE de', phone, ':', corto.slice(0, 60) || ('[' + (media?.tipo || 'media') + ']'))

  let conv = await estadoConv(phone)
  if (!conv) { await setConv(phone, {}); conv = await estadoConv(phone) }
  else await supabase.from('whatsapp_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id)
  await supabase.from('whatsapp_messages').insert({
    conversation_id: conv?.id || null, direction: 'in', body: corto || null, delivery_status: 'recibido',
    media_url: media?.url || null, media_type: media?.tipo || null, media_name: media?.name || null,
    meta_message_id: String(m.id),
  }).then(() => {}).catch(() => {})
  if (!corto) return
  if (!(await flag('bot_activo'))) { log('BOT APAGADO: ignorando a', phone); return }

  // numeros internos y silenciados: se registran, no se conversa (este numero es SOLO para leads)
  const tnum = await tipoNumero(phone)
  if (['silencio', 'desactivado', 'secretaria', 'gerencia'].includes(tnum || '') || phone === ADMIN) return

  // modo humano del panel: el bot se calla por completo
  if (conv && conv.modo === 'humano') {
    if (conv.lead_id) await supabase.from('lead_activities').insert({ lead_id: conv.lead_id, note: ('WHATSAPP: ' + corto).toUpperCase().slice(0, 500) }).then(() => {}, () => {})
    return
  }

  // ¿cliente con lote? este numero no es de cobranza: registrar y avisar si parece pago
  const p9 = phone.slice(-9)
  const { data: clientes } = await supabase.from('clients').select('id, full_name').ilike('phone', `%${p9}%`).limit(1)
  const cliente = (clientes || [])[0]
  if (cliente) {
    if (/pag(ue|ué|ado)|voucher|deposit|transferi|constancia/i.test(corto) && ADMIN)
      await enviar(ADMIN, `🤖 CLIENTE *${cliente.full_name}* (${phone}) escribió al número de leads:\n"${corto}"\n\n→ Posible pago por verificar en CUOTAS.`, { tipo: 'aviso_admin' })
    return
  }

  // ---- flujo de leads (mismas reglas del bot) ----
  const { data: leadsEx } = await supabase.from('leads').select('id, full_name, status, project_id').ilike('phone', `%${p9}%`).limit(1)
  let lead = (leadsEx || [])[0]
  const estado = conv?.flow_state || null

  if (!(await flag('ia_activa'))) {
    if (!lead && /^\d{9,13}$/.test(phone)) {
      await supabase.from('leads').insert({
        full_name: 'POR CONFIRMAR', phone, source: 'whatsapp', status: 'nuevo',
        optin_whatsapp: true, optin_date: new Date().toISOString(),
      }).then(() => {}, () => {})
    }
    log('VENTAS APAGADO: registro silencioso de', phone)
    return
  }
  if (lead && estado && estado !== 'humano' && estado !== 'completado' &&
      /\basesor|humano|persona real|hablar con (alguien|un)|que me llamen|ll[aá]men|vendedor|encargado|un agente/i.test(corto)) {
    await pasarAsesor(phone, lead, 'pidio_asesor')
    return
  }
  if (!lead) {
    const d = await detectarProyecto(corto)
    const { data: nuevoLead } = await supabase.from('leads').insert({
      full_name: 'POR CONFIRMAR', phone, source: 'whatsapp', status: 'nuevo', project_id: d.pr?.id || null,
      optin_whatsapp: true, optin_date: new Date().toISOString(),
    }).select().single()
    lead = nuevoLead
    if (!lead) { log('no pude crear el lead', phone); return }
    if (ADMIN) await enviar(ADMIN, `🤖 NUEVO LEAD: ${phone}${d.pr ? ' · interesado en ' + d.pr.name : ''} ("${corto.slice(0, 50)}").`, { tipo: 'aviso_admin' })
    if (d.pr) { await iniciarFlujoProyecto(phone, lead); return }
    await pedirProyecto(phone, lead, d.proys)
    return
  }
  if (estado === 'espera_proyecto') {
    const { proys } = await detectarProyecto('')
    const n = parseInt(corto.replace(/\D/g, ''), 10)
    let pr = (!isNaN(n) && n >= 1 && n <= proys.length) ? proys[n - 1] : null
    if (!pr) pr = (await detectarProyecto(corto)).pr
    if (!pr) { await enviar(phone, 'No identifiqué el proyecto 🤔 Escríbeme el número de la lista, por favor.', { tipo: 'lead_flujo', lead_id: lead.id }); return }
    await supabase.from('leads').update({ project_id: pr.id, status: 'interesado', temperature: 'tibio' }).eq('id', lead.id)
    lead.project_id = pr.id
    await iniciarFlujoProyecto(phone, lead)
    return
  }
  if (estado === 'flow') { await responderFlujo(phone, lead, conv, corto); return }
  if (estado === 'humano') {
    await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('WHATSAPP: ' + corto).toUpperCase().slice(0, 500) }).then(() => {}, () => {})
    return
  }
  // sin estado en esta conversacion: re-reconocer proyecto o preguntar
  if (!estado) {
    if (lead.project_id) { await iniciarFlujoProyecto(phone, lead); return }
    const d = await detectarProyecto(corto)
    if (d.pr) { await supabase.from('leads').update({ project_id: d.pr.id }).eq('id', lead.id); lead.project_id = d.pr.id; await iniciarFlujoProyecto(phone, lead); return }
    await pedirProyecto(phone, lead, d.proys)
    return
  }
  // completado / humano previo: registrar y respuesta neutra (igual que el bot)
  await supabase.from('lead_activities').insert({ lead_id: lead.id, note: ('WHATSAPP: ' + corto).toUpperCase().slice(0, 500) }).then(() => {}, () => {})
  const trivial = corto.length < 3 || /^(gracias|grasias|ok|okey|oki|ya|listo|dale|de acuerdo|👍|🙏)[.!\s]*$/i.test(corto)
  if (trivial) return
  if (/asesor|humano|persona real|hablar con alguien|que me llamen|llamen/i.test(corto)) {
    await setConv(phone, { flow_state: 'humano' })
    await enviar(phone, 'Claro 🙌 Le paso con un asesor de Urbis. Te escribe en breve.', { tipo: 'lead_flujo', lead_id: lead.id })
    if (ADMIN) await enviar(ADMIN, '⚠️ PIDIÓ ASESOR\nTel: ' + phone + '\nNombre: ' + (lead.full_name || '-') + '\nÚltimo msj: ' + corto.slice(0, 120), { tipo: 'aviso_admin' })
    return
  }
  await enviar(phone, 'Gracias por tu mensaje 🙌 Un asesor de Urbis revisará tu consulta y te responderá pronto. Si es urgente escribe *ASESOR*.', { tipo: 'lead_flujo', lead_id: lead.id })
}

// ---------- estados de entrega (sent/delivered/read/failed) ----------
async function manejarEstado(s) {
  if (s.status === 'failed') {
    const err = (s.errors && s.errors[0] && (s.errors[0].title || s.errors[0].message)) || 'fallo de entrega'
    await supabase.from('scheduled_messages').update({ status: 'fallido', last_error: String(err).slice(0, 300) }).eq('wa_msg_id', s.id).then(() => {}, () => {})
    log('ENTREGA FALLIDA', s.id, err)
  }
}

// ---------- salientes del panel (manual_panel) ----------
async function procesarSalientesPanel() {
  const { data } = await supabase.from('scheduled_messages')
    .select('id, recipient_phone, body, media_url, media_type, media_name, conversation_id, sender_id, tipo')
    .in('tipo', ['manual_panel', 'edit_panel', 'vcard_panel', 'label_panel']).eq('status', 'pendiente').order('scheduled_for').limit(10)
  for (const m of (data || [])) {
    try {
      if (m.tipo !== 'manual_panel') throw new Error('funcion de Baileys no disponible en la API oficial (' + m.tipo + ')')
      const dig = String(m.recipient_phone).replace(/\D/g, '')
      let r
      if (m.media_url) {
        const mt = ['video', 'audio', 'document'].includes(m.media_type) ? m.media_type : 'image'
        r = await enviarMedia(dig, m.media_url, mt, (m.body || '').trim())
      } else r = await enviarTexto(dig, m.body || '')
      await supabase.from('scheduled_messages').update({ status: 'enviado', sent_at: new Date().toISOString(), wa_msg_id: r.messages?.[0]?.id || null }).eq('id', m.id)
      // humano respondio desde el panel: el bot se calla en ese chat
      let conv = null
      if (m.conversation_id) { const { data: c } = await supabase.from('whatsapp_conversations').select('id, modo, phone').eq('id', m.conversation_id).maybeSingle(); conv = c }
      if (!conv) conv = await estadoConv(dig)
      if (conv && conv.modo !== 'humano')
        await supabase.from('whatsapp_conversations').update({ modo: 'humano', humano_por: m.sender_id || null, humano_desde: new Date().toISOString() }).eq('id', conv.id)
      log('PANEL -> ENVIADO a', dig)
    } catch (e) {
      await supabase.from('scheduled_messages').update({ status: 'fallido', last_error: String(e.message || e).slice(0, 300) }).eq('id', m.id)
      log('PANEL -> ERROR a', m.recipient_phone, String(e.message || e))
    }
  }
}

// ---------- arranque ----------
if (!process.env.WA_PHONE_NUMBER_ID || !process.env.WA_TOKEN) { console.error('Faltan WA_PHONE_NUMBER_ID / WA_TOKEN en .env'); process.exit(1) }
servidorWebhook({
  puerto: Number(process.env.WA_PUERTO || 8090),
  alRecibir: m => manejarEntrante(m).catch(e => log('entrante:', e.message)),
  alEstado: s => manejarEstado(s).catch(() => {}),
})
setInterval(() => { procesarSalientesPanel().catch(() => {}) }, 5000)
log('MOTOR DE LEADS (Cloud API oficial) corriendo. Webhook en /webhook, puerto', process.env.WA_PUERTO || 8090)
