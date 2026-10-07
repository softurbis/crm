// Lo que comparten la pantalla de Cuotas y la ficha del lote al mostrar pagos:
// como se agrupa un deposito, su estado y sus documentos (voucher del cliente y
// comprobante SUNAT). Vivia solo en Cuotas; la ficha lo necesita igual, y dos
// copias terminan contando historias distintas.
import { supabase } from './supabase'
import { upload } from './archivos'
import { confirmar, pedir } from './dialogos'

export const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })

// columnas de un pago tal como las usan el historial y el detalle del pago
export const COLS_PAGO = 'id, date, amount, operation_number, income_type, voucher_url, receipt_url, extra_url, voucher_note, receipt_note, extra_note, observation, installment_id, sale_id, sale:sales(status), lot:lots(mz,lt), client:clients(full_name), installment:installments(installment_number), financial_account_id, account:financial_accounts(name)'
export const COLS_PAGO_NA = ', voucher_na, voucher_na_reason, receipt_na, receipt_na_reason'   // sql/49

// El estado del pago sale PRIMERO de la venta a la que pertenece: un pago de una
// venta expropiada ES expropiado aunque nadie lo haya escrito en la observacion.
// El texto queda de respaldo por los pagos sin venta (separaciones perdidas) y
// por los que el panel sello a mano. Sin esto, los pagos de las expropiaciones
// MIGRADAS de Excel (16 lotes, ~S/ 40.000) salian como ACEPTADO mezclados con
// los pagos activos del lote — descubierto el 25 ago 2026.
export const estadoDe = r => {
  if (r.sale?.status === 'expropiado') return 'EXPROPIADO'
  const o = (r.observation || '').toUpperCase()
  if (o.includes('EXPROP')) return 'EXPROPIADO'
  if (o.includes('PERDIDA')) return 'PERDIDA'
  return 'ACEPTADO'
}

export const conceptoPago = p => p.income_type === 'cuota' && p.installment
  ? `CUOTA N ${p.installment.installment_number}`
  : (p.income_type || '-').toUpperCase()

// La etiqueta que traía el Excel ("CUOTA 6", "INICIAL") repite el concepto, y cuando
// el depósito se repartió en otras cuotas (5 + 6) parecía decir otra cosa: no se
// muestra. Lo demás de la observación (notas, correcciones) sí.
const ETIQUETA_VIEJA = /^(CUOTA\s*(N[°º]?\s*)?\d+|INICIAL|SEPARACI[OÓ]N( E INICIAL)?)$/i
export const notaVisible = obs => String(obs || '').split('|').map(s => s.trim())
  .filter(s => s && !ETIQUETA_VIEJA.test(s)).join(' | ')

// "cuota 5 (S/ 40.00) + cuota 6 (S/ 460.00)": cómo se repartió un depósito
export const textoReparto = reparto => reparto.map(x => `cuota ${x.n} (${soles(x.monto)})`).join(' + ')

// Una cascada genera varias aplicaciones de un único depósito. La operación, la
// fecha y la cuenta identifican ese depósito sin mezclar los pagos sin referencia.
export function agruparPagos(pagos) {
  const grupos = new Map()
  for (const pago of pagos) {
    const op = String(pago.operation_number || '').trim().toUpperCase()
    const key = !op || op === 'SIN-REF'
      ? `fila:${pago.id}`
      : `${pago.date || ''}|${op}|${pago.financial_account_id || ''}`
    if (!grupos.has(key)) grupos.set(key, { key, items: [], referencia: pago })
    grupos.get(key).items.push(pago)
  }
  return [...grupos.values()].map(g => {
    const { items } = g
    const cuotas = items.filter(p => p.income_type === 'cuota' && p.installment)
      .map(p => p.installment.installment_number).sort((a, b) => a - b)
    const conceptos = [...new Set(items.map(conceptoPago))]
    const lotes = [...new Set(items.map(p => p.lot ? `${p.lot.mz}-${p.lot.lt}` : '-'))]
    const clientes = [...new Set(items.map(p => p.client?.full_name || '-'))]
    const voucher = items.find(p => p.voucher_url)
    const comprobante = items.find(p => p.receipt_url)
    // "no aplica": el deposito nunca va a tener ese documento (cascada, cuadre,
    // canje). Vale para todo el grupo, que es como lo ve y lo marca el operador.
    const voucherNA = items.every(p => p.voucher_na)
    const comprobanteNA = items.every(p => p.receipt_na)
    // a qué cuota fue cada parte del depósito, de la más antigua a la más nueva
    const reparto = items.filter(p => p.income_type === 'cuota' && p.installment)
      .map(p => ({ id: p.id, n: p.installment.installment_number, monto: Number(p.amount || 0) }))
      .sort((a, b) => a.n - b.n)
    return {
      ...g,
      reparto,
      notas: [...new Set(items.map(p => notaVisible(p.observation)).filter(Boolean))].join(' | '),
      total: items.reduce((s, p) => s + Number(p.amount || 0), 0),
      concepto: cuotas.length === items.length
        ? `CUOTA${cuotas.length > 1 ? 'S' : ''} N ${cuotas.join(' + ')}`
        : conceptos.join(' + '),
      lotes: lotes.join(' + '),
      clientes: clientes.join(' + '),
      voucherUrl: voucher?.voucher_url || null,
      voucherNA, voucherNAMotivo: items.find(p => p.voucher_na_reason)?.voucher_na_reason || null,
      voucherFaltante: items.some(p => !p.voucher_url && !p.voucher_na),
      comprobanteUrl: comprobante?.receipt_url || null,
      comprobanteNA, comprobanteNAMotivo: items.find(p => p.receipt_na_reason)?.receipt_na_reason || null,
      comprobanteFaltante: items.some(p => !p.receipt_url && !p.receipt_na),
    }
  })
}

// ---- LA CASCADA, OTRA VEZ EN ORDEN ----
// Vuelve a repartir los depósitos de cuotas de una venta con la regla del dueño:
// cada depósito termina primero la cuota más antigua que debe y lo que sobra pasa a
// la siguiente. Conserva cada depósito (fecha, operación, monto, voucher y boleta):
// solo cambia a qué cuotas va. Rehace desde el depósito que contiene `desdeId`, o
// desde el primero con fecha >= `desdeFecha`; los anteriores no se tocan. Reusa
// las filas que ya existen (igual que reordenar_cascada, sql/120): agrega una si el
// depósito ahora toca una cuota más y borra las que sobran.
// Lo usan "Recalcular cascada" y el detalle del pago al borrar o corregir el monto:
// sin esto quedaban cuotas con saldo antes de otras ya pagadas.
const r2 = n => Math.round(Number(n) * 100) / 100
const hoyLima = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)

export async function recalcularCascada({ saleId, desdeId = null, desdeFecha = null }) {
  const [cuotasR, pagosR] = await Promise.all([
    supabase.from('installments').select('id, installment_number, amount, amount_paid, due_date, status, paid_date')
      .eq('sale_id', saleId).order('installment_number'),
    supabase.from('daily_income').select('*').eq('sale_id', saleId).eq('income_type', 'cuota').eq('approved', true)
      .not('installment_id', 'is', null).order('date').order('created_at'),
  ])
  if (cuotasR.error) throw cuotasR.error
  if (pagosR.error) throw pagosR.error
  const cuotas = cuotasR.data || []
  if (!cuotas.length) return { cambios: 0 }
  const grupos = agruparPagos(pagosR.data || [])
  let desde = 0
  if (desdeId) {
    desde = grupos.findIndex(x => x.items.some(p => p.id === desdeId))
    if (desde < 0) throw new Error('NO ENCONTRÉ EL PAGO A RECALCULAR.')
  } else if (desdeFecha) {
    desde = grupos.findIndex(x => (x.referencia.date || '') >= desdeFecha)
    if (desde < 0) desde = grupos.length
  }

  // lo que ya pagaron los depósitos anteriores no se mueve
  const pagado = new Map(cuotas.map(q => [q.id, 0]))
  for (const p of grupos.slice(0, desde).flatMap(x => x.items)) pagado.set(p.installment_id, r2((pagado.get(p.installment_id) || 0) + Number(p.amount || 0)))

  // primero el plan entero; si algo no cuadra, no se escribe nada
  const planes = grupos.slice(desde).map(g => {
    let resto = r2(g.total)
    const partes = []
    for (const q of cuotas) {
      if (resto <= 0.004) break
      const debe = r2(Number(q.amount) - (pagado.get(q.id) || 0))
      if (debe <= 0.004) continue
      const toma = Math.min(resto, debe)
      partes.push({ cuota: q.id, monto: r2(toma) })
      pagado.set(q.id, r2((pagado.get(q.id) || 0) + toma))
      resto = r2(resto - toma)
    }
    if (resto > 0.01) throw new Error(`EL PAGO ${g.referencia.operation_number} DEL ${g.referencia.date} PASA LO QUE DEBE LA VENTA EN ${soles(resto)}.`)
    return { g, partes }
  })

  let cambios = 0
  for (const { g, partes } of planes) {
    const filas = [...g.items].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || a.id.localeCompare(b.id))
    // el voucher y la boleta son del DEPÓSITO: valen para todas sus partes
    const docs = {}
    for (const c of ['voucher_url', 'receipt_url']) {
      const con = filas.find(p => p[c])
      if (con) { docs[c] = con[c]; docs[campoNota(c)] = con[campoNota(c)] || null; docs[campoNA(c)] = false; docs[campoNAMotivo(c)] = null }
    }
    for (let i = 0; i < partes.length; i++) {
      const f = filas[i], pt = partes[i]
      if (f) {
        const faltaDoc = Object.keys(docs).some(k => k.endsWith('_url') && !f[k])
        if (f.installment_id === pt.cuota && Math.abs(Number(f.amount) - pt.monto) < 0.005 && !faltaDoc) continue
        const { error } = await supabase.from('daily_income').update({ installment_id: pt.cuota, amount: pt.monto, ...docs }).eq('id', f.id)
        if (error) throw error
      } else {
        // el depósito ahora toca una cuota más: una fila nueva, copia de la primera
        const { id, comprobante_id, ...base } = filas[0]
        const { error } = await supabase.from('daily_income').insert({ ...base, ...docs, installment_id: pt.cuota, amount: pt.monto })
        if (error) throw error
      }
      cambios++
    }
    // el depósito ahora toca menos cuotas: las filas que sobran se van
    const sobran = filas.slice(partes.length).map(p => p.id)
    if (sobran.length) {
      const { error } = await supabase.from('daily_income').delete().in('id', sobran)
      if (error) throw error
      cambios += sobran.length
    }
  }

  // cada cuota, sumando lo que le quedó. Se compara contra cómo están AHORA: el
  // trigger de la base (apply_income_to_installment) ya las fue tocando con cada
  // fila escrita, y la foto del principio ya no sirve para saber si cambiaron.
  const hoy = hoyLima()
  const ultima = new Map()
  for (const { g, partes } of planes) for (const pt of partes) if ((ultima.get(pt.cuota) || '') < g.referencia.date) ultima.set(pt.cuota, g.referencia.date)
  const ahoraR = await supabase.from('installments').select('id, amount_paid, status, paid_date').eq('sale_id', saleId)
  if (ahoraR.error) throw ahoraR.error
  const ahora = new Map((ahoraR.data || []).map(q => [q.id, q]))
  for (const c of cuotas) {
    const q = { ...c, ...(ahora.get(c.id) || {}) }
    const monto = r2(pagado.get(q.id) || 0)
    const pagada = monto >= Number(q.amount) - 0.009
    const status = pagada ? 'pagado' : q.due_date < hoy ? 'vencido' : 'pendiente'
    const paid_date = pagada ? (ultima.get(q.id) || q.paid_date) : null
    if (Math.abs(Number(q.amount_paid) - monto) < 0.005 && q.status === status && (q.paid_date || null) === (paid_date || null)) continue
    const { error } = await supabase.from('installments').update({ amount_paid: monto, status, paid_date }).eq('id', q.id)
    if (error) throw error
  }
  return { cambios }
}

// voucher_url -> voucher_na / voucher_na_reason / voucher_note (idem receipt_url)
export const campoNA = campo => campo.replace('_url', '_na')
export const campoNAMotivo = campo => campo.replace('_url', '_na_reason')
export const campoNota = campo => campo.replace('_url', '_note')
export const nombreDoc = campo => campo === 'voucher_url' ? 'VOUCHER DEL CLIENTE' : 'COMPROBANTE INTERNO'

// Todas las aplicaciones del mismo deposito (misma fecha + N° operacion + cuenta),
// igual que las agrupa el historial. Un pago SIN-REF va solo.
export function filasDelPago(r, pagos) {
  const op = String(r.operation_number || '').trim().toUpperCase()
  if (!op || op === 'SIN-REF') return [r]
  return pagos.filter(x => (x.date || '') === (r.date || '') &&
    String(x.operation_number || '').trim().toUpperCase() === op &&
    (x.financial_account_id || '') === (r.financial_account_id || ''))
}

// Sube el voucher o el comprobante de un pago, con su nota. Devuelve el texto
// del aviso, o null si se cancelo la nota (no se sube nada).
export async function subirDocPago(row, file, campo, naOk = true) {
  const nota = await pedir('Comentario / nota de este documento (opcional, Enter para saltar):')
  if (nota === null) return null
  const url = await upload(`${campo === 'voucher_url' ? 'vouchers' : 'comprobantes'}/${row.id}`, file)
  const patch = { [campo]: url, [campoNota(campo)]: nota.trim() || null }
  // si el documento aparecio despues de todo, la marca "no aplica" ya no vale
  if (naOk) { patch[campoNA(campo)] = false; patch[campoNAMotivo(campo)] = null }
  const { error } = await supabase.from('daily_income').update(patch).eq('id', row.id)
  if (error) throw error
  return campo === 'voucher_url' ? 'VOUCHER SUBIDO' : 'COMPROBANTE SUBIDO'
}

const registrarNoAplica = (filas, campo, motivo, marcado, email, pidOp) => supabase.from('activity_log').insert({
  action: 'UPDATE', entity_type: 'daily_income', user_email: email || null,
  details: {
    cambio: marcado ? 'documento_no_aplica' : 'documento_vuelve_a_pedirse',
    documento: nombreDoc(campo), motivo,
    operacion: filas[0]?.operation_number || null,
    lote: filas[0]?.lot ? filas[0].lot.mz + '-' + filas[0].lot.lt : null,
    cliente: filas[0]?.client?.full_name || null,
    monto: filas.reduce((s, p) => s + Number(p.amount || 0), 0),
    aplicaciones: filas.length, project_id: pidOp,
  },
})

// ---- DOCUMENTOS QUE NO APLICAN ----
// La cascada aplica un deposito a varias cuotas y los cuadres/canjes no tienen
// voucher: pedirlos para siempre obligaba a subir el mismo papel varias veces.
// Aqui se marca, con motivo (bitacora), y deja de contar como faltante.
// `filas` son todas las aplicaciones del mismo deposito: se marcan juntas.
// Devuelve { ok, t, ids, motivo } o null si se cancelo.
export async function marcarNoAplica(filas, campo, { email, pidOp }) {
  const doc = nombreDoc(campo)
  const motivo = await pedir('¿Por qué este pago NO va a tener ' + doc + '?\n\n' +
    'Ej: es parte de una cascada y el voucher está en el primer pago / cuadre de migración sin documento.\n' +
    'El motivo queda en la bitácora (obligatorio, mínimo 5 caracteres):', { tipo: 'largo', obligatorio: true })
  if (motivo === null) return null
  if (motivo.trim().length < 5) return { ok: false, t: 'MOTIVO OBLIGATORIO (mínimo 5 caracteres).' }
  const texto = motivo.trim().toUpperCase().slice(0, 300)
  const ids = filas.map(p => p.id)
  const { error } = await supabase.from('daily_income')
    .update({ [campoNA(campo)]: true, [campoNAMotivo(campo)]: texto }).in('id', ids)
  if (error) return { ok: false, t: 'NO SE PUDO MARCAR: ' + error.message }
  await registrarNoAplica(filas, campo, texto, true, email, pidOp)
  return { ok: true, ids, motivo: texto, t: doc + ' MARCADO COMO NO APLICA' + (ids.length > 1 ? ' (' + ids.length + ' aplicaciones del mismo pago)' : '') + '. MOTIVO EN BITÁCORA.' }
}

export async function quitarNoAplica(filas, campo, { email, pidOp }) {
  const doc = nombreDoc(campo)
  if (!await confirmar('¿Volver a pedir el ' + doc + ' de este pago?\n\nDejará de estar marcado como "no aplica" y volverá a la lista de faltantes.')) return null
  const ids = filas.map(p => p.id)
  const { error } = await supabase.from('daily_income')
    .update({ [campoNA(campo)]: false, [campoNAMotivo(campo)]: null }).in('id', ids)
  if (error) return { ok: false, t: 'NO SE PUDO QUITAR LA MARCA: ' + error.message }
  await registrarNoAplica(filas, campo, null, false, email, pidOp)
  return { ok: true, ids, t: 'MARCA QUITADA: EL ' + doc + ' VUELVE A PEDIRSE.' }
}
