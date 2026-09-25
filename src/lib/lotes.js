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
