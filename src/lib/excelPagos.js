// PAGOS EN EXCEL (16 nov 2026): el botón 📥 Excel de "Boletas y facturas" (la
// secretaria de la socia y el superusuario). Recibe los pagos ya agrupados por
// depósito (agruparDepositos de pages/Facturacion) y arma un libro con:
//   Resumen     por proyecto, por concepto y por mes
//   Pagos       un depósito por fila: cliente, lote, concepto, monto, operación
//   Pendientes  los que todavía no tienen boleta ni factura
//   Por cuota   cada parte del depósito (una cascada lo reparte en varias cuotas)
// REGLA DEL DUEÑO (16 nov): en el Excel NO van los comprobantes ni links a ningún
// documento (voucher, boleta, factura): eso se ve solo dentro del sistema. Solo datos y
// montos, y si el pago ya tiene su boleta o factura (SÍ / PENDIENTE / NO APLICA).
import { fechaPe, fechaCelda, diaLima, num, SOLES, FECHA, cabecera, titulo, filaTotal, libroNuevo, descargarLibro, hoyArchivo } from './excelComun'

const TIPO = { cuota: 'CUOTA', inicial: 'INICIAL', separacion: 'SEPARACIÓN', mora: 'MORA', otro: 'OTRO' }
const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC']
const loteDe = r => r.mz ? r.mz + '-' + r.lt : ''
const tieneComprobante = g => !!(g.comprobante || g.electronico)
const boletaDe = g => tieneComprobante(g) ? 'SÍ' : g.noAplica ? 'NO APLICA' : 'PENDIENTE'

const COLS = [
  ['Fecha', 12], ['Proyecto', 26], ['Lote', 8], ['Cliente', 34], ['Tipo doc', 9], ['N° documento', 14], ['Concepto', 30],
  ['Monto', 13], ['N° operación', 16], ['Cuenta / banco', 22], ['Boleta / factura', 15], ['Observación', 22],
]

function hojaPagos(wb, nombre, grupos, vacio) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLS.map(([, width]) => ({ width }))
  cabecera(ws, 1, COLS.map(([t]) => t))
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLS.length } }
  if (!grupos.length) { ws.addRow([vacio]).font = { italic: true, color: { argb: 'FF666666' } }; return ws }
  for (const g of grupos) {
    const r = g.r, b = boletaDe(g)
    const fila = ws.addRow([
      fechaCelda(r.date), r.proyecto, loteDe(r), r.cliente || '', r.doc_type || (r.doc_number ? 'DNI' : ''), r.doc_number || '', g.concepto,
      num(g.total), r.operation_number || '', r.banco || '', b, r.venta_estado === 'expropiado' ? 'VENTA EXPROPIADA' : '',
    ])
    fila.getCell(1).numFmt = FECHA
    fila.getCell(8).numFmt = SOLES; fila.getCell(8).font = { bold: true }
    fila.getCell(11).font = b === 'PENDIENTE' ? { bold: true, color: { argb: 'FFB00020' } }
      : b === 'NO APLICA' ? { color: { argb: 'FF999999' } } : { color: { argb: 'FF2E7D32' } }
  }
  return ws
}

export async function descargarExcelPagos(grupos, { desde = '', hasta = '', usuario = '', proyecto = '' } = {}) {
  const wb = await libroNuevo()
  // en el Excel van del más antiguo al más nuevo (la pantalla los muestra al revés)
  const lista = [...grupos].sort((a, b) => String(a.r.date).localeCompare(String(b.r.date)) || String(a.r.proyecto).localeCompare(String(b.r.proyecto)))
  const pendientes = lista.filter(g => g.pendiente)
  const rango = desde || hasta ? 'Del ' + (fechaPe(desde) || 'inicio') + ' al ' + (fechaPe(hasta) || 'hoy') : 'Todos los pagos'

  // ---------- RESUMEN ----------
  const res = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] })
  res.columns = [{ width: 34 }, { width: 12 }, { width: 17 }, { width: 16 }, { width: 13 }, { width: 17 }, { width: 12 }]
  titulo(res, 'PAGOS' + (proyecto ? ' · ' + proyecto.toUpperCase() : ''),
    rango + ' · bajado el ' + fechaPe(diaLima(new Date().toISOString())) + (usuario ? ' · ' + usuario : ''),
    'Un pago = un depósito: si se repartió en varias cuotas va en una sola fila (las partes están en la hoja "Por cuota"). Pendiente = todavía sin boleta ni factura.')
  cabecera(res, 5, ['Proyecto', 'Pagos', 'Total cobrado', 'Con boleta o factura', 'Pendientes', 'Monto pendiente', 'No aplica'])
  const proyectos = [...new Set(lista.map(g => g.r.proyecto))].sort()
  const suma = l => l.reduce((s, g) => s + Number(g.total || 0), 0)
  const fila = (etq, l) => {
    const pend = l.filter(g => g.pendiente)
    const r = res.addRow([etq, l.length, suma(l), l.filter(tieneComprobante).length, pend.length, suma(pend), l.filter(g => g.noAplica && !tieneComprobante(g)).length])
    r.getCell(3).numFmt = SOLES; r.getCell(6).numFmt = SOLES
    if (pend.length) r.getCell(5).font = { bold: true, color: { argb: 'FFB00020' } }
    return r
  }
  for (const p of proyectos) fila(p, lista.filter(g => g.r.proyecto === p))
  filaTotal(fila('TOTAL', lista))

  // por concepto: cada parte del depósito con su tipo (una cascada puede mezclar)
  res.addRow([])
  cabecera(res, res.rowCount + 1, ['Concepto', 'Partes', 'Monto'])
  const partes = lista.flatMap(g => g.items)
  for (const [k, t] of Object.entries(TIPO)) {
    const l = partes.filter(x => x.tipo === k)
    if (!l.length) continue
    res.addRow([t, l.length, l.reduce((s, x) => s + Number(x.amount || 0), 0)]).getCell(3).numFmt = SOLES
  }
  const otros = partes.filter(x => !TIPO[x.tipo])
  if (otros.length) res.addRow(['OTRO', otros.length, otros.reduce((s, x) => s + Number(x.amount || 0), 0)]).getCell(3).numFmt = SOLES

  // por mes, si el rango tiene más de uno
  const meses = [...new Set(lista.map(g => String(g.r.date).slice(0, 7)))].sort()
  if (meses.length > 1) {
    res.addRow([])
    cabecera(res, res.rowCount + 1, ['Mes', 'Pagos', 'Total cobrado', 'Con boleta o factura', 'Pendientes', 'Monto pendiente', 'No aplica'])
    for (const m of meses) fila(MESES[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4), lista.filter(g => String(g.r.date).startsWith(m)))
  }

  // ---------- DETALLE ----------
  hojaPagos(wb, 'Pagos', lista, 'No hay pagos en este rango.')
  hojaPagos(wb, 'Pendientes (' + pendientes.length + ')', pendientes, 'No hay pagos pendientes de boleta o factura en este rango.')

  // ---------- POR CUOTA: cada parte del depósito ----------
  const pc = wb.addWorksheet('Por cuota', { views: [{ state: 'frozen', ySplit: 1 }] })
  const colsPc = [['Fecha', 12], ['Proyecto', 26], ['Lote', 8], ['Cliente', 34], ['N° documento', 14], ['Tipo', 12], ['Cuota N°', 9], ['Monto', 13], ['N° operación', 16], ['Cuenta / banco', 22]]
  pc.columns = colsPc.map(([, width]) => ({ width }))
  cabecera(pc, 1, colsPc.map(([t]) => t))
  pc.autoFilter = { from: 'A1', to: { row: 1, column: colsPc.length } }
  for (const g of lista) {
    for (const x of [...g.items].sort((a, b) => (a.cuota || 0) - (b.cuota || 0))) {
      const r = pc.addRow([fechaCelda(x.date), x.proyecto, loteDe(x), x.cliente || '', x.doc_number || '', TIPO[x.tipo] || String(x.tipo || '').toUpperCase(),
        num(x.cuota), num(x.amount), x.operation_number || '', x.banco || ''])
      r.getCell(1).numFmt = FECHA; r.getCell(8).numFmt = SOLES
    }
  }

  const nombre = desde || hasta
    ? 'pagos-' + (fechaPe(desde) || 'inicio').replace(/\//g, '-') + '-al-' + (fechaPe(hasta) || 'hoy').replace(/\//g, '-')
    : 'pagos-todos-' + hoyArchivo()
  await descargarLibro(wb, nombre + '.xlsx')
  return { pagos: lista.length, pendientes: pendientes.length }
}
