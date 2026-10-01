// ============================================================================
// EL FACTURADOR, DEL LADO DEL AGENTE                                 [1 oct 2026]
// ----------------------------------------------------------------------------
// El panel pide un comprobante (comprobantes, sql/113) y este módulo lo emite
// hablando con el facturador del servidor (crm/facturador, localhost:8097), que
// es el que tiene los certificados y la clave SOL de cada RUC. Corre dentro de
// agente-urbis (index.js).
//
// EL CAMINO, igual al que ya anda en producción en El Cholao:
//   1. FIRMAR. El comprobante existe desde que se firma: tiene su código de
//      verificación y su QR. Se guarda ese XML y nunca se vuelve a armar: lo que
//      reciba SUNAT es byte por byte lo que tiene el cliente.
//   2. La FACTURA viaja sola y SUNAT contesta al momento.
//      La BOLETA real no viaja sola: se informa en el RESUMEN del día siguiente
//      (así lo exige SUNAT). Mientras tanto ya vale y el cliente se la lleva.
//   3. Resúmenes y bajas contestan con un TICKET: se pregunta después.
//   4. Con el comprobante firmado se arma la hoja A4 (PDF con QR) y se guarda en
//      el pago, junto con una copia del XML y de la constancia fuera del servidor.
//
// En el ambiente de PRUEBAS de SUNAT la boleta sí viaja sola (el resumen no se
// puede probar ahí) y nada tiene valor: el PDF sale con la marca "PRUEBA" y NO se
// pone como boleta del pago.
//
// Las claves no pasan por aquí: este módulo solo conoce el token del servicio,
// que lee de /etc/facturador/servicio.json (el agente corre como root).
// ============================================================================
const fs = require('fs')
const { subirAR2 } = require('./r2')
// Las librerías del PDF se cargan recién al armar el primero. Si en el servidor
// faltara instalarlas (un git pull sin npm install), el bot de WhatsApp —que vive
// en este mismo proceso— no se cae: solo queda sin PDF hasta que se instalen.
let _pdf = null
function libreriasPdf() {
  if (!_pdf) _pdf = { jsPDF: require('jspdf').jsPDF, QRCode: require('qrcode') }
  return _pdf
}

const SERVICIO = (process.env.FACTURADOR_URL || 'http://127.0.0.1:8097').replace(/\/$/, '')
const ARCHIVO_TOKEN = process.env.FACTURADOR_CONFIG || '/etc/facturador/servicio.json'

// minutos de espera según el intento: SUNAT caído no se arregla insistiendo
const ESPERAS = [1, 2, 5, 15, 30, 60, 120, 360]
const TZ = { timeZone: 'America/Lima' }
const hoyLima = () => new Date().toLocaleDateString('en-CA', TZ)
const horaLima = () => Number(new Date().toLocaleString('en-US', { ...TZ, hour: '2-digit', hour12: false })) % 24
const enMin = m => new Date(Date.now() + m * 60000).toISOString()
const dos = n => Number(n || 0).toFixed(2)
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nombreDe = c => c.serie + '-' + c.numero
const TITULO = { boleta: 'BOLETA DE VENTA ELECTRÓNICA', factura: 'FACTURA ELECTRÓNICA' }
const DOC = { 0: 'Doc.', 1: 'DNI', 4: 'C.E.', 6: 'RUC', 7: 'Pasaporte' }
// El color de quien factura (#rrggbb) -> [r, g, b]; y el mismo aclarado para fondos
const rgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null }
const claro = (c, cuanto) => c.map(v => Math.round(v + (255 - v) * cuanto))

// Lo que dice SUNAT, en castellano de oficina. Lo que no se conoce va tal cual.
function explicar(codigo, mensaje) {
  const c = String(codigo || ''), n = (c.match(/(\d{3,4})\s*$/) || [])[1] || ''
  if (c === 'servicio' || c === 'token') return mensaje
  if (c === 'red') return 'No se pudo llegar a SUNAT (sin conexión o SUNAT caído). Se reintenta solo.'
  if (['0102', '0103', '0104', '0105', '0106'].includes(n)) return 'SUNAT no aceptó el usuario o la clave SOL de este RUC (código ' + n + '). Hay que revisarlo en el servidor: bash /opt/facturador/probar-clave.sh EL_RUC'
  if (['0110', '0111'].includes(n)) return 'El usuario SOL de este RUC no tiene el perfil de facturación electrónica (código ' + n + ').'
  if (n === '0140' || n === '0098') return 'SUNAT lo está procesando. Se vuelve a preguntar solo.'
  if (n === '0130' || n === '0135' || n === '0109' || n === '0200') return 'SUNAT no está disponible en este momento (código ' + n + '). Se reintenta solo.'
  if (n === '1033') return 'SUNAT ya tiene registrado ese número con otros datos (código 1033). ¿La serie se está usando en otro sistema? Cambia la serie del proyecto y emite de nuevo.'
  return (n ? 'SUNAT ' + n + ': ' : '') + String(mensaje || 'sin detalle').slice(0, 800)
}
const esDeClave = codigo => /0(10[2-6]|11[01])\s*$/.test(String(codigo || ''))

module.exports = function crearFacturador({ supabase, log, avisar = async () => {} }) {
  let TOKEN = '', SALUD = null, saludAt = 0, publicadoAt = 0, rescateAt = 0, papelesAt = 0
  let ocupado = false, diferido = false, avisoSinTabla = false, servicioCaido = null
  const avisados = new Map()   // clave -> día: un mismo aviso sale una vez por día
  const LOGOS = new Map()

  // un aviso que falla no puede voltear una emisión
  const avisa = texto => Promise.resolve().then(() => avisar(texto)).catch(() => {})
  const unaVezAlDia = (clave, texto) => {
    const hoy = hoyLima()
    if (avisados.get(clave) === hoy) return
    avisados.set(clave, hoy)
    avisa(texto)
  }

  function token(denuevo) {
    if (TOKEN && !denuevo) return TOKEN
    TOKEN = process.env.FACTURADOR_TOKEN || ''
    if (!TOKEN) { try { TOKEN = JSON.parse(fs.readFileSync(ARCHIVO_TOKEN, 'utf8')).token || '' } catch { TOKEN = '' } }
    return TOKEN
  }

  // Un pedido al facturador. NUNCA lanza: siempre devuelve {estado, codigo, mensaje}.
  // `invalido` = el facturador dijo que el pedido está mal (no llegó a SUNAT).
  async function pedir(accion, cuerpo, ms = 100000) {
    const mandar = () => fetch(SERVICIO + '/' + accion, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(ms),
    })
    try {
      let r = await mandar()
      if (r.status === 401) { token(true); r = await mandar() }
      const j = await r.json().catch(() => null)
      if (r.status === 401) return { estado: 'error', codigo: 'token', mensaje: 'El agente no pudo identificarse ante el facturador del servidor.', reintentable: true }
      if (!j) return { estado: 'error', codigo: 'servicio', mensaje: 'El facturador del servidor contestó algo inesperado (' + r.status + ').', reintentable: true }
      if (r.status === 400) return { estado: 'invalido', codigo: 'pedido', mensaje: String(j.mensaje || 'pedido inválido'), reintentable: false }
      if (r.status >= 500) return { estado: 'error', codigo: 'servicio', mensaje: String(j.mensaje || 'El facturador del servidor falló.'), reintentable: true }
      return j
    } catch {
      return { estado: 'error', codigo: 'servicio', mensaje: 'El facturador del servidor no contesta. Se reintenta solo.', reintentable: true }
    }
  }

  // Qué RUC están cargados y en qué ambiente. Sin token: /salud no lo pide.
  async function salud() {
    if (SALUD && Date.now() - saludAt < 20000) return SALUD
    try {
      const r = await fetch(SERVICIO + '/salud', { signal: AbortSignal.timeout(8000) })
      const j = await r.json()
      SALUD = { emisores: Object.fromEntries((j.emisores || []).map(e => [e.ruc, e])), errores: j.errores || {} }
      saludAt = Date.now()
      if (servicioCaido !== false) log('FACTURADOR: servicio arriba ·', Object.keys(SALUD.emisores).length, 'emisor(es)')
      servicioCaido = false
    } catch {
      SALUD = null
      if (servicioCaido !== true) log('FACTURADOR: el servicio no contesta en', SERVICIO, '(¿falta instalarlo? migracion/12)')
      servicioCaido = true
    }
    return SALUD
  }

  // El panel no puede hablar con el facturador: se le deja en la base lo que hay.
  async function publicar(S) {
    if (Date.now() - publicadoAt < 60000) return
    publicadoAt = Date.now()
    const ahora = new Date().toISOString()
    const filas = Object.values(S.emisores).map(e => ({
      ruc: e.ruc, razon_social: e.razon_social, ambiente: e.ambiente, afectacion: e.afectacion,
      certificado_vence: e.certificado_vence || null, certificado_dias: e.certificado_dias ?? null, error: null, visto_at: ahora,
    }))
    for (const [quien, motivo] of Object.entries(S.errores)) {
      const ruc = String(quien).replace(/\.json$/, '')
      if (/^\d{11}$/.test(ruc) && !S.emisores[ruc]) filas.push({ ruc, razon_social: null, ambiente: null, afectacion: null, certificado_vence: null, certificado_dias: null, error: String(motivo).slice(0, 300), visto_at: ahora })
    }
    if (filas.length) {
      const { error } = await supabase.from('fact_emisores').upsert(filas)
      if (error) return
    }
    // lo que ya no está en el servidor deja de figurar
    const q = supabase.from('fact_emisores').delete()
    await (filas.length ? q.not('ruc', 'in', '(' + filas.map(f => f.ruc).join(',') + ')') : q.neq('ruc', ''))
    for (const e of Object.values(S.emisores)) {
      const d = e.certificado_dias
      if (d != null && d <= 30 && (d % 5 === 0 || d <= 5))
        unaVezAlDia('cert:' + e.ruc, '🧾 *CERTIFICADO DIGITAL POR VENCER*\n' + e.razon_social + ' (RUC ' + e.ruc + ')\nVence en *' + d + ' día(s)*. Sin certificado vigente no se pueden emitir boletas ni facturas: hay que sacar uno nuevo en SUNAT y cargarlo en el servidor.')
    }
  }

  const upd = async (id, patch) => {
    const { error } = await supabase.from('comprobantes').update(patch).eq('id', id)
    if (error) log('FACTURADOR: no se pudo guardar', id, error.message)
    return !error
  }

  // ------------------------------------------------------------------ el PDF
  async function logoDe(url) {
    if (!url) return null
    if (LOGOS.has(url)) return LOGOS.get(url)
    let logo = null
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer())
        // solo PNG o JPG: la librería del PDF no abre otros formatos
        const formato = buf[0] === 0x89 && buf[1] === 0x50 ? 'PNG' : buf[0] === 0xff && buf[1] === 0xd8 ? 'JPEG' : null
        if (formato && buf.length < 3 * 1024 * 1024) logo = { data: 'data:image/' + formato.toLowerCase() + ';base64,' + buf.toString('base64'), formato }
      }
    } catch {}
    LOGOS.set(url, logo)
    return logo
  }

  // La representación impresa: una hoja A4 con los datos del emisor, el detalle,
  // el QR con los campos que fija SUNAT y el código de verificación de la firma.
  async function armarPdf(c, p) {
    const { jsPDF, QRCode } = libreriasPdf()
    const d = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
    const M = 15, ANCHO = 210, DER = ANCHO - M
    const prueba = c.ambiente !== 'produccion'
    // cada proyecto factura con la marca de SU dueño: su logo y su color
    const COLOR = rgb(p.fact_color) || [62, 92, 52]
    const FONDO = claro(COLOR, 0.88)
    const marca = () => {
      if (!prueba) return
      d.setFont('helvetica', 'bold').setFontSize(54).setTextColor(232, 232, 232)
      d.text('PRUEBA - SIN VALOR', 105, 175, { align: 'center', angle: 38 })
      d.setTextColor(20, 20, 20)
    }
    marca()

    // --- cabecera: emisor a la izquierda, recuadro del comprobante a la derecha
    let x = M
    const logo = await logoDe(p.fact_logo_url || p.logo_url)
    if (logo) {
      try {
        const pr = d.getImageProperties(logo.data)
        // entra en un recuadro de 40 x 26 mm sin deformarse
        const k = Math.min(40 / pr.width, 26 / pr.height), ancho = pr.width * k
        d.addImage(logo.data, logo.formato, M, 11 + (26 - pr.height * k) / 2, ancho, pr.height * k)
        x = M + ancho + 5
      } catch {}
    }
    const anchoEmisor = 128 - x
    d.setTextColor(20, 20, 20).setFont('helvetica', 'bold').setFontSize(11.5)
    const razon = d.splitTextToSize(String(p.fact_razon_social || '').toUpperCase(), anchoEmisor)
    let y = 17
    d.text(razon, x, y); y += razon.length * 5
    d.setFont('helvetica', 'normal').setFontSize(8.5)
    if (p.fact_direccion) { const dir = d.splitTextToSize(String(p.fact_direccion).toUpperCase(), anchoEmisor); d.text(dir, x, y); y += dir.length * 3.8 }
    if (p.name) { d.setFont('helvetica', 'bold'); d.text(String(p.name).toUpperCase(), x, y + 0.5); y += 4.3 }

    d.setDrawColor(...COLOR).setLineWidth(0.6).roundedRect(132, 11, 63, 28, 2, 2)
    d.setFont('helvetica', 'bold').setFontSize(11.5).text('R.U.C. ' + c.ruc, 163.5, 19, { align: 'center' })
    d.setFillColor(...COLOR).rect(132.3, 21.6, 62.4, 7.4, 'F')
    d.setTextColor(255, 255, 255).setFontSize(c.tipo === 'boleta' ? 9.6 : 11).text(TITULO[c.tipo], 163.5, 26.7, { align: 'center' })
    d.setTextColor(20, 20, 20).setFontSize(12.5).text(nombreDe(c), 163.5, 35.3, { align: 'center' })

    // --- a nombre de quién
    y = Math.max(y, 41) + 5
    const [aa, mm, dd] = String(c.fecha_emision).split('-')
    const fila = (etq, val, xx, yy, anchoVal) => {
      d.setFont('helvetica', 'bold').setFontSize(8.5).text(etq, xx, yy)
      const corrido = d.getTextWidth(etq) + 1.8   // se mide en negrita, que es como se escribió
      d.setFont('helvetica', 'normal')
      const t = d.splitTextToSize(String(val || '-'), anchoVal)
      d.text(t, xx + corrido, yy)
      return t.length
    }
    const y0 = y
    y += 5.5
    y += 4.4 * fila('Señor(es):', c.cliente_nombre, M + 3, y, 95)
    y += 4.4 * fila((DOC[c.cliente_tipo_doc] || 'Doc.') + ':', c.cliente_numero || 'SIN DOCUMENTO', M + 3, y, 95)
    if (c.cliente_direccion) y += 4.4 * fila('Dirección:', c.cliente_direccion, M + 3, y, 95)
    fila('Fecha de emisión:', dd + '/' + mm + '/' + aa, 132, y0 + 5.5, 30)
    fila('Moneda:', 'SOLES', 132, y0 + 9.9, 30)
    fila('Forma de pago:', 'CONTADO', 132, y0 + 14.3, 30)
    y = Math.max(y, y0 + 18.5)
    d.setDrawColor(150).setLineWidth(0.2).roundedRect(M, y0, DER - M, y - y0, 1.5, 1.5)

    // --- el detalle
    y += 5
    const COL = { cant: M + 2, uni: M + 16, desc: M + 32, pu: 160, imp: DER - 2 }
    const cabecera = () => {
      d.setFillColor(...FONDO).rect(M, y, DER - M, 7, 'F')
      d.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...claro(COLOR, -0.25).map(v => Math.max(0, Math.min(255, v))))
      d.text('CANT.', COL.cant, y + 4.7); d.text('UNIDAD', COL.uni, y + 4.7); d.text('DESCRIPCIÓN', COL.desc, y + 4.7)
      d.text('P. UNITARIO', COL.pu, y + 4.7, { align: 'right' }); d.text('IMPORTE', COL.imp, y + 4.7, { align: 'right' })
      d.setTextColor(20, 20, 20); y += 7
    }
    cabecera()
    d.setFont('helvetica', 'normal').setFontSize(8.5)
    for (const it of (c.items || [])) {
      const desc = d.splitTextToSize(String(it.descripcion || ''), 100)
      const alto = Math.max(6.5, desc.length * 3.9 + 2.6)
      if (y + alto > 262) { d.addPage(); marca(); y = 18; cabecera(); d.setFont('helvetica', 'normal').setFontSize(8.5) }
      d.text('1.00', COL.cant, y + 4.4); d.text('UNIDAD', COL.uni, y + 4.4); d.text(desc, COL.desc, y + 4.4)
      d.text(dos(it.monto), COL.pu, y + 4.4, { align: 'right' }); d.text(dos(it.monto), COL.imp, y + 4.4, { align: 'right' })
      y += alto
      d.setDrawColor(215).setLineWidth(0.15).line(M, y, DER, y)
    }

    // --- totales, monto en letras, QR y código de verificación
    if (y > 205) { d.addPage(); marca(); y = 18 }
    y += 6
    const yTot = y
    const total = (etq, val, negrita) => {
      d.setFont('helvetica', negrita ? 'bold' : 'normal').setFontSize(negrita ? 10 : 8.8)
      d.text(etq, 150, y, { align: 'right' }); d.text(soles(val), DER - 2, y, { align: 'right' })
      y += negrita ? 6 : 4.8
    }
    if (Number(c.gravadas) > 0) total('Op. gravada', c.gravadas)
    if (Number(c.exoneradas) > 0) total('Op. exonerada', c.exoneradas)
    if (Number(c.inafectas) > 0) total('Op. inafecta', c.inafectas)
    total('I.G.V.', c.igv || 0)
    y += 1
    d.setFillColor(...FONDO).rect(118, y - 4.6, DER - 118, 7, 'F')
    total('IMPORTE TOTAL', c.total, true)
    if (c.monto_letras) {
      d.setFont('helvetica', 'bold').setFontSize(8.5)
      d.text(d.splitTextToSize('SON: ' + String(c.monto_letras).toUpperCase(), 92), M, yTot)
    }

    y = Math.max(y, yTot + 16) + 4
    d.setDrawColor(...COLOR).setLineWidth(0.4).line(M, y, DER, y)
    y += 4
    if (c.qr) {
      try { d.addImage(await QRCode.toDataURL(c.qr, { margin: 0, width: 300, errorCorrectionLevel: 'M' }), 'PNG', M, y, 30, 30) } catch {}
    }
    d.setFont('helvetica', 'normal').setFontSize(8.3)
    const pie = [
      'Representación impresa de la ' + TITULO[c.tipo] + '.',
      'Código de verificación: ' + (c.firma || '-'),
      'Puede consultar su validez en www.sunat.gob.pe, en "Consulta de validez del comprobante de pago electrónico".',
    ]
    if (prueba) pie.unshift('EMITIDA EN EL AMBIENTE DE PRUEBAS DE SUNAT: NO TIENE VALOR TRIBUTARIO.')
    let yp = y + 5
    for (const linea of pie) { const t = d.splitTextToSize(linea, DER - M - 36); d.text(t, M + 35, yp); yp += t.length * 4 + 1.6 }
    return Buffer.from(d.output('arraybuffer'))
  }

  // PDF + copia del XML y de la constancia. Se puede llamar las veces que haga
  // falta: solo sube lo que falta. Con el PDF real, el pago queda con su boleta.
  async function papeles(c) {
    const patch = {}
    const cola = String(c.id).replace(/-/g, '').slice(0, 10)   // para que la dirección no se pueda adivinar
    const base = 'comprobantes/' + c.ruc + (c.ambiente === 'produccion' ? '' : '/pruebas') + '/'
      + c.ruc + '-' + (c.tipo === 'factura' ? '01' : '03') + '-' + c.serie + '-' + c.numero + '-' + cola
    if (!c.pdf_url) {
      try {
        const { data: p } = await supabase.from('projects').select('name, logo_url, fact_razon_social, fact_direccion, fact_logo_url, fact_color').eq('id', c.project_id).maybeSingle()
        const url = await subirAR2(base + '.pdf', await armarPdf(c, p || {}), 'application/pdf', log)
        if (url) patch.pdf_url = url
      } catch (e) { log('FACTURADOR: no se pudo armar el PDF de', nombreDe(c), String(e.message || e)) }
    }
    for (const [ruta, campo, sufijo] of [[c.xml_ruta, 'xml_url', '.xml'], [c.cdr_ruta, 'cdr_url', '-constancia.xml']]) {
      if (c[campo] || !ruta) continue
      try { const url = await subirAR2(base + sufijo, fs.readFileSync(ruta), 'application/xml', log); if (url) patch[campo] = url } catch {}
    }
    if (!Object.keys(patch).length) return
    await upd(c.id, patch)
    Object.assign(c, patch)
    if (patch.pdf_url && c.ambiente === 'produccion') {
      await supabase.from('daily_income').update({ receipt_url: patch.pdf_url, receipt_na: false, receipt_na_reason: null })
        .eq('comprobante_id', c.id).is('receipt_url', null)
    }
  }

  // ------------------------------------------------------------- emitir uno
  async function fallo(c, r) {
    const codigo = String(r.codigo || '').slice(0, 60)
    const mensaje = explicar(codigo, r.mensaje)
    if (r.reintentable || r.estado === 'error') {
      const min = /0140\s*$/.test(codigo) ? 15 : ESPERAS[Math.min(Math.max((c.intentos || 1) - 1, 0), ESPERAS.length - 1)]
      await upd(c.id, { estado: 'error', codigo, mensaje, proximo_intento: enMin(min) })
      log('FACTURADOR ↻', nombreDe(c), codigo, '· reintento en', min, 'min')
      if (esDeClave(codigo)) unaVezAlDia('clave:' + c.ruc, '🧾 *EL FACTURADOR NO PUEDE ENTRAR A SUNAT*\nRUC ' + c.ruc + '\n' + mensaje + '\n\nLos cobros siguen normal; los comprobantes quedan en cola y salen solos cuando se arregle.')
      return
    }
    await upd(c.id, { estado: 'rechazado', codigo, mensaje, proximo_intento: new Date().toISOString() })
    log('FACTURADOR ✗', c.tipo, nombreDe(c), codigo, String(r.mensaje || '').slice(0, 120))
    await avisa('🧾 *COMPROBANTE RECHAZADO*\n' + c.tipo.toUpperCase() + ' ' + nombreDe(c) + ' · ' + soles(c.total) + '\n' + c.cliente_nombre + '\n' + mensaje
      + '\n\nEl cobro está registrado y no se toca. Falta el comprobante: se emite de nuevo desde la ficha del lote.')
  }

  async function emitirUno(c) {
    const base = { ruc: c.ruc, tipo: c.tipo, serie: c.serie, numero: String(c.numero) }
    if (!c.firma) {
      const f = await pedir('firmar', {
        ...base, fecha: c.fecha_emision, hora: String(c.hora_emision || '12:00:00').slice(0, 8), moneda: 'PEN',
        cliente: { tipo_doc: c.cliente_tipo_doc, numero: c.cliente_numero || (c.cliente_tipo_doc === '0' ? '-' : ''), nombre: c.cliente_nombre, direccion: c.cliente_direccion || '' },
        items: (c.items || []).map(i => ({ descripcion: i.descripcion, cantidad: 1, precio_con_igv: Number(i.monto) })),
        // si la suma de las líneas no da lo cobrado, el facturador se niega: mejor ahí que en SUNAT
        total_cobrado: Number(c.total),
      })
      if (f.estado !== 'firmado' || !f.firma) return fallo(c, f)
      const firmado = {
        firma: f.firma, qr: f.qr || null, monto_letras: f.letras || null, xml_ruta: f.xml || null,
        gravadas: f.gravadas, exoneradas: f.exoneradas, inafectas: f.inafectas, igv: f.igv,
      }
      if (!await upd(c.id, firmado)) return
      Object.assign(c, firmado)
    }

    if (c.tipo === 'boleta' && c.ambiente === 'produccion') {
      await upd(c.id, { estado: 'firmado', codigo: null, mensaje: 'Firmada. Se informa a SUNAT en el resumen del día siguiente.', emitido_at: new Date().toISOString() })
      log('FACTURADOR ✔ boleta', nombreDe(c), 'firmada ·', soles(c.total))
    } else {
      const r = await pedir('enviar', base)
      if (r.estado !== 'aceptado') return fallo(c, r)
      const ok = { estado: 'aceptado', codigo: String(r.codigo ?? '0'), mensaje: String(r.mensaje || 'Aceptada por SUNAT').slice(0, 800), cdr_ruta: r.cdr || null, emitido_at: new Date().toISOString() }
      await upd(c.id, ok)
      Object.assign(c, ok)
      log('FACTURADOR ✔', c.tipo, nombreDe(c), 'aceptada por SUNAT', c.ambiente === 'produccion' ? '' : '(PRUEBAS)', '·', soles(c.total))
    }
    await papeles(c)
  }

  // Lo que quedó a medias por un reinicio vuelve a la cola CON SU MISMO NÚMERO.
  async function rescatar() {
    if (Date.now() - rescateAt < 60000) return
    rescateAt = Date.now()
    await supabase.from('comprobantes').update({ estado: 'error', mensaje: 'Se interrumpió el envío. Se reintenta solo.', proximo_intento: new Date().toISOString() })
      .eq('estado', 'emitiendo').lt('tomado_at', new Date(Date.now() - 5 * 60000).toISOString())
    const { data: colgados } = await supabase.from('fact_envios').select('id').eq('estado', 'enviando').lt('creado_at', new Date(Date.now() - 10 * 60000).toISOString())
    for (const e of (colgados || [])) {
      await supabase.from('fact_envios').update({ estado: 'error', mensaje: 'Se interrumpió antes de tener respuesta.' }).eq('id', e.id)
      await soltar(e.id, 30, 'El envío a SUNAT se interrumpió. Se reintenta solo.')
    }
  }

  // El latido corto: lo que el panel espera mirando la pantalla.
  async function procesar() {
    if (ocupado) return
    ocupado = true
    try {
      const { data: cola, error } = await supabase.from('comprobantes').select('id, ruc, tipo, serie, numero')
        .in('estado', ['pendiente', 'error']).lte('proximo_intento', new Date().toISOString()).order('creado_at').limit(5)
      if (error) { if (!avisoSinTabla) log('FACTURADOR:', error.message, '(¿falta correr sql/113?)'); avisoSinTabla = true; return }
      avisoSinTabla = false
      const S = await salud()
      if (S) await publicar(S)
      await rescatar()
      if (S && Date.now() - papelesAt > 120000) {
        papelesAt = Date.now()
        const { data: sinPdf } = await supabase.from('comprobantes').select('*').in('estado', ['firmado', 'en_sunat', 'aceptado'])
          .is('pdf_url', null).gt('creado_at', new Date(Date.now() - 15 * 86400000).toISOString()).limit(5)
        for (const c of (sinPdf || [])) await papeles(c)
      }
      for (const p of (cola || [])) {
        if (!S) { await upd(p.id, { estado: 'error', codigo: 'servicio', mensaje: 'El facturador del servidor no contesta. Se reintenta solo.', proximo_intento: enMin(2) }); continue }
        const em = S.emisores[p.ruc]
        if (!em) {
          const motivo = S.errores[p.ruc] || S.errores[p.ruc + '.json']
          await upd(p.id, { estado: 'error', codigo: 'sin_emisor', proximo_intento: enMin(5), mensaje: 'El RUC ' + p.ruc + ' todavía no está cargado en el facturador del servidor' + (motivo ? ' (' + String(motivo).slice(0, 200) + ')' : '') + '. El comprobante queda en cola.' })
          continue
        }
        // el número se da aquí, junto con "lo estoy emitiendo": los dos o ninguno
        const { data: c, error: e2 } = await supabase.rpc('fact_tomar', { p_id: p.id, p_ambiente: em.ambiente })
        if (e2) { log('FACTURADOR: fact_tomar', e2.message); continue }
        if (!c || !c.id) continue
        try { await emitirUno(c) }
        catch (e) {
          log('FACTURADOR: fallo emitiendo', nombreDe(c), String(e.message || e))
          await upd(c.id, { estado: 'error', codigo: 'agente', mensaje: 'Falló el servidor al emitir. Se reintenta solo.', proximo_intento: enMin(5) })
        }
      }
    } finally { ocupado = false }
  }

  // ------------------------------------------------- resúmenes, bajas, tickets
  async function nuevoEnvio(tipo, ruc, referencia, cantidad) {
    const hoy = hoyLima()
    const { data: ult } = await supabase.from('fact_envios').select('correlativo').eq('ruc', ruc).eq('ambiente', 'produccion')
      .eq('tipo', tipo).eq('fecha_generacion', hoy).order('correlativo', { ascending: false }).limit(1)
    const correlativo = ((ult && ult[0]?.correlativo) || 0) + 1
    const { data, error } = await supabase.from('fact_envios')
      .insert({ tipo, ruc, ambiente: 'produccion', fecha_generacion: hoy, correlativo, fecha_referencia: referencia, cantidad }).select().single()
    if (error) { log('FACTURADOR: no se pudo abrir el envío', error.message); return null }
    return data
  }

  // Los comprobantes de un envío que no llegó a SUNAT vuelven a donde estaban.
  async function soltar(envioId, minutos, mensaje) {
    const { data: cs } = await supabase.from('comprobantes').select('id, condicion').eq('envio_id', envioId).eq('estado', 'en_sunat')
    for (const c of (cs || [])) {
      await upd(c.id, { estado: c.condicion === 'anular' ? 'por_anular' : 'firmado', condicion: 'adicionar', mensaje, proximo_intento: enMin(minutos) })
    }
  }

  async function cerrarEnvio(e, r, etiqueta) {
    if (r.estado === 'esperando' && r.ticket) {
      await supabase.from('fact_envios').update({ estado: 'esperando', ticket: r.ticket, identificador: r.documento || null, xml_ruta: r.xml || null, codigo: String(r.codigo || ''), mensaje: 'En cola en SUNAT' }).eq('id', e.id)
      log('FACTURADOR →', etiqueta, r.documento || '', '· ticket', r.ticket)
      return true
    }
    const reintenta = r.reintentable || r.estado === 'error'
    const mensaje = explicar(r.codigo, r.mensaje)
    await supabase.from('fact_envios').update({ estado: reintenta ? 'error' : 'rechazado', identificador: r.documento || null, codigo: String(r.codigo || '').slice(0, 60), mensaje, listo_at: new Date().toISOString() }).eq('id', e.id)
    await soltar(e.id, reintenta ? 30 : 360, 'No se pudo informar a SUNAT: ' + mensaje)
    log('FACTURADOR ✗', etiqueta, String(r.codigo || ''), String(r.mensaje || '').slice(0, 120))
    if (!reintenta) await avisa('🧾 *SUNAT NO RECIBIÓ ' + etiqueta.toUpperCase() + '*\nRUC ' + e.ruc + ' · ' + e.cantidad + ' comprobante(s) del ' + e.fecha_referencia + '\n' + mensaje + '\n\nSe vuelve a intentar en unas horas. Está en Comprobantes.').catch(() => {})
    return false
  }

  // Las boletas reales de DÍAS ANTERIORES sin informar, un resumen por RUC y por
  // día. Las de hoy esperan a mañana: SUNAT da plazo de sobra y así es un envío.
  // Las que hay que ANULAR (ya informadas) no esperan: van con condición 3.
  async function resumenes(S) {
    const hoy = hoyLima()
    const { data: bs } = await supabase.from('comprobantes').select('*').eq('tipo', 'boleta').eq('ambiente', 'produccion')
      .in('estado', ['firmado', 'por_anular']).lte('proximo_intento', new Date().toISOString()).order('fecha_emision').order('numero').limit(1000)
    const grupos = new Map()
    for (const b of (bs || [])) {
      if (b.estado === 'firmado' && b.fecha_emision >= hoy) continue
      if (!b.firma || !S.emisores[b.ruc] || S.emisores[b.ruc].ambiente !== 'produccion') continue
      const k = b.ruc + '|' + b.fecha_emision
      if (!grupos.has(k)) grupos.set(k, [])
      if (grupos.get(k).length < 400) grupos.get(k).push(b)
    }
    for (const [k, grupo] of grupos) {
      const [ruc, dia] = k.split('|')
      const e = await nuevoEnvio('resumen', ruc, dia, grupo.length)
      if (!e) continue
      // las boletas se cuelgan del envío ANTES de mandar: si el proceso se cae en
      // el medio se ve qué quedó a mitad y no se informa dos veces
      const lineas = []
      for (const b of grupo) {
        // SUNAT no deja anular lo que nunca le informaron: una boleta anulada antes
        // de informarse va primero como alta (1) y en el resumen siguiente como baja (3)
        const anula = b.estado === 'por_anular'
        await upd(b.id, { envio_id: e.id, estado: 'en_sunat', condicion: anula ? 'anular' : 'adicionar' })
        lineas.push({
          serie: b.serie, numero: String(b.numero), total: dos(b.total),
          gravado: dos(b.gravadas), exonerado: dos(b.exoneradas), inafecto: dos(b.inafectas), igv: dos(b.igv),
          condicion: anula ? '3' : '1', cliente_tipo_doc: b.cliente_tipo_doc || '0', cliente_numero: b.cliente_numero || '-',
        })
      }
      await cerrarEnvio(e, await pedir('resumen', { ruc, fecha: dia, correlativo: String(e.correlativo), boletas: lineas }, 130000), 'el resumen de boletas')
    }
  }

  // Una factura que SUNAT ya aceptó se anula con una comunicación de baja.
  async function bajas(S) {
    const { data: fs_ } = await supabase.from('comprobantes').select('*').eq('tipo', 'factura').eq('ambiente', 'produccion')
      .eq('estado', 'por_anular').lte('proximo_intento', new Date().toISOString()).order('creado_at').limit(20)
    for (const f of (fs_ || [])) {
      if (!S.emisores[f.ruc]) continue
      const e = await nuevoEnvio('baja', f.ruc, f.fecha_emision, 1)
      if (!e) continue
      await upd(f.id, { envio_id: e.id, estado: 'en_sunat', condicion: 'anular' })
      await cerrarEnvio(e, await pedir('anular', {
        ruc: f.ruc, fecha: f.fecha_emision, correlativo: String(e.correlativo), motivo: f.motivo_baja || 'ANULACION DE LA OPERACION',
        documentos: [{ tipo: 'factura', serie: f.serie, numero: String(f.numero) }],
      }, 130000), 'la baja de ' + nombreDe(f))
    }
  }

  // Un resumen o una baja terminan cuando SUNAT contesta por el ticket. Mientras
  // diga "todavía" no pasa nada; cuando diga sí o no, se copia a lo que llevaba.
  async function tickets() {
    const { data: enVuelo } = await supabase.from('fact_envios').select('*').eq('estado', 'esperando').not('ticket', 'is', null)
      .order('consultado_at', { nullsFirst: true }).limit(20)
    for (const e of (enVuelo || [])) {
      const r = await pedir('ticket', { ruc: e.ruc, ticket: e.ticket, documento: e.identificador || '' })
      const ahora = new Date().toISOString()
      if (r.estado !== 'aceptado' && r.estado !== 'rechazado') { await supabase.from('fact_envios').update({ consultado_at: ahora }).eq('id', e.id); continue }
      const acepto = r.estado === 'aceptado'
      const mensaje = acepto ? String(r.mensaje || 'Aceptado').slice(0, 800) : explicar(r.codigo, r.mensaje)
      await supabase.from('fact_envios').update({ estado: r.estado, codigo: String(r.codigo ?? ''), mensaje, cdr_ruta: r.cdr || null, consultado_at: ahora, listo_at: ahora }).eq('id', e.id)
      const { data: cs } = await supabase.from('comprobantes').select('*').eq('envio_id', e.id).eq('estado', 'en_sunat')
      for (const c of (cs || [])) {
        if (acepto && c.condicion === 'anular') {
          await upd(c.id, { estado: 'anulado', codigo: String(r.codigo ?? '0'), mensaje: 'Dada de baja ante SUNAT (' + (e.identificador || '') + ').' })
          if (c.pdf_url) await supabase.from('daily_income').update({ receipt_url: null }).eq('comprobante_id', c.id).eq('receipt_url', c.pdf_url)
        } else if (acepto) {
          // se pidió anular mientras viajaba: ahora que SUNAT la conoce, sale la baja
          await upd(c.id, { estado: c.motivo_baja ? 'por_anular' : 'aceptado', codigo: String(r.codigo ?? '0'), mensaje: 'Aceptada por SUNAT en el resumen ' + (e.identificador || '') + '.', proximo_intento: ahora })
        } else if (c.condicion === 'anular') {
          await upd(c.id, { estado: 'aceptado', condicion: 'adicionar', motivo_baja: null, mensaje: 'SUNAT rechazó la anulación: ' + mensaje + ' El comprobante sigue vigente.' })
        } else {
          await upd(c.id, { estado: 'firmado', mensaje: 'SUNAT rechazó el resumen: ' + mensaje, proximo_intento: enMin(360) })
        }
      }
      log('FACTURADOR', acepto ? '✔' : '✗', e.identificador || e.tipo, '·', (cs || []).length, 'comprobante(s)', acepto ? '' : String(r.mensaje || '').slice(0, 120))
      if (!acepto) await avisa('🧾 *SUNAT RECHAZÓ ' + (e.tipo === 'baja' ? 'UNA BAJA' : 'UN RESUMEN DE BOLETAS') + '*\nRUC ' + e.ruc + ' · ' + (e.identificador || '') + '\n' + mensaje + '\n\nEstá en Comprobantes.').catch(() => {})
    }
  }

  // El latido largo (cada 10 minutos): lo que SUNAT contesta en diferido.
  async function diferidos() {
    if (diferido) return
    diferido = true
    try {
      const S = await salud()
      if (!S) return
      await tickets()
      // de día: de noche SUNAT hace mantenimiento y no hay nadie para leer un aviso
      const h = horaLima()
      if (h < 6 || h >= 22) return
      await bajas(S)
      await resumenes(S)
    } finally { diferido = false }
  }

  return { procesar, diferidos, armarPdf }
}
module.exports.explicar = explicar
