// GASTOS EN EXCEL (16 nov 2026): el botón 📥 Excel de Gastos de la secretaria de la
// socia (y del superusuario en esa pantalla). Baja LO QUE ESTÁ VIENDO: el proyecto, el
// estado y la búsqueda que tenga puestos. El libro trae:
//   Resumen            por proyecto, por tipo y por mes
//   Gastos             uno por fila, con firmas, pago y montos
//   Faltan documentos  los pagados sin RH / factura o sin voucher
// REGLA DEL DUEÑO (16 nov): en el Excel NO van los documentos ni links (RH, voucher,
// constancia, reposición): eso se ve solo dentro del sistema. Solo datos y montos, y si
// el gasto ya tiene su RH y su voucher (SÍ / FALTA / NO APLICA).
import { fechaPe, fechaCelda, diaLima, num, SOLES, FECHA, cabecera, titulo, filaTotal, libroNuevo, descargarLibro, hoyArchivo } from './excelComun'
import { estadoGasto, numeroGasto } from '../components/ConstanciaGasto'

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SET', 'OCT', 'NOV', 'DIC']
const fechaDe = g => g.issue_date || g.reception_date || null
// el día del pago, igual que la pantalla: el que registró el pago en el panel, o la
// fecha de la constancia en los gastos cargados (su confirmed_at es el día de la carga)
export const pagadoEl = g => g.confirmed_by && g.confirmed_at ? diaLima(g.confirmed_at) : (g.reception_date || g.issue_date || null)
// las líneas del detalle ("fecha | detalle | monto") en una sola celda
const detalleDe = g => (g.detail || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a.length >= 2)
  .map(a => [a[0], a[1], a[2] ? 'S/ ' + a[2] : ''].filter(Boolean).join(' ')).join('; ')

export function estadoTexto(g, porPagar) {
  const e = estadoGasto(g)
  if (e === 'confirmado') return 'PAGADO'
  if (e === 'rechazado') return 'RECHAZADO'
  if (e === 'aprobado') return porPagar ? (g.voucher_url ? 'POR PAGAR (FALTA CONFIRMAR)' : 'POR PAGAR (FALTA VOUCHER)') : 'APROBADO'
  if (e === 'por_firmar') return 'POR FIRMAR'
  if (e === 'en_papel') return 'FIRMA EN PAPEL'
  return porPagar === null ? 'SOLICITADO' : 'POR APROBAR'
}

// ¿tiene el documento? SÍ / NO APLICA / FALTA (solo falta en los pagados)
const tiene = (url, na, pagado) => url ? 'SÍ' : na ? 'NO APLICA' : pagado ? 'FALTA' : ''

const COLS = [
  ['N°', 11], ['Fecha', 12], ['Proyecto', 24], ['Estado', 20], ['Tipo', 18], ['Receptor', 30], ['DNI receptor', 12],
  ['Motivo', 40], ['Detalle', 40], ['Monto', 13], ['Cómo se paga', 16], ['Comprobante que presenta', 16], ['Entrega', 26],
  ['Pidió', 22], ['Aprobó', 22], ['Aprobado el', 12], ['Pagado el', 12], ['Pago registrado por', 22],
  ['RH / factura', 12], ['Voucher del pago', 12], ['Lo adelantó', 18], ['Reposición', 34], ['Motivo del rechazo', 30],
]

function hojaGastos(wb, nombre, lista, ctx, extra) {
  const cols = extra ? [...COLS, extra] : COLS
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = cols.map(([, width]) => ({ width }))
  cabecera(ws, 1, cols.map(([t]) => t))
  ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } }
  if (!lista.length) { ws.addRow([extra ? 'Todos los gastos pagados tienen su RH y su voucher.' : 'No hay gastos con este filtro.']).font = { italic: true, color: { argb: 'FF666666' } }; return ws }
  for (const g of lista) {
    const e = estadoGasto(g), pagado = e === 'confirmado', rp = g.reposicion
    const r = ws.addRow([
      numeroGasto(g), fechaCelda(fechaDe(g)), ctx.proyecto(g), estadoTexto(g, ctx.porPagar(g)), g.type || '', g.recipient || '', g.recipient_dni || '',
      g.description || '', detalleDe(g), num(g.amount), g.payment_method || '', g.document_type || '', g.sender || '',
      g.requester_name || g.pedido_por_nombre || '', g.approved_at ? (g.approved_name || (g.approval_papel ? g.sender || '' : '')) + (g.approval_papel ? ' (EN PAPEL)' : '') : '',
      fechaCelda(diaLima(g.approved_at)), pagado ? fechaCelda(pagadoEl(g)) : null, pagado ? (g.pagado_por_nombre || (g.confirmed_by ? '' : 'SEGÚN LA CONSTANCIA')) : '',
      tiene(g.receipt_url, g.receipt_na, pagado), tiene(g.voucher_url, g.voucher_na, pagado), g.adelanto_por || '',
      rp ? [rp.persona, fechaPe(rp.fecha), rp.monto != null ? 'S/ ' + Number(rp.monto).toFixed(2) : ''].filter(Boolean).join(' · ')
        : (g.adelanto_por && !g.rejected_at ? 'FALTA REPONER' : ''),
      g.rejected_at ? (g.rejected_reason || '') : '',
      ...(extra ? [ctx.falta(g)] : []),
    ])
    for (const k of [2, 16, 17]) r.getCell(k).numFmt = FECHA
    r.getCell(10).numFmt = SOLES; r.getCell(10).font = { bold: true }
    const est = r.getCell(4)
    est.font = pagado ? { color: { argb: 'FF2E7D32' } } : e === 'rechazado' ? { color: { argb: 'FFB00020' } } : { bold: true, color: { argb: 'FFB26A00' } }
    for (const k of [19, 20]) if (r.getCell(k).value === 'FALTA') r.getCell(k).font = { bold: true, color: { argb: 'FFB00020' } }
    if (extra) r.getCell(cols.length).font = { bold: true, color: { argb: 'FFB00020' } }
  }
  return ws
}

// lista: los gastos que está viendo; proyDe: { id: proyecto }; filtro: el texto de lo que filtró
export async function descargarExcelGastos(lista, { proyDe = {}, usuario = '', filtro = '' } = {}) {
  const wb = await libroNuevo()
  const proyecto = g => proyDe[g.project_id]?.name || ''
  // aprobada por la socia y sin pagar: le falta el voucher (null = el proyecto no pide aprobación)
  const porPagar = g => proyDe[g.project_id]?.expense_approval ? estadoGasto(g) === 'aprobado' : null
  const falta = g => [!g.receipt_url && !g.receipt_na && 'RH / FACTURA', !g.voucher_url && !g.voucher_na && 'VOUCHER'].filter(Boolean).join(' Y ')
  const ctx = { proyecto, porPagar, falta }
  // del más antiguo al más nuevo
  const orden = [...lista].sort((a, b) => String(fechaDe(a) || '').localeCompare(String(fechaDe(b) || '')) || (a.request_number || 0) - (b.request_number || 0))
  const vivos = orden.filter(g => estadoGasto(g) !== 'rechazado')
  const pagados = orden.filter(g => estadoGasto(g) === 'confirmado')
  const faltan = pagados.filter(falta)
  const suma = l => l.reduce((s, g) => s + Number(g.amount || 0), 0)

  // ---------- RESUMEN ----------
  const res = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] })
  res.columns = [{ width: 32 }, { width: 12 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 15 }, { width: 13 }, { width: 13 }]
  titulo(res, 'GASTOS' + (filtro ? ' · ' + filtro.toUpperCase() : ''),
    'Bajado el ' + fechaPe(diaLima(new Date().toISOString())) + (usuario ? ' · ' + usuario : '') + ' · ' + orden.length + ' gasto' + (orden.length === 1 ? '' : 's'),
    'Sin pagar = por firmar, por aprobar o por pagar. Los rechazados no suman en el total. "Sin RH" y "Sin voucher" cuentan solo los pagados.')
  cabecera(res, 5, ['Proyecto', 'Gastos (sin rechazados)', 'Total', 'Pagado', 'Sin pagar', 'Rechazado', 'Sin RH', 'Sin voucher'])
  const fila = (etq, l) => {
    const v = l.filter(g => estadoGasto(g) !== 'rechazado'), p = l.filter(g => estadoGasto(g) === 'confirmado')
    const r = res.addRow([etq, v.length, suma(v), suma(p), suma(v.filter(g => estadoGasto(g) !== 'confirmado')),
      suma(l.filter(g => estadoGasto(g) === 'rechazado')),
      p.filter(g => !g.receipt_url && !g.receipt_na).length, p.filter(g => !g.voucher_url && !g.voucher_na).length])
    for (const k of [3, 4, 5, 6]) r.getCell(k).numFmt = SOLES
    return r
  }
  const proyectos = [...new Set(orden.map(proyecto))].sort()
  for (const p of proyectos) fila(p || '—', orden.filter(g => proyecto(g) === p))
  filaTotal(fila('TOTAL', orden))

  // por tipo (sin rechazados), de mayor a menor
  res.addRow([])
  cabecera(res, res.rowCount + 1, ['Tipo (sin rechazados)', 'Gastos', 'Total', 'Pagado'])
  const tipos = [...new Set(vivos.map(g => g.type || 'SIN TIPO'))]
    .map(t => [t, vivos.filter(g => (g.type || 'SIN TIPO') === t)]).sort((a, b) => suma(b[1]) - suma(a[1]))
  for (const [t, l] of tipos) {
    const r = res.addRow([t, l.length, suma(l), suma(l.filter(g => estadoGasto(g) === 'confirmado'))])
    r.getCell(3).numFmt = SOLES; r.getCell(4).numFmt = SOLES
  }

  // por mes de la fecha del gasto (sin rechazados)
  const meses = [...new Set(vivos.map(g => String(fechaDe(g) || '').slice(0, 7)).filter(Boolean))].sort()
  if (meses.length > 1) {
    res.addRow([])
    cabecera(res, res.rowCount + 1, ['Mes (sin rechazados)', 'Gastos', 'Total', 'Pagado'])
    for (const m of meses) {
      const l = vivos.filter(g => String(fechaDe(g) || '').startsWith(m))
      const r = res.addRow([MESES[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4), l.length, suma(l), suma(l.filter(g => estadoGasto(g) === 'confirmado'))])
      r.getCell(3).numFmt = SOLES; r.getCell(4).numFmt = SOLES
    }
  }

  // ---------- DETALLE ----------
  hojaGastos(wb, 'Gastos', orden, ctx)
  hojaGastos(wb, 'Faltan documentos (' + faltan.length + ')', faltan, ctx, ['Falta', 20])

  await descargarLibro(wb, 'gastos-' + hoyArchivo() + '.xlsx')
  return { gastos: orden.length, faltan: faltan.length }
}
