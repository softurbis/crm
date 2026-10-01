// Estados de un lote: el mismo color y el mismo nombre en el mapa, en el
// buscador y en la ficha del lote.
export const COLORS = {
  disponible: '#4caf72', separado: '#e0913f', vendido: '#4f83c2',
  entregado: '#3fb6a8', invadido: '#c94f4f', expropiado: '#9a6bc9',
  eliminado: '#6d6f74',
}
export const LBL = {
  disponible: 'Disponible', separado: 'Separado', vendido: 'Vendido',
  entregado: 'Entregado', invadido: 'Invadido', expropiado: 'Expropiado',
  eliminado: 'Eliminado',
}
// Un lote ELIMINADO ya no existe en el terreno (expropiacion, cambio de trazo o
// marcador de migracion). No se puede borrar de la base porque arrastra ventas y
// pagos reales, pero NO debe contar como lote: no suma en el total del proyecto ni
// aparece en el mapa. Queda accesible con su propio filtro para auditarlo.
export const esLote = l => l.status !== 'eliminado'
export const EN_CARTERA = ['vendido', 'entregado']   // ya son de un cliente y siguen en cobranza

// fecha de hoy en Peru (UTC-5), para decidir que cuota ya vencio
export const hoyPeru = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)

// "2026-09-24" -> "24/09/2026"
export const fechaPe = f => f ? String(f).slice(0, 10).split('-').reverse().join('/') : '—'

// CUOTA VENCIDA: una sola definición para todo el panel (ficha, mapa, Hoy, Clientes,
// Dashboard). Ya pasó su fecha, no está pagada y le falta más de S/ 2 (lo de menos
// son redondeos de una cascada). Se calcula EN VIVO con la fecha: el estado
// 'vencido' guardado en la cuota solo se actualiza cuando alguien la toca, y por
// eso cada pantalla contaba distinto.
export const TOLERANCIA_CUOTA = 2
export const saldoCuota = q => Math.round((Number(q.amount || 0) - Number(q.amount_paid || 0)) * 100) / 100
export const cuotaVencida = (q, hoy = hoyPeru()) =>
  q.status !== 'pagado' && !!q.due_date && q.due_date < hoy && saldoCuota(q) > TOLERANCIA_CUOTA

// LO COBRADO DE UNA VENTA, con una sola fórmula para todas las listas: cuotas
// pagadas + inicial + separación (la separación sale del precio: precio − inicial −
// financiado). Es la misma cuenta de la ficha del lote. Antes la lista de Ventas no
// sumaba la separación y mostraba otro "cobrado" y otro "saldo" que la ficha.
export function cobradoDeVenta(v, cuotas = v.installments || []) {
  const r2 = n => Math.round(Number(n || 0) * 100) / 100
  const pagCuotas = cuotas.reduce((s, i) => s + Number(i.amount_paid || 0), 0)
  const separacion = Math.max(0, r2(Number(v.total_sale_price) - Number(v.initial_amount_paid) - Number(v.financed_amount)))
  const cobrado = r2(pagCuotas + Number(v.initial_amount_paid || 0) + separacion)
  return {
    cobrado,
    saldo: r2(Number(v.total_sale_price) - cobrado),
    cuotasPagadas: cuotas.filter(i => i.status === 'pagado').length,
  }
}
