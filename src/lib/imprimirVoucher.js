// La hoja A4 de un VOUCHER con su referencia arriba (proyecto, Mz y lote, cliente,
// concepto, monto, N° de operación y banco), para imprimirla o archivarla en papel.
// Pedido del dueño (18 nov 2026): la secretaria sube los vouchers y quedan en línea,
// pero también hacen falta impresos y que cada hoja diga de quién es.
//
// Sirve con lo que hay en la base (18 nov: ~3,300 fotos, 356 PDF, 21 Word):
//   - foto (jpg, jpeg, png, jfif): va entera debajo de la referencia;
//   - PDF: cada página va en su hoja (hasta 6), dibujada con pdf.js;
//   - Word que solo envuelve una foto: se saca la foto (como en la carga masiva).
// Este archivo se carga recién al apretar 🖨, así que no pesa en el panel.
import { jsPDF } from 'jspdf'
import { supabase } from './supabase'
import { fotoDentroDelWord } from './archivos'
import { soles, textoReparto } from './pagos'
import { fechaPe } from './lotes'

const MAX_PAGINAS = 6
const M = 14              // margen
const ANCHO = 210 - 2 * M  // 182 mm útiles
const PIE = 284           // hasta dónde puede bajar el voucher

const ahoraLima = () => new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date())
const unicos = xs => [...new Set(xs.filter(Boolean))]
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
const extension = url => (String(url).split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()

// ---- la referencia, a partir de las filas del pago que cubre este voucher ----
function referencia(items) {
  const r = items[0]
  const lotes = unicos(items.map(p => p.lot ? `${p.lot.mz}|${p.lot.lt}` : null)).map(x => x.split('|'))
  const cuotas = items.filter(p => p.income_type === 'cuota' && p.installment)
  const reparto = cuotas.map(p => ({ n: p.installment.installment_number, monto: Number(p.amount || 0) })).sort((a, b) => a.n - b.n)
  const nombreTipo = t => ({ separacion: 'SEPARACIÓN', inicial: 'INICIAL', cuota: 'CUOTA' }[t] || String(t || 'PAGO').toUpperCase())
  const concepto = cuotas.length === items.length && reparto.length
    ? (reparto.length > 1 ? 'CUOTAS N° ' + unicos(reparto.map(x => x.n)).join(' + ') : 'CUOTA N° ' + reparto[0].n)
    : unicos(items.map(p => p.income_type === 'cuota' && p.installment ? 'CUOTA N° ' + p.installment.installment_number : nombreTipo(p.income_type))).join(' + ')
  return {
    lote: lotes.length === 1 ? `MZ ${lotes[0][0]} · LOTE ${lotes[0][1]}`
      : lotes.length ? lotes.map(([mz, lt]) => `MZ ${mz} LT ${lt}`).join(' + ') : 'SIN LOTE',
    loteCorto: lotes.length ? lotes.map(([mz, lt]) => `Mz ${mz} Lt ${lt}`).join(' + ') : 'sin lote',
    cliente: unicos(items.map(p => p.client?.full_name)).join(' + ') || 'SIN CLIENTE',
    concepto,
    reparto: reparto.length > 1 ? textoReparto(reparto) : '',
    total: items.reduce((s, p) => s + Number(p.amount || 0), 0),
    fecha: fechaPe(r.date),
    operacion: r.operation_number && r.operation_number !== 'SIN-REF' ? r.operation_number : '—',
    // sin "→": la letra del PDF (helvetica) no la tiene y sale "!'"
    banco: [r.banco_origen, r.account?.name].filter(Boolean).join('  >  ') || '—',
  }
}

// lo que no viene con el historial: el proyecto (su nombre y su empresa) y el DNI
async function datosExtra(ids) {
  try {
    const { data } = await supabase.from('daily_income')
      .select('project:projects(name, fact_razon_social, fact_ruc), client:clients(doc_type, doc_number)')
      .in('id', ids.slice(0, 50))
    const filas = data || []
    const proy = filas.find(f => f.project)?.project || null
    const docs = unicos(filas.map(f => f.client?.doc_number ? `${f.client.doc_type || 'DOC'} ${f.client.doc_number}` : null))
    return { proyecto: proy, documento: docs.join(' + ') }
  } catch { return { proyecto: null, documento: '' } }
}

// ---- el archivo del voucher, convertido en una o varias imágenes ----
async function traer(url) {
  // la caché de Cloudflare puede guardar una copia sin CORS: se reintenta con otra URL
  for (const u of [url, url + (url.includes('?') ? '&' : '?') + 'imp=1']) {
    try {
      const r = await fetch(u)
      if (r.ok) return await r.blob()
    } catch { /* se intenta la siguiente */ }
  }
  throw new Error('No se pudo descargar el archivo del voucher.')
}

// cualquier imagen → JPEG sobre fondo blanco, girada como la foto dice (EXIF)
async function aJpeg(blob) {
  let img
  try { img = await createImageBitmap(blob, { imageOrientation: 'from-image' }) }
  catch {
    img = await new Promise((ok, mal) => {
      const el = new Image(); const u = URL.createObjectURL(blob)
      el.onload = () => { URL.revokeObjectURL(u); ok(el) }
      el.onerror = () => { URL.revokeObjectURL(u); mal(new Error('El archivo del voucher no es una imagen que se pueda leer.')) }
      el.src = u
    })
  }
  const w0 = img.width, h0 = img.height
  const k = Math.min(1, 2400 / Math.max(w0, h0))   // nítido en A4 sin pesar de más
  return lienzoAJpeg(Math.round(w0 * k), Math.round(h0 * k), ctx => ctx.drawImage(img, 0, 0, Math.round(w0 * k), Math.round(h0 * k)))
}

async function lienzoAJpeg(w, h, dibujar) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)   // un PNG transparente saldría negro
  await dibujar(ctx, c)
  return { data: c.toDataURL('image/jpeg', 0.9), w, h }
}

async function paginasDelPdf(blob) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { default: worker } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  const hojas = []
  for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGINAS); i++) {
    const page = await pdf.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(3, 1700 / base.width) })
    hojas.push(await lienzoAJpeg(Math.round(viewport.width), Math.round(viewport.height),
      ctx => page.render({ canvasContext: ctx, viewport }).promise))
  }
  return { hojas, total: pdf.numPages }
}

async function imagenesDelVoucher(url) {
  const blob = await traer(url)
  const ext = extension(url)
  if (blob.type === 'application/pdf' || ext === 'pdf') return paginasDelPdf(blob)
  if (ext === 'docx' || ext === 'doc' || /word/.test(blob.type)) {
    const foto = ext === 'docx' ? await fotoDentroDelWord(new File([blob], 'voucher.docx')) : null
    if (!foto) throw new Error('Este voucher es un documento de Word con texto, no una foto: ábrelo con VER e imprímelo desde Word.')
    return { hojas: [await aJpeg(foto)], total: 1 }
  }
  return { hojas: [await aJpeg(blob)], total: 1 }
}

// ---- la hoja ----
function armarPdf({ ref, extra, nota, hojas, totalPaginas }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const proyecto = extra.proyecto?.name || 'PROYECTO'
  const empresa = [extra.proyecto?.fact_razon_social, extra.proyecto?.fact_ruc && 'RUC ' + extra.proyecto.fact_ruc].filter(Boolean).join(' · ')
  const impreso = ahoraLima()
  const t = (s, x, y, { size = 10, bold = false, color = 25, align } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color)
    doc.text(String(s), x, y, align ? { align } : undefined)
  }
  const imagen = (h, top) => {
    const altoMax = PIE - top
    const k = Math.min(ANCHO / h.w, altoMax / h.h)
    const w = h.w * k, alto = h.h * k
    const x = M + (ANCHO - w) / 2
    doc.addImage(h.data, 'JPEG', x, top, w, alto, undefined, 'FAST')
    doc.setDrawColor(190); doc.setLineWidth(0.2); doc.rect(x, top, w, alto)
  }

  hojas.forEach((h, i) => {
    if (i > 0) doc.addPage()
    if (i === 0) {
      // cabecera: de qué proyecto es (cada proyecto con su nombre y su empresa)
      t(proyecto.toUpperCase(), M, 17, { size: 14, bold: true })
      t('VOUCHER DE PAGO', 210 - M, 17, { size: 10, bold: true, color: 90, align: 'right' })
      if (empresa) t(empresa, M, 22.5, { size: 8, color: 100 })
      t('Impreso el ' + impreso, 210 - M, 22.5, { size: 8, color: 100, align: 'right' })
      doc.setDrawColor(60); doc.setLineWidth(0.5); doc.line(M, 26, 210 - M, 26)

      // la referencia: lo que se busca al tener la hoja en la mano
      t(ref.lote, M, 36, { size: 19, bold: true })
      t(soles(ref.total), 210 - M, 36, { size: 17, bold: true, align: 'right' })
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
      const cliente = doc.splitTextToSize(ref.cliente, ANCHO - (extra.documento ? 48 : 0))[0]
      t(cliente, M, 43.5, { size: 12, bold: true })
      if (extra.documento) t(extra.documento, 210 - M, 43.5, { size: 10, color: 60, align: 'right' })

      const filas = [
        [['CONCEPTO', ref.concepto], ['FECHA DEL PAGO', ref.fecha]],
        [['N° DE OPERACIÓN', ref.operacion], ['BANCO DE ORIGEN  >  CUENTA DESTINO', ref.banco]],
      ]
      let y = 51
      doc.setDrawColor(200); doc.setLineWidth(0.2); doc.line(M, y - 3.5, 210 - M, y - 3.5)
      for (const fila of filas) {
        fila.forEach(([k, v], j) => {
          const x = M + j * (ANCHO / 2)
          t(k, x, y, { size: 7, color: 110 })
          doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5)
          t(doc.splitTextToSize(String(v), ANCHO / 2 - 4)[0], x, y + 4.6, { size: 10.5, bold: true })
        })
        y += 11
      }
      const extraLineas = [ref.reparto && 'Se repartió en: ' + ref.reparto, nota && 'Nota del voucher: ' + nota].filter(Boolean)
      for (const linea of extraLineas) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
        const partes = doc.splitTextToSize(linea, ANCHO).slice(0, 2)
        partes.forEach((p, k) => t(p, M, y - 1 + k * 4, { size: 8.5, color: 60 }))
        y += partes.length * 4 + 1.5
      }
      doc.setDrawColor(200); doc.line(M, y - 2.5, 210 - M, y - 2.5)
      imagen(h, y + 1)
    } else {
      // las páginas siguientes de un PDF: una línea para no perder de quién es
      t(`${ref.lote}  ·  ${ref.cliente}`.slice(0, 95), M, 16, { size: 10, bold: true })
      t(`VOUCHER (continuación, página ${i + 1})`, 210 - M, 16, { size: 8, color: 100, align: 'right' })
      doc.setDrawColor(60); doc.setLineWidth(0.4); doc.line(M, 19.5, 210 - M, 19.5)
      imagen(h, 23)
    }
  })

  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    t(`${proyecto} · ${ref.loteCorto} · ${ref.concepto} · ${soles(ref.total)}`.slice(0, 110), M, 291, { size: 7.5, color: 120 })
    t(n > 1 ? `Hoja ${i} de ${n}` : '', 210 - M, 291, { size: 7.5, color: 120, align: 'right' })
  }
  if (totalPaginas > hojas.length) {
    doc.setPage(n)
    t(`El PDF del voucher tiene ${totalPaginas} páginas: aquí van las primeras ${hojas.length}.`, M, 287.5, { size: 7.5, color: 150 })
  }
  doc.setProperties({ title: sinTildes(`Voucher ${ref.loteCorto} ${ref.cliente} ${ref.fecha}`) })
  return doc
}

// `items`: las filas del pago (columnas COLS_PAGO) que cubre ESTE voucher.
// `ventana`: la pestaña ya abierta con el clic (BotonImprimirVoucher la abre antes de
// cargar este archivo: si se abre después de esperar, el navegador la bloquea).
// La hoja sale en esa pestaña con el diálogo de imprimir (también se puede guardar).
export async function imprimirVoucher({ url, nota, items, ventana }) {
  const w = ventana === undefined ? window.open('', '_blank') : ventana
  try {
    if (!url || !items?.length) throw new Error('Este pago no tiene voucher para imprimir.')
    const [extra, { hojas, total }] = await Promise.all([datosExtra(items.map(p => p.id)), imagenesDelVoucher(url)])
    const doc = armarPdf({ ref: referencia(items), extra, nota, hojas, totalPaginas: total })
    doc.autoPrint()
    const blobUrl = URL.createObjectURL(doc.output('blob'))
    if (w) w.location.href = blobUrl
    else {
      const ref = referencia(items)
      const a = document.createElement('a'); a.href = blobUrl
      a.download = sinTildes(`Voucher-${ref.loteCorto}-${ref.cliente}`).replace(/[^a-z0-9]+/gi, '-').slice(0, 80) + '.pdf'
      a.click()
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120000)
  } catch (e) {
    if (w) w.close()
    throw e
  }
}
