// El PLANO REAL de un proyecto (sql/181): projects.plano trae el fondo (calles,
// parques, quebrada, rótulos) y cada lote su forma en lots.poligono, todo en metros.
// Lo usan el Mapa de lotes y el panel del vendedor (components/PlanoReal.jsx).
import { repartirCuotas } from './cronograma'

// ¿hay con qué dibujar el plano real?
export const tienePlano = (plano, lotes) =>
  !!plano && Number(plano.ancho) > 0 && (lotes || []).some(l => Array.isArray(l.poligono) && l.poligono.length >= 3)

// centro del lote, para poner su número
export function centroDe(poly) {
  let x = 0, y = 0
  for (const [a, b] of poly) { x += a; y += b }
  return [x / poly.length, y / poly.length]
}

// lado más corto del lote: con eso se decide el tamaño de su número
export function ladoMenor(poly) {
  let m = Infinity
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = poly[i], [c, d] = poly[(i + 1) % poly.length]
    m = Math.min(m, Math.hypot(c - a, d - b))
  }
  return m
}

// COLORES DE PRECIO: los del plano del proyecto (NARANJA S/ 74, VERDE S/ 45…). Si el
// plano no los trae, uno por cada precio por m², del más caro al más barato.
const PALETA = ['#ffad00', '#fff000', '#00c8ff', '#00d73c', '#c58ae0', '#f08080', '#9ad0ff', '#e8c39e']
export function categoriasDe(plano, lotes) {
  const propias = (plano?.categorias || []).filter(c => c && Number(c.precio_m2) > 0)
  if (propias.length) return propias.map(c => ({ ...c, precio_m2: Number(c.precio_m2) }))
  const precios = [...new Set((lotes || []).map(l => Number(l.price_per_m2)).filter(n => n > 0))].sort((a, b) => b - a)
  return precios.map((p, i) => ({ precio_m2: p, nombre: 'S/ ' + p + ' el m²', color: PALETA[i % PALETA.length] }))
}
export const categoriaDe = (cats, l) => cats.find(c => Math.abs(c.precio_m2 - Number(l.price_per_m2)) < 0.005) || null

// LA COTIZACIÓN DE UN LOTE, con la regla de los contratos del sistema (lib/cronograma):
// cuotas en soles enteros y la última absorbe la diferencia. Así el vendedor dice
// exactamente lo que después sale en el contrato. Semanal y diaria como la lista de
// precios de Campo Verde: la cuota del mes × 12 meses ÷ 52 semanas o ÷ 365 días.
const r2 = n => Math.round(Number(n) * 100) / 100
export function cotizar(precio, inicial, meses, descuentoContado = 0) {
  const total = r2(precio)
  const ini = Math.min(total, Math.max(0, r2(inicial || 0)))
  const saldo = r2(total - ini)
  const cuotas = repartirCuotas(saldo, meses)
  const n = cuotas.length
  const cuota = n ? cuotas[0] : 0
  const ultima = n ? cuotas[n - 1] : 0
  const dto = Number(descuentoContado) > 0 && Number(descuentoContado) < 100 ? Number(descuentoContado) : 0
  return {
    precio: total, inicial: ini, saldo, n, cuota, ultima,
    semanal: r2(cuota * 12 / 52), diaria: r2(cuota * 12 / 365),
    contado: dto ? r2(total * (100 - dto) / 100) : null, dto,
  }
}

export const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// "47 cuotas de S/ 458.00 y la cuota 48 de S/ 412.52" (pedido del dueño, 5 nov 2026)
export function textoCuotasVenta(q) {
  if (!q || !q.n) return 'sin cuotas (pago completo)'
  if (q.n === 1) return '1 cuota de ' + soles(q.ultima)
  if (Math.abs(q.ultima - q.cuota) < 0.005) return q.n + ' cuotas de ' + soles(q.cuota)
  return (q.n - 1) + ' cuota' + (q.n - 1 > 1 ? 's' : '') + ' de ' + soles(q.cuota) + ' y la cuota ' + q.n + ' de ' + soles(q.ultima)
}
