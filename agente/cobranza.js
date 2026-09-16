// ============================================================================
// AGENTE DE COBRANZA — API oficial de WhatsApp + Claude Haiku       [sep 2026]
// ----------------------------------------------------------------------------
// Proceso APARTE del bot de leads (index.js, Baileys): otro numero, otro pm2.
// Un solo numero oficial para la cobranza de TODOS los proyectos.
//
//  · Entra un mensaje por el webhook de Meta → se guarda → el agente contesta.
//  · El agente solo conoce al cliente cuyo celular VALIDADO es el que escribe.
//    Las herramientas resuelven al cliente desde el telefono del chat: el modelo
//    nunca recibe ni puede pasar un id de cliente. Numero no registrado =
//    respuesta fija, sin IA y sin ningun dato.
//  · Voucher → cobranza_pagos_reportados. NO toca daily_income: eso lo hace la
//    secretaria al validar (validar_pago_reportado, sql/76).
//  · Si la secretaria escribe (panel o celular), el agente se calla en ese chat.
//  · Los avisos programados son PLANTILLAS aprobadas por Meta: fuera de la
//    ventana de 24 h Meta no deja mandar texto libre.
//
// Correr:  pm2 start cobranza.js --name cobranza-agente
// .env:    SUPABASE_URL, SUPABASE_SERVICE_KEY, WA_PHONE_NUMBER_ID, WA_TOKEN,
//          WA_VERIFY_TOKEN, COBRANZA_ANTHROPIC_API_KEY (si falta usa ANTHROPIC_API_KEY),
//          R2_WORKER / R2_BOT_SECRET / R2_PUBLIC_URL, TELEGRAM_BOT_TOKEN (opcional)
// Sin WA_TOKEN arranca igual: sirve para probar desde el panel (Cobranza IA → Probar).
// ============================================================================
require('dotenv').config()
const crypto = require('crypto')
const { createClient } = require('@supabase/supabase-js')
const { Anthropic } = require('@anthropic-ai/sdk')
const WA = require('./cloudapi')
const { subirAR2 } = require('./r2')
const TG = require('./telegram')

const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a)
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
if (!process.env.SUPABASE_URL || !SB_KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en .env'); process.exit(1) }
const supabase = createClient(process.env.SUPABASE_URL, SB_KEY)

// Clave PROPIA de cobranza: su gasto se ve aparte y se puede anular sin romper
// el asistente interno del bot. Si no esta, usa la general (y lo avisa).
const CLAVE_IA = process.env.COBRANZA_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || ''
const CLAVE_PROPIA = !!process.env.COBRANZA_ANTHROPIC_API_KEY
const ia = CLAVE_IA ? new Anthropic({ apiKey: CLAVE_IA, maxRetries: 2, timeout: 60000 }) : null
const WA_LISTO = !!(process.env.WA_PHONE_NUMBER_ID && process.env.WA_TOKEN)
const PUERTO = Number(process.env.COBRANZA_PUERTO || process.env.WA_PUERTO || 8090)
const MODELO_POR_DEFECTO = 'claude-haiku-4-5'

// ---------- utilidades ----------
const TZ = 'America/Lima'
const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const horaLima = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const dig = t => String(t || '').replace(/\D/g, '')
const nueve = t => dig(t).slice(-9)
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const monto2 = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const diasEntre = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 86400000)
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const fechaCorta = iso => iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : ''
const espera = ms => new Promise(r => setTimeout(r, ms))
const nombrePila = full => { const p = String(full || '').trim().split(/\s+/)[0] || ''; return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : 'cliente' }
const loteDe = v => `Mz ${v?.lot?.mz ?? '?'} Lt ${v?.lot?.lt ?? '?'}`
const esFecha = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
// medianoche de Lima en UTC (Peru no tiene horario de verano)
const inicioDiaLima = iso => new Date(iso + 'T05:00:00Z').toISOString()

let CFG = {}
async function config() {
  const { data, error } = await supabase.from('cobranza_config').select('*').eq('id', 1).maybeSingle()
  if (error) { log('config:', error.message, '(¿falta correr sql/76?)'); return CFG }
  CFG = data || {}
  return CFG
}

// ============================================================================
// QUIEN ESCRIBE: la unica puerta a los datos
// ============================================================================
// Clientes cuyo celular VALIDADO y habilitado para el bot es este numero. Es la
// misma regla de la cobranza de siempre (telefonosBot en index.js): si en la
// ficha el numero no esta marcado y validado, el agente no da ningun dato.
async function clientesDelTelefono(phone) {
  const p9 = nueve(phone)
  if (p9.length < 9) return []
  const { data, error } = await supabase.from('clients')
    .select('id, full_name, phone, phone_valid, phone_bot, phone2, phone2_valid, phone2_bot')
    .or(`phone.ilike.%${p9}%,phone2.ilike.%${p9}%`).limit(20)
  if (error) { log('clientes:', error.message); return [] }
  return (data || []).filter(c =>
    (nueve(c.phone) === p9 && c.phone_valid && c.phone_bot !== false) ||
    (nueve(c.phone2) === p9 && c.phone2_valid && c.phone2_bot))
}
function telefonosBot(c) {
  const out = []
  if (c?.phone && c.phone_valid && c.phone_bot !== false) out.push(dig(c.phone))
  if (c?.phone2 && c.phone2_valid && c.phone2_bot) out.push(dig(c.phone2))
  return [...new Set(out.map(t => t.length === 9 ? '51' + t : t))]
}

const COLS_VENTA = 'id, client_id, co_client_id, status, monthly_amount, lot:lots!inner(id, mz, lt, project:projects(id, name)), installments(id, installment_number, amount, amount_paid, due_date, status)'
async function ventasDe(clientIds) {
  if (!clientIds || !clientIds.length) return []
  const [a, b] = await Promise.all([
    supabase.from('sales').select(COLS_VENTA).in('client_id', clientIds).in('status', ['en_proceso', 'pagado']),
    supabase.from('sales').select(COLS_VENTA).in('co_client_id', clientIds).in('status', ['en_proceso', 'pagado']),
  ])
  const m = new Map()
  for (const s of [...(a.data || []), ...(b.data || [])]) m.set(s.id, s)
  return [...m.values()]
}
function cuotasPendientes(v, hoy) {
  return (v.installments || [])
    .map(q => ({ ...q, pendiente: Math.round((Number(q.amount) - Number(q.amount_paid)) * 100) / 100 }))
    .filter(q => q.status !== 'pagado' && q.pendiente > 0.004)
    .sort((a, b) => a.installment_number - b.installment_number)
    .map(q => ({ ...q, vencida: q.due_date < hoy }))
}
// "Mz B Lt 12", "manzana b lote 12", "lote 12" → la venta que calza
function ventaPorTexto(ventas, texto) {
  const t = String(texto || '').toUpperCase()
  if (!t.trim()) return null
  const mz = (t.match(/\b(?:MZ|MZA|MANZANA)\.?\s*([A-Z0-9]{1,3})\b/) || [])[1]
  const lt = (t.match(/\b(?:LT|LOTE)\.?\s*(\d{1,4})\b/) || [])[1]
  const sinCeros = x => String(x ?? '').trim().toUpperCase().replace(/^0+(?=.)/, '')
  const calzan = ventas.filter(v =>
    (!mz || sinCeros(v.lot.mz) === sinCeros(mz)) && (!lt || sinCeros(v.lot.lt) === sinCeros(lt)))
  return (mz || lt) && calzan.length === 1 ? calzan[0] : null
}

// ============================================================================
// CHATS Y MENSAJES
// ============================================================================
async function chatDe(phone, esPrueba, nombreWhatsapp) {
  const p = dig(phone)
  const clientes = await clientesDelTelefono(p)
  const ids = clientes.map(c => c.id)
  const { data: ya } = await supabase.from('cobranza_chats').select('*').eq('phone', p).eq('es_prueba', !!esPrueba).maybeSingle()
  if (ya) {
    const campos = { client_ids: ids }
    if (nombreWhatsapp && nombreWhatsapp !== ya.nombre_whatsapp) campos.nombre_whatsapp = nombreWhatsapp
    await supabase.from('cobranza_chats').update(campos).eq('id', ya.id)
    return { ...ya, ...campos, clientes }
  }
  const { data: nuevo, error } = await supabase.from('cobranza_chats')
    .insert({ phone: p, es_prueba: !!esPrueba, client_ids: ids, nombre_whatsapp: nombreWhatsapp || null })
    .select('*').single()
  if (error) {
    // otro mensaje del mismo numero lo creo un instante antes
    const { data: otra } = await supabase.from('cobranza_chats').select('*').eq('phone', p).eq('es_prueba', !!esPrueba).maybeSingle()
    if (otra) return { ...otra, clientes }
    throw new Error('no se pudo crear el chat: ' + error.message)
  }
  return { ...nuevo, clientes }
}

const ventanaAbierta = chat => !!chat.ultimo_entrante_at && (Date.now() - new Date(chat.ultimo_entrante_at).getTime()) < 23.5 * 3600e3

// Manda texto libre (solo dentro de la ventana de 24 h) y lo deja en el chat.
async function enviarAlCliente(chat, texto, autor, extra = {}) {
  const fila = { chat_id: chat.id, direccion: 'out', autor, texto, estado: 'enviado', ...extra }
  if (chat.es_prueba) fila.estado = 'prueba'
  else if (!WA_LISTO) { fila.estado = 'fallido'; fila.error = 'Falta WA_TOKEN en el servidor: todavía no se puede enviar' }
  else if (!ventanaAbierta(chat)) { fila.estado = 'fallido'; fila.error = 'Pasaron más de 24 h desde el último mensaje del cliente: Meta solo deja escribirle con plantilla' }
  else {
    try {
      const r = await WA.enviarTexto(chat.phone, texto)
      fila.wa_id = r.messages?.[0]?.id || null
    } catch (e) { fila.estado = 'fallido'; fila.error = String(e.message || e).slice(0, 300) }
  }
  const { error } = await supabase.from('cobranza_mensajes').insert(fila)
  if (error) log('mensaje out:', error.message)
  await supabase.from('cobranza_chats').update({ ultimo_mensaje_at: new Date().toISOString() }).eq('id', chat.id)
  return fila.estado !== 'fallido'
}

// Aviso a la(s) responsable(s) de cobranza por Telegram (si lo tienen vinculado).
// Nunca frena al agente: si falla, el panel igual muestra el chat.
async function avisarResponsables(texto) {
  try {
    if (!TG.activo()) return
    const { data: us } = await supabase.from('profiles').select('phone, active').contains('permisos', ['cobranza'])
    for (const u of (us || []).filter(x => x.active !== false)) {
      const p9 = nueve(u.phone)
      if (p9.length < 9) continue
      const { data: tl } = await supabase.from('telegram_links').select('chat_id').ilike('phone', '%' + p9).limit(1)
      if (tl && tl[0] && tl[0].chat_id) await TG.tgEnviar(tl[0].chat_id, texto)
    }
  } catch (e) { log('aviso a responsables:', String(e.message || e)) }
}

async function pasarAHumano(chat, motivo) {
  if (chat.modo === 'humano') return
  await supabase.from('cobranza_chats').update({ modo: 'humano', motivo_humano: String(motivo || '').slice(0, 300), humano_desde: new Date().toISOString(), humano_por: null }).eq('id', chat.id)
  chat.modo = 'humano'
  if (!chat.es_prueba) {
    const quien = (chat.clientes || []).map(c => c.full_name).join(' / ') || 'número no registrado'
    await avisarResponsables('💬 *COBRANZA — atender chat*\n+' + chat.phone + ' · ' + quien + '\nMotivo: ' + motivo + '\n\nPanel → Cobranza IA → Conversaciones')
  }
}

// ============================================================================
// HERRAMIENTAS DEL AGENTE (todas acotadas al chat que escribe)
// ============================================================================
async function estadoDeCuenta(chat) {
  const hoy = hoyLima()
  const ventas = await ventasDe(chat.client_ids)
  if (!ventas.length) return { mensaje: 'Este número no tiene lotes registrados. No des datos: deriva a la secretaria.' }
  const ids = ventas.map(v => v.id)
  const [pagos, promesas, reportados] = await Promise.all([
    supabase.from('daily_income').select('sale_id, date, amount, income_type').in('sale_id', ids).order('date', { ascending: false }).limit(60),
    supabase.from('cobranza_promesas').select('sale_id, fecha_promesa, monto').in('sale_id', ids).eq('estado', 'vigente').eq('es_prueba', !!chat.es_prueba),
    supabase.from('cobranza_pagos_reportados').select('sale_id, monto, fecha').in('client_id', chat.client_ids).eq('estado', 'pendiente').eq('es_prueba', !!chat.es_prueba),
  ])
  return {
    fecha_de_hoy: fechaCorta(hoy),
    titulares: (chat.clientes || []).map(c => c.full_name),
    lotes: ventas.map(v => {
      const cuotas = v.installments || []
      const pend = cuotasPendientes(v, hoy)
      const vencidas = pend.filter(q => q.vencida)
      const proxima = pend.find(q => !q.vencida)
      const prom = (promesas.data || []).find(p => p.sale_id === v.id)
      return {
        lote: loteDe(v),
        proyecto: v.lot.project?.name || '',
        situacion: v.status === 'pagado' || !pend.length ? 'lote totalmente pagado' : 'pagando en cuotas',
        cuota_mensual: v.monthly_amount ? soles(v.monthly_amount) : null,
        cuotas_pagadas: cuotas.filter(q => q.status === 'pagado').length,
        cuotas_totales: cuotas.length,
        cuotas_vencidas: vencidas.map(q => ({ numero: q.installment_number, vencio: fechaCorta(q.due_date), pendiente: soles(q.pendiente) })),
        total_vencido: soles(vencidas.reduce((s, q) => s + q.pendiente, 0)),
        proxima_cuota: proxima ? { numero: proxima.installment_number, vence: fechaCorta(proxima.due_date), monto: soles(proxima.pendiente) } : null,
        saldo_pendiente_total: soles(pend.reduce((s, q) => s + q.pendiente, 0)),
        ultimos_pagos_registrados: (pagos.data || []).filter(p => p.sale_id === v.id).slice(0, 3)
          .map(p => ({ fecha: fechaCorta(p.date), monto: soles(p.amount), tipo: p.income_type })),
        promesa_de_pago_vigente: prom ? { fecha: fechaCorta(prom.fecha_promesa), monto: prom.monto ? soles(prom.monto) : null } : null,
      }
    }),
    pagos_en_revision: (reportados.data || []).map(p => ({ monto: p.monto ? soles(p.monto) : null, fecha: fechaCorta(p.fecha) })),
  }
}

async function cuentasParaPagar(chat, input) {
  let ventas = await ventasDe(chat.client_ids)
  const una = ventaPorTexto(ventas, input.lote)
  if (una) ventas = [una]
  const proyectos = [...new Set(ventas.map(v => v.lot.project?.id).filter(Boolean))]
  if (!proyectos.length) return { mensaje: 'Sin lotes registrados: deriva a la secretaria.' }
  const { data, error } = await supabase.from('financial_accounts')
    .select('project_id, name, type, account_number, cci, holder_name').in('project_id', proyectos).eq('active', true)
  if (error) return { error: error.message }
  const conDatos = (data || []).filter(c => c.account_number || c.cci)
  if (!conDatos.length) return { mensaje: 'No hay cuentas con número cargado en el sistema. Deriva a la secretaria para que le pase las cuentas.' }
  const nombre = id => ventas.find(v => v.lot.project?.id === id)?.lot.project?.name || ''
  return {
    cuentas: conDatos.map(c => ({
      proyecto: nombre(c.project_id), banco_o_billetera: c.name, tipo: c.type === 'digital_wallet' ? 'billetera' : 'banco',
      numero: c.account_number || null, cci: c.cci || null, titular: c.holder_name || null,
    })),
  }
}

async function registrarPagoReportado(chat, input) {
  const hoy = hoyLima()
  // el voucher: el ultimo adjunto que mando el cliente en ESTE chat. El modelo no
  // elige ninguna URL: asi no se puede "reportar" una imagen de otro chat.
  const { data: adj } = await supabase.from('cobranza_mensajes').select('id, media_url, created_at')
    .eq('chat_id', chat.id).eq('direccion', 'in').not('media_url', 'is', null)
    .order('created_at', { ascending: false }).limit(1)
  const m = (adj || [])[0]
  if (!m || Date.now() - new Date(m.created_at).getTime() > 48 * 3600e3)
    return { error: 'No hay una foto o PDF de voucher reciente en este chat. Pídele que la envíe.' }
  const { data: ya } = await supabase.from('cobranza_pagos_reportados').select('id').eq('mensaje_id', m.id).limit(1)
  if (ya && ya.length) return { ok: true, nota: 'Ese voucher ya estaba registrado para revisión. No lo registres de nuevo.' }

  const ventas = await ventasDe(chat.client_ids)
  const activas = ventas.filter(v => v.status === 'en_proceso')
  const venta = activas.length === 1 ? activas[0] : ventaPorTexto(activas, input.lote)
  const alertas = []
  const op = String(input.numero_operacion || '').trim().toUpperCase()
  if (op) {
    const [d1, d2] = await Promise.all([
      supabase.from('daily_income').select('id').ilike('operation_number', op).limit(1),
      supabase.from('cobranza_pagos_reportados').select('id').ilike('numero_operacion', op).neq('estado', 'rechazado').eq('es_prueba', !!chat.es_prueba).limit(1),
    ])
    if (d1.data && d1.data.length) alertas.push('OPERACIÓN YA REGISTRADA EN CUOTAS (¿voucher repetido?)')
    if (d2.data && d2.data.length) alertas.push('OPERACIÓN YA REPORTADA ANTES')
  } else alertas.push('SIN NÚMERO DE OPERACIÓN LEGIBLE')
  const fecha = esFecha(input.fecha) ? input.fecha : null
  if (!fecha) alertas.push('FECHA NO LEGIBLE')
  else if (fecha > hoy) alertas.push('FECHA FUTURA')
  const monto = Number(input.monto)
  if (!(monto > 0)) alertas.push('MONTO NO LEGIBLE')
  if (!venta && activas.length > 1) alertas.push('NO SE SABE A QUÉ LOTE CORRESPONDE')
  if (venta && monto > 0) {
    const deuda = cuotasPendientes(venta, hoy).reduce((s, q) => s + q.pendiente, 0)
    if (monto > deuda + 0.01) alertas.push('MONTO MAYOR A LA DEUDA DEL LOTE (' + soles(deuda) + ')')
  }

  const { error } = await supabase.from('cobranza_pagos_reportados').insert({
    chat_id: chat.id, mensaje_id: m.id,
    client_id: venta ? venta.client_id : (chat.client_ids[0] || null), sale_id: venta ? venta.id : null,
    voucher_url: m.media_url, monto: monto > 0 ? monto : null, fecha, numero_operacion: op || null,
    banco: input.banco || null, titular: input.titular || null,
    lectura: input, alerta: alertas.join(' · ') || null, es_prueba: !!chat.es_prueba,
  })
  if (error) return { error: 'No se pudo registrar: ' + error.message }
  if (!chat.es_prueba) {
    await avisarResponsables('💵 *PAGO REPORTADO POR VALIDAR*\n' + ((chat.clientes || []).map(c => c.full_name).join(' / ') || '+' + chat.phone)
      + (venta ? ' · ' + loteDe(venta) : '') + '\n' + (monto > 0 ? soles(monto) : 'monto no legible') + (op ? ' · op ' + op : '')
      + (alertas.length ? '\n⚠ ' + alertas.join(' · ') : '') + '\n\nPanel → Cobranza IA → Por validar')
  }
  return {
    ok: true, registrado_para_revision: true, alertas,
    nota: 'Dile que lo recibiste y que la secretaria lo valida. No digas que el pago ya está registrado.'
      + (alertas.length ? ' Hay observaciones: si alguna depende del cliente (foto borrosa, lote), pídele lo que falte.' : ''),
  }
}

async function registrarPromesa(chat, input) {
  const cfg = await config()
  const hoy = hoyLima()
  if (!esFecha(input.fecha)) return { error: 'Fecha inválida. Usa AAAA-MM-DD.' }
  if (input.fecha < hoy) return { error: 'Esa fecha ya pasó. Pregúntale de nuevo para qué día puede pagar.' }
  const max = Number(cfg.promesa_max_dias || 30)
  if (diasEntre(input.fecha, hoy) > max)
    return { error: `La fecha está a más de ${max} días. No la aceptes tú: deriva a la secretaria para que ella lo converse.`, derivar: true }
  const activas = (await ventasDe(chat.client_ids)).filter(v => v.status === 'en_proceso')
  if (!activas.length) return { error: 'No tiene lotes con cuotas pendientes. Deriva a la secretaria.' }
  const venta = activas.length === 1 ? activas[0] : ventaPorTexto(activas, input.lote)
  if (!venta) return { error: 'Tiene varios lotes: pregúntale para cuál es la promesa.', lotes: activas.map(loteDe) }

  // una promesa nueva reemplaza a la anterior de ese lote
  await supabase.from('cobranza_promesas').update({ estado: 'cancelada', cerrado_at: new Date().toISOString() })
    .eq('sale_id', venta.id).eq('estado', 'vigente').eq('es_prueba', !!chat.es_prueba)
  const monto = Number(input.monto) > 0 ? Number(input.monto) : null
  const { error } = await supabase.from('cobranza_promesas').insert({
    client_id: venta.client_id, sale_id: venta.id, chat_id: chat.id, fecha_promesa: input.fecha, monto,
    texto_cliente: String(input.texto_cliente || '').slice(0, 500), origen: 'agente', es_prueba: !!chat.es_prueba,
  })
  if (error) return { error: 'No se pudo anotar: ' + error.message }
  const dias = Number(cfg.promesa_avisar_dias ?? 1)
  return {
    ok: true, lote: loteDe(venta), fecha: fechaCorta(input.fecha), monto: monto ? soles(monto) : null,
    recordatorio: dias > 0 ? `se le recordará ${dias} día(s) antes` : 'se le recordará ese mismo día',
  }
}

async function ejecutar(nombre, input, chat) {
  switch (nombre) {
    case 'estado_de_cuenta': return estadoDeCuenta(chat)
    case 'cuentas_para_pagar': return cuentasParaPagar(chat, input)
    case 'registrar_pago_reportado': return registrarPagoReportado(chat, input)
    case 'registrar_promesa_de_pago': return registrarPromesa(chat, input)
    case 'derivar_a_secretaria':
      await pasarAHumano(chat, input.motivo || 'el agente lo derivó')
      return { ok: true, nota: 'Listo. Dile que la secretaria de cobranzas le escribe en breve. No sigas atendiendo este tema.' }
    default: return { error: 'Herramienta desconocida: ' + nombre }
  }
}

const HERRAMIENTAS = [
  {
    name: 'estado_de_cuenta',
    description: 'Devuelve los lotes del titular que escribe: cuotas vencidas, próxima cuota, saldo pendiente, últimos pagos, promesa vigente y pagos en revisión. Solo de este número. Úsala antes de responder cualquier pregunta sobre deuda, cuotas, fechas o pagos.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cuentas_para_pagar',
    description: 'Cuentas bancarias y billeteras activas del proyecto del cliente, para que realice su pago.',
    input_schema: {
      type: 'object',
      properties: { lote: { type: 'string', description: 'Opcional, si el cliente tiene varios lotes. Ej: "Mz B Lt 12"' } },
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_pago_reportado',
    description: 'Registra para REVISIÓN de la secretaria el voucher que el cliente acaba de enviar en foto o PDF. Úsala solo después de leer la imagen y solo si es un comprobante de pago. No confirma el pago.',
    input_schema: {
      type: 'object',
      properties: {
        monto: { type: 'number', description: 'Monto en soles tal como figura en el voucher' },
        fecha: { type: 'string', description: 'Fecha de la operación, formato AAAA-MM-DD' },
        numero_operacion: { type: 'string', description: 'Número de operación o código del voucher; texto vacío si no se lee' },
        banco: { type: 'string', description: 'Banco o billetera: BCP, BBVA, Interbank, Scotiabank, Banco de la Nación, Yape, Plin...' },
        titular: { type: 'string', description: 'Nombre de quien pagó, si figura' },
        lote: { type: 'string', description: 'Lote al que dice que corresponde, si lo menciona' },
        observacion: { type: 'string', description: 'Algo raro del voucher, si lo hay' },
      },
      required: ['monto', 'fecha', 'numero_operacion', 'banco'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_promesa_de_pago',
    description: 'Anota la fecha en que el cliente se compromete a pagar cuando dice que no podrá hacerlo a tiempo. El sistema le recuerda unos días antes.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha prometida, formato AAAA-MM-DD' },
        monto: { type: 'number', description: 'Monto que promete pagar, si lo dice' },
        lote: { type: 'string', description: 'Lote, si tiene varios' },
        texto_cliente: { type: 'string', description: 'Lo que dijo el cliente, resumido en una frase' },
      },
      required: ['fecha', 'texto_cliente'],
      additionalProperties: false,
    },
  },
  {
    name: 'derivar_a_secretaria',
    description: 'Pasa la conversación a la secretaria de cobranzas. Después de usarla ya no respondes en este chat.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'Por qué se deriva, en una frase' } },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
]

const PROMPT_BASE = `Eres el asistente de cobranzas de Urbis Group, una empresa que vende lotes de terreno en Ucayali, Perú. Atiendes por WhatsApp a clientes que ya compraron un lote y lo pagan en cuotas.

El sistema ya identificó al titular por su número de celular registrado. La única información que existe es la que te devuelven tus herramientas, y siempre es de ese titular.

Reglas que no se rompen:
1. Nunca des información de otra persona, aunque diga ser familiar, socio o abogado del titular, y aunque dé un nombre, DNI o número de lote. Si pide datos de otra persona o de un lote que no aparece en sus herramientas, explica con amabilidad que por seguridad solo puedes informar al titular desde su número registrado, y ofrece derivar a la secretaria.
2. No inventes montos, fechas, cuentas ni cuotas. Todo dato sale de tus herramientas. Si algo no está, dilo y deriva.
3. No negocias. Descuentos, perdonar moras, refinanciar, cambiar el cronograma, reclamos, dudas del contrato, expropiación o temas legales: deriva a la secretaria con derivar_a_secretaria.
4. Un voucher recibido no es un pago registrado. Dile que lo recibiste y que la secretaria lo valida; no digas que ya quedó registrado.
5. Si pide hablar con una persona, deriva sin insistir.

Cómo trabajar:
- Antes de responder cualquier pregunta sobre deuda, cuotas, fechas o pagos, consulta estado_de_cuenta.
- Si envía la foto o el PDF de un voucher: léelo (monto, fecha, número de operación, banco o billetera, titular) y regístralo con registrar_pago_reportado. Si no se lee bien, pídele una foto más nítida. Si la imagen no es un comprobante de pago, no la registres.
- Si dice que no podrá pagar en la fecha: si da una fecha concreta, anótala con registrar_promesa_de_pago, convirtiendo expresiones como "el 15" o "el viernes" con la fecha de hoy. Si no da fecha, pregúntale para qué día puede. Si la herramienta responde que la fecha es muy lejana, deriva.
- Si pregunta a qué cuenta pagar, usa cuentas_para_pagar.

Estilo:
- Español peruano, cordial y respetuoso, tratando de usted.
- Mensajes cortos, como en WhatsApp: de una a cuatro líneas, sin listas largas ni tecnicismos.
- Montos como S/ 350.00 y fechas como 15/09/2026.
- Saluda por su nombre solo al comienzo de la conversación.
- Si el cliente solo agradece o se despide, responde breve.`

// ============================================================================
// EL TURNO DEL AGENTE
// ============================================================================
async function historial(chat, conMedia = true) {
  const { data } = await supabase.from('cobranza_mensajes')
    .select('direccion, autor, texto, media_url, media_type, estado, created_at')
    .eq('chat_id', chat.id).order('created_at', { ascending: false }).limit(30)
  const filas = (data || []).reverse()
  let ultimaRespuesta = -1
  filas.forEach((m, i) => { if (m.direccion === 'out' && ['agente', 'secretaria', 'celular'].includes(m.autor)) ultimaRespuesta = i })
  const msgs = []
  const poner = (role, bloques) => {
    const ult = msgs[msgs.length - 1]
    if (ult && ult.role === role) ult.content.push(...bloques)
    else msgs.push({ role, content: [...bloques] })
  }
  filas.forEach((m, i) => {
    if (m.direccion === 'in') {
      const b = []
      if (m.media_url) {
        // solo lo que llego despues de la ultima respuesta va como imagen: lo
        // anterior ya se leyo, y reenviarlo en cada turno multiplica el costo
        const nuevo = i > ultimaRespuesta
        const esPdf = m.media_type === 'document' && /\.pdf(\?|$)/i.test(m.media_url)
        if (nuevo && conMedia && m.media_type === 'image') b.push({ type: 'image', source: { type: 'url', url: m.media_url } })
        else if (nuevo && conMedia && esPdf) b.push({ type: 'document', source: { type: 'url', url: m.media_url } })
        else b.push({ type: 'text', text: '[El cliente envió un archivo (' + (m.media_type || 'adjunto') + ')' + (nuevo ? ' que no se puede ver aquí' : ', ya revisado') + ']' })
      }
      if (m.texto) b.push({ type: 'text', text: m.texto })
      if (b.length) poner('user', b)
    } else if (m.texto) {
      const prefijo = { agente: '', secretaria: '[Escribió la secretaria de cobranzas] ', celular: '[Escribió la secretaria desde el celular] ', plantilla: '[Aviso automático enviado] ', sistema: '[Aviso del sistema] ' }[m.autor] ?? ''
      poner('assistant', [{ type: 'text', text: prefijo + m.texto }])
    }
  })
  if (msgs.length && msgs[0].role !== 'user') msgs.unshift({ role: 'user', content: [{ type: 'text', text: '[Inicio de la conversación]' }] })
  return msgs
}

async function responder(chat, cfg) {
  const inicio = new Date().toISOString()
  let mensajes = await historial(chat)
  if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') return
  const hoy = hoyLima()
  const dia = new Date().toLocaleDateString('es-PE', { timeZone: TZ, weekday: 'long' })
  const system = [
    { type: 'text', text: PROMPT_BASE + (cfg.notas_agente ? '\n\nIndicaciones del negocio:\n' + cfg.notas_agente : ''), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `Hoy es ${dia} ${fechaCorta(hoy)} (${hoy}), hora de Lima ${horaLima()}.\nTitular(es) de este número: ${(chat.clientes || []).map(c => c.full_name).join(' / ')}.` },
  ]
  const modelo = cfg.modelo || MODELO_POR_DEFECTO
  const textos = []
  const uso = { in: 0, out: 0, cache: 0 }
  let conMedia = true
  let terminado = false

  for (let vuelta = 0; vuelta < 6; vuelta++) {
    let r
    try {
      r = await ia.messages.create({ model: modelo, max_tokens: 1024, system, tools: HERRAMIENTAS, messages: mensajes })
    } catch (e) {
      // una imagen que Anthropic no pudo abrir tumba el turno entero: se reintenta
      // una vez describiendo el adjunto en texto
      if (e instanceof Anthropic.BadRequestError && conMedia && vuelta === 0) {
        log('IA 400 con adjunto, reintento sin imagen:', String(e.message).slice(0, 160))
        conMedia = false
        mensajes = await historial(chat, false)
        vuelta = -1
        continue
      }
      throw e
    }
    uso.in += r.usage?.input_tokens || 0
    uso.out += r.usage?.output_tokens || 0
    uso.cache += r.usage?.cache_read_input_tokens || 0
    for (const b of r.content) if (b.type === 'text' && b.text.trim()) textos.push(b.text.trim())
    if (r.stop_reason === 'refusal') {
      await pasarAHumano(chat, 'el asistente no pudo responder este mensaje')
      textos.length = 0
      textos.push('Gracias por su mensaje. La secretaria de cobranzas le escribe en breve.')
      terminado = true
      break
    }
    if (r.stop_reason !== 'tool_use') { terminado = true; break }
    mensajes.push({ role: 'assistant', content: r.content })
    const resultados = []
    for (const b of r.content) {
      if (b.type !== 'tool_use') continue
      let res
      try { res = await ejecutar(b.name, b.input || {}, chat) } catch (e) { res = { error: String(e.message || e) } }
      log('  herramienta', b.name, res && res.error ? '→ error: ' + res.error : '→ ok')
      resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(res), ...(res && res.error ? { is_error: true } : {}) })
    }
    mensajes.push({ role: 'user', content: resultados })
  }

  let respuesta = textos.join('\n\n').trim().slice(0, 3500)
  if (!terminado || !respuesta) {
    await pasarAHumano(chat, 'el asistente no llegó a una respuesta')
    respuesta = respuesta || 'Gracias por su mensaje. La secretaria de cobranzas le escribe en breve.'
  }
  // la respuesta se fecha al INICIO del turno: si el cliente escribio algo mientras
  // el agente pensaba, ese mensaje queda despues y el siguiente turno lo contesta
  await enviarAlCliente(chat, respuesta, 'agente', { created_at: inicio, tokens_in: uso.in, tokens_out: uso.out, tokens_cache: uso.cache })
  log('AGENTE →', '+' + chat.phone, (chat.es_prueba ? '[PRUEBA] ' : '') + respuesta.replace(/\s+/g, ' ').slice(0, 90), `(${uso.in}/${uso.out} tokens)`)

  const { data: nuevos } = await supabase.from('cobranza_mensajes').select('id').eq('chat_id', chat.id).eq('direccion', 'in').gt('created_at', inicio).limit(1)
  if (nuevos && nuevos.length) programarTurno(chat.id, 2000)
}

const NO_REGISTRADO = 'Hola, le saluda Urbis Group - Cobranzas. No encontramos este número registrado como titular de un lote. Por seguridad no podemos compartir información por aquí; en breve una asesora le escribirá para ayudarle.'

const timers = new Map()
const enCurso = new Set()
// Espera unos segundos antes de contestar: la gente manda la foto y despues el
// texto, o tres mensajes seguidos. Se responde a todo junto.
function programarTurno(chatId, ms = 7000) {
  clearTimeout(timers.get(chatId))
  timers.set(chatId, setTimeout(() => { timers.delete(chatId); turno(chatId).catch(e => log('turno:', String(e.message || e))) }, ms))
}
async function turno(chatId) {
  if (enCurso.has(chatId)) { programarTurno(chatId, 4000); return }
  enCurso.add(chatId)
  try {
    const { data: fila } = await supabase.from('cobranza_chats').select('*').eq('id', chatId).maybeSingle()
    if (!fila || fila.modo !== 'agente') return
    const cfg = await config()
    if (!fila.es_prueba && !cfg.agente_activo) return
    const chat = { ...fila, clientes: await clientesDelTelefono(fila.phone) }
    chat.client_ids = chat.clientes.map(c => c.id)

    if (!chat.client_ids.length) {
      // sin IA y sin datos: respuesta fija una vez y a la secretaria
      const desde = new Date(Date.now() - 24 * 3600e3).toISOString()
      const { data: ya } = await supabase.from('cobranza_mensajes').select('id').eq('chat_id', chat.id).eq('autor', 'sistema').gte('created_at', desde).limit(1)
      if (!ya || !ya.length) await enviarAlCliente(chat, NO_REGISTRADO, 'sistema')
      await pasarAHumano(chat, 'número no registrado como titular (o celular sin validar en su ficha)')
      return
    }
    if (!ia) { await pasarAHumano(chat, 'el agente no tiene clave de IA configurada'); return }
    try {
      await responder(chat, cfg)
    } catch (e) {
      log('IA falló para', chat.phone, String(e.message || e).slice(0, 200))
      await supabase.from('cobranza_mensajes').insert({ chat_id: chat.id, direccion: 'out', autor: 'sistema', texto: null, estado: 'fallido', error: 'El agente no pudo responder: ' + String(e.message || e).slice(0, 250) })
      await pasarAHumano(chat, 'error del agente: ' + String(e.message || e).slice(0, 120))
    }
  } finally { enCurso.delete(chatId) }
}

// ============================================================================
// WEBHOOK: entrantes, ecos del celular y estados de entrega
// ============================================================================
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'audio/ogg': 'ogg', 'video/mp4': 'mp4' }
async function guardarMedia(mediaId, mime, nombre) {
  const { buffer, mime: real } = await WA.bajarMedia(mediaId)
  if (buffer.length > 16 * 1024 * 1024) throw new Error('adjunto de más de 16 MB')
  const tipo = mime || real
  const ext = EXT[String(tipo).split(';')[0]] || (String(nombre || '').split('.').pop() || 'bin').toLowerCase().slice(0, 5)
  const huella = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32)
  const url = await subirAR2('cobranza/entrantes/' + huella + '.' + ext, buffer, tipo, log)
  if (!url) throw new Error('R2 no respondió')
  return url
}

async function entrante(m, v) {
  const phone = dig(m.from)
  if (!phone || m.type === 'reaction') return
  if (m.id) {
    const { data: dup } = await supabase.from('cobranza_mensajes').select('id').eq('wa_id', m.id).limit(1)
    if (dup && dup.length) return   // Meta reintenta los webhooks
  }
  const nombre = (v.contacts || []).find(c => dig(c.wa_id) === phone)?.profile?.name || null
  const chat = await chatDe(phone, false, nombre)
  let texto = m.text?.body || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || ''
  const mm = m.image || m.document || m.video || m.audio || m.sticker
  let media = null
  if (mm) {
    media = { tipo: m.image ? 'image' : m.document ? 'document' : m.video ? 'video' : m.audio ? 'audio' : 'sticker', name: m.document?.filename || null }
    if (!texto) texto = mm.caption || ''
    try { media.url = await guardarMedia(mm.id, mm.mime_type, media.name) }
    catch (e) { log('adjunto de', phone, ':', String(e.message || e)); if (!texto) texto = '[adjunto recibido — no se pudo guardar]' }
  }
  if (!texto && !media) texto = '[' + (m.type || 'mensaje') + ' no soportado]'
  const ahora = new Date().toISOString()
  const { error } = await supabase.from('cobranza_mensajes').insert({
    chat_id: chat.id, direccion: 'in', autor: 'cliente', texto: texto || null, estado: 'recibido', wa_id: m.id || null,
    media_url: media?.url || null, media_type: media?.url ? media.tipo : null, media_name: media?.name || null,
  })
  if (error) { if (!/duplicate/i.test(error.message)) log('mensaje in:', error.message); return }
  await supabase.from('cobranza_chats').update({ ultimo_entrante_at: ahora, ultimo_mensaje_at: ahora, no_leidos: (chat.no_leidos || 0) + 1 }).eq('id', chat.id)
  log('ENTRA de +' + phone, (texto || '[' + (media?.tipo || 'adjunto') + ']').replace(/\s+/g, ' ').slice(0, 70))
  programarTurno(chat.id)
}

// Lo que la secretaria escribio desde la app WhatsApp Business (coexistencia):
// queda en el chat y el agente se calla ahi, igual que si respondiera en el panel.
async function eco(e) {
  const phone = dig(e.to)
  if (!phone) return
  if (e.id) {
    const { data: dup } = await supabase.from('cobranza_mensajes').select('id').eq('wa_id', e.id).limit(1)
    if (dup && dup.length) return
  }
  const chat = await chatDe(phone, false)
  const texto = e.text?.body || e.image?.caption || e.document?.caption || '[' + (e.type || 'mensaje') + ' enviado desde el celular]'
  await supabase.from('cobranza_mensajes').insert({ chat_id: chat.id, direccion: 'out', autor: 'celular', texto, estado: 'enviado', wa_id: e.id || null })
  await supabase.from('cobranza_chats').update({ ultimo_mensaje_at: new Date().toISOString() }).eq('id', chat.id)
  await pasarAHumano(chat, 'la secretaria respondió desde el celular')
}

const RANGO = { enviado: 1, entregado: 2, leido: 3, fallido: 9 }
async function estadoEntrega(s) {
  const est = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallido' }[s.status]
  if (!est || !s.id) return
  const error = s.status === 'failed' ? String((s.errors && s.errors[0] && (s.errors[0].title || s.errors[0].message)) || 'fallo de entrega').slice(0, 300) : null
  for (const tabla of ['cobranza_mensajes', 'cobranza_envios']) {
    const { data } = await supabase.from(tabla).select('id, estado').eq('wa_id', s.id).limit(1)
    const fila = data && data[0]
    if (!fila || (RANGO[fila.estado] || 0) >= RANGO[est]) continue   // 'leido' no vuelve a 'entregado'
    await supabase.from(tabla).update({ estado: est, ...(error ? { error } : {}) }).eq('id', fila.id)
  }
}

// ============================================================================
// COLAS DEL PANEL: mensajes de la secretaria y pruebas
// ============================================================================
async function salientesPanel() {
  const { data } = await supabase.from('cobranza_mensajes').select('id, chat_id, texto, autor')
    .eq('estado', 'pendiente').eq('direccion', 'out').order('created_at').limit(10)
  for (const m of (data || [])) {
    const { data: chat } = await supabase.from('cobranza_chats').select('*').eq('id', m.chat_id).maybeSingle()
    if (!chat) continue
    let upd
    if (chat.es_prueba) upd = { estado: 'prueba' }
    else if (!WA_LISTO) upd = { estado: 'fallido', error: 'Falta el token de WhatsApp en el servidor' }
    else if (!ventanaAbierta(chat)) upd = { estado: 'fallido', error: 'Pasaron más de 24 h desde el último mensaje del cliente: Meta solo deja escribirle con plantilla' }
    else {
      try { const r = await WA.enviarTexto(chat.phone, m.texto || ''); upd = { estado: 'enviado', wa_id: r.messages?.[0]?.id || null } }
      catch (e) { upd = { estado: 'fallido', error: String(e.message || e).slice(0, 300) } }
    }
    await supabase.from('cobranza_mensajes').update(upd).eq('id', m.id)
    await supabase.from('cobranza_chats').update({ ultimo_mensaje_at: new Date().toISOString() }).eq('id', chat.id)
    // la secretaria tomo la palabra: el agente se calla. La confirmacion de un pago
    // validado sale como 'sistema' y NO calla al agente.
    if (m.autor === 'secretaria' && chat.modo !== 'humano')
      await supabase.from('cobranza_chats').update({ modo: 'humano', motivo_humano: 'respondió la secretaria desde el panel', humano_desde: new Date().toISOString() }).eq('id', chat.id)
  }
}

async function pruebas() {
  const { data } = await supabase.from('cobranza_pruebas').select('*').eq('estado', 'pendiente').order('created_at').limit(5)
  for (const t of (data || [])) {
    try {
      const chat = await chatDe(t.phone, true)
      const cmd = String(t.texto || '').trim()
      if (cmd === '/reiniciar') {
        await supabase.from('cobranza_pagos_reportados').delete().eq('chat_id', chat.id).eq('es_prueba', true)
        await supabase.from('cobranza_promesas').delete().eq('chat_id', chat.id).eq('es_prueba', true)
        await supabase.from('cobranza_mensajes').delete().eq('chat_id', chat.id)
        await supabase.from('cobranza_chats').update({ modo: 'agente', motivo_humano: null, humano_desde: null, no_leidos: 0 }).eq('id', chat.id)
      } else if (cmd === '/aviso') {
        await supabase.from('cobranza_mensajes').insert({ chat_id: chat.id, direccion: 'out', autor: 'plantilla', texto: await vistaPreviaAviso(chat), estado: 'prueba' })
      } else {
        const ahora = new Date().toISOString()
        await supabase.from('cobranza_mensajes').insert({ chat_id: chat.id, direccion: 'in', autor: 'cliente', texto: t.texto || null, media_url: t.media_url || null, media_type: t.media_type || null, estado: 'recibido' })
        await supabase.from('cobranza_chats').update({ ultimo_entrante_at: ahora, ultimo_mensaje_at: ahora }).eq('id', chat.id)
        await turno(chat.id)
      }
      await supabase.from('cobranza_pruebas').update({ estado: 'procesado', procesado_at: new Date().toISOString() }).eq('id', t.id)
    } catch (e) {
      log('[PRUEBA] error:', String(e.message || e))
      await supabase.from('cobranza_pruebas').update({ estado: 'error', error: String(e.message || e).slice(0, 300) }).eq('id', t.id)
    }
  }
}

// ============================================================================
// AVISOS PROGRAMADOS (plantillas de Meta)
// ============================================================================
// Decide si HOY le toca un aviso a esta venta, con la configuracion del panel.
function decidirAviso(v, cfg, hoy) {
  const pend = cuotasPendientes(v, hoy)
  if (!pend.length) return null
  const nombre = nombrePila(v.client?.full_name)
  const lote = loteDe(v)
  const proyecto = v.lot.project?.name || ''
  const vencidas = pend.filter(q => q.vencida)
  if (!vencidas.length) {
    const q = pend[0]
    const d = diasEntre(q.due_date, hoy)
    if (!(cfg.dias_antes || []).map(Number).includes(d)) return null
    if (d === 0) return { motivo: 'vence_hoy', plantilla: cfg.plantilla_vence_hoy, q, params: [nombre, q.installment_number, lote, proyecto, monto2(q.pendiente)] }
    return { motivo: 'antes_' + d, plantilla: cfg.plantilla_recordatorio, q, params: [nombre, q.installment_number, lote, proyecto, fechaCorta(q.due_date), monto2(q.pendiente)] }
  }
  const q = vencidas[0]
  const dd = diasEntre(hoy, q.due_date)
  const lista = (cfg.dias_despues || []).map(Number)
  let motivo = null
  if (lista.includes(dd)) motivo = 'vencida_' + dd
  else {
    const base = Math.max(0, ...lista)
    const cada = Math.max(1, Number(cfg.repetir_cada || 7))
    if (dd > base && (dd - base) % cada === 0) motivo = 'repite_' + dd
  }
  if (!motivo) return null
  // escalon (sql/90): quien ACUMULA cuotas vencidas recibe el otro aviso, no los dos
  if (cfg.plantilla_vencida_grave && vencidas.length >= Number(cfg.grave_desde_cuotas || 4)) {
    const total = vencidas.reduce((s, x) => s + x.pendiente, 0)
    return { motivo: 'grave_' + dd, plantilla: cfg.plantilla_vencida_grave, q, params: [nombre, vencidas.length, lote, proyecto, monto2(total)] }
  }
  return { motivo, plantilla: cfg.plantilla_vencida, q, params: [nombre, q.installment_number, lote, proyecto, fechaCorta(q.due_date), monto2(q.pendiente)] }
}

async function vistaPreviaAviso(chat) {
  const cfg = await config()
  const hoy = hoyLima()
  const ventas = (await ventasDe(chat.client_ids)).filter(v => v.status === 'en_proceso')
  if (!ventas.length) return 'Este cliente no tiene lotes con cuotas pendientes: no le toca ningún aviso.'
  const lineas = []
  for (const v of ventas) {
    const cli = (chat.clientes || []).find(c => c.id === v.client_id)
    const d = decidirAviso({ ...v, client: cli }, cfg, hoy)
    lineas.push(loteDe(v) + ': ' + (d
      ? `hoy le toca "${d.motivo}" con la plantilla ${d.plantilla || '(SIN NOMBRE — configurar)'} → ${d.params.join(' · ')}`
      : 'hoy no le toca aviso con la configuración actual'))
  }
  return '📨 VISTA PREVIA DE AVISOS (no se envía)\n' + lineas.join('\n')
}

async function registrarEnvio(tel, d, extra, cfg) {
  const fila = { phone: tel, motivo: d.motivo, plantilla: d.plantilla, parametros: d.params, estado: 'enviado', ...extra }
  try {
    const r = await WA.enviarPlantilla(tel, d.plantilla, d.params.map(String), cfg.plantilla_idioma || 'es')
    fila.wa_id = r.messages?.[0]?.id || null
  } catch (e) { fila.estado = 'fallido'; fila.error = String(e.message || e).slice(0, 300) }
  await supabase.from('cobranza_envios').insert(fila)
  const chat = await chatDe(tel, false)
  await supabase.from('cobranza_mensajes').insert({ chat_id: chat.id, direccion: 'out', autor: 'plantilla', texto: `Aviso "${d.plantilla}" (${d.motivo}): ${d.params.join(' · ')}`, estado: fila.estado, error: fila.error || null, wa_id: fila.wa_id || null })
  await supabase.from('cobranza_chats').update({ ultimo_mensaje_at: new Date().toISOString() }).eq('id', chat.id)
  return fila.estado === 'enviado'
}

async function todasLasVentas() {
  const cols = 'id, client_id, status, auto_cobranza, client:clients!sales_client_id_fkey(id, full_name, phone, phone_valid, phone_bot, phone2, phone2_valid, phone2_bot), lot:lots!inner(mz, lt, project:projects(id, name)), installments(id, installment_number, amount, amount_paid, due_date, status)'
  const out = []
  for (let desde = 0; ; desde += 500) {   // paginado: Supabase corta en silencio a las 1000 filas
    const { data, error } = await supabase.from('sales').select(cols).eq('status', 'en_proceso').eq('auto_cobranza', true).order('id').range(desde, desde + 499)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 500) break
  }
  return out
}

let barriendo = false
async function barridoAvisos() {
  if (barriendo) return
  const cfg = await config()
  const hoy = hoyLima()
  if (!cfg.avisos_activos || cfg.ultimo_barrido === hoy) return
  if (horaLima() < String(cfg.hora_avisos || '09:00').slice(0, 5)) return
  if (!WA_LISTO) { log('AVISOS: falta WA_TOKEN, no se envía nada'); return }
  barriendo = true
  try {
    log('=== AVISOS DE COBRANZA', hoy, '===')
    try { await supabase.rpc('mark_overdue_installments') } catch (e) { log('mark_overdue:', e.message) }
    const { count: yaHoy } = await supabase.from('cobranza_envios').select('id', { count: 'exact', head: true }).gte('created_at', inicioDiaLima(hoy))
    let cupo = Number(cfg.tope_diario ?? 200) - (yaHoy || 0)
    const [ventas, prom, rep] = await Promise.all([
      todasLasVentas(),
      supabase.from('cobranza_promesas').select('sale_id').eq('estado', 'vigente').eq('es_prueba', false),
      supabase.from('cobranza_pagos_reportados').select('sale_id').eq('estado', 'pendiente').eq('es_prueba', false),
    ])
    // quien prometio una fecha o ya mando su voucher no recibe el aviso generico
    const conPromesa = new Set((prom.data || []).map(p => p.sale_id))
    const enRevision = new Set((rep.data || []).map(p => p.sale_id))
    let enviados = 0, sinPlantilla = 0, topeAlcanzado = false
    for (const v of ventas) {
      const tels = telefonosBot(v.client)
      if (!tels.length || conPromesa.has(v.id) || enRevision.has(v.id)) continue
      const d = decidirAviso(v, cfg, hoy)
      if (!d) continue
      if (!d.plantilla) { sinPlantilla++; continue }
      const { data: ya } = await supabase.from('cobranza_envios').select('id').eq('installment_id', d.q.id).eq('motivo', d.motivo).limit(1)
      if (ya && ya.length) continue
      for (const tel of tels) {
        if (cupo <= 0) { topeAlcanzado = true; break }
        if (await registrarEnvio(tel, d, { client_id: v.client_id, sale_id: v.id, installment_id: d.q.id }, cfg)) enviados++
        cupo--
        await espera(1200)
      }
      if (topeAlcanzado) break
    }

    // promesas: recordatorio N dias antes de la fecha prometida
    const { data: proms } = await supabase.from('cobranza_promesas')
      .select('id, client_id, sale_id, fecha_promesa, monto, avisar_dias_antes, client:clients(id, full_name, phone, phone_valid, phone_bot, phone2, phone2_valid, phone2_bot), sale:sales(id, lot:lots(mz, lt, project:projects(name)), installments(id, amount, amount_paid, status, installment_number, due_date))')
      .eq('estado', 'vigente').eq('es_prueba', false).is('aviso_enviado_at', null)
    for (const p of (proms || [])) {
      if (topeAlcanzado || !cfg.plantilla_promesa || !p.sale) continue
      const dias = p.avisar_dias_antes ?? cfg.promesa_avisar_dias ?? 1
      if (!(hoy >= sumarDias(p.fecha_promesa, -dias) && hoy <= p.fecha_promesa)) continue
      const pend = cuotasPendientes(p.sale, hoy)
      const monto = p.monto || (pend[0] ? pend[0].pendiente : 0)
      const d = { motivo: 'promesa', plantilla: cfg.plantilla_promesa, params: [nombrePila(p.client?.full_name), fechaCorta(p.fecha_promesa), monto2(monto), loteDe(p.sale), p.sale.lot?.project?.name || ''] }
      let ok = false
      for (const tel of telefonosBot(p.client)) {
        if (cupo <= 0) { topeAlcanzado = true; break }
        ok = (await registrarEnvio(tel, d, { client_id: p.client_id, sale_id: p.sale_id, promesa_id: p.id }, cfg)) || ok
        cupo--
        await espera(1200)
      }
      if (ok) await supabase.from('cobranza_promesas').update({ aviso_enviado_at: new Date().toISOString() }).eq('id', p.id)
    }

    // promesas vencidas: ¿pago algo desde que prometio?
    const { data: vencidas } = await supabase.from('cobranza_promesas')
      .select('id, sale_id, monto, created_at, fecha_promesa, client:clients(full_name)')
      .eq('estado', 'vigente').eq('es_prueba', false).lt('fecha_promesa', hoy)
    const incumplidas = []
    for (const p of (vencidas || [])) {
      const { data: pagos } = p.sale_id
        ? await supabase.from('daily_income').select('amount').eq('sale_id', p.sale_id).gte('created_at', p.created_at)
        : { data: [] }
      const pagado = (pagos || []).reduce((s, x) => s + Number(x.amount), 0)
      const cumplida = pagado > 0 && (!p.monto || pagado + 0.01 >= Number(p.monto))
      await supabase.from('cobranza_promesas').update({ estado: cumplida ? 'cumplida' : 'incumplida', cerrado_at: new Date().toISOString() }).eq('id', p.id)
      if (!cumplida) incumplidas.push('• ' + (p.client?.full_name || '?') + ' — prometió ' + fechaCorta(p.fecha_promesa))
    }

    await supabase.from('cobranza_config').update({ ultimo_barrido: hoy }).eq('id', 1)
    log('AVISOS:', enviados, 'enviados', sinPlantilla ? '· ' + sinPlantilla + ' sin plantilla configurada' : '', topeAlcanzado ? '· TOPE DIARIO ALCANZADO' : '')
    const partes = []
    if (topeAlcanzado) partes.push('🛑 Se llegó al tope diario de ' + cfg.tope_diario + ' avisos: el resto sale mañana.')
    if (sinPlantilla) partes.push('⚠ ' + sinPlantilla + ' aviso(s) no salieron porque falta el nombre de la plantilla en la configuración.')
    if (incumplidas.length) partes.push('📅 Promesas incumplidas:\n' + incumplidas.join('\n'))
    if (partes.length) await avisarResponsables('*COBRANZA — resumen de avisos ' + fechaCorta(hoy) + '*\nEnviados: ' + enviados + '\n\n' + partes.join('\n\n'))
  } catch (e) { log('barridoAvisos:', String(e.message || e)) }
  finally { barriendo = false }
}

// ============================================================================
// ARRANQUE
// ============================================================================
async function latido() {
  await supabase.from('cobranza_config').update({
    latido: new Date().toISOString(),
    latido_info: { whatsapp: WA_LISTO, ia: !!ia, clave_ia_propia: CLAVE_PROPIA, telegram: TG.activo(), puerto: PUERTO },
  }).eq('id', 1).then(() => {}, () => {})
}

function cadaTanto(fn, ms, nombre) {
  let ocupado = false
  setInterval(async () => {
    if (ocupado) return
    ocupado = true
    try { await fn() } catch (e) { log(nombre + ':', String(e.message || e)) } finally { ocupado = false }
  }, ms)
}

if (TG.setLog) TG.setLog(log)
WA.servidorWebhook({
  puerto: PUERTO,
  alRecibir: (m, v) => entrante(m, v).catch(e => log('entrante:', String(e.message || e))),
  alEstado: s => estadoEntrega(s).catch(() => {}),
  alEco: x => eco(x).catch(e => log('eco:', String(e.message || e))),
})
cadaTanto(salientesPanel, 5000, 'salientes')
cadaTanto(pruebas, 3000, 'pruebas')
cadaTanto(barridoAvisos, 5 * 60000, 'avisos')
cadaTanto(latido, 60000, 'latido')
latido()
config().then(c => log('AGENTE DE COBRANZA corriendo · webhook :' + PUERTO
  + ' · WhatsApp ' + (WA_LISTO ? 'listo' : 'SIN TOKEN (solo pruebas)')
  + ' · IA ' + (ia ? (CLAVE_PROPIA ? 'clave propia' : 'clave GENERAL (crear COBRANZA_ANTHROPIC_API_KEY)') : 'SIN CLAVE')
  + ' · agente ' + (c.agente_activo ? 'ON' : 'off') + ' · avisos ' + (c.avisos_activos ? 'ON' : 'off')))
