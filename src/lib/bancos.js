// ============================================================================
// BANCO DE ORIGEN: la lista ÚNICA de bancos, cajas y billeteras de Pucallpa
// ----------------------------------------------------------------------------
// Es "con qué pagó el cliente" (daily_income.banco_origen, sql/207). La misma
// lista en TODAS las cobranzas. La CUENTA DESTINO (a qué cuenta de la empresa
// entró la plata) es otra cosa: sale de las cuentas de cobro de cada proyecto.
// Los nombres son los cortos que devuelve la IA del voucher
// (agente/lector_vouchers.js), para que la lectura llene el campo sola.
// Para agregar un banco: una línea aquí, nada más.
// ============================================================================

export const BANCOS_ORIGEN = [
  // bancos
  { nombre: 'BCP', claves: ['bcp', 'banco de credito', 'credito del peru', 'viabcp'] },
  { nombre: 'BBVA', claves: ['bbva', 'continental'] },
  { nombre: 'SCOTIABANK', claves: ['scotiabank', 'scotia'] },
  { nombre: 'INTERBANK', claves: ['interbank'] },
  { nombre: 'BANCO DE LA NACION', claves: ['banco de la nacion', 'nacion'] },
  { nombre: 'BANBIF', claves: ['banbif', 'interamericano de finanzas'] },
  { nombre: 'PICHINCHA', claves: ['pichincha'] },
  { nombre: 'MIBANCO', claves: ['mibanco', 'mi banco'] },
  { nombre: 'BANCO SANTANDER', claves: ['santander'] },
  // cajas municipales
  { nombre: 'CAJA HUANCAYO', claves: ['huancayo'] },
  { nombre: 'CAJA AREQUIPA', claves: ['arequipa'] },
  { nombre: 'CAJA PIURA', claves: ['piura'] },
  { nombre: 'CAJA SULLANA', claves: ['sullana'] },
  { nombre: 'CAJA TRUJILLO', claves: ['trujillo'] },
  { nombre: 'CAJA CUSCO', claves: ['cusco', 'cuzco'] },
  { nombre: 'CAJA ICA', claves: ['caja ica', 'cmac ica', 'municipal de ica'] },
  { nombre: 'CAJA MAYNAS', claves: ['maynas'] },
  // billeteras y otros
  { nombre: 'YAPE', claves: ['yape'] },
  { nombre: 'PLIN', claves: ['plin'] },
  { nombre: 'LEMON', claves: ['lemon'] },
  { nombre: 'EFECTIVO', claves: ['efectivo'] },
  { nombre: 'OTRO', claves: [] },
]

export const NOMBRES_BANCOS = BANCOS_ORIGEN.map(b => b.nombre)

const limpio = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

// Lo que leyó la IA ("CAJA MUNICIPAL DE AREQUIPA", "Banco de Crédito") → el
// nombre de la lista. Si no se parece a ninguno, se devuelve tal cual (en
// mayúsculas): mejor guardar lo leído que perderlo.
export function normalizarBanco(texto) {
  const t = limpio(texto)
  if (!t) return ''
  const exacto = BANCOS_ORIGEN.find(b => limpio(b.nombre) === t)
  if (exacto) return exacto.nombre
  const b = BANCOS_ORIGEN.find(x => x.claves.some(k => (t + ' ').includes(k)))
  return b ? b.nombre : String(texto).trim().toUpperCase()
}

// Las opciones del <select>: la lista + el valor que ya tenga el pago si no está
// en ella (un pago viejo con otro banco tiene que seguir viéndose).
export function opcionesBanco(actual) {
  const v = String(actual || '').trim()
  return v && !NOMBRES_BANCOS.includes(v) ? [...NOMBRES_BANCOS, v] : NOMBRES_BANCOS
}
