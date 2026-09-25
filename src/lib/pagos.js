// Lo que comparten la pantalla de Cuotas y la ficha del lote al mostrar pagos:
// como se agrupa un deposito, su estado y sus documentos (voucher del cliente y
// comprobante SUNAT). Vivia solo en Cuotas; la ficha lo necesita igual, y dos
// copias terminan contando historias distintas.
import { supabase } from './supabase'
import { upload } from './archivos'

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
    return {
      ...g,
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
  const nota = prompt('Comentario / nota de este documento (opcional, Enter para saltar):')
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
  const motivo = prompt('¿Por qué este pago NO va a tener ' + doc + '?\n\n' +
    'Ej: es parte de una cascada y el voucher está en el primer pago / cuadre de migración sin documento.\n' +
    'El motivo queda en la bitácora (obligatorio, mínimo 5 caracteres):')
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
  if (!confirm('¿Volver a pedir el ' + doc + ' de este pago?\n\nDejará de estar marcado como "no aplica" y volverá a la lista de faltantes.')) return null
  const ids = filas.map(p => p.id)
  const { error } = await supabase.from('daily_income')
    .update({ [campoNA(campo)]: false, [campoNAMotivo(campo)]: null }).in('id', ids)
  if (error) return { ok: false, t: 'NO SE PUDO QUITAR LA MARCA: ' + error.message }
  await registrarNoAplica(filas, campo, null, false, email, pidOp)
  return { ok: true, ids, t: 'MARCA QUITADA: EL ' + doc + ' VUELVE A PEDIRSE.' }
}
