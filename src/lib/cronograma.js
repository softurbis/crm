// Montos del cronograma de una venta nueva.
//
// Cada cuota se redondea HACIA ARRIBA al sol entero (481.25 -> 482.00) para que
// el cliente deposite un monto limpio, y la ULTIMA cuota absorbe la diferencia:
// sale menor que las demas. La suma de todas sigue siendo exactamente lo
// financiado. Asi viene en el contrato modelo de Neshuya (24 sep 2026):
// S/ 23,100 en 48 cuotas = 47 de S/ 482.00 y la ultima de S/ 446.00.
//
// Solo se usa al CREAR un cronograma. Los cronogramas que ya existen salen de
// contratos firmados y no se tocan.
const r2 = n => Math.round(n * 100) / 100

export function repartirCuotas(financiado, meses) {
  const total = r2(Number(financiado))
  const n = parseInt(meses)
  if (!(n >= 1) || !(total > 0)) return []
  if (n === 1) return [total]
  const exacta = r2(total / n)
  // el -1e-9 evita que 700.00 (guardado como 700.0000000001) suba a 701
  let cuota = Math.ceil(exacta - 1e-9)
  let ultima = r2(total - cuota * (n - 1))
  // cuotas muy chicas: el redondeo podria dejar la ultima en cero o negativa.
  // Ahi se vuelve al reparto exacto de siempre.
  if (ultima <= 0) { cuota = exacta; ultima = r2(total - cuota * (n - 1)) }
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? ultima : cuota))
}

// ------------------------------------------------------------------ fechas --
// El DIA DE PAGO se elige en el contrato: el 1, el 15, fin de mes u otro día.
// Se guarda como un número del 1 al 31, y 31 = FIN DE MES: en los meses cortos
// cae en el último día (30 de abril, 28 o 29 de febrero). Con el día 30 pasa lo
// mismo en febrero, y en marzo vuelve al 30: cada fecha sale del día elegido,
// nunca de la cuota anterior.
export const FIN_DE_MES = 31

const ultimoDia = (anio, mes0) => new Date(Date.UTC(anio, mes0 + 1, 0)).getUTCDate()

// fecha (AAAA-MM-DD) de la cuota que cae `k` meses después de `primera`, el día `dia`
export function fechaCuota(primera, k, dia) {
  const [a, m] = String(primera).slice(0, 10).split('-').map(Number)
  const d = parseInt(dia) || Number(String(primera).slice(8, 10))
  const t = new Date(Date.UTC(a, m - 1 + k, 1))
  const y = t.getUTCFullYear(), mes0 = t.getUTCMonth()
  const dd = Math.min(d, ultimoDia(y, mes0))
  return y + '-' + String(mes0 + 1).padStart(2, '0') + '-' + String(dd).padStart(2, '0')
}

export const fechasCuotas = (primera, n, dia) => Array.from({ length: n }, (_, k) => fechaCuota(primera, k, dia))

// "el último día de cada mes", "el día 15 de cada mes"
export const textoDiaPago = dia => Number(dia) >= FIN_DE_MES ? 'el último día de cada mes' : 'el día ' + Number(dia) + ' de cada mes'

// Los meses en que puede caer la primera cuota, desde el mes de `desde`:
// [{ valor: '2026-12', etiqueta: 'Diciembre 2026 (al mes siguiente)' }, …]
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre']
export function mesesParaPrimera(desde, cuantos = 13) {
  const [a, m] = String(desde).slice(0, 10).split('-').map(Number)
  return Array.from({ length: cuantos }, (_, k) => {
    const t = new Date(Date.UTC(a, m - 1 + k, 1))
    const y = t.getUTCFullYear(), mes0 = t.getUTCMonth()
    const cuando = k === 0 ? 'el mismo mes' : k === 1 ? 'al mes siguiente' : 'a ' + k + ' meses'
    return { valor: y + '-' + String(mes0 + 1).padStart(2, '0'), etiqueta: MESES[mes0] + ' ' + y + ' (' + cuando + ')' }
  })
}

// "47 cuotas de S/ 777.40 y la última de S/ 772.53"
export function textoCuotas(cuotas) {
  if (!cuotas.length) return ''
  const f = v => 'S/ ' + Number(v).toLocaleString('es-PE', { minimumFractionDigits: 2 })
  const n = cuotas.length
  const ultima = cuotas[n - 1]
  if (n === 1) return '1 cuota de ' + f(ultima)
  if (Math.abs(ultima - cuotas[0]) < 0.005) return n + ' cuotas de ' + f(cuotas[0])
  return (n - 1) + ' cuota' + (n - 1 > 1 ? 's' : '') + ' de ' + f(cuotas[0]) + ' y la última de ' + f(ultima)
}
