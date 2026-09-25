// Registrar plata: separacion, inicial (crea la venta y su cronograma), cuota y
// cuadre. Antes vivia dentro de la pantalla de Cuotas; desde la fase 2 (24 sep
// 2026) se cobra desde la ficha del lote y esto es lo unico que escribe.
//
// Ninguna de estas operaciones es atomica (son varias escrituras seguidas, como
// siempre fue). El orden esta pensado para que, si algo falla a mitad, lo que
// quede escrito se entienda y se pueda terminar a mano: primero el registro
// principal, despues la plata, al final el estado del lote.
import { supabase } from './supabase'
import { upload, subirRuta } from './archivos'
import { repartirCuotas } from './cronograma'

const r2 = n => Math.round(Number(n) * 100) / 100
export const digitos = s => String(s || '').replace(/\D/g, '')
export const celularValido = v => { const t = digitos(v); return t.length >= 9 && !t.includes('999999999') }
export const hoyPe = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)
export function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
// 30 de octubre + 4 meses = 28 de febrero (no 2 de marzo), y el mes siguiente
// vuelve al 30: cada fecha se cuenta desde la primera, no desde la anterior.
export function sumarMeses(fecha, n) {
  const d = new Date(fecha + 'T12:00:00')
  const dia = d.getDate()
  d.setMonth(d.getMonth() + n)
  if (d.getDate() < dia) d.setDate(0)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------- personas --

export const esPendiente = c => !c?.doc_number || c.doc_type === 'PEND' || String(c.doc_number).toUpperCase().startsWith('PEND')
export const tieneFotoDni = c => !!(c?.dni_url || (c?.dni_front_url && c?.dni_back_url))

// Lo que falta para que la persona pueda firmar el contrato (decision del 24
// sep: la inicial exige todo esto; la separacion solo nombre y celular).
export function faltanParaContrato(p, archivoDni) {
  const f = []
  if (!String(p?.full_name || '').trim()) f.push('nombre completo')
  const doc = String(p?.doc_number || '').trim()
  if (!doc || esPendiente(p)) f.push('N° de documento')
  else if ((p.doc_type || 'DNI') === 'DNI' && !/^\d{8}$/.test(doc)) f.push('DNI de 8 dígitos')
  if (!archivoDni && !tieneFotoDni(p)) f.push('foto del DNI')
  if (!celularValido(p?.phone)) f.push('celular válido')
  if (!String(p?.address || '').trim()) f.push('dirección')
  if (!String(p?.district || '').trim()) f.push('distrito')
  if (!String(p?.province || '').trim()) f.push('provincia')
  if (!String(p?.department || '').trim()) f.push('departamento')
  if (!String(p?.civil_status || '').trim()) f.push('estado civil')
  return f
}

// Clientes y lead con ese celular (se compara por los ultimos 9 digitos, igual
// que el bot). El lead se prefiere del mismo proyecto.
export async function buscarPorCelular(celular, pid) {
  const p9 = digitos(celular).slice(-9)
  if (p9.length < 9) return { clientes: [], lead: null }
  const [c, l] = await Promise.all([
    supabase.from('clients').select('id, full_name, doc_type, doc_number, phone, phone2')
      .or(`phone.ilike.*${p9}*,phone2.ilike.*${p9}*`).limit(5),
    supabase.from('leads').select('id, full_name, phone, status, project_id, client_id')
      .ilike('phone', `%${p9}%`).order('created_at', { ascending: false }).limit(5),
  ])
  const leads = l.data || []
  return { clientes: c.data || [], lead: leads.find(x => x.project_id === pid) || leads[0] || null }
}

export async function buscarPorDocumento(docType, docNumber) {
  const doc = String(docNumber || '').trim().toUpperCase()
  if (!doc) return null
  const { data } = await supabase.from('clients').select('*').eq('doc_type', docType || 'DNI').eq('doc_number', doc).maybeSingle()
  return data || null
}

// La persona de una separacion: solo nombre y celular. Queda "pendiente de DNI"
// (doc_type PEND) hasta la inicial, donde se completa con los datos del contrato.
export async function crearPendiente({ nombre, celular }) {
  const { data, error } = await supabase.from('clients').insert({
    doc_type: 'PEND', doc_number: 'PEND-' + Date.now().toString(36).toUpperCase(),
    full_name: String(nombre).trim().toUpperCase(),
    phone: digitos(celular), phone_valid: celularValido(celular), phone_bot: true,
  }).select('id, full_name, doc_type, doc_number, phone').single()
  if (error) throw new Error('No se pudo registrar a la persona: ' + error.message)
  return data
}

const CAMPOS_PERSONA = ['full_name', 'address', 'district', 'province', 'department', 'civil_status', 'nationality']

// Guarda los datos del contrato de una persona. Si ese documento ya lo tiene OTRA
// ficha, se usa esa (es la misma persona registrada dos veces) y se le completan
// los datos. Devuelve la ficha final: { cliente, fusionadoDesde }.
export async function guardarPersona(p, archivoDni) {
  const docType = p.doc_type && p.doc_type !== 'PEND' ? p.doc_type : 'DNI'
  const doc = String(p.doc_number || '').trim().toUpperCase()
  const payload = {}
  for (const k of CAMPOS_PERSONA) if (String(p[k] || '').trim()) payload[k] = String(p[k]).trim().toUpperCase()
  if (p.phone) Object.assign(payload, { phone: digitos(p.phone), phone_valid: celularValido(p.phone) })
  if (p.phone2) Object.assign(payload, { phone2: digitos(p.phone2), phone2_valid: celularValido(p.phone2) })
  payload.doc_type = docType
  payload.doc_number = doc
  if (archivoDni) {
    const ext = (archivoDni.name.split('.').pop() || 'jpg').toLowerCase()
    payload.dni_url = await subirRuta(`dni/${doc}-completo-${Date.now()}.${ext}`, archivoDni)
  }
  const otra = await buscarPorDocumento(docType, doc)
  if (otra && otra.id !== p.id) {
    const { data, error } = await supabase.from('clients').update(payload).eq('id', otra.id).select('*').single()
    if (error) throw new Error('No se pudo actualizar a ' + otra.full_name + ': ' + error.message)
    return { cliente: data, fusionadoDesde: p.id || null }
  }
  const q = p.id
    ? supabase.from('clients').update(payload).eq('id', p.id).select('*').single()
    : supabase.from('clients').insert(payload).select('*').single()
  const { data, error } = await q
  if (error) throw new Error('No se pudo guardar a la persona: ' + error.message)
  return { cliente: data, fusionadoDesde: null }
}

// Cuando la ficha "pendiente" de la separacion resulto ser alguien que ya estaba
// registrado: todo lo suyo pasa a la ficha buena y la pendiente se borra si ya
// no la usa nada (si algo la sigue usando, se deja).
async function juntarFichas(desdeId, haciaId) {
  if (!desdeId || desdeId === haciaId) return
  await supabase.from('separations').update({ client_id: haciaId }).eq('client_id', desdeId)
  await supabase.from('daily_income').update({ client_id: haciaId }).eq('client_id', desdeId)
  await supabase.from('leads').update({ client_id: haciaId }).eq('client_id', desdeId).then(() => {}, () => {})
  const [{ count: v }, { count: s }] = await Promise.all([
    supabase.from('sales').select('id', { count: 'exact', head: true }).or(`client_id.eq.${desdeId},co_client_id.eq.${desdeId}`),
    supabase.from('separations').select('id', { count: 'exact', head: true }).eq('client_id', desdeId),
  ])
  if (!v && !s) await supabase.from('clients').delete().eq('id', desdeId).eq('doc_type', 'PEND').then(() => {}, () => {})
}

// El lead que trajo a la persona avanza en el embudo (Campañas lo cuenta):
// separar = negociacion, inicial = ganado. Nunca se retrocede un estado.
const ORDEN_LEAD = ['nuevo', 'contactado', 'interesado', 'visita_agendada', 'negociacion', 'ganado']
export async function avanzarLead({ leadId, clienteId, telefonos = [], pid, estado }) {
  let ids = leadId ? [leadId] : []
  if (!ids.length) {
    for (const t of telefonos.filter(Boolean)) {
      const { lead } = await buscarPorCelular(t, pid)
      if (lead) { ids = [lead.id]; break }
    }
  }
  if (!ids.length) return null
  const { data: l } = await supabase.from('leads').select('id, status').eq('id', ids[0]).maybeSingle()
  if (!l) return null
  const patch = { client_id: clienteId }
  if (ORDEN_LEAD.indexOf(estado) > ORDEN_LEAD.indexOf(l.status) && l.status !== 'perdido') patch.status = estado
  if (l.status === 'perdido') patch.status = estado   // volvio y compro: deja de estar perdido
  await supabase.from('leads').update(patch).eq('id', l.id).then(() => {}, () => {})
  return l.id
}

// -------------------------------------------------------------------- pago --

// El voucher se sube con el N° de operacion en la ruta (como siempre).
async function filaPago({ pidOp, loteId, clienteId, pago, profile }) {
  const op = (String(pago.nroOp || '').trim() || 'SIN-REF').toUpperCase()
  const voucherUrl = pago.file ? await upload(`vouchers/${op.replace(/[^A-Z0-9-]/g, '')}`, pago.file) : null
  return {
    project_id: pidOp, lot_id: loteId, client_id: clienteId, date: pago.fecha,
    operation_number: op, operation_type: pago.opTipo,
    financial_account_id: pago.cuentaId || null, observation: String(pago.obs || '').toUpperCase(), origin: 'sistema',
    voucher_url: voucherUrl, voucher_note: String(pago.nota || '').trim() || null,
    registered_by: profile?.id, approved: true, approved_at: new Date().toISOString(),
  }
}

export function validarPago(pago, { voucherObligatorio = true } = {}) {
  if (voucherObligatorio && !pago.file) return 'OBLIGATORIO: adjunta la foto del voucher del cliente.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pago.fecha || '')) return 'Revisa la fecha del pago.'
  if (!(Number(pago.monto) > 0)) return 'El monto debe ser mayor a cero.'
  if (!pago.cuentaId) return 'Elige el banco o cuenta donde entró la plata.'
  return null
}

// Como se reparte un pago entre las cuotas pendientes, de la mas antigua a la
// mas nueva (la "cascada").
export function planCascada(pendientes, monto) {
  let rest = r2(monto || 0)
  const parts = []
  for (const q of pendientes) {
    if (rest <= 0.004) break
    const deuda = r2(Number(q.amount) - Number(q.amount_paid))
    if (deuda <= 0.004) continue
    const take = Math.min(rest, deuda)
    parts.push({ q, take: r2(take), resto: r2(deuda - take) })
    rest = r2(rest - take)
  }
  return { parts, sobra: rest }
}

// --------------------------------------------------------------- separacion --

export async function registrarSeparacion({ pidOp, lote, clienteId, pago, vence, advisorId, recordarA = [], secs = [], profile, leadId }) {
  const { data: sep, error: e1 } = await supabase.from('separations').insert({
    lot_id: lote.id, client_id: clienteId, amount: Number(pago.monto),
    date: pago.fecha, expiration_date: vence, status: 'vigente', advisor_id: advisorId || null, created_by: profile?.id || null,
  }).select().single()
  if (e1) throw new Error('No se pudo crear la separación: ' + e1.message)
  const base = await filaPago({ pidOp, loteId: lote.id, clienteId, pago, profile })
  const { error: e2 } = await supabase.from('daily_income').insert({ ...base, amount: Number(pago.monto), income_type: 'separacion', separation_id: sep.id })
  if (e2) throw new Error('La separación se creó pero el pago NO se registró: ' + e2.message)
  const { error: e3 } = await supabase.from('lots').update({ status: 'separado' }).eq('id', lote.id)
  if (e3) throw new Error('Separación y pago registrados, pero el lote no cambió a SEPARADO: ' + e3.message)
  await avanzarLead({ leadId, clienteId, pid: pidOp, estado: 'negociacion' })
  // recordatorio del vencimiento en el control de actividades (quien registra + las elegidas)
  const destinos = new Set(recordarA)
  const propia = secs.find(s => s.user_id === profile?.id)
  if (propia) destinos.add(propia.id)
  if (destinos.size) {
    const { data: cli } = await supabase.from('clients').select('full_name').eq('id', clienteId).maybeSingle()
    const titulo = ('VENCE SEPARACION MZ ' + lote.mz + ' LT ' + lote.lt + ' — ' + (cli?.full_name || 'CLIENTE') + ' (S/ ' + Number(pago.monto).toFixed(2) + ')').slice(0, 200)
    const filas = [...destinos].map(sid => ({ secretary_id: sid, title: titulo, date: vence, slot: 'manana', category: 'administrativa', separation_id: sep.id }))
    const { error: e4 } = await supabase.from('secretary_tasks').insert(filas)
    if (e4) await supabase.from('secretary_tasks').insert(filas.map(({ separation_id, ...x }) => x))
  }
  return sep
}

// ------------------------------------------------------------------ inicial --
// Crea la venta, su cronograma (cuotas redondeadas, lib/cronograma), el pago de
// la inicial y la comision. Con separacion: la completa, y su pago queda ligado
// a la venta (asi sale en el estado de cuenta).

export async function registrarInicial({
  pidOp, lote, sep, clienteId, clientePendienteId, coClienteId, pago, precio, meses, primeraCuota,
  advisorId, comision, comUrbis, profile, leadId, telefonos = [],
}) {
  const precioN = r2(precio), inicial = r2(pago.monto), sepMonto = sep ? r2(sep.amount) : 0
  const financiado = r2(precioN - inicial - sepMonto)
  const montos = repartirCuotas(financiado, meses)
  if (!montos.length) throw new Error('No queda saldo por financiar: revisa el precio, la inicial y la separación.')
  // si la ficha de la separacion era otra (pendiente) y resulto ser alguien ya registrado
  if (clientePendienteId && clientePendienteId !== clienteId) await juntarFichas(clientePendienteId, clienteId)

  const { data: sale, error: e1 } = await supabase.from('sales').insert({
    lot_id: lote.id, client_id: clienteId, co_client_id: coClienteId || null, separation_id: sep?.id || null,
    advisor_id: advisorId || sep?.advisor_id || null,
    total_sale_price: precioN, initial_amount_paid: inicial,
    financed_amount: financiado, installments_count: montos.length,
    monthly_amount: montos[0], sale_date: pago.fecha, status: 'en_proceso',
  }).select().single()
  if (e1) throw new Error('No se pudo crear la venta: ' + e1.message)
  const filas = montos.map((amt, i) => ({ sale_id: sale.id, installment_number: i + 1, due_date: sumarMeses(primeraCuota, i), amount: amt }))
  const { error: e2 } = await supabase.from('installments').insert(filas)
  if (e2) throw new Error('La venta se creó pero el cronograma NO: ' + e2.message + ' — genéralo desde la ficha (pestaña Cuotas).')
  const base = await filaPago({ pidOp, loteId: lote.id, clienteId, pago, profile })
  const { error: e3 } = await supabase.from('daily_income').insert({ ...base, amount: inicial, income_type: 'inicial', sale_id: sale.id })
  if (e3) throw new Error('Venta y cronograma creados, pero el pago de la inicial NO se registró: ' + e3.message)
  await supabase.from('lots').update({ status: 'vendido' }).eq('id', lote.id)
  if (sep) {
    await supabase.from('separations').update({ status: 'completada' }).eq('id', sep.id)
    await supabase.from('daily_income').update({ sale_id: sale.id }).eq('separation_id', sep.id).is('sale_id', null)
    await supabase.from('secretary_tasks').delete().eq('separation_id', sep.id).eq('status', 'pendiente').then(() => {}, () => {})
  }
  const avisos = []
  const advFinal = advisorId || sep?.advisor_id || null
  if (advFinal || Number(comUrbis || 0) > 0) {
    const fila = { sale_id: sale.id, advisor_id: advFinal, amount: Number(comision || 0), urbis_amount: Number(comUrbis || 0), status: 'pendiente' }
    let r4 = await supabase.from('commissions').insert(fila)
    if (r4.error && /urbis_amount/i.test(r4.error.message)) {
      const { urbis_amount, ...f2 } = fila
      r4 = await supabase.from('commissions').insert(f2)
    }
    if (r4.error) avisos.push('La comisión no se registró: ' + r4.error.message)
  }
  await avanzarLead({ leadId, clienteId, telefonos, pid: pidOp, estado: 'ganado' })
  return { sale, avisos }
}

// -------------------------------------------------------------------- cuota --

export async function registrarCuota({ pidOp, lote, sale, pago, plan, profile }) {
  if (!plan?.parts?.length) throw new Error('Monto inválido.')
  if (plan.sobra > 0.01) throw new Error('El monto excede la deuda total del lote en S/ ' + plan.sobra.toFixed(2) + '.')
  const base = await filaPago({ pidOp, loteId: lote.id, clienteId: sale.client_id, pago, profile })
  for (const p of plan.parts) {
    const { error } = await supabase.from('daily_income').insert({ ...base, amount: p.take, income_type: 'cuota', sale_id: sale.id, installment_id: p.q.id })
    if (error) throw new Error('Error al aplicar a la cuota ' + p.q.installment_number + ': ' + error.message)
  }
}

// ------------------------------------------------------------------- cuadre --
// Solo superusuario: una inicial o separacion que no se cargo en la migracion,
// sobre una venta que ya existe. No crea venta ni toca el cronograma.

export async function registrarCuadre({ pidOp, lote, sale, pago, tipo, profile }) {
  const base = await filaPago({ pidOp, loteId: lote.id, clienteId: sale.client_id, pago, profile })
  const nota = ('CUADRE ' + tipo.toUpperCase() + ' POR SUPERUSUARIO' + (pago.obs ? ' | ' + String(pago.obs).toUpperCase() : '')).slice(0, 400)
  const { error } = await supabase.from('daily_income').insert({ ...base, amount: r2(pago.monto), income_type: tipo, sale_id: sale.id, observation: nota })
  if (error) throw new Error(error.message)
}
