// EXPORTAR UNA LISTA A EXCEL (28 nov 2026, pedido de gerencia B6: "exportar a Excel cualquier
// lista: prospectos, tareas, ventas, cobranza, gastos y lotes"). Baja LO QUE ESTÁ VIENDO la
// pantalla (con sus filtros) en una hoja, con cabecera, filtro y totales de las columnas en soles.
// Solo datos (REGLA del dueño: los Excel no llevan documentos ni links).
//   columnas: [{ t: 'Título', w: 14, f: 'soles' | 'fecha' | 'num' | null, v: fila => valor, total: true }]
import { fechaPe, fechaCelda, SOLES, FECHA, cabecera, titulo, filaTotal, libroNuevo, descargarLibro, hoyArchivo, nombreHoja } from './excelComun'

export async function descargarLista({ hoja = 'Lista', tituloLibro, sub, nota, columnas, filas, archivo }) {
  const wb = await libroNuevo()
  const ws = wb.addWorksheet(nombreHoja(hoja), { views: [{ state: 'frozen', ySplit: 5 }] })
  ws.columns = columnas.map(c => ({ width: c.w || 14 }))
  titulo(ws, tituloLibro || hoja, sub || ('Al ' + fechaPe(new Date(Date.now() - 5 * 3600e3).toISOString())), nota || 'Sale de Urbis Control con el filtro que estaba puesto al bajarlo.')
  cabecera(ws, 5, columnas.map(c => c.t))
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: columnas.length } }
  for (const f of filas) {
    const r = ws.addRow(columnas.map(c => {
      const v = c.v(f)
      if (v === undefined || v === null || v === '') return null
      if (c.f === 'fecha') return fechaCelda(v)
      if (c.f === 'soles' || c.f === 'num') return Number(v)
      return v
    }))
    columnas.forEach((c, i) => { if (c.f === 'soles') r.getCell(i + 1).numFmt = SOLES; if (c.f === 'fecha') r.getCell(i + 1).numFmt = FECHA })
  }
  if (!filas.length) ws.addRow(['No hay filas con este filtro.']).font = { italic: true, color: { argb: 'FF666666' } }
  else if (columnas.some(c => c.total)) {
    const r = ws.addRow(columnas.map((c, i) => i === 0 ? 'TOTAL (' + filas.length + ')' : c.total ? filas.reduce((s, f) => s + (Number(c.v(f)) || 0), 0) : null))
    columnas.forEach((c, i) => { if (c.total && c.f === 'soles') r.getCell(i + 1).numFmt = SOLES })
    filaTotal(r)
  }
  await descargarLibro(wb, (archivo || hoja).replace(/[\\/:*?"<>|]/g, ' ') + ' ' + hoyArchivo() + '.xlsx')
}
