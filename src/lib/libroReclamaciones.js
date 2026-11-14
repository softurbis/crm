// LIBRO DE RECLAMACIONES VIRTUAL (sql/230, 14 nov 2026): lo que comparten la página pública
// (/libro-de-reclamaciones) y la bandeja del panel (/reclamos): textos legales, formatos y
// el PDF de la hoja. jsPDF se carga recién al descargar, para que el formulario abra rápido.

export const PLAZO_DIAS = 15

export const TIPOS = {
  reclamo: { t: 'Reclamo', d: 'Disconformidad relacionada a los productos o servicios.' },
  queja: { t: 'Queja', d: 'Disconformidad no relacionada a los productos o servicios; o malestar o descontento respecto a la atención al público.' },
}
export const MEDIOS = { correo: 'Correo electrónico', whatsapp: 'WhatsApp / teléfono', domicilio: 'Carta a mi domicilio' }
export const DOCS = { DNI: 'DNI', CE: 'Carné de extranjería', PASAPORTE: 'Pasaporte' }

export const LEYENDAS = [
  'La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI.',
  `El proveedor deberá dar respuesta al reclamo o queja en un plazo no mayor a ${PLAZO_DIAS} días hábiles improrrogables.`,
]

// "EL TRIUNFO DE NESHUYA" → "El Triunfo de Neshuya" (como nombre_bonito de la base)
const MENORES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'en', 'e'])
export const bonito = s => String(s || '').toLowerCase().split(/\s+/).filter(Boolean)
  .map((w, i) => (i > 0 && MENORES.has(w)) ? w : w[0].toUpperCase() + w.slice(1)).join(' ')

export const soles = n => n == null || n === '' ? '' : 'S/ ' + Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// fecha y hora de Lima (UTC−5, sin horario de verano)
const lima = iso => new Date(new Date(iso).getTime() - 5 * 3600 * 1000).toISOString()
export const fechaPe = iso => iso ? lima(iso).slice(0, 10).split('-').reverse().join('/') : ''
export const horaPe = iso => {
  if (!iso) return ''
  const [h, m] = lima(iso).slice(11, 16).split(':').map(Number)
  return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' a. m.' : ' p. m.')
}
export const fechaHoraPe = iso => iso ? fechaPe(iso) + ', ' + horaPe(iso) : ''
export const fechaSolaPe = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : ''

export const nombreArchivo = h => `HOJA DE RECLAMACION ${h.numero} ${String(h.empresa?.razon_social || '').replace(/[\\/:*?"<>|.]+/g, ' ').trim()}`.slice(0, 110) + '.pdf'

// ------------------------------------------------------------------- PDF --
// La hoja en A4, con las 4 partes del formato oficial. `h` = lo que devuelve libro_hoja().
export async function hojaPdf(h) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const M = 16, W = 210 - 2 * M
  const VERDE = [24, 57, 53]
  let y = 16

  const salto = alto => { if (y + alto > 280) { doc.addPage(); y = 18 } }
  const titulo = t => {
    salto(14)
    y += 3
    doc.setFillColor(...VERDE); doc.rect(M, y, W, 7, 'F')
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    doc.text(t, M + 2.5, y + 4.9)
    doc.setTextColor(30)
    y += 10
  }
  // una fila de campos: [[etiqueta, valor, ancho relativo], ...]
  const fila = campos => {
    const total = campos.reduce((s, c) => s + (c[2] || 1), 0)
    const partes = campos.map(c => {
      const w = W * (c[2] || 1) / total
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
      return { ...c, w, lineas: doc.splitTextToSize(String(c[1] ?? '').trim() || '—', w - 3) }
    })
    const alto = 4.2 + Math.max(...partes.map(p => p.lineas.length)) * 4.3 + 2
    salto(alto)
    let x = M
    for (const p of partes) {
      doc.setDrawColor(200); doc.setLineWidth(0.2); doc.rect(x, y, p.w, alto)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(95)
      doc.text(String(p[0]).toUpperCase(), x + 1.5, y + 3.3)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(25)
      p.lineas.forEach((l, i) => doc.text(l, x + 1.5, y + 7.6 + i * 4.3))
      x += p.w
    }
    y += alto
  }
  // un texto largo (detalle, pedido, respuesta) que puede pasar de página
  const bloque = (etiqueta, texto) => {
    salto(12)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(95)
    doc.text(String(etiqueta).toUpperCase(), M + 1.5, y + 3.3)
    y += 5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(25)
    for (const parrafo of String(texto || '—').replace(/\r/g, '').split('\n')) {
      for (const l of (parrafo.trim() ? doc.splitTextToSize(parrafo, W - 3) : [''])) {
        salto(5); doc.text(l, M + 1.5, y + 3.4); y += 4.4
      }
    }
    y += 2
  }

  // ---- cabecera: el libro y el número ----
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...VERDE)
  doc.text('LIBRO DE RECLAMACIONES', M, y + 4)
  doc.setFontSize(10.5); doc.setTextColor(30)
  doc.text('HOJA DE RECLAMACIÓN', M, y + 10)
  doc.setFillColor(245, 243, 236); doc.setDrawColor(...VERDE); doc.setLineWidth(0.5)
  doc.roundedRect(210 - M - 62, y - 2, 62, 16, 2, 2, 'FD')
  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.text('N°', 210 - M - 31, y + 3, { align: 'center' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(String(h.numero || ''), 210 - M - 31, y + 10, { align: 'center' })
  y += 18
  fila([['Fecha', fechaHoraPe(h.fecha), 1], ['Proyecto', h.proyecto, 2]])
  fila([['Razón social del proveedor', h.empresa?.razon_social, 2], ['RUC', h.empresa?.ruc, 1]])
  fila([['Domicilio fiscal', h.empresa?.direccion, 1], ['Atención al público', h.empresa?.atencion, 1]])

  const c = h.consumidor || {}
  titulo('1. IDENTIFICACIÓN DEL CONSUMIDOR RECLAMANTE')
  fila([['Nombre completo', c.nombre, 2], [DOCS[c.doc_tipo] || c.doc_tipo || 'Documento', c.doc_numero, 1]])
  fila([['Domicilio', c.domicilio, 1]])
  fila([['Teléfono', c.telefono, 1], ['Correo electrónico', c.correo, 2]])
  if (c.menor_de_edad) fila([['Padre, madre o apoderado (menor de edad)', c.apoderado_nombre, 2], ['Su documento', c.apoderado_doc, 1]])

  const b = h.bien || {}
  titulo('2. IDENTIFICACIÓN DEL BIEN CONTRATADO')
  fila([['Tipo', b.tipo === 'servicio' ? 'Servicio' : 'Producto', 1], ['Monto reclamado', soles(b.monto) || '—', 1]])
  fila([['Descripción', b.descripcion, 1]])

  titulo('3. DETALLE DE LA RECLAMACIÓN Y PEDIDO DEL CONSUMIDOR')
  fila([['Tipo', (TIPOS[h.tipo]?.t || h.tipo || '').toUpperCase() + ' — ' + (TIPOS[h.tipo]?.d || ''), 1]])
  bloque('Detalle', h.detalle)
  bloque('Pedido', h.pedido)
  fila([['Respuesta solicitada por', MEDIOS[h.respuesta_medio] || h.respuesta_medio, 1]])

  titulo('4. OBSERVACIONES Y ACCIONES ADOPTADAS POR EL PROVEEDOR')
  if (h.respuesta) {
    fila([['Fecha de comunicación de la respuesta', fechaHoraPe(h.respuesta_at), 1]])
    bloque('Respuesta', h.respuesta)
  } else {
    bloque('Estado', `Pendiente de respuesta. El proveedor responderá en un plazo no mayor a ${PLAZO_DIAS} días hábiles.`)
  }

  // ---- leyendas obligatorias ----
  salto(22)
  y += 3
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); doc.setTextColor(70)
  for (const t of [
    '• RECLAMO: ' + TIPOS.reclamo.d + '   • QUEJA: ' + TIPOS.queja.d,
    ...LEYENDAS.map(l => '• ' + l),
  ]) {
    for (const l of doc.splitTextToSize(t, W)) { salto(4); doc.text(l, M, y); y += 3.6 }
  }

  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5); doc.setTextColor(130)
    doc.text('Hoja de reclamación virtual · urbisgroupinmobiliaria.com/libro-de-reclamaciones', 105, 290, { align: 'center' })
    if (n > 1) doc.text(i + ' / ' + n, 210 - M, 290, { align: 'right' })
  }
  return doc
}

export async function descargarHoja(h) {
  const doc = await hojaPdf(h)
  doc.save(nombreArchivo(h))
}
