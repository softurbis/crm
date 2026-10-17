// ============================================================================
// EL VOUCHER DEL COBRO, LEÍDO CON IA (sql/154, agente/lector_vouchers.js)
// ----------------------------------------------------------------------------
// Al elegir el voucher se sube una COPIA para leer (lecturas/vouchers/) y el
// servidor la lee con Claude. El voucher de verdad se sigue subiendo al registrar.
// Devuelve lo mismo que leerVoucher (el OCR del navegador), para que la pantalla
// no cambie: si la IA no está o falla, DatosPago usa el OCR de siempre.
// ============================================================================
import { supabase } from './supabase'
import { upload } from './archivos'

const espera = ms => new Promise(r => setTimeout(r, ms))
export const faltaSql154 = e => /pedir_lectura_voucher|voucher_lectura|voucher_repetido|schema cache|PGRST20[25]/i.test(String(e?.message || e || ''))

const TIPO_OP = { transferencia: 'TRANSFERENCIA', billetera: 'BILLETERA DIGITAL', deposito: 'DEPOSITO', efectivo: 'EFECTIVO' }

export async function leerVoucherIA(file, projectId) {
  const url = await upload('lecturas/vouchers/' + projectId, file)
  const { data: id, error } = await supabase.rpc('pedir_lectura_voucher', { p_project: projectId, p_url: url })
  if (error) throw error
  // el servidor la toma en 1-2 s y la lee en unos segundos
  for (let i = 0; i < 60; i++) {
    await espera(i < 5 ? 1500 : 2000)
    const { data: v } = await supabase.rpc('voucher_lectura', { p_id: id })
    if (v?.estado === 'listo') return { ...aOcr(v.lectura || {}, v.repetidos || []), urlLectura: url }
    if (v?.estado === 'error') throw new Error(v.error || 'la IA no pudo leer el voucher')
  }
  throw new Error('la lectura con IA está tardando demasiado')
}

// lo leído, con la forma que ya entiende la pantalla (VoucherReview)
function aOcr(L, repetidos) {
  const vacio = L.monto == null && !L.numero_operacion && !L.fecha
  if (vacio) return { vacio: true, ia: true, motivo: !L.es_comprobante ? 'No parece un comprobante de pago.' : !L.legible ? 'La imagen está borrosa o cortada.' : '' }
  // "Banco / cuenta" = con qué pagó el cliente (decisión del dueño): la app primero
  // (Yape, Plin) y si no hay cuenta con ese nombre, el banco del voucher
  const bancosPosibles = [L.app, L.banco].filter(Boolean)
  return {
    ia: true,
    monto: L.monto, operacion: L.numero_operacion, fecha: L.fecha, hora: L.hora,
    banco: bancosPosibles[0] || null, bancosPosibles,
    tipoOperacion: TIPO_OP[L.tipo] || null,
    confianza: 'IA',
    candidatos: [], cajas: {}, imagen: null,
    destinatario: L.destinatario_nombre, destinatarioCuenta: L.destinatario_cuenta, ordenante: L.ordenante_nombre,
    moneda: L.moneda, observaciones: L.observaciones, noEsComprobante: !L.es_comprobante, ilegible: !L.legible,
    repetidos,
  }
}

// ¿ese N° de operación con ese monto ya está registrado? (con lo escrito en el formulario)
export async function voucherRepetido(projectId, op, monto) {
  const { data, error } = await supabase.rpc('voucher_repetido', { p_project: projectId, p_op: op, p_monto: monto })
  if (error) return null   // sql/154 sin correr: sigue el aviso de siempre al registrar
  return data
}

export async function pedirAprobacionVoucher({ projectId, lotId, op, monto, fecha, url, nota }) {
  const { data, error } = await supabase.rpc('pedir_aprobacion_voucher', {
    p_project: projectId, p_lot: lotId || null, p_op: op, p_monto: monto, p_fecha: fecha || null, p_url: url || null, p_nota: nota || null,
  })
  if (error) throw new Error(error.message)
  return data
}
