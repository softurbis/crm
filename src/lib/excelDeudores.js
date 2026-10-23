// INFORME EN EXCEL DE CUOTAS VENCIDAS (22 oct 2026): lo que devuelve
// facturacion_deudores (sql/156) en un libro con una hoja de resumen por proyecto,
// una hoja con todos los lotes con deuda y una hoja por proyecto con cada cuota
// vencida y los datos del cliente. exceljs se carga solo cuando se pide el informe.
const fechaPe = f => f ? String(f).slice(0, 10).split('-').reverse().join('/') : ''
// la fecha como día puro (UTC): Excel la muestra sin hora, sin correrse por la zona horaria
const fechaCelda = f => { if (!f) return null; const [y, m, d] = String(f).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const num = n => (n === null || n === undefined || n === '') ? null : Number(n)
const SOLES = '"S/ "#,##0.00'
const FECHA = 'dd/mm/yyyy'
const nombreHoja = s => String(s || 'Proyecto').replace(/[\\/*?:[\]]/g, ' ').slice(0, 31)

function cabecera(ws, fila, cols) {
  const r = ws.getRow(fila)
  r.values = cols
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  r.alignment = { vertical: 'middle', wrapText: true }
  r.height = 30
  r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E5E4E' } }; c.border = { bottom: { style: 'thin' } } })
  return r
}

export async function descargarExcelDeudores(filas, { usuario = '', titulo = 'Cuotas vencidas' } = {}) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Urbis Control'
  wb.created = new Date()
  const hoy = new Date()
  const proyectos = [...new Set(filas.map(f => f.proyecto))].sort()

  // ---------- RESUMEN ----------
  const res = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] })
  res.columns = [{ width: 34 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }]
  res.getCell('A1').value = titulo.toUpperCase()
  res.getCell('A1').font = { bold: true, size: 15 }
  res.getCell('A2').value = 'Al ' + hoy.toLocaleDateString('es-PE') + (usuario ? ' · ' + usuario : '')
  res.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } }
  res.getCell('A3').value = 'Cuota vencida: ya pasó su fecha, no está pagada y le falta más de S/ 2. Solo ventas vigentes.'
  res.getCell('A3').font = { size: 9, color: { argb: 'FF666666' } }
  cabecera(res, 5, ['Proyecto', 'Lotes con deuda', 'Cuotas vencidas', 'Deuda vencida', 'Saldo por cobrar'])
  let tl = 0, tc = 0, td = 0, ts = 0
  for (const p of proyectos) {
    const fp = filas.filter(f => f.proyecto === p)
    const c = fp.reduce((s, f) => s + Number(f.n_vencidas), 0)
    const d = fp.reduce((s, f) => s + Number(f.deuda_vencida), 0)
    const s = fp.reduce((a, f) => a + Number(f.saldo || 0), 0)
    tl += fp.length; tc += c; td += d; ts += s
    const r = res.addRow([p, fp.length, c, d, s])
    r.getCell(4).numFmt = SOLES; r.getCell(5).numFmt = SOLES
  }
  const tot = res.addRow(['TOTAL', tl, tc, td, ts])
  tot.font = { bold: true }
  tot.getCell(4).numFmt = SOLES; tot.getCell(5).numFmt = SOLES
  tot.eachCell(c => { c.border = { top: { style: 'thin' } } })

  // ---------- LOTES CON DEUDA (todos los proyectos, una fila por venta) ----------
  const lotes = wb.addWorksheet('Lotes con deuda', { views: [{ state: 'frozen', ySplit: 1 }] })
  lotes.columns = [
    { key: 'proyecto', width: 26 }, { key: 'lote', width: 9 }, { key: 'cliente', width: 34 }, { key: 'doc', width: 14 },
    { key: 'tel', width: 13 }, { key: 'tel2', width: 13 }, { key: 'dir', width: 40 }, { key: 'co', width: 28 },
    { key: 'fv', width: 12 }, { key: 'precio', width: 14 }, { key: 'cuota', width: 12 }, { key: 'ncuotas', width: 9 },
    { key: 'pag', width: 9 }, { key: 'nv', width: 9 }, { key: 'desde', width: 12 }, { key: 'dias', width: 9 },
    { key: 'deuda', width: 15 }, { key: 'cobrado', width: 14 }, { key: 'saldo', width: 15 }, { key: 'asesor', width: 20 },
  ]
  cabecera(lotes, 1, ['Proyecto', 'Lote', 'Cliente', 'Documento', 'Celular', 'Celular 2', 'Dirección', 'Co-comprador',
    'Fecha venta', 'Precio', 'Cuota mensual', 'N° cuotas', 'Pagadas', 'Vencidas', 'Vencida desde', 'Días de atraso',
    'Deuda vencida', 'Cobrado', 'Saldo por cobrar', 'Asesor'])
  lotes.autoFilter = 'A1:T1'
  for (const f of filas) {
    const r = lotes.addRow([
      f.proyecto, f.lote, f.cliente, (f.doc_type || 'DNI') + ' ' + (f.doc_number || ''), f.telefono || '', f.telefono2 || '',
      f.direccion || '', f.co_cliente ? f.co_cliente + (f.co_doc_number ? ' (' + f.co_doc_number + ')' : '') : '',
      fechaCelda(f.fecha_venta), num(f.precio), num(f.cuota_mensual), num(f.n_cuotas), num(f.n_pagadas), num(f.n_vencidas),
      fechaCelda(f.vencida_desde), num(f.dias_atraso), num(f.deuda_vencida), num(f.cobrado), num(f.saldo), f.asesor || '',
    ])
    r.getCell(9).numFmt = FECHA; r.getCell(15).numFmt = FECHA
    for (const k of [10, 11, 17, 18, 19]) r.getCell(k).numFmt = SOLES
    r.getCell(17).font = { bold: true, color: { argb: 'FFB00020' } }
  }

  // ---------- UNA HOJA POR PROYECTO: cada cuota vencida con su cliente ----------
  for (const p of proyectos) {
    const ws = wb.addWorksheet(nombreHoja(p), { views: [{ state: 'frozen', ySplit: 3 }] })
    ws.columns = [
      { width: 9 }, { width: 34 }, { width: 14 }, { width: 13 }, { width: 13 }, { width: 40 },
      { width: 8 }, { width: 12 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 10 }, { width: 15 },
    ]
    const fp = filas.filter(f => f.proyecto === p)
    const nc = fp.reduce((s, f) => s + Number(f.n_vencidas), 0)
    const dd = fp.reduce((s, f) => s + Number(f.deuda_vencida), 0)
    ws.getCell('A1').value = p.toUpperCase() + ' · CUOTAS VENCIDAS'
    ws.getCell('A1').font = { bold: true, size: 13 }
    ws.getCell('A2').value = `Al ${hoy.toLocaleDateString('es-PE')} · ${fp.length} lotes · ${nc} cuotas · deuda vencida S/ ${dd.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`
    ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } }
    cabecera(ws, 3, ['Lote', 'Cliente', 'Documento', 'Celular', 'Celular 2', 'Dirección',
      'Cuota N°', 'Venció', 'Días', 'Monto cuota', 'Pagado', 'Saldo cuota', 'Vencidas del lote', 'Deuda del lote'])
    ws.autoFilter = 'A3:N3'
    for (const f of fp) {
      const cuotas = f.cuotas || []
      cuotas.forEach((q, i) => {
        const r = ws.addRow([
          f.lote, f.cliente, (f.doc_type || 'DNI') + ' ' + (f.doc_number || ''), f.telefono || '', f.telefono2 || '', f.direccion || '',
          num(q.n), fechaCelda(q.vence), num(q.dias), num(q.monto), num(q.pagado), num(q.saldo),
          i === 0 ? num(f.n_vencidas) : null, i === 0 ? num(f.deuda_vencida) : null,
        ])
        r.getCell(8).numFmt = FECHA
        for (const k of [10, 11, 12, 14]) r.getCell(k).numFmt = SOLES
        if (i === 0) { r.getCell(1).font = { bold: true }; r.getCell(14).font = { bold: true, color: { argb: 'FFB00020' } } }
        if (i > 0) for (const k of [1, 2, 3, 4, 5, 6]) r.getCell(k).font = { color: { argb: 'FF999999' } }
        if (i === cuotas.length - 1) r.eachCell(c => { c.border = { bottom: { style: 'hair', color: { argb: 'FFBBBBBB' } } } })
      })
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'cuotas-vencidas-' + fechaPe(new Date(Date.now() - 5 * 3600 * 1000).toISOString()).replace(/\//g, '-') + '.xlsx'   // fecha Perú
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
