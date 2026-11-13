// CARTAS DE COBRANZA (sql/155, 21 oct 2026)
//
// La carta se escribe desde una plantilla: {cliente}, {lote}, {deuda}… se llenan
// con los datos de la venta (carta_datos) y el texto queda editable hasta que la
// socia del proyecto la firma. Firmada, el texto ya no cambia: el PDF se arma
// aquí, en el navegador, con el membrete del proyecto, la firma registrada de la
// socia y su código de verificación. El mismo PDF se imprime y se manda por
// WhatsApp (se sube a R2 en cobranza/cartas/).
import { jsPDF } from 'jspdf'
import { letras } from './letras'
import { subirRuta } from './archivos'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']
export const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fechaCorta = s => s ? String(s).slice(0, 10).split('-').reverse().join('/') : ''
export const fechaLarga = iso => {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return `${d} de ${MESES[m - 1]} de ${y}`
}

// Las variables que se pueden usar en una plantilla, con su explicación (la
// pestaña Plantillas las muestra para que se puedan copiar).
export const VARIABLES = [
  ['fecha', 'fecha de hoy en letras: 21 de octubre de 2026'],
  ['cliente', 'nombre completo del cliente'],
  ['doc_tipo', 'DNI, CE, RUC…'],
  ['dni', 'número de documento'],
  ['direccion', 'dirección, distrito y provincia del cliente'],
  ['cotitular', 'nombre del cotitular (si tiene)'],
  ['lote', 'manzana-lote: A-12'],
  ['mz', 'manzana'],
  ['lt', 'lote'],
  ['proyecto', 'nombre del proyecto'],
  ['empresa', 'razón social del proyecto'],
  ['ruc', 'RUC del proyecto'],
  ['cuotas_vencidas', 'cuántas cuotas vencidas tiene'],
  ['deuda', 'la deuda vencida: S/ 1,020.00'],
  ['deuda_letras', 'la deuda en letras: MIL VEINTE CON 00/100'],
  ['detalle_cuotas', 'una línea por cuota vencida, con su fecha y saldo'],
  ['primera_vencida', 'fecha de la cuota vencida más antigua'],
  ['plazo_dias', 'los días de plazo de la carta'],
  ['socia', 'nombre de la socia que firma'],
]

// Llena la plantilla con los datos de la venta. Lo que no se conoce queda como
// raya para que se vea y se complete a mano antes de mandarla a firmar.
export function llenarPlantilla(texto, d, plazo) {
  const cuotas = d?.cuotas || []
  const valores = {
    fecha: fechaLarga(d?.hoy),
    cliente: d?.cliente || '',
    doc_tipo: d?.doc_tipo || 'DNI',
    dni: d?.dni || '',
    direccion: d?.direccion || '',
    cotitular: d?.cotitular || '',
    lote: d?.lote || '',
    mz: d?.mz || '',
    lt: d?.lt || '',
    proyecto: d?.proyecto || '',
    empresa: d?.empresa || '',
    ruc: d?.ruc || '',
    cuotas_vencidas: String(d?.cuotas_vencidas ?? cuotas.length),
    deuda: soles(d?.deuda),
    deuda_letras: letras(Number(d?.deuda || 0)),
    detalle_cuotas: cuotas.map(c => `   • Cuota N° ${c.n}, vencida el ${fechaCorta(c.vence)}: ${soles(c.saldo)}`).join('\n'),
    primera_vencida: cuotas.length ? fechaCorta(cuotas[0].vence) : '',
    plazo_dias: String(plazo ?? 7),
    socia: (d?.socias || []).length === 1 ? d.socias[0].nombre : '',
  }
  return String(texto || '').replace(/\{([a-z_]+)\}/g, (m, k) => (k in valores ? (valores[k] || '________') : m))
}

// Lo que se ve de cada estado (en la lista y en la ficha de la carta)
export const ESTADOS = {
  por_firmar: { t: 'Por firmar', c: 'st-firma', i: '✍' },
  firmada: { t: 'Firmada · por entregar', c: 'st-info', i: '🖨' },
  entregada: { t: 'Entregada · en plazo', c: 'st-ok', i: '📬' },
  vencida: { t: 'Plazo vencido', c: 'st-per', i: '⏰' },
  cerrada: { t: 'Cerrada', c: 'st-na', i: '✔' },
  anulada: { t: 'Anulada', c: 'st-na', i: '✖' },
}
// una carta entregada cuyo plazo ya pasó se ve como "plazo vencido"
export const estadoVisible = (c, hoy) => c.estado === 'entregada' && c.plazo_vence && c.plazo_vence < hoy ? 'vencida' : c.estado

export const RESULTADOS = {
  pago: { t: 'Pagó / se puso al día', i: '✅', cierra: true },
  acuerdo: { t: 'Acuerdo de pago', i: '🤝' },
  escalar: { t: 'Sin respuesta: pasar a otra carta', i: '📨' },
  expropiar: { t: 'Resolución: expropiar el lote', i: '⛔', cierra: true },
  no_ubicado: { t: 'No se ubicó al cliente', i: '🔍' },
  rechazo: { t: 'No quiso recibirla', i: '🚫' },
  otro: { t: 'Otro', i: '📝' },
}

// ------------------------------------------------------------------- PDF --

// Una imagen de R2 como PNG para el PDF. Se pide sin la copia guardada del
// navegador: esa copia no trae el permiso CORS (ver logoPng en contratoArchivos).
async function imagenPng(url, alto) {
  if (!url) return null
  let src = null
  try {
    const r = await fetch(url, { mode: 'cors', cache: 'no-store' })
    if (!r.ok) throw new Error(String(r.status))
    src = URL.createObjectURL(await r.blob())
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = src })
    const w = Math.min(Math.round((img.naturalWidth / img.naturalHeight || 1) * alto), alto * 4)
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = alto
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, alto)
    ctx.drawImage(img, 0, 0, w, alto)
    return { dataUrl: cv.toDataURL('image/png'), w, h: alto }
  } catch { return null } finally { if (src) URL.revokeObjectURL(src) }
}

// La carta en PDF. `c` es la fila de cartas_listar; `p` el proyecto (con su logo,
// razón social, RUC y dirección). Devuelve el jsPDF armado.
export async function cartaPdf(c, p) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const M = 22, ANCHO = 210 - 2 * M
  const [logo, firma] = await Promise.all([
    imagenPng(p?.fact_logo_url || p?.logo_url, 160),
    c.firma_url ? imagenPng(c.firma_url, 160) : null,
  ])
  const empresa = (p?.fact_razon_social || '').trim() || 'URBIS GROUP'

  // membrete: logo a la izquierda, empresa y RUC a la derecha, una raya debajo
  let y = 16
  if (logo) {
    const h = 16, w = Math.min(h * logo.w / logo.h, 60)
    doc.addImage(logo.dataUrl, 'PNG', M, y - 2, w, h)
  }
  doc.setTextColor(30)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11)
  doc.text(empresa, 210 - M, y + 3, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  const cab = [p?.fact_ruc ? 'RUC ' + p.fact_ruc : '', (p?.fact_direccion || '').trim(), p?.name || ''].filter(Boolean)
  cab.forEach((t, i) => doc.text(doc.splitTextToSize(t, 110)[0], 210 - M, y + 8 + i * 4, { align: 'right' }))
  y = Math.max(y + 18, y + 8 + cab.length * 4 + 2)
  doc.setDrawColor(24, 57, 53); doc.setLineWidth(0.6); doc.line(M, y, 210 - M, y)
  y += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('CARTA N° ' + String(c.numero).padStart(5, '0'), 210 - M, y, { align: 'right' })
  y += 8

  // el cuerpo, tal cual se firmó. Se respeta cada salto de línea.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(25)
  const alto = 5.1
  for (const parrafo of String(c.cuerpo || '').replace(/\r/g, '').split('\n')) {
    const lineas = parrafo.trim() === '' ? [''] : doc.splitTextToSize(parrafo, ANCHO)
    for (const l of lineas) {
      if (y > 262) { doc.addPage(); y = 22 }
      // la línea del asunto va en negrita
      doc.setFont('helvetica', /^\s*asunto\s*:/i.test(parrafo) ? 'bold' : 'normal')
      doc.text(l, M, y)
      y += l === '' ? alto * 0.7 : alto
    }
  }

  // la firma de la socia (o el espacio vacío si todavía no firma)
  if (y > 225) { doc.addPage(); y = 30 }
  y += 14
  const cx = 105
  if (firma) {
    const h = 22, w = Math.min(h * firma.w / firma.h, 70)
    doc.addImage(firma.dataUrl, 'PNG', cx - w / 2, y, w, h)
  }
  y += 24
  doc.setDrawColor(60); doc.setLineWidth(0.3); doc.line(cx - 35, y, cx + 35, y)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
  doc.text((c.firmado_nombre || 'Pendiente de firma').toUpperCase(), cx, y + 5, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  if (c.firmado_dni) doc.text('DNI ' + c.firmado_dni, cx, y + 9.5, { align: 'center' })
  doc.text(empresa, cx, y + (c.firmado_dni ? 14 : 9.5), { align: 'center' })

  // pie: el código de verificación de la firma
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5); doc.setTextColor(120)
    const pie = c.codigo
      // "en el sistema", no "digitalmente": firma digital es la del certificado (Ley 27269)
      ? `Firmado en el sistema por ${c.firmado_nombre} el ${fechaCorta(c.firmado_at)} · código de verificación ${c.codigo}`
      : 'BORRADOR — sin firma: no entregar'
    doc.text(pie, 105, 288, { align: 'center' })
    if (n > 1) doc.text(i + ' / ' + n, 210 - M, 288, { align: 'right' })
  }
  return doc
}

export const nombrePdf = c => `CARTA ${c.numero} LOTE ${c.lote} ${String(c.cliente || '').replace(/[\\/:*?"<>|]+/g, ' ').trim()}`.slice(0, 120) + '.pdf'

// Sube el PDF firmado a R2 y devuelve su dirección (para mandarlo por WhatsApp).
export async function subirPdf(c, p) {
  const doc = await cartaPdf(c, p)
  const file = new File([doc.output('blob')], nombrePdf(c), { type: 'application/pdf' })
  return subirRuta(`cobranza/cartas/${c.id}-${Date.now()}.pdf`, file, { comprimir: false, abrirWord: false })
}
