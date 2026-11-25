// CUOTAS DEL MES EN EXCEL (24 nov 2026; rehecho 25 nov): botón 📥 de la pantalla Pagos,
// solo para el superusuario y el operador. Se elige un mes y uno o todos los proyectos.
// Hojas:
//   Resumen          las DOS cifras del mes, separadas y explicadas con sus números:
//                    (A) DINERO QUE ENTRÓ en el mes (la caja: todo lo depositado ese mes)
//                    (B) COBRADO DE LAS CUOTAS QUE VENCÍAN en el mes (pagado en cualquier fecha)
//                    y el "puente" entre las dos (25 nov: el dueño no entendía por qué agosto
//                    daba 18 mil en una y 21 mil en la otra). Luego, las dos por proyecto.
//   Leyenda          qué significa cada cifra, hoja, estado, columna y cómo filtrar
//   Cuotas del mes   cada cuota que VENCE en el mes: cuánto se pagó en el mes, antes y
//                    después, su estado y el link al voucher
//   Pagos del mes    cada depósito que ENTRÓ en el mes, con "qué se pagó" (cuota del mes,
//                    atrasada, adelantada, inicial...) y su link
// En las hojas de detalle la fila 2 suma SOLO lo filtrado (SUBTOTAL).
// LINKS: el dueño los pidió para este informe (uso interno: superusuario y operador).
// Los Excel de la secretaria de la socia siguen SIN links (regla del 16 nov).
import { supabase } from './supabase'
import { fechaPe, fechaCelda, diaLima, num, SOLES, FECHA, libroNuevo, descargarLibro } from './excelComun'

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
const r2 = n => Math.round(Number(n || 0) * 100) / 100
const loteDe = l => l ? l.mz + '-' + l.lt : ''
const sol = n => 'S/ ' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PASO = 1000

// ---------- colores ----------
const VERDE = 'FF2E5E4E', BORDE = { style: 'thin', color: { argb: 'FFD5DED9' } }
const ESTADO = {   // estado de una cuota: [fondo, letra]
  'PAGADA': ['FFE3F3E7', 'FF1E7B34'],
  'PARCIAL': ['FFFFF1DC', 'FF9A5500'],
  'PARCIAL · VENCIDA': ['FFFDE4E7', 'FFB00020'],
  'VENCIDA': ['FFFDE4E7', 'FFB00020'],
  'POR VENCER': ['FFEDF0F3', 'FF555555'],
}
const CLASE = {    // qué se pagó con un depósito: [fondo, letra]
  'CUOTA DEL MES': ['FFE3F3E7', 'FF1E7B34'],
  'CUOTA ATRASADA': ['FFFFF1DC', 'FF9A5500'],
  'CUOTA ADELANTADA': ['FFE3EEFB', 'FF1C5DA8'],
  'INICIAL': ['FFF0E6F8', 'FF6A3A94'],
  'SEPARACIÓN': ['FFEDF0F3', 'FF44515E'],
  'MORA / OTRO': ['FFEDF0F3', 'FF555555'],
  'VENTA EXPROPIADA': ['FFF2F2F2', 'FF8A8A8A'],
}
const CUANDO = {
  'EN EL MES': ['FFE3F3E7', 'FF1E7B34'],
  'ANTES (ADELANTO)': ['FFE3EEFB', 'FF1C5DA8'],
  'DESPUÉS (CON ATRASO)': ['FFFFF1DC', 'FF9A5500'],
  'EN PARTES': ['FFEDF0F3', 'FF44515E'],
  'SIN FECHA (MIGRADO)': ['FFF2F2F2', 'FF8A8A8A'],
}

// '2026-11' → primer y último día del mes
export function rangoMes(mes) {
  const [y, m] = mes.split('-').map(Number)
  const fin = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { desde: mes + '-01', hasta: mes + '-' + String(fin).padStart(2, '0'), nombre: MESES[m - 1] + ' ' + y, mesSolo: MESES[m - 1].toLowerCase() }
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
  // 1) las cuotas que vencen en el mes, de ventas vivas (no expropiadas ni anuladas).
  //    La venta tiene comprador y co-comprador: se nombra el enlace al comprador.
  const cuotas = await todas(() => supabase.from('installments')
    .select('id, installment_number, due_date, amount, amount_paid, paid_date, status, sale:sales!inner(id, status, installments_count, lot:lots!inner(mz, lt, project_id), client:clients!sales_client_id_fkey(full_name, doc_type, doc_number, phone))')
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

  // 3) todo lo que entró en el mes, de cualquier concepto
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

// qué se pagó con un depósito que entró en el mes
function claseDe(p, desde, hasta, idsMes) {
  if (p.sale?.status === 'expropiado') return 'VENTA EXPROPIADA'
  if (p.income_type === 'cuota' && p.installment?.due_date) {
    if (p.installment.due_date < desde) return 'CUOTA ATRASADA'
    if (p.installment.due_date > hasta) return 'CUOTA ADELANTADA'
    if (idsMes.has(p.installment_id)) return 'CUOTA DEL MES'
  }
  if (p.income_type === 'inicial') return 'INICIAL'
  if (p.income_type === 'separacion') return 'SEPARACIÓN'
  return 'MORA / OTRO'
}

// ---------- ayudas de formato ----------
function pintar(celda, [fondo, letra], negrita = true) {
  celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fondo } }
  celda.font = { bold: negrita, color: { argb: letra } }
  celda.alignment = { horizontal: 'center', vertical: 'middle' }
}
function banda(ws, fila, texto, nCols, { size = 15, fondo = VERDE, letra = 'FFFFFFFF', alto = 32 } = {}) {
  ws.mergeCells(fila, 1, fila, nCols)
  const c = ws.getCell(fila, 1)
  c.value = texto
  c.font = { bold: true, size, color: { argb: letra } }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fondo } }
  c.alignment = { vertical: 'middle', indent: 1, wrapText: true }
  ws.getRow(fila).height = alto
}
function texto(ws, fila, t, nCols, { alto = 18, gris = true, negrita = false, size = 10, col = 1 } = {}) {
  if (nCols > col) ws.mergeCells(fila, col, fila, nCols)
  const c = ws.getCell(fila, col)
  c.value = t
  c.font = { size, bold: negrita, italic: gris && !negrita, color: { argb: gris ? 'FF5F6B66' : 'FF222222' } }
  c.alignment = { vertical: 'top', wrapText: true }
  ws.getRow(fila).height = alto
}
function encabezado(ws, fila, cols) {
  const r = ws.getRow(fila)
  r.values = cols
  r.height = 32
  r.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE } }
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    c.border = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE }
  })
  return r
}
function rayas(fila, n, i) {
  for (let k = 1; k <= n; k++) {
    const c = fila.getCell(k)
    c.border = { top: BORDE, bottom: BORDE, left: BORDE, right: BORDE }
    if (i % 2 && !c.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6F9F7' } }
  }
  fila.alignment = { vertical: 'middle' }
}
function total(fila, n) {
  for (let k = 1; k <= n; k++) {
    const c = fila.getCell(k)
    c.font = { ...(c.font || {}), bold: true }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4ECE8' } }
    c.border = { top: { style: 'medium', color: { argb: VERDE } }, bottom: BORDE, left: BORDE, right: BORDE }
  }
}
// un hipervínculo clicable (o vacío si no hay documento)
function link(celda, url, t) {
  if (!url) return
  celda.value = { text: t, hyperlink: url }
  celda.font = { color: { argb: 'FF1155CC' }, underline: true }
  celda.alignment = { horizontal: 'center' }
}
const letra = n => { let s = ''; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
// fila 2 de las hojas de detalle: totales que cambian con los filtros
function filaFiltrada(ws, cols, desde, hasta, sumas, cuenta) {
  const f = ws.getRow(2)
  f.height = 22
  f.getCell(1).value = '▼ TOTAL DE LO QUE SE VE (cambia al filtrar)'
  ws.mergeCells(2, 1, 2, 4)
  f.getCell(5).value = { formula: `SUBTOTAL(3,A${desde}:A${hasta})`, result: cuenta }
  f.getCell(5).numFmt = '0 "filas"'
  for (const [col, res] of sumas) {
    const L = letra(col)
    f.getCell(col).value = { formula: `SUBTOTAL(9,${L}${desde}:${L}${hasta})`, result: r2(res) }
    f.getCell(col).numFmt = SOLES
  }
  for (let k = 1; k <= cols.length; k++) {
    const c = f.getCell(k)
    c.font = { bold: true, color: { argb: 'FF1E3D33' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCEAE3' } }
    c.border = { bottom: { style: 'medium', color: { argb: VERDE } } }
  }
}
const apaisado = ws => { ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } }

export async function descargarExcelCuotasMes({ mes, proyectos, usuario = '' }) {
  const { desde, hasta, nombre, mesSolo } = rangoMes(mes)
  const pids = proyectos.map(p => p.id)
  const nombreDe = Object.fromEntries(proyectos.map(p => [p.id, p.name]))
  const { cuotas, deCuotas, delMes } = await traerDatos(pids, desde, hasta)
  const hoy = diaLima(new Date().toISOString())
  const unSolo = proyectos.length === 1
  const idsMes = new Set(cuotas.map(c => c.id))

  // ---------- cada cuota: cuánto se pagó en el mes, antes y después ----------
  const pagosDe = {}
  for (const p of deCuotas) if (p.sale?.status !== 'expropiado') (pagosDe[p.installment_id] ||= []).push(p)
  const lista = cuotas.map(c => {
    const pagos = pagosDe[c.id] || []
    const suma = f => r2(pagos.filter(f).reduce((s, p) => s + Number(p.amount), 0))
    const en = suma(p => p.date >= desde && p.date <= hasta)
    const antes = suma(p => p.date < desde)
    const despues = suma(p => p.date > hasta)
    // lo pagado que no tiene depósito registrado (cargas migradas): sin fecha
    const sinFecha = Math.max(0, r2(Math.min(Number(c.amount_paid), Number(c.amount)) - en - antes - despues))
    const cobrado = r2(en + antes + despues + sinFecha)
    const partes = [['EN EL MES', en], ['ANTES (ADELANTO)', antes], ['DESPUÉS (CON ATRASO)', despues], ['SIN FECHA (MIGRADO)', sinFecha]].filter(([, v]) => v > 0.009)
    const cuando = !partes.length ? '' : partes.length > 1 ? 'EN PARTES' : partes[0][0]
    return { c, pid: c.sale.lot.project_id, pagos, en, antes, despues, sinFecha, cobrado, cuando,
      estado: estadoCuota(c, hoy), saldo: Math.max(0, r2(Number(c.amount) - Number(c.amount_paid))) }
  }).sort((a, b) => String(nombreDe[a.pid]).localeCompare(String(nombreDe[b.pid])) || a.c.due_date.localeCompare(b.c.due_date)
    || String(a.c.sale.lot.mz).localeCompare(String(b.c.sale.lot.mz)) || Number(a.c.sale.lot.lt) - Number(b.c.sale.lot.lt))

  // ---------- cada depósito del mes: qué se pagó ----------
  const entradas = delMes.map(p => ({ p, clase: claseDe(p, desde, hasta, idsMes) }))
    .sort((a, b) => a.p.date.localeCompare(b.p.date) || String(nombreDe[a.p.project_id]).localeCompare(String(nombreDe[b.p.project_id])))

  // ---------- las cifras ----------
  const S = (l, f) => r2(l.reduce((s, x) => s + Number(f(x) || 0), 0))
  const cifras = (lc, le) => {
    const porClase = Object.fromEntries(Object.keys(CLASE).map(k => [k, S(le.filter(x => x.clase === k), x => x.p.amount)]))
    return {
      entro: S(le, x => x.p.amount), porClase,
      n: lc.length, esperado: S(lc, x => x.c.amount), en: S(lc, x => x.en), antes: S(lc, x => x.antes), despues: S(lc, x => x.despues),
      sinFecha: S(lc, x => x.sinFecha), cobrado: S(lc, x => x.cobrado), saldo: S(lc, x => x.saldo),
      pagadas: lc.filter(x => x.estado === 'PAGADA').length, parciales: lc.filter(x => x.estado.startsWith('PARCIAL')).length,
      vencidas: lc.filter(x => x.estado === 'VENCIDA').length, porVencer: lc.filter(x => x.estado === 'POR VENCER').length,
    }
  }
  const T = cifras(lista, entradas)
  const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0

  const wb = await libroNuevo()

  // =====================================================================
  // RESUMEN
  // =====================================================================
  const res = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }], properties: { tabColor: { argb: VERDE } } })
  const NC = 9
  res.columns = [{ width: 40 }, { width: 17 }, ...Array(NC - 2).fill({ width: 15 })]
  apaisado(res)
  banda(res, 1, 'COBRANZA DE ' + nombre + ' · ' + (unSolo ? proyectos[0].name.toUpperCase() : 'TODOS LOS PROYECTOS (' + proyectos.length + ')'), NC, { size: 16, alto: 36 })
  texto(res, 2, 'Mes: del ' + fechaPe(desde) + ' al ' + fechaPe(hasta) + ' · datos al ' + fechaPe(hoy) + (usuario ? ' · bajado por ' + usuario : '') + '   👉 ¿Dudas con algún término? Mira la hoja LEYENDA.', NC)

  // --- las cifras grandes ---
  let f = 4
  banda(res, f++, 'LAS CIFRAS DEL MES', NC, { size: 12, fondo: 'FFDCEAE3', letra: 'FF1E3D33', alto: 24 })
  const grande = (etq, valor, expl, color, fmt = SOLES) => {
    const r = res.getRow(f)
    r.getCell(1).value = etq
    r.getCell(1).font = { bold: true, size: 11 }
    r.getCell(1).alignment = { vertical: 'middle', wrapText: true }
    r.getCell(2).value = valor
    r.getCell(2).numFmt = fmt
    r.getCell(2).font = { bold: true, size: 14, color: { argb: color } }
    r.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' }
    res.mergeCells(f, 3, f, NC)
    r.getCell(3).value = expl
    r.getCell(3).font = { size: 9, color: { argb: 'FF5F6B66' } }
    r.getCell(3).alignment = { vertical: 'middle', wrapText: true, indent: 1 }
    r.height = 34
    for (let k = 1; k <= NC; k++) r.getCell(k).border = { bottom: BORDE }
    f++
  }
  grande('💰 DINERO QUE ENTRÓ EN ' + MESES[Number(mes.slice(5)) - 1], T.entro,
    'Todo lo que se depositó entre el ' + fechaPe(desde) + ' y el ' + fechaPe(hasta) + ': cuotas de este mes, cuotas atrasadas, adelantos, iniciales y separaciones. Es la CAJA del mes. Detalle: hoja "Pagos del mes".', 'FF1E7B34')
  grande('📅 CUOTAS QUE VENCÍAN EN ' + MESES[Number(mes.slice(5)) - 1] + ' (lo esperado)', T.esperado,
    T.n + ' cuotas con fecha de vencimiento en ' + mesSolo + '. Es lo que los clientes debían pagar este mes. Detalle: hoja "Cuotas del mes".', 'FF222222')
  grande('✅ COBRADO DE ESAS CUOTAS', T.cobrado,
    'Lo pagado de esas ' + T.n + ' cuotas, SIN IMPORTAR CUÁNDO se pagó: antes de ' + mesSolo + ' (adelantos), en ' + mesSolo + ' o después (con atraso, hasta hoy).', 'FF1C5DA8')
  grande('⏳ FALTA COBRAR DE ESAS CUOTAS', T.saldo,
    'Lo que todavía deben de las cuotas de ' + mesSolo + ' (' + (T.vencidas + T.parciales) + ' cuotas vencidas o a medias' + (T.porVencer ? ', ' + T.porVencer + ' aún por vencer' : '') + ').', T.saldo > 0 ? 'FFB00020' : 'FF1E7B34')
  grande('📊 CUMPLIMIENTO', pct(T.cobrado, T.esperado) / 100,
    'Cobrado ÷ esperado. ' + T.pagadas + ' de ' + T.n + ' cuotas están pagadas completas.', 'FF222222', '0.0%')

  // --- por qué no coinciden ---
  f++
  banda(res, f++, '¿POR QUÉ "ENTRÓ EN EL MES" Y "COBRADO DE LAS CUOTAS" NO SON IGUALES?', NC, { size: 12, fondo: 'FFDCEAE3', letra: 'FF1E3D33', alto: 24 })
  texto(res, f++, 'Son dos preguntas distintas. Solo comparten una parte: lo pagado EN ' + mesSolo + ' de cuotas DE ' + mesSolo + ' (' + sol(T.en) + ', resaltado en verde en las dos tablas). '
    + 'En ' + mesSolo + ' también entró dinero de cuotas de otros meses, iniciales y separaciones; y las cuotas de ' + mesSolo + ' también se pagaron antes o después del mes.', NC, { alto: 44, gris: false })
  const puente = (tit, filas, tot, totEtq) => {
    encabezado(res, f, [tit, 'Monto', 'Qué es'])
    res.mergeCells(f, 3, f, NC)
    f++
    filas.forEach(([etq, v, expl, comun], i) => {
      const r = res.getRow(f)
      r.getCell(1).value = etq; r.getCell(2).value = v; r.getCell(2).numFmt = SOLES
      res.mergeCells(f, 3, f, NC)
      r.getCell(3).value = expl; r.getCell(3).font = { size: 9, color: { argb: 'FF5F6B66' } }; r.getCell(3).alignment = { wrapText: true, vertical: 'middle' }
      r.height = 28
      rayas(r, NC, i)
      if (comun) for (const k of [1, 2]) { r.getCell(k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD7F0DD' } }; r.getCell(k).font = { bold: true, color: { argb: 'FF1E7B34' } } }
      f++
    })
    const r = res.getRow(f)
    r.getCell(1).value = totEtq; r.getCell(2).value = tot; r.getCell(2).numFmt = SOLES
    res.mergeCells(f, 3, f, NC)
    total(r, NC)
    f += 2
  }
  const C = T.porClase
  puente('💰 DINERO QUE ENTRÓ EN ' + MESES[Number(mes.slice(5)) - 1] + ', ¿de qué fue?', [
    ['Cuotas de ' + mesSolo + ' pagadas en ' + mesSolo, C['CUOTA DEL MES'], 'La parte en común con la otra tabla.', true],
    ['Cuotas atrasadas (de meses anteriores)', C['CUOTA ATRASADA'], 'Clientes que en ' + mesSolo + ' pagaron cuotas que vencían antes.'],
    ['Cuotas adelantadas (de meses siguientes)', C['CUOTA ADELANTADA'], 'Clientes que en ' + mesSolo + ' pagaron cuotas que vencen después.'],
    ['Iniciales', C['INICIAL'], 'Pagos iniciales de ventas.'],
    ['Separaciones', C['SEPARACIÓN'], 'Pagos para separar un lote.'],
    ['Mora y otros', C['MORA / OTRO'], 'Moras y pagos que no son cuota, inicial ni separación.'],
    ...(C['VENTA EXPROPIADA'] ? [['De ventas que luego se expropiaron', C['VENTA EXPROPIADA'], 'Entraron en el mes, pero la venta ya está expropiada.']] : []),
  ], T.entro, 'TOTAL QUE ENTRÓ EN ' + MESES[Number(mes.slice(5)) - 1])
  puente('✅ COBRADO DE LAS CUOTAS DE ' + MESES[Number(mes.slice(5)) - 1] + ', ¿cuándo se pagó?', [
    ['Pagado en ' + mesSolo, T.en, 'La parte en común con la otra tabla.', true],
    ['Pagado antes de ' + mesSolo + ' (adelanto)', T.antes, 'El cliente pagó esta cuota por adelantado, en un mes anterior.'],
    ['Pagado después de ' + mesSolo + ' (con atraso)', T.despues, 'El cliente pagó con atraso, en un mes posterior (hasta hoy).'],
    ...(T.sinFecha ? [['Pagado sin fecha registrada', T.sinFecha, 'Cuotas de datos migrados: figuran pagadas pero sin depósito cargado en el sistema.']] : []),
  ], T.cobrado, 'TOTAL COBRADO DE LAS CUOTAS DE ' + MESES[Number(mes.slice(5)) - 1])

  // --- por proyecto ---
  const tablaProy = (tit, cols, filaDe, fmts) => {
    banda(res, f++, tit, NC, { size: 12, fondo: 'FFDCEAE3', letra: 'FF1E3D33', alto: 24 })
    encabezado(res, f++, cols)
    const filas = proyectos.map(p => ({ p, d: cifras(lista.filter(x => x.pid === p.id), entradas.filter(x => x.p.project_id === p.id)) }))
    filas.forEach(({ p, d }, i) => {
      const r = res.getRow(f++)
      r.values = [p.name, ...filaDe(d)]
      fmts.forEach((fm, k) => { if (fm) r.getCell(k + 2).numFmt = fm })
      rayas(r, cols.length, i)
    })
    if (!unSolo) {
      const r = res.getRow(f++)
      r.values = ['TOTAL', ...filaDe(T)]
      fmts.forEach((fm, k) => { if (fm) r.getCell(k + 2).numFmt = fm })
      total(r, cols.length)
    }
    f++
  }
  tablaProy('💰 DINERO QUE ENTRÓ EN EL MES, POR PROYECTO',
    ['Proyecto', 'Cuotas del mes', 'Cuotas atrasadas', 'Cuotas adelantadas', 'Iniciales', 'Separaciones', 'Mora y otros', 'Expropiadas', 'TOTAL ENTRÓ'],
    d => [d.porClase['CUOTA DEL MES'], d.porClase['CUOTA ATRASADA'], d.porClase['CUOTA ADELANTADA'], d.porClase['INICIAL'], d.porClase['SEPARACIÓN'], d.porClase['MORA / OTRO'], d.porClase['VENTA EXPROPIADA'], d.entro],
    Array(8).fill(SOLES))
  tablaProy('📅 CUOTAS QUE VENCÍAN EN EL MES, POR PROYECTO',
    ['Proyecto', 'N° cuotas', 'Esperado', 'Pagado en el mes', 'Pagado antes', 'Pagado después', 'Total cobrado', 'Falta cobrar', '% cobrado'],
    d => [d.n, d.esperado, d.en, d.antes, d.despues + d.sinFecha, d.cobrado, d.saldo, pct(d.cobrado, d.esperado) / 100],
    ['0', SOLES, SOLES, SOLES, SOLES, SOLES, SOLES, '0.0%'])
  tablaProy('🚦 ESTADO DE LAS CUOTAS DEL MES, POR PROYECTO',
    ['Proyecto', 'N° cuotas', 'Pagadas', 'Parciales', 'Vencidas', 'Por vencer'],
    d => [d.n, d.pagadas, d.parciales, d.vencidas, d.porVencer],
    ['0', '0', '0', '0', '0'])

  // =====================================================================
  // LEYENDA
  // =====================================================================
  const ley = wb.addWorksheet('Leyenda', { views: [{ showGridLines: false }], properties: { tabColor: { argb: 'FF1C5DA8' } } })
  ley.columns = [{ width: 30 }, { width: 100 }]
  apaisado(ley)
  banda(ley, 1, 'LEYENDA · CÓMO LEER ESTE EXCEL', 2, { size: 16, alto: 36 })
  let lf = 3
  const grupo = (tit, items, colores) => {
    banda(ley, lf++, tit, 2, { size: 11, fondo: 'FFDCEAE3', letra: 'FF1E3D33', alto: 22 })
    items.forEach(([t, d], i) => {
      const r = ley.getRow(lf++)
      r.getCell(1).value = t; r.getCell(2).value = d
      r.getCell(1).font = { bold: true }
      r.getCell(2).alignment = { wrapText: true, vertical: 'middle' }
      r.height = Math.max(20, Math.ceil(d.length / 105) * 15 + 6)
      rayas(r, 2, i)
      if (colores?.[t]) pintar(r.getCell(1), colores[t])
    })
    lf++
  }
  grupo('LAS DOS CIFRAS PRINCIPALES (no son iguales y está bien)', [
    ['💰 Dinero que entró en el mes', 'Todo lo que se DEPOSITÓ dentro del mes, sea de la cuota que sea (de este mes, atrasada o adelantada), iniciales y separaciones. Es la caja: lo que llegó al banco ese mes.'],
    ['📅 Cuotas que vencían en el mes', 'Las cuotas cuya fecha de vencimiento cae dentro del mes, y cuánto suman. Es lo que se esperaba cobrar.'],
    ['✅ Cobrado de esas cuotas', 'Cuánto se ha pagado de esas cuotas, en CUALQUIER fecha: antes del mes (adelanto), dentro del mes o después (con atraso, hasta el día en que se baja el Excel). Por eso un mes viejo puede mostrar más cobrado que dinero entrado.'],
    ['⏳ Falta cobrar', 'Lo que todavía se debe de las cuotas del mes.'],
    ['Ejemplo', 'Una cuota de agosto pagada el 10 de setiembre suma en "Cobrado de las cuotas de agosto", pero NO en "Dinero que entró en agosto" (entró en setiembre). Una cuota de julio pagada el 5 de agosto suma en "Dinero que entró en agosto" como cuota atrasada, pero no en las cuotas de agosto.'],
  ])
  grupo('LAS HOJAS', [
    ['Resumen', 'Las cifras del mes, por qué no coinciden y lo mismo separado por proyecto.'],
    ['Cuotas del mes', 'Una fila por cada cuota que vence en el mes: cliente, lote, monto, cuánto se pagó (en el mes, antes, después), lo que falta, el estado y los links al voucher y la boleta.'],
    ['Pagos del mes', 'Una fila por cada depósito que entró en el mes, con "Qué se pagó" y los links.'],
  ])
  grupo('ESTADO DE UNA CUOTA (hoja Cuotas del mes)', [
    ['PAGADA', 'La cuota está pagada completa.'],
    ['PARCIAL', 'Se pagó una parte y todavía no vence.'],
    ['PARCIAL · VENCIDA', 'Se pagó una parte y ya pasó su fecha de vencimiento.'],
    ['VENCIDA', 'No se pagó nada y ya pasó su fecha de vencimiento.'],
    ['POR VENCER', 'No se pagó nada, pero su fecha de vencimiento todavía no llega.'],
  ], ESTADO)
  grupo('CUÁNDO SE PAGÓ (hoja Cuotas del mes)', [
    ['EN EL MES', 'Se pagó dentro del mes en que vencía.'],
    ['ANTES (ADELANTO)', 'Se pagó en un mes anterior a su vencimiento.'],
    ['DESPUÉS (CON ATRASO)', 'Se pagó en un mes posterior a su vencimiento.'],
    ['EN PARTES', 'Se pagó con varios depósitos en distintos momentos (mira las columnas "Pagado en el mes / antes / después").'],
    ['SIN FECHA (MIGRADO)', 'Figura pagada, pero viene de los datos migrados y no tiene su depósito cargado en el sistema.'],
  ], CUANDO)
  grupo('QUÉ SE PAGÓ (hoja Pagos del mes)', [
    ['CUOTA DEL MES', 'Cuota que vence en este mismo mes.'],
    ['CUOTA ATRASADA', 'Cuota que vencía en un mes anterior.'],
    ['CUOTA ADELANTADA', 'Cuota que vence en un mes siguiente.'],
    ['INICIAL', 'Pago inicial de una venta.'],
    ['SEPARACIÓN', 'Pago para separar un lote.'],
    ['MORA / OTRO', 'Mora u otro concepto.'],
    ['VENTA EXPROPIADA', 'Pago de una venta que ya está expropiada (sale en gris).'],
  ], CLASE)
  grupo('COLUMNAS', [
    ['Cuota', '"5 de 48" = quinta cuota de un cronograma de 48.'],
    ['Monto cuota', 'Lo que vale la cuota según el cronograma.'],
    ['Pagado en el mes / antes / después', 'Cuánto de la cuota se pagó dentro del mes, en meses anteriores (adelanto) o en meses posteriores (con atraso).'],
    ['Total pagado', 'La suma de lo anterior (más lo "sin fecha" de los datos migrados).'],
    ['Falta', 'Monto cuota menos lo pagado.'],
    ['Voucher / Voucher 2', 'VER abre la foto del depósito. Si la cuota se pagó con dos depósitos, el segundo va en "Voucher 2" (todos están en la hoja Pagos del mes).'],
    ['Boleta / factura', 'VER abre la boleta o factura subida al sistema.'],
    ['N° operación', 'El número de operación del depósito (para buscarlo en el banco).'],
  ])
  grupo('CÓMO FILTRAR', [
    ['Las flechas ▼', 'En las hojas "Cuotas del mes" y "Pagos del mes" cada título tiene una flechita ▼. Tócala para ver, por ejemplo, solo un proyecto, solo las VENCIDAS o solo las CUOTA ATRASADA.'],
    ['Fila de totales', 'La fila verde de arriba (debajo del título) suma SOLO lo que se ve: al filtrar, los totales cambian solos.'],
    ['Quitar filtros', 'En Excel: pestaña Datos → Borrar. En el celular: toca la flechita y elige "Seleccionar todo".'],
  ])

  // =====================================================================
  // CUOTAS DEL MES
  // =====================================================================
  const cols = [['Proyecto', 24], ['Lote', 8], ['Cliente', 32], ['N° documento', 13], ['Celular', 12], ['Cuota', 9], ['Vence', 11], ['Monto cuota', 13],
    ['Pagado en el mes', 13], ['Pagado antes', 13], ['Pagado después', 13], ['Total pagado', 13], ['Falta', 13], ['Estado', 17], ['Cuándo se pagó', 20],
    ['Fecha(s) de pago', 14], ['N° operación', 18], ['Cuenta / banco', 22], ['Voucher', 9], ['Voucher 2', 9], ['Boleta / factura', 10]]
  const ws = wb.addWorksheet('Cuotas del mes (' + lista.length + ')', { views: [{ state: 'frozen', ySplit: 3, xSplit: 3 }], properties: { tabColor: { argb: 'FF9A5500' } } })
  ws.columns = cols.map(([, width]) => ({ width }))
  apaisado(ws)
  banda(ws, 1, 'CUOTAS QUE VENCEN EN ' + nombre + ' · ' + (unSolo ? proyectos[0].name.toUpperCase() : 'TODOS LOS PROYECTOS') + ' · usa las flechas ▼ para filtrar', cols.length, { size: 13, alto: 28 })
  encabezado(ws, 3, cols.map(([t]) => t))
  const ini = 4
  if (!lista.length) ws.addRow(['No hay cuotas que venzan en ' + mesSolo + '.']).font = { italic: true, color: { argb: 'FF666666' } }
  lista.forEach((x, i) => {
    const { c } = x, cl = c.sale.client || {}
    const vouchers = [...new Set(x.pagos.map(p => p.voucher_url).filter(Boolean))]
    const boleta = x.pagos.map(p => p.receipt_url).find(Boolean)
    const fila = ws.getRow(ini + i)
    fila.values = [
      nombreDe[x.pid], loteDe(c.sale.lot), cl.full_name || '', cl.doc_number || '', cl.phone || '',
      c.installment_number + (c.sale.installments_count ? ' de ' + c.sale.installments_count : ''),
      fechaCelda(c.due_date), num(c.amount), x.en || null, x.antes || null, (x.despues + x.sinFecha) || null, x.cobrado || 0, x.saldo, x.estado, x.cuando,
      [...new Set(x.pagos.map(p => fechaPe(p.date)))].join(' · '),
      [...new Set(x.pagos.map(p => p.operation_number).filter(Boolean))].join(' · '),
      [...new Set(x.pagos.map(p => p.account?.name).filter(Boolean))].join(' · '),
    ]
    rayas(fila, cols.length, i)
    fila.getCell(7).numFmt = FECHA
    for (let k = 8; k <= 13; k++) fila.getCell(k).numFmt = SOLES
    fila.getCell(13).font = { bold: x.saldo > 0, color: { argb: x.saldo > 0 ? 'FFB00020' : 'FF999999' } }
    pintar(fila.getCell(14), ESTADO[x.estado])
    if (x.cuando) pintar(fila.getCell(15), CUANDO[x.cuando], false)
    link(fila.getCell(19), vouchers[0], 'VER')
    link(fila.getCell(20), vouchers[1], 'VER')
    link(fila.getCell(21), boleta, 'VER')
  })
  const fin = Math.max(ini, ini + lista.length - 1)
  filaFiltrada(ws, cols, ini, fin, [[8, T.esperado], [9, T.en], [10, T.antes], [11, T.despues + T.sinFecha], [12, T.cobrado], [13, T.saldo]], lista.length)
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: fin, column: cols.length } }

  // =====================================================================
  // PAGOS DEL MES (todo lo que entró)
  // =====================================================================
  const colsP = [['Fecha', 11], ['Proyecto', 24], ['Lote', 8], ['Cliente', 32], ['N° documento', 13], ['Qué se pagó', 19], ['Cuota N°', 8], ['Cuota vence', 11],
    ['Monto', 13], ['N° operación', 18], ['Tipo', 15], ['Cuenta / banco', 22], ['Banco de origen', 16], ['Voucher', 9], ['Boleta / factura', 10], ['Observación', 30]]
  const wp = wb.addWorksheet('Pagos del mes (' + entradas.length + ')', { views: [{ state: 'frozen', ySplit: 3, xSplit: 4 }], properties: { tabColor: { argb: 'FF1E7B34' } } })
  wp.columns = colsP.map(([, width]) => ({ width }))
  apaisado(wp)
  banda(wp, 1, 'DINERO QUE ENTRÓ EN ' + nombre + ' · ' + (unSolo ? proyectos[0].name.toUpperCase() : 'TODOS LOS PROYECTOS') + ' · usa las flechas ▼ para filtrar', colsP.length, { size: 13, alto: 28 })
  encabezado(wp, 3, colsP.map(([t]) => t))
  if (!entradas.length) wp.addRow(['No entró ningún pago en ' + mesSolo + '.']).font = { italic: true, color: { argb: 'FF666666' } }
  entradas.forEach(({ p, clase }, i) => {
    const fila = wp.getRow(ini + i)
    fila.values = [fechaCelda(p.date), nombreDe[p.project_id] || '', loteDe(p.lot), p.client?.full_name || '', p.client?.doc_number || '', clase,
      p.installment?.installment_number ?? null, p.installment ? fechaCelda(p.installment.due_date) : null, num(p.amount), p.operation_number || '', p.operation_type || '',
      p.account?.name || '', p.banco_origen || '', '', '', p.observation || '']
    rayas(fila, colsP.length, i)
    fila.getCell(1).numFmt = FECHA; fila.getCell(8).numFmt = FECHA
    fila.getCell(9).numFmt = SOLES; fila.getCell(9).font = { bold: true }
    pintar(fila.getCell(6), CLASE[clase], false)
    link(fila.getCell(14), p.voucher_url, 'VER')
    link(fila.getCell(15), p.receipt_url, 'VER')
    if (clase === 'VENTA EXPROPIADA') for (const k of [1, 2, 3, 4, 5, 9]) fila.getCell(k).font = { color: { argb: 'FF8A8A8A' } }
  })
  const finP = Math.max(ini, ini + entradas.length - 1)
  filaFiltrada(wp, colsP, ini, finP, [[9, T.entro]], entradas.length)
  wp.autoFilter = { from: { row: 3, column: 1 }, to: { row: finP, column: colsP.length } }

  const archivo = 'cobranza-' + nombre.toLowerCase().replace(' ', '-') + (unSolo ? '-' + proyectos[0].name.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, '-') : '-todos') + '.xlsx'
  await descargarLibro(wb, archivo)
  return { cuotas: lista.length, pagos: entradas.length, entro: T.entro, cobrado: T.cobrado }
}
