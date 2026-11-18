// EXCEL DE LAS FACTURAS DE GASTOS (sql/233, 18 nov 2026): lo que Victor y Alex
// emitieron en el mes, una hoja por emisor, para declararlo con su contador.
// REGLA DEL DUEÑO: solo datos y montos; ni PDF ni links (lib/excelComun).
import { libroNuevo, cabecera, titulo, filaTotal, descargarLibro, fechaCelda, num, nombreHoja, SOLES, FECHA } from './excelComun'

const ESTADO = {
  aceptado: 'ACEPTADA', firmado: 'EMITIDA', en_sunat: 'EN SUNAT', por_anular: 'ANULÁNDOSE',
  anulado: 'ANULADA', rechazado: 'RECHAZADA', pendiente: 'EN COLA', emitiendo: 'EMITIENDO', error: 'REINTENTANDO',
}
// cuenta como emitida con valor (lo que se declara): aceptada o todavía viajando. La
// anulada CON NOTA DE CRÉDITO también: valió, y la nota (en negativo) es la que la
// deshace; la anulada con baja (dentro de los 7 días) no cuenta nunca.
const conValor = c => c.ambiente === 'produccion'
  && (['aceptado', 'firmado', 'en_sunat', 'por_anular'].includes(c.estado) || (c.estado === 'anulado' && !!c.nota_id))

// facturas: las del mes (de cualquier emisor) · emisores: fact_emisores_gasto
// proyectos: { id: nombre } · mes: 'AAAA-MM'
export async function descargarExcelFacturasGasto(facturas, { emisores = [], proyectos = {}, mes = '' } = {}) {
  const wb = await libroNuevo()
  const [a, m] = mes.split('-')
  const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
  const nombreMes = m ? MESES[Number(m) - 1] + ' ' + a : ''
  // las pruebas (ambiente beta) no van: no tienen valor tributario
  const reales = facturas.filter(c => c.ambiente === 'produccion' && c.numero != null)
  const porRuc = new Map()
  for (const c of reales) { if (!porRuc.has(c.ruc)) porRuc.set(c.ruc, []); porRuc.get(c.ruc).push(c) }
  if (!porRuc.size) porRuc.set('', [])

  for (const [ruc, lista] of porRuc) {
    const em = emisores.find(e => e.ruc === ruc)
    const ws = wb.addWorksheet(nombreHoja(em ? em.nombre + ' ' + ruc : 'Sin facturas'))
    titulo(ws, 'FACTURAS EMITIDAS POR GASTOS' + (nombreMes ? ' — ' + nombreMes : ''),
      em ? em.razon_social + ' · RUC ' + ruc : 'No hay facturas reales en este mes',
      'Exoneradas de IGV (Amazonía). Las anuladas con baja y las rechazadas no suman. La anulada con nota de crédito suma, y la nota va en su fila, en negativo.')
    cabecera(ws, 5, ['Fecha', 'Comprobante', 'Tipo', 'Cliente (dueño del proyecto)', 'RUC del cliente', 'Proyecto', 'Detalle', 'Op. exonerada', 'IGV', 'Total', 'Estado'])
    ws.columns = [{ width: 12 }, { width: 13 }, { width: 15 }, { width: 38 }, { width: 14 }, { width: 28 }, { width: 60 }, { width: 14 }, { width: 9 }, { width: 14 }, { width: 13 }]
    let fila = 6, suma = 0
    for (const c of [...lista].sort((x, y) => String(x.fecha_emision).localeCompare(String(y.fecha_emision)) || (x.numero - y.numero))) {
      const nota = c.tipo === 'nota_credito'
      const signo = nota ? -1 : 1
      const vale = conValor(c)
      if (vale) suma += signo * Number(c.total || 0)
      const r = ws.getRow(fila++)
      r.values = [
        fechaCelda(c.fecha_emision), c.serie + '-' + c.numero, nota ? 'NOTA DE CRÉDITO' + (c.ref_serie ? ' (' + c.ref_serie + '-' + c.ref_numero + ')' : '') : 'FACTURA',
        c.cliente_nombre, c.cliente_numero, proyectos[c.project_id] || '',
        (c.items || []).map(i => i.descripcion).join(' | '),
        num(vale ? signo * Number(c.exoneradas ?? c.total) : 0), num(vale ? signo * Number(c.igv || 0) : 0), num(signo * Number(c.total || 0)),
        c.estado === 'anulado' && c.nota_id ? 'ANULADA CON NOTA' : (ESTADO[c.estado] || c.estado),
      ]
      r.getCell(1).numFmt = FECHA
      ;[8, 9, 10].forEach(k => { r.getCell(k).numFmt = SOLES })
      r.getCell(7).alignment = { wrapText: true, vertical: 'top' }
      if (!vale) r.font = { color: { argb: 'FF999999' } }
    }
    const t = ws.getRow(fila + 1)
    t.values = ['', '', '', '', '', '', 'TOTAL CON VALOR (' + lista.filter(conValor).length + ' comprobantes)', null, null, num(suma), '']
    t.getCell(10).numFmt = SOLES
    filaTotal(t)
  }
  const quien = porRuc.size === 1 ? (emisores.find(e => porRuc.has(e.ruc))?.nombre || '') : ''
  await descargarLibro(wb, 'facturas-de-gastos' + (quien ? '-' + quien.toLowerCase() : '') + (mes ? '-' + mes : '') + '.xlsx')
}
