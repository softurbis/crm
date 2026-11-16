// LO COMÚN A LOS INFORMES EN EXCEL DEL PANEL (16 nov 2026): Lotes con deuda
// (excelDeudores), Pagos y comprobantes (excelPagos) y Gastos (excelGastos).
// exceljs pesa casi 1 MB: se carga solo cuando alguien pide un informe.
export const fechaPe = f => f ? String(f).slice(0, 10).split('-').reverse().join('/') : ''
// la fecha como día puro (UTC): Excel la muestra sin hora, sin correrse por la zona horaria
export const fechaCelda = f => { if (!f) return null; const [y, m, d] = String(f).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
// un momento (timestamptz) como el día en Lima
export const diaLima = ts => ts ? new Date(new Date(ts).getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10) : null
export const num = n => (n === null || n === undefined || n === '') ? null : Number(n)
export const SOLES = '"S/ "#,##0.00'
export const FECHA = 'dd/mm/yyyy'
export const nombreHoja = s => String(s || 'Proyecto').replace(/[\\/*?:[\]]/g, ' ').slice(0, 31)
// hoy en Perú, para el nombre del archivo (dd-mm-aaaa)
export const hoyArchivo = () => fechaPe(new Date(Date.now() - 5 * 3600 * 1000).toISOString()).replace(/\//g, '-')

export async function libroNuevo() {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Urbis Control'
  wb.created = new Date()
  return wb
}

export function cabecera(ws, fila, cols) {
  const r = ws.getRow(fila)
  r.values = cols
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  r.alignment = { vertical: 'middle', wrapText: true }
  r.height = 30
  r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5E4E' } }; c.border = { bottom: { style: 'thin' } } })
  return r
}

// título, subtítulo y nota en las primeras filas de una hoja
export function titulo(ws, texto, sub, nota) {
  ws.getCell('A1').value = texto
  ws.getCell('A1').font = { bold: true, size: 15 }
  if (sub) { ws.getCell('A2').value = sub; ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } } }
  if (nota) { ws.getCell('A3').value = nota; ws.getCell('A3').font = { size: 9, color: { argb: 'FF666666' } } }
}

// REGLA DEL DUEÑO (16 nov): los informes NO llevan links a documentos (voucher, boleta,
// RH, constancia): los documentos se ven solo dentro del sistema.

// la fila de totales: negrita y raya arriba
export function filaTotal(r) {
  r.font = { bold: true }
  r.eachCell(c => { c.border = { top: { style: 'thin' } } })
  return r
}

export async function descargarLibro(wb, nombre) {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
