import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'

const cents = n => Math.round(Number(n || 0) * 100)
const money = n => 'S/ ' + (n / 100).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = s => s ? s.slice(0, 10).split('-').reverse().join('/') : '-'
export const hoyLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const loteCuenta = v => (v.lot?.associated_to || '').startsWith('VENTA CONJUNTA')
  ? v.lot.associated_to.split(' (')[0] : `Mz. ${v.lot?.mz || '-'} / Lt. ${v.lot?.lt || '-'}`

export function resumenCuenta(v, pagos, corte) {
  const rows = [...(v.installments || [])].sort((a, b) => a.installment_number - b.installment_number).map(i => {
    const saldo = Math.max(0, cents(i.amount) - cents(i.amount_paid))
    return { ...i, saldo, estado: !saldo ? 'Pagada' : i.due_date && i.due_date < corte ? 'Vencida' : cents(i.amount_paid) > 0 ? 'Parcial' : 'Pendiente' }
  })
  const propios = pagos.filter(p => p.sale_id === v.id)
  const iniciales = propios.filter(p => p.income_type === 'inicial')
  const separaciones = propios.filter(p => p.income_type === 'separacion')
  const inicial = iniciales.length ? iniciales.reduce((s, p) => s + cents(p.amount), 0) : cents(v.initial_amount_paid)
  const separacion = separaciones.length ? separaciones.reduce((s, p) => s + cents(p.amount), 0)
    : v.financed_amount == null ? 0 : Math.max(0, cents(v.total_sale_price) - cents(v.initial_amount_paid) - cents(v.financed_amount))
  const pagado = inicial + separacion + rows.reduce((s, i) => s + cents(i.amount_paid), 0)
  const vencidas = rows.filter(i => i.estado === 'Vencida')
  const proxima = rows.filter(i => i.saldo && i.due_date >= corte).sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
  return { rows, propios, inicial, separacion, pagado, saldo: cents(v.total_sale_price) - pagado, vencidas,
    vencido: vencidas.reduce((s, i) => s + i.saldo, 0), proxima }
}

export function crearEstadoCuentaPdf({ cliente, ventas, pagos, proyectos = [], corte = hoyLima() }) {
  if (!ventas.length) throw new Error('No hay ventas para exportar.')
  const doc = new jsPDF()
  let y = 0
  const texto = (value, size = 10, bold = false) => {
    if (bold && y > 250) { doc.addPage(); y = 22 }
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size)
    const lines = doc.splitTextToSize(String(value), 178)
    for (const line of lines) {
      if (y > 273) { doc.addPage(); y = 22 }
      doc.text(line, 16, y); y += size * 0.45 + 2
    }
  }
  const tabla = (head, body, options = {}) => {
    autoTable(doc, { startY: y + 2, margin: { left: 16, right: 16, top: 20, bottom: 20 },
      head: [head], body, theme: 'striped', styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
      headStyles: { fillColor: [24, 57, 53] }, alternateRowStyles: { fillColor: [243, 247, 246] },
      rowPageBreak: 'avoid', ...options })
    y = doc.lastAutoTable.finalY + 9
  }
  ventas.forEach((v, index) => {
    if (index) doc.addPage()
    doc.setFillColor(24, 57, 53); doc.rect(0, 0, 210, 30, 'F')
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text('URBIS GROUP', 16, 15)
    doc.setFontSize(9); doc.text('ESTADO DE CUENTA Y CRONOGRAMA', 16, 23)
    doc.setTextColor(35); y = 41
    texto(cliente.full_name || 'Cliente', 14, true)
    texto(`${cliente.doc_type || 'Documento'}: ${cliente.doc_number || '-'}    |    Fecha de corte: ${fecha(corte)}`)
    texto(`${proyectos.find(p => p.id === v.lot?.project_id)?.name || 'Proyecto'} - ${loteCuenta(v)}`, 11, true)
    const estadoVenta = { en_proceso: 'En proceso', pagado: 'Pagada', expropiado: 'Expropiada', anulado: 'Anulada' }[v.status] || v.status || '-'
    texto(`Estado de la venta: ${estadoVenta}    |    Fecha de venta: ${fecha(v.sale_date)}`, 9)
    const r = resumenCuenta(v, pagos, corte)
    tabla(['Precio de venta', 'Separación', 'Inicial', 'Total pagado', r.saldo < 0 ? 'Saldo a favor' : 'Saldo pendiente'],
      [[money(cents(v.total_sale_price)), money(r.separacion), money(r.inicial), money(r.pagado), money(Math.abs(r.saldo))]])
    const activa = ['en_proceso', 'pagado'].includes(v.status)
    if (activa) {
      texto(`Deuda vencida: ${money(r.vencido)} (${r.vencidas.length} cuotas)`, 11, true)
      texto(r.proxima ? `Próximo vencimiento: ${fecha(r.proxima.due_date)} - Cuota ${r.proxima.installment_number} - Saldo ${money(r.proxima.saldo)}` : 'Sin próximos vencimientos pendientes.')
    } else texto('Venta no vigente: cronograma histórico; los saldos no constituyen una liquidación de cobro.', 10, true)
    texto(`Cuotas: ${r.rows.filter(i => !i.saldo).length} pagadas / ${r.rows.filter(i => i.saldo).length} con saldo / ${r.rows.length} en total`, 9)
    texto('Cronograma de cuotas', 12, true)
    if (r.rows.length) tabla(['N°', 'Vencimiento', 'Importe', 'Abonado', 'Saldo', 'Estado'], r.rows.map(i =>
      [i.installment_number, fecha(i.due_date), money(cents(i.amount)), money(cents(i.amount_paid)), money(i.saldo), i.estado]))
    else texto('Esta venta no tiene cuotas registradas.')
    texto('Historial de pagos registrados', 12, true)
    if (r.propios.length) tabla(['Fecha', 'Concepto', 'N° de operación', 'Monto'], [...r.propios].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(p =>
      [fecha(p.date), `${p.income_type || 'Pago'}${p.installment?.installment_number ? ' / cuota ' + p.installment.installment_number : ''}`, p.operation_number || '-', money(cents(p.amount))]))
    else texto('No hay movimientos de caja registrados para esta venta.')
    texto('Los abonos del cronograma reflejan su aplicación a las cuotas. Un depósito puede aparecer distribuido en varios movimientos. El total pagado incluye separación e inicial registradas o informadas en la venta.', 8)
    texto('Documento informativo emitido con los registros disponibles a la fecha de corte. No sustituye un comprobante de pago.', 8)
  })
  const count = doc.getNumberOfPages()
  for (let i = 1; i <= count; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100)
    doc.text(`URBIS GROUP | Corte: ${fecha(corte)}`, 16, 287)
    doc.text(`${i} / ${count}`, 194, 287, { align: 'right' })
  }
  return doc
}

export function descargarEstadoCuenta(datos) {
  const doc = crearEstadoCuentaPdf(datos)
  const nombre = (datos.cliente.full_name || 'cliente').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 70)
  doc.save(`Estado-de-cuenta-${nombre}-${hoyLima()}.pdf`)
}
