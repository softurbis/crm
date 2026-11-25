// CUOTAS DEL MES EN EXCEL (24 nov 2026): botón 📥 de la pantalla Pagos, solo para el
// superusuario y el operador. Se elige un mes y uno o todos los proyectos, y baja:
//   Resumen          por proyecto: cuotas que vencen, cuánto se esperaba, cobrado, saldo
//   Cuotas del mes   cada cuota que VENCE en el mes, con su estado y el link al voucher
//   Pagos del mes    cada pago RECIBIDO en el mes (cualquier concepto), con su link
// LINKS: el dueño los pidió para este informe (es de uso interno: superusuario y
// operador). Los Excel de la secretaria de la socia siguen SIN links (regla del 16 nov).
import { supabase } from './supabase'
import { fechaPe, fechaCelda, diaLima, num, SOLES, FECHA, cabecera, titulo, filaTotal, libroNuevo, descargarLibro } from './excelComun'

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
const TIPO = { cuota: 'CUOTA', inicial: 'INICIAL', separacion: 'SEPARACIÓN', mora: 'MORA', otro: 'OTRO' }
const r2 = n => Math.round(Number(n || 0) * 100) / 100
const loteDe = l => l ? l.mz + '-' + l.lt : ''
const PASO = 1000

// '2026-11' → primer y último día del mes
export function rangoMes(mes) {
  const [y, m] = mes.split('-').map(Number)
  const fin = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { desde: mes + '-01', hasta: mes + '-' + String(fin).padStart(2, '0'), nombre: MESES[m - 1] + ' ' + y }
}

// trae todo, de 1000 en 1000 (Supabase corta callado en 1000 filas)
async function todas(armar) {
  let out = []
  for (let desde = 0; desde < 100000; desde += PASO) {
    const { data, error } = await armar().range(desde, desde + PASO - 1)
    if (error) throw new Error(error.message)
    out = out.concat(data || [])
    if (!data || data.length < PASO) break
  }
  return out
}

async function traerDatos(pids, desde, hasta) {
  // 1) las cuotas que vencen en el mes, de ventas vivas (no expropiadas ni anuladas)
  const cuotas = await todas(() => supabase.from('installments')
    .select('id, installment_number, due_date, amount, amount_paid, paid_date, status, sale:sales!inner(id, status, installments_count, lot:lots!inner(mz, lt, project_id), client:clients(full_name, doc_type, doc_number, phone))')
    .gte('due_date', desde).lte('due_date', hasta)
    .in('sale.lot.project_id', pids).in('sale.status', ['en_proceso', 'pagado'])
    .order('due_date').order('id'))

  // 2) los pagos aplicados a esas cuotas (pueden ser de otro mes: adelantos o atrasos)
  const COLS = 'id, project_id, date, amount, operation_number, operation_type, income_type, voucher_url, receipt_url, observation, installment_id, banco_origen, sale:sales(status), lot:lots(mz, lt), client:clients(full_name, doc_type, doc_number), installment:installments(installment_number, due_date), account:financial_accounts(name)'
  const ids = cuotas.map(c => c.id)
  let deCuotas = []
  for (let i = 0; i < ids.length; i += 150) {
    const trozo = ids.slice(i, i + 150)
    deCuotas = deCuotas.concat(await todas(() => supabase.from('daily_income').select(COLS)
      .in('installment_id', trozo).order('date').order('id')))
  }

  // 3) todo lo cobrado en el mes, de cualquier concepto
  const delMes = await todas(() => supabase.from('daily_income').select(COLS)
    .in('project_id', pids).gte('date', desde).lte('date', hasta)
    .order('date').order('id'))

  return { cuotas, deCuotas, delMes }
}

const estadoCuota = (c, hoy) => {
  const pagado = r2(c.amount_paid), monto = r2(c.amount)
  if (pagado >= monto - 0.009) return 'PAGADA'
  if (pagado > 0) return c.due_date < hoy ? 'PARCIAL · VENCIDA' : 'PARCIAL'
  return c.due_date < hoy ? 'VENCIDA' : 'POR VENCER'
}
const COLOR = { PAGADA: 'FF2E7D32', PARCIAL: 'FFB26A00', 'PARCIAL · VENCIDA': 'FFB00020', VENCIDA: 'FFB00020', 'POR VENCER': 'FF555555' }

// un hipervínculo clicable (o vacío si no hay documento)
function link(celda, url, texto) {
  if (!url) { celda.value = ''; return }
  celda.value = { text: texto, hyperlink: url }
  celda.font = { color: { argb: 'FF1155CC' }, underline: true }
}

export async function descargarExcelCuotasMes({ mes, proyectos, usuario = '' }) {
  const { desde, hasta, nombre } = rangoMes(mes)
  const pids = proyectos.map(p => p.id)
  const nombreDe = Object.fromEntries(proyectos.map(p => [p.id, p.name]))
  const { cuotas, deCuotas, delMes } = await traerDatos(pids, desde, hasta)
  const hoy = diaLima(new Date().toISOString())

  const pagosDe = {}
  for (const p of deCuotas) (pagosDe[p.installment_id] ||= []).push(p)

  const lista = cuotas.map(c => {
    const pagos = (pagosDe[c.id] || []).filter(p => p.sale?.status !== 'expropiado')
    return { c, pid: c.sale.lot.project_id, pagos, estado: estadoCuota(c, hoy), saldo: Math.max(0, r2(c.amount) - r2(c.amount_paid)) }
  }).sort((a, b) => String(nombreDe[a.pid]).localeCompare(String(nombreDe[b.pid])) || a.c.due_date.localeCompare(b.c.due_date)
    || String(a.c.sale.lot.mz).localeCompare(String(b.c.sale.lot.mz)) || Number(a.c.sale.lot.lt) - Number(b.c.sale.lot.lt))

  const wb = await libroNuevo()
  const unSolo = proyectos.length === 1

  // ---------- RESUMEN ----------
  const res = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] })
  res.columns = [{ width: 32 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 11 }, { width: 18 }]
  titulo(res, 'CUOTAS DE ' + nombre + (unSolo ? ' · ' + proyectos[0].name.toUpperCase() : ''),
    'Vencen del ' + fechaPe(desde) + ' al ' + fechaPe(hasta) + ' · bajado el ' + fechaPe(hoy) + (usuario ? ' · ' + usuario : ''),
    'Cuotas que VENCEN en el mes (ventas vivas; sin expropiadas ni anuladas). "Cobrado" = lo pagado de esas cuotas, en cualquier fecha. La hoja "Pagos del mes" trae todo lo que ENTRÓ en el mes.')
  cabecera(res, 5, ['Proyecto', 'Cuotas', 'Esperado', 'Cobrado', 'Saldo', 'Pagadas', 'Parciales', 'Vencidas', 'Por vencer', 'Entró en el mes'])
  const filaRes = (etq, l, entro) => {
    const r = res.addRow([etq, l.length, r2(l.reduce((s, x) => s + Number(x.c.amount), 0)), r2(l.reduce((s, x) => s + Math.min(Number(x.c.amount_paid), Number(x.c.amount)), 0)),
      r2(l.reduce((s, x) => s + x.saldo, 0)), l.filter(x => x.estado === 'PAGADA').length, l.filter(x => x.estado.startsWith('PARCIAL')).length,
      l.filter(x => x.estado === 'VENCIDA').length, l.filter(x => x.estado === 'POR VENCER').length, r2(entro)])
    ;[3, 4, 5, 10].forEach(i => { r.getCell(i).numFmt = SOLES })
    if (r.getCell(8).value) r.getCell(8).font = { bold: true, color: { argb: 'FFB00020' } }
    return r
  }
  const vivos = delMes.filter(p => p.sale?.status !== 'expropiado')
  for (const p of proyectos) filaRes(p.name, lista.filter(x => x.pid === p.id), vivos.filter(x => x.project_id === p.id).reduce((s, x) => s + Number(x.amount), 0))
  if (!unSolo) filaTotal(filaRes('TOTAL', lista, vivos.reduce((s, x) => s + Number(x.amount), 0)))

  // ---------- CUOTAS DEL MES ----------
  const cols = [['Proyecto', 24], ['Lote', 8], ['Cliente', 34], ['N° documento', 13], ['Celular', 13], ['Cuota', 9], ['Vence', 12], ['Monto cuota', 13],
    ['Pagado', 13], ['Saldo', 13], ['Estado', 17], ['Fecha de pago', 13], ['N° operación', 18], ['Cuenta / banco', 22], ['Voucher', 11], ['Voucher 2', 11], ['Boleta / factura', 15]]
  const ws = wb.addWorksheet('Cuotas del mes (' + lista.length + ')', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = cols.map(([, width]) => ({ width }))
  cabecera(ws, 1, cols.map(([t]) => t))
  ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } }
  if (!lista.length) ws.addRow(['No hay cuotas que venzan en ' + nombre.toLowerCase() + '.']).font = { italic: true, color: { argb: 'FF666666' } }
  for (const x of lista) {
    const { c } = x, cl = c.sale.client || {}
    const vouchers = [...new Set(x.pagos.map(p => p.voucher_url).filter(Boolean))]
    const boleta = x.pagos.map(p => p.receipt_url).find(Boolean)
    const fila = ws.addRow([
      nombreDe[x.pid], loteDe(c.sale.lot), cl.full_name || '', cl.doc_number || '', cl.phone || '',
      c.installment_number + (c.sale.installments_count ? ' de ' + c.sale.installments_count : ''),
      fechaCelda(c.due_date), num(c.amount), num(r2(Math.min(c.amount_paid, c.amount))), num(x.saldo), x.estado,
      x.pagos.length ? [...new Set(x.pagos.map(p => fechaPe(p.date)))].join(' · ') : '',
      [...new Set(x.pagos.map(p => p.operation_number).filter(Boolean))].join(' · '),
      [...new Set(x.pagos.map(p => p.account?.name).filter(Boolean))].join(' · '),
      '', '', '',
    ])
    fila.getCell(7).numFmt = FECHA
    ;[8, 9, 10].forEach(i => { fila.getCell(i).numFmt = SOLES })
    fila.getCell(11).font = { bold: true, color: { argb: COLOR[x.estado] } }
    link(fila.getCell(15), vouchers[0], 'VER')
    link(fila.getCell(16), vouchers[1], 'VER')
    link(fila.getCell(17), boleta, 'VER')
  }
  if (lista.length) {
    const t = ws.addRow(['TOTAL', '', '', '', '', lista.length + ' cuotas', '', r2(lista.reduce((s, x) => s + Number(x.c.amount), 0)),
      r2(lista.reduce((s, x) => s + Math.min(Number(x.c.amount_paid), Number(x.c.amount)), 0)), r2(lista.reduce((s, x) => s + x.saldo, 0))])
    ;[8, 9, 10].forEach(i => { t.getCell(i).numFmt = SOLES })
    filaTotal(t)
  }

  // ---------- PAGOS DEL MES (todo lo que entró) ----------
  const colsP = [['Fecha', 12], ['Proyecto', 24], ['Lote', 8], ['Cliente', 34], ['N° documento', 13], ['Concepto', 20], ['Cuota vence', 12], ['Monto', 13],
    ['N° operación', 18], ['Tipo', 15], ['Cuenta / banco', 22], ['Banco de origen', 16], ['Voucher', 11], ['Boleta / factura', 15], ['Observación', 26]]
  const wp = wb.addWorksheet('Pagos del mes (' + delMes.length + ')', { views: [{ state: 'frozen', ySplit: 1 }] })
  wp.columns = colsP.map(([, width]) => ({ width }))
  cabecera(wp, 1, colsP.map(([t]) => t))
  wp.autoFilter = { from: 'A1', to: { row: 1, column: colsP.length } }
  if (!delMes.length) wp.addRow(['No entró ningún pago en ' + nombre.toLowerCase() + '.']).font = { italic: true, color: { argb: 'FF666666' } }
  const ordenP = [...delMes].sort((a, b) => a.date.localeCompare(b.date) || String(nombreDe[a.project_id]).localeCompare(String(nombreDe[b.project_id])))
  for (const p of ordenP) {
    const expro = p.sale?.status === 'expropiado'
    const concepto = (TIPO[p.income_type] || String(p.income_type || '').toUpperCase()) + (p.installment ? ' ' + p.installment.installment_number : '')
    const fila = wp.addRow([fechaCelda(p.date), nombreDe[p.project_id] || '', loteDe(p.lot), p.client?.full_name || '', p.client?.doc_number || '', concepto,
      p.installment ? fechaCelda(p.installment.due_date) : null, num(p.amount), p.operation_number || '', p.operation_type || '', p.account?.name || '',
      p.banco_origen || '', '', '', [expro ? 'VENTA EXPROPIADA' : '', p.observation || ''].filter(Boolean).join(' · ')])
    fila.getCell(1).numFmt = FECHA; fila.getCell(7).numFmt = FECHA
    fila.getCell(8).numFmt = SOLES; fila.getCell(8).font = { bold: true }
    link(fila.getCell(13), p.voucher_url, 'VER')
    link(fila.getCell(14), p.receipt_url, 'VER')
    if (expro) fila.font = { color: { argb: 'FF999999' } }
  }
  if (delMes.length) {
    // el total no suma los pagos de ventas expropiadas (salen en gris)
    const nEx = delMes.length - vivos.length
    const t = wp.addRow(['TOTAL', '', '', '', '', vivos.length + ' pagos' + (nEx ? ' (sin ' + nEx + ' expropiado' + (nEx > 1 ? 's' : '') + ')' : ''), '', r2(vivos.reduce((s, x) => s + Number(x.amount), 0))])
    t.getCell(8).numFmt = SOLES
    filaTotal(t)
  }

  const archivo = 'cuotas-' + nombre.toLowerCase().replace(' ', '-') + (unSolo ? '-' + proyectos[0].name.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, '-') : '-todos') + '.xlsx'
  await descargarLibro(wb, archivo)
  return { cuotas: lista.length, pagos: delMes.length }
}
