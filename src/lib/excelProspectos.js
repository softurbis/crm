// PROSPECTOS EN EXCEL (27 nov 2026, pedido de gerencia: "no se pueden exportar los
// prospectos" y "exportar y asignar en bloque, con la fecha del último contacto").
// Baja LO QUE ESTÁ VIENDO en Prospectos (estado, proyecto, vendedor, temperatura y
// búsqueda), sin el tope de 1000 filas: se pide en páginas y en orden fijo. El libro trae:
//   Prospectos   uno por fila, con su vendedor, siguiente paso y último contacto
//   Resumen      cuántos hay por proyecto y estado, y por vendedor
// Solo datos (REGLA del dueño: los Excel no llevan documentos ni links).
import { fechaPe, fechaCelda, diaLima, num, SOLES, FECHA, cabecera, titulo, filaTotal, libroNuevo, descargarLibro, hoyArchivo } from './excelComun'

const ESTADO = { nuevo: 'NUEVO', contactado: 'CONTACTADO', interesado: 'INTERESADO', visita_agendada: 'VISITA AGENDADA', negociacion: 'NEGOCIACIÓN', ganado: 'GANADO', perdido: 'PERDIDO' }
const ORDEN_EST = Object.keys(ESTADO)
const TEMP = { frio: 'FRÍO', tibio: 'TIBIO', caliente: 'CALIENTE' }
const ORIGEN = { referido: 'REFERIDO', feria: 'FERIA O VOLANTEO', walk_in: 'VINO A LA OFICINA', ads: 'PUBLICIDAD / REDES', whatsapp: 'WHATSAPP', otro: 'OTRO' }
const cel = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('51') ? d.slice(2) : d }
const dias = (desde, hasta) => desde ? Math.max(0, Math.floor((new Date(hasta + 'T12:00:00') - new Date(desde + 'T12:00:00')) / 86400000)) : null

// trae TODAS las filas de la consulta (armar() la vuelve a construir en cada página)
export async function traerTodos(armar, porPagina = 1000) {
  const out = []
  for (let desde = 0; ; desde += porPagina) {
    const { data, error } = await armar().range(desde, desde + porPagina - 1)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < porPagina) break
  }
  return out
}

const COLS = [
  ['Nombre', 30], ['Celular', 12], ['Celular 2', 12], ['Proyecto', 24], ['Estado', 16], ['Temperatura', 12], ['Origen', 18],
  ['Vendedor', 22], ['Asignado el', 12], ['Interés', 30], ['Presupuesto', 13], ['Siguiente paso', 34], ['Fecha del paso', 12],
  ['Hora', 8], ['Último contacto', 13], ['Días sin contacto', 10], ['Motivo de pérdida', 26], ['Ya es cliente', 10], ['Entró el', 12],
]

export async function excelProspectos({ filas, nomProy, nomVend, filtro }) {
  const wb = await libroNuevo()
  const hoy = diaLima(new Date().toISOString())

  const ws = wb.addWorksheet('Prospectos', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLS.map(([, width]) => ({ width }))
  cabecera(ws, 1, COLS.map(([t]) => t))
  ws.autoFilter = { from: 'A1', to: { row: 1, column: COLS.length } }
  for (const l of filas) {
    const ult = diaLima(l.ultimo_contacto_at)
    const r = ws.addRow([
      l.full_name || '', cel(l.phone), cel(l.phone2), nomProy(l.project_id) || '', ESTADO[l.status] || (l.status || '').toUpperCase(),
      TEMP[l.temperature] || '', ORIGEN[l.source] || (l.source || '').toUpperCase(), nomVend(l.assigned_to) || 'SIN VENDEDOR',
      fechaCelda(diaLima(l.asignado_at)), l.interes || '', num(l.budget_estimate), l.next_action || '', fechaCelda(l.next_action_date),
      l.next_action_time ? String(l.next_action_time).slice(0, 5) : '', fechaCelda(ult), ult ? dias(ult, hoy) : null,
      l.lost_reason || '', l.client_id ? 'SÍ' : '', fechaCelda(diaLima(l.created_at)),
    ])
    r.getCell(9).numFmt = FECHA; r.getCell(11).numFmt = SOLES; r.getCell(13).numFmt = FECHA; r.getCell(15).numFmt = FECHA; r.getCell(19).numFmt = FECHA
  }
  if (!filas.length) ws.addRow(['No hay prospectos con este filtro.']).font = { italic: true, color: { argb: 'FF666666' } }

  // RESUMEN: por proyecto y estado, y por vendedor
  const rs = wb.addWorksheet('Resumen')
  rs.columns = [{ width: 30 }, ...ORDEN_EST.map(() => ({ width: 13 })), { width: 10 }]
  titulo(rs, 'Prospectos al ' + fechaPe(hoy), filtro || 'Todos los prospectos', 'Sale de Urbis Control → Prospectos, con el filtro que estaba puesto al bajarlo.')
  cabecera(rs, 5, ['Proyecto', ...ORDEN_EST.map(e => ESTADO[e]), 'Total'])
  const porProy = {}
  for (const l of filas) { const k = nomProy(l.project_id) || 'SIN PROYECTO'; (porProy[k] = porProy[k] || {})[l.status] = (porProy[k][l.status] || 0) + 1 }
  for (const [p, c] of Object.entries(porProy).sort()) rs.addRow([p, ...ORDEN_EST.map(e => c[e] || null), Object.values(c).reduce((a, b) => a + b, 0)])
  filaTotal(rs.addRow(['TOTAL', ...ORDEN_EST.map(e => filas.filter(l => l.status === e).length || null), filas.length]))

  rs.addRow([])
  const fv = rs.rowCount + 1
  cabecera(rs, fv, ['Vendedor', 'En seguimiento', 'Sin siguiente paso', 'Paso vencido', 'Ganados', 'Perdidos', 'Total'])
  const ABIERTOS = ['nuevo', 'contactado', 'interesado', 'visita_agendada', 'negociacion']
  const porVend = {}
  for (const l of filas) {
    const k = nomVend(l.assigned_to) || 'SIN VENDEDOR'
    const v = porVend[k] = porVend[k] || { ab: 0, sin: 0, venc: 0, gan: 0, per: 0, tot: 0 }
    v.tot++
    if (ABIERTOS.includes(l.status)) { v.ab++; if (!l.next_action_date) v.sin++; else if (l.next_action_date < hoy) v.venc++ }
    if (l.status === 'ganado') v.gan++
    if (l.status === 'perdido') v.per++
  }
  for (const [k, v] of Object.entries(porVend).sort((a, b) => b[1].tot - a[1].tot)) rs.addRow([k, v.ab, v.sin || null, v.venc || null, v.gan || null, v.per || null, v.tot])

  await descargarLibro(wb, 'prospectos-' + hoyArchivo() + '.xlsx')
}
