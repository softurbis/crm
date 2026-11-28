// La rebaja de un CONVENIO para un lote (28 nov 2026, C8, sql/254): precio especial por bloque
// (instituciones.manzanas) o por institución. Fuera del bloque, sin rebaja. La usan la pantalla
// Instituciones (lista de precios del convenio) y la ficha del lote (precio de lista aparte).
export function rebajaConvenio(inst, lote) {
  if (!inst || !lote) return 0
  const v = Number(inst.rebaja_valor) || 0
  if (inst.manzanas?.length && !inst.manzanas.map(m => String(m).toUpperCase()).includes(String(lote.mz).toUpperCase())) return 0
  if (inst.rebaja_tipo === 'por_lote') return v
  if (inst.rebaja_tipo === 'por_m2') return Math.round(v * Number(lote.area_m2 || 0) * 100) / 100
  if (inst.rebaja_tipo === 'porcentaje') return Math.round(Number(lote.total_price || 0) * v) / 100
  return 0
}
