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
