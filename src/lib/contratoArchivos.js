// ============================================================================
// EL CONTRATO COMO ARCHIVO — PDF y Word                           [28 sep 2026]
// ----------------------------------------------------------------------------
// Lee el contrato TAL COMO ESTÁ EN PANTALLA (con lo corregido en "Editar texto")
// y lo arma como:
//   · PDF (jsPDF): texto de verdad, no una foto; se puede buscar y copiar
//   · Word (.docx): editable, en Times New Roman como el papel
// Las dos librerías se precargan al abrir el contrato. Toda hoja lleva arriba el
// encabezado ("Contrato de Compromiso de Compraventa - H.U.P. <proyecto>") y abajo
// el pie y el foliado, igual que la impresión (imprimirConPie).
// ============================================================================

// Pie de cada hoja: en el centro, chico y en cursiva. Sin nombre de empresa: Urbis
// Group Real Estate todavía no está constituida (pedido del dueño, 30 sep).
export const PIE = 'Documento Privado Confidencial'
// Foliado de cada hoja, abajo a la derecha: "1 de 10", "2 de 10"...
const folio = (n, total) => n + ' de ' + total
// Todo el contrato en letra 10 (pedido del 30 sep)
const TAM = 10
// Espaciado mínimo (pedido del 30 sep): interlineado 1.25 y poco aire entre párrafos,
// para que las firmas entren en la hoja de la última cláusula
const INTER = 1.25

// ---------------------------------------------------------------- leer la pantalla
const esNegrita = n => n.tagName === 'B' || n.tagName === 'STRONG' || /^(bold|bolder|[6-9]00)$/.test(n.style?.fontWeight || '')

// trozos de texto { t, b } y saltos de línea { br }
function runsDe(nodo, negrita = false, out = []) {
  for (const n of nodo.childNodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.nodeValue.replace(/\s+/g, ' ')
      if (t) out.push({ t, b: negrita })
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      if (n.tagName === 'BR') out.push({ br: true })
      else if (!/^(IMG|SVG|SCRIPT|STYLE)$/i.test(n.tagName)) runsDe(n, negrita || esNegrita(n), out)
    }
  }
  return out
}

// sin espacios de más al inicio, al final ni alrededor de los saltos
function limpiar(runs) {
  const out = []
  for (const r of runs) {
    if (r.br) { out.push({ br: true }); continue }
    const prev = out[out.length - 1]
    let t = r.t
    if (!prev || prev.br || /\s$/.test(prev.t)) t = t.replace(/^\s+/, '')
    if (!t) continue
    if (prev && !prev.br && prev.b === r.b) prev.t += t
    else out.push({ t, b: r.b })
  }
  while (out.length && out[0].br) out.shift()
  while (out.length && out[out.length - 1].br) out.pop()
  out.forEach((r, i) => { if (!r.br && (i === out.length - 1 || out[i + 1].br)) r.t = r.t.replace(/\s+$/, '') })
  return out.filter(r => r.br || r.t)
}

const esSalto = n => !!n.style && (n.style.pageBreakBefore === 'always' || n.style.breakBefore === 'page')
const BLOQUE = /^(P|DIV|H[1-6]|TABLE|UL|OL|LI|SECTION|ARTICLE|BLOCKQUOTE)$/

// El contrato como lista de bloques: cabecera, h2, h3, p, tabla, salto.
export function leerContrato(raiz) {
  const out = []
  const sueltos = []                           // texto escrito fuera de un párrafo (al editar)
  const soltar = () => { const runs = limpiar(sueltos.splice(0)); if (runs.length) out.push({ tipo: 'p', runs }) }
  const recorrer = el => {
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { const t = n.nodeValue.replace(/\s+/g, ' '); if (t.trim()) sueltos.push({ t, b: false }); continue }
      if (n.nodeType !== Node.ELEMENT_NODE) continue
      if (n.classList.contains('contract-head')) {
        soltar()
        out.push({ tipo: 'cabecera', img: n.querySelector('img'), svg: n.querySelector('svg'),
          nombre: n.querySelector('.ch-name')?.textContent.trim() || '', sub: n.querySelector('.ch-sub')?.textContent.trim() || '' })
        continue
      }
      if (!BLOQUE.test(n.tagName)) { if (n.tagName === 'BR') sueltos.push({ br: true }); else runsDe(n, esNegrita(n), sueltos); continue }
      soltar()
      if (esSalto(n)) out.push({ tipo: 'salto' })
      if (/^H[12]$/.test(n.tagName)) out.push({ tipo: 'h2', runs: limpiar(runsDe(n, true)) })
      else if (/^H[3-6]$/.test(n.tagName)) out.push({ tipo: 'h3', runs: limpiar(runsDe(n, true)) })
      else if (n.tagName === 'P') { const runs = limpiar(runsDe(n)); if (runs.length) out.push({ tipo: 'p', runs, centro: n.style.textAlign === 'center' }) }
      else if (n.tagName === 'TABLE') out.push({
        tipo: 'tabla', firmas: n.classList.contains('firmas'), compacta: n.classList.contains('compacta'),
        letra: Number(n.dataset?.letra) || null,           // el cronograma baja la letra si no entra en una hoja
        filas: [...n.rows].map(tr => ({ enc: tr.parentElement?.tagName === 'THEAD', celdas: [...tr.cells].map(c => limpiar(runsDe(c, c.tagName === 'TH'))) })),
      })
      else recorrer(n)
    }
    soltar()
  }
  recorrer(raiz)
  return out.filter(b => !(b.tipo === 'h2' || b.tipo === 'h3') || b.runs.length)
}

// El logo como PNG (el del proyecto o el de Urbis). Si no se puede leer, sin logo.
// TRAMPA (30 sep, "el logo no sale ni en el Word ni en el PDF"): la pantalla carga el
// logo de R2 como imagen común y el navegador guarda ESA copia, que no trae el permiso
// CORS (R2 solo lo manda si la petición dice de qué página viene). Al pedirlo de nuevo
// para el PDF salía esa copia y se descartaba en silencio. Por eso se pide sin usar la
// copia guardada (cache: 'no-store') y la pantalla lo carga con crossOrigin.
async function logoPng(cab) {
  let src = null
  try {
    if (cab.img?.src) {
      const r = await fetch(cab.img.src, { mode: 'cors', cache: 'no-store' })
      if (!r.ok) throw new Error('logo ' + r.status)
      src = URL.createObjectURL(await r.blob())
    } else if (cab.svg) {
      src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(cab.svg)], { type: 'image/svg+xml' }))
    } else return null
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = src })
    const h = 192                                                   // 3× los 64 px de pantalla: nítido al imprimir
    const w = Math.min(Math.round((img.naturalWidth / img.naturalHeight || 1) * h), h * 3)
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return { dataUrl: cv.toDataURL('image/png'), w, h }
  } catch { return null } finally { if (src) URL.revokeObjectURL(src) }
}

const nombreArchivo = s => String(s || 'Contrato').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)

// Arma el archivo y lo intenta bajar solo. Devuelve su dirección para un enlace
// "Guardar" de respaldo: si armarlo tarda (el Word carga una librería grande, y en
// una PC lenta son varios segundos), el navegador ya no lo cuenta como clic de la
// persona y puede bloquear la descarga EN SILENCIO, sobre todo si antes se bajó el
// PDF. Pasaba "en algunas computadoras" (30 sep). Quien lo usa libera la dirección.
export async function prepararArchivo(tipo, raiz, titulo, encabezado = '') {
  const blob = tipo === 'pdf' ? await armarPdf(raiz, encabezado) : await armarWord(raiz, titulo, encabezado)
  const nombre = nombreArchivo(titulo) + (tipo === 'pdf' ? '.pdf' : '.docx')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nombre
  document.body.appendChild(a); a.click(); a.remove()
  return { url, nombre }
}

// Al abrir el contrato se traen las librerías de PDF y Word por detrás: el clic en
// "Descargar" ya no espera la descarga de la librería.
export function precargar() {
  import('docx').catch(() => {})
  import('jspdf').catch(() => {})
  import('jspdf-autotable').catch(() => {})
}

// ---------------------------------------------------------------- PDF
// Las fuentes estándar del PDF solo tienen Latin-1: las tildes y la ñ entran,
// las comillas tipográficas y la raya larga se pasan a su versión simple.
const latin = s => String(s || '')
  .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
  .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/•/g, '-')
  .replace(/[   ]/g, ' ').replace(/[^\x00-\xFF]/g, '')

export async function armarPdf(raiz, encabezado = '') {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const bloques = leerContrato(raiz)
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const A4 = { w: 210, h: 297 }, M = { izq: 22, der: 22, arriba: 20, abajo: 24 }
  const PT = 0.3528                                                 // 1 punto en mm
  const ancho = A4.w - M.izq - M.der
  const limite = A4.h - M.abajo
  let y = M.arriba
  let enBlanco = true                                               // nada escrito aún en esta hoja
  const nuevaHoja = () => { doc.addPage(); y = M.arriba; enBlanco = true }
  const fuente = (b, size) => { doc.setFont('times', b ? 'bold' : 'normal'); doc.setFontSize(size) }
  // Ancho SIN kerning: getTextWidth lo descuenta pero doc.text no lo aplica, y las
  // mayúsculas ("COMPRAVENTA DE") se comían el espacio entre palabras.
  const medir = t => doc.getStringUnitWidth(t, { kerning: {} }) * doc.getFontSize() / doc.internal.scaleFactor
  doc.setTextColor(17)

  // párrafo con negritas en medio, justificado palabra por palabra. maquetar() solo
  // arma las líneas: sirve también para medir cuánto ocupa antes de escribirlo
  function maquetar(runs, size, negrita) {
    const tokens = []
    let finEspacio = true
    for (const r of runs) {
      if (r.br) { tokens.push({ br: true }); finEspacio = true; continue }
      const txt = latin(r.t)
      const empieza = /^\s/.test(txt)
      txt.split(/\s+/).filter(Boolean).forEach((t, i) => tokens.push({ t, b: negrita || r.b, junto: i === 0 && !empieza && !finEspacio }))
      finEspacio = /\s$/.test(txt)
    }
    const palabras = []
    for (const k of tokens) {
      if (k.br) { palabras.push({ br: true }); continue }
      fuente(k.b, size)
      const w = medir(k.t)
      const ult = palabras[palabras.length - 1]
      if (k.junto && ult && !ult.br) { ult.trozos.push({ t: k.t, b: k.b, w }); ult.w += w }
      else palabras.push({ trozos: [{ t: k.t, b: k.b, w }], w })
    }
    fuente(false, size)
    const esp = medir(' ')
    const lineas = []
    let actual = [], w = 0
    const cerrar = forzada => { lineas.push({ pals: actual, w, forzada }); actual = []; w = 0 }
    for (const p of palabras) {
      if (p.br) { cerrar(true); continue }
      if (actual.length && w + esp + p.w > ancho) cerrar(false)
      w += (actual.length ? esp : 0) + p.w
      actual.push(p)
    }
    if (actual.length) cerrar(true)
    return { lineas, esp }
  }
  const altoParrafo = (runs, { size = TAM, antes = 0, despues = 1.4, negrita = false } = {}) =>
    antes + maquetar(runs, size, negrita).lineas.length * size * PT * INTER + despues
  function parrafo(runs, { size = TAM, alinear = 'justify', antes = 0, despues = 1.4, negrita = false } = {}) {
    const lh = size * PT * INTER
    const { lineas, esp } = maquetar(runs, size, negrita)
    y += antes
    for (const ln of lineas) {
      if (y + lh > limite) nuevaHoja()
      let x = M.izq, gap = esp
      if (alinear === 'center') x = M.izq + (ancho - ln.w) / 2
      else if (alinear === 'justify' && !ln.forzada && ln.pals.length > 1) gap = esp + (ancho - ln.w) / (ln.pals.length - 1)
      const base = y + size * PT
      for (const p of ln.pals) {
        for (const tz of p.trozos) { fuente(tz.b, size); doc.text(tz.t, x, base); x += tz.w }
        x += gap
      }
      y += lh
      enBlanco = false
    }
    y += despues
  }

  async function cabecera(b) {
    const logo = await logoPng(b)
    const hLogo = 17
    const wLogo = logo ? Math.min(hLogo * logo.w / logo.h, 50) : 0
    const nombre = latin(b.nombre), sub = latin(b.sub)
    const cs1 = 0.4, cs2 = 0.9                                      // letter-spacing de la pantalla
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
    const wNom = medir(nombre) + cs1 * Math.max(0, nombre.length - 1)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    const wSub = medir(sub) + cs2 * Math.max(0, sub.length - 1)
    const sep = logo ? 5 : 0
    const x = M.izq + Math.max(0, (ancho - (wLogo + sep + Math.max(wNom, wSub))) / 2)
    if (logo) doc.addImage(logo.dataUrl, 'PNG', x, y, wLogo, hLogo)
    const tx = x + wLogo + sep
    doc.setTextColor(28, 42, 24); doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
    // sin subtítulo (desde el 30 sep la cabecera es solo el nombre del proyecto) el
    // nombre va centrado a la altura del logo
    doc.text(nombre, tx, y + (sub ? 8 : 10.5), { charSpace: cs1 })
    if (sub) {
      doc.setTextColor(85); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
      doc.text(sub, tx, y + 13, { charSpace: cs2 })
    }
    doc.setTextColor(17)
    y += hLogo + 3
    doc.setDrawColor(28, 42, 24)
    doc.setLineWidth(0.4); doc.line(M.izq, y, A4.w - M.der, y)
    doc.setLineWidth(0.2); doc.line(M.izq, y + 0.9, A4.w - M.der, y + 0.9)
    y += 6
    enBlanco = false
  }

  // las firmas: 13 mm para firmar sobre la raya y después nombre y documento
  const FIRMAR = 13
  const lineasFirma = f => f.celdas.map(runs => { const ls = [[]]; for (const r of runs) r.br ? ls.push([]) : ls[ls.length - 1].push(r); return ls })
  const altoFirmas = b => b.filas.reduce((s, f) => s + FIRMAR + Math.max(1, ...lineasFirma(f).map(c => c.length)) * TAM * PT * 1.3 + 2, 0)
  function firmas(b) {
    const size = TAM, lh = size * PT * 1.3
    for (const f of b.filas) {
      const wCol = ancho / (f.celdas.length || 1)
      const cels = lineasFirma(f)
      const alto = FIRMAR + Math.max(1, ...cels.map(c => c.length)) * lh
      if (y + alto > limite) nuevaHoja()
      cels.forEach((ls, i) => {
        let yy = y + FIRMAR
        const cx = M.izq + wCol * i + wCol / 2
        for (const ln of ls) {
          let w = 0
          for (const r of ln) { fuente(r.b, size); w += medir(latin(r.t)) }
          let x = cx - w / 2
          for (const r of ln) { fuente(r.b, size); const t = latin(r.t); doc.text(t, x, yy + size * PT); x += medir(t) }
          yy += lh
        }
      })
      y += alto + 2
      enBlanco = false
    }
  }

  const texto = runs => runs.map(r => (r.br ? '\n' : latin(r.t))).join('')
  // el cronograma (tabla "compacta") va fino para que entre en una hoja; su letra
  // viene de la pantalla (data-letra): 10, o menos si con 10 no entra
  const relleno = b => (b.compacta ? { top: 0.3, bottom: 0.3, left: 1.5, right: 1.5 } : { top: 1.2, bottom: 1.2, left: 2, right: 2 })
  const letraDe = b => b.letra || TAM

  function tabla(b) {
    if (b.firmas) return firmas(b)
    const todaNegrita = runs => { const t = runs.filter(r => !r.br && r.t.trim()); return t.length > 0 && t.every(r => r.b) }
    const fila = f => f.celdas.map(c => ({ content: texto(c), styles: todaNegrita(c) ? { fontStyle: 'bold' } : {} }))
    autoTable(doc, {
      startY: y + 1,
      head: b.filas.filter(f => f.enc).map(fila),
      body: b.filas.filter(f => !f.enc).map(fila),
      theme: 'grid',
      margin: { left: M.izq, right: M.der, top: M.arriba, bottom: M.abajo },
      styles: { font: 'times', fontSize: letraDe(b), textColor: 17, lineColor: [68, 68, 68], lineWidth: 0.2, fillColor: [255, 255, 255], cellPadding: relleno(b), overflow: 'linebreak', valign: 'middle', halign: b.compacta ? 'center' : 'left' },
      headStyles: { fillColor: [233, 240, 228], textColor: [28, 42, 24], fontStyle: 'bold' },   // el mismo verde claro de la pantalla
      // una tabla no se parte entre dos hojas: si no entra en lo que queda, empieza en la siguiente
      pageBreak: 'avoid',
      rowPageBreak: 'avoid',
      showHead: 'everyPage',
    })
    y = doc.lastAutoTable.finalY + 3
    enBlanco = false
  }

  // cuánto ocupará una tabla, para decidir antes si su título va en la hoja siguiente
  function altoTabla(b) {
    if (b.firmas) return altoFirmas(b)
    const cols = Math.max(1, ...b.filas.map(f => f.celdas.length))
    const util = Math.max(5, ancho / cols - 4)
    const pad = relleno(b)
    let alto = 4
    const t = letraDe(b)
    for (const f of b.filas) {
      fuente(f.enc, t)
      const lineas = Math.max(1, ...f.celdas.map(c => texto(c).split('\n').reduce((s, x) => s + Math.max(1, Math.ceil(medir(x) / util)), 0)))
      alto += lineas * t * PT * 1.15 + pad.top + pad.bottom
    }
    return alto
  }

  const opciones = b => (b.tipo === 'h2' ? { alinear: 'center', negrita: true, antes: enBlanco ? 0 : 1.5, despues: 2 }
    : b.tipo === 'h3' ? { alinear: 'left', negrita: true, antes: enBlanco ? 0 : 2, despues: 0.8 }
    : { alinear: b.centro ? 'center' : 'justify' })
  const corto = b => b?.tipo === 'p' && maquetar(b.runs, TAM, false).lineas.length <= 4
  // también las firmas: nunca quedan solas en una hoja, se llevan la última cláusula
  const esTabla = b => b?.tipo === 'tabla'

  for (let k = 0; k < bloques.length; k++) {
    const b = bloques[k]
    // el título de una tabla (y la línea que la presenta) va en la misma hoja que
    // la tabla; igual la última cláusula con las firmas: si juntos no entran en lo
    // que queda, pasan a la hoja siguiente
    if (!enBlanco && (b.tipo === 'h3' || b.tipo === 'p')) {
      const grupo = [b]
      if (b.tipo === 'h3' && corto(bloques[k + 1]) && esTabla(bloques[k + 2])) grupo.push(bloques[k + 1])
      const sigue = bloques[k + grupo.length]
      if (esTabla(sigue) && (b.tipo === 'h3' || corto(b))) {
        const alto = grupo.reduce((s, x) => s + altoParrafo(x.runs, opciones(x)), 0) + altoTabla(sigue)
        if (alto <= limite - M.arriba && y + alto > limite) nuevaHoja()
      }
    }
    if (b.tipo === 'cabecera') await cabecera(b)
    else if (b.tipo === 'salto') { if (!enBlanco) nuevaHoja() }
    else if (b.tipo === 'h2') parrafo(b.runs, opciones(b))
    else if (b.tipo === 'h3') {
      if (y + 3 * TAM * PT * INTER > limite) nuevaHoja()              // el título no queda solo al pie
      parrafo(b.runs, opciones(b))
    }
    else if (b.tipo === 'p') parrafo(b.runs, opciones(b))
    else if (b.tipo === 'tabla') tabla(b)
  }

  // arriba el encabezado; abajo, en el centro, el pie; y a la derecha el foliado
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(110)
    if (encabezado) doc.text(latin(encabezado), A4.w / 2, 12, { align: 'center' })
    const yp = A4.h - 15
    doc.setDrawColor(185); doc.setLineWidth(0.2); doc.line(M.izq, yp, A4.w - M.der, yp)
    doc.text(latin(PIE), A4.w / 2, yp + 5, { align: 'center' })
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(17)
    doc.text(folio(i, total), A4.w - M.der, yp + 5.5, { align: 'right' })
  }
  return doc.output('blob')
}

// ---------------------------------------------------------------- Word
export async function armarWord(raiz, titulo, encabezado = '') {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ImageRun, Header, Footer, PageNumber, Tab, TabStopType, ShadingType, LineRuleType } = await import('docx')
  const bloques = leerContrato(raiz)
  const hijos = []
  let saltoPendiente = false
  const corrida = (r, { size, negrita } = {}) => (r.br ? new TextRun({ break: 1 }) : new TextRun({ text: r.t, bold: negrita || r.b || undefined, size }))
  let trasTabla = false                       // el párrafo que sigue a una tabla se separa un poco
  const parrafo = (runs, { alinear = AlignmentType.JUSTIFIED, size, negrita, antes = 0, despues = 70, keepNext } = {}) => {
    hijos.push(new Paragraph({
      alignment: alinear, keepNext, pageBreakBefore: saltoPendiente || undefined,
      spacing: { before: antes + (trasTabla && !saltoPendiente ? 100 : 0), after: despues },
      children: runs.map(r => corrida(r, { size, negrita })),
    }))
    saltoPendiente = false
    trasTabla = false
  }
  // 1 punto de alto: no alcanza a empujar nada a otra hoja
  const diminuto = () => new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT }, children: [new TextRun({ text: '', size: 2 })] })
  const borde = { style: BorderStyle.SINGLE, size: 4, color: '444444' }
  const nada = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const todos = x => ({ top: x, bottom: x, left: x, right: x, insideHorizontal: x, insideVertical: x })

  // también las firmas: la línea de antes se queda con ellas (nunca solas en una hoja)
  const esTabla = b => b?.tipo === 'tabla'
  for (let k = 0; k < bloques.length; k++) {
    const b = bloques[k]
    if (b.tipo === 'cabecera') {
      const logo = await logoPng(b)
      if (logo) {
        const bytes = Uint8Array.from(atob(logo.dataUrl.split(',')[1]), ch => ch.charCodeAt(0))
        hijos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
          children: [new ImageRun({ type: 'png', data: bytes, transformation: { width: Math.round(64 * logo.w / logo.h), height: 64 } })] }))
      }
      // la doble raya va bajo la última línea de la cabecera (sin subtítulo, bajo el nombre)
      const raya = { bottom: { style: BorderStyle.DOUBLE, size: 6, color: '1C2A18', space: 6 } }
      hijos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: b.sub ? 0 : 280 }, ...(b.sub ? {} : { border: raya }),
        children: [new TextRun({ text: b.nombre, bold: true, font: 'Arial', size: 28, color: '1C2A18', characterSpacing: 30 })] }))
      if (b.sub) hijos.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 280 }, border: raya,
        children: [new TextRun({ text: b.sub, font: 'Arial', size: 14, color: '555555', characterSpacing: 40 })] }))
    } else if (b.tipo === 'salto') saltoPendiente = hijos.length > 0
    else if (b.tipo === 'h2') parrafo(b.runs, { alinear: AlignmentType.CENTER, negrita: true, antes: 80, despues: 140 })
    else if (b.tipo === 'h3') parrafo(b.runs, { alinear: AlignmentType.LEFT, negrita: true, antes: 160, despues: 40, keepNext: true })
    // la línea que presenta una tabla se queda con ella en la misma hoja
    else if (b.tipo === 'p') parrafo(b.runs, { alinear: b.centro ? AlignmentType.CENTER : AlignmentType.JUSTIFIED, keepNext: esTabla(bloques[k + 1]) || undefined })
    else if (b.tipo === 'tabla') {
      if (saltoPendiente) { hijos.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0 }, children: [] })); saltoPendiente = false }
      const ultima = b.filas.length - 1
      hijos.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: todos(b.firmas ? nada : borde),
        rows: b.filas.map((f, r) => new TableRow({
          tableHeader: f.enc || undefined,
          cantSplit: true,
          children: f.celdas.map(c => new TableCell({
            borders: b.firmas ? { top: nada, bottom: nada, left: nada, right: nada } : undefined,
            // encabezado con el mismo verde claro de la pantalla y del PDF
            shading: f.enc ? { fill: 'E9F0E4', type: ShadingType.CLEAR, color: 'auto' } : undefined,
            margins: b.compacta ? { top: 0, bottom: 0, left: 80, right: 80 } : { top: 40, bottom: 40, left: 100, right: 100 },
            children: [new Paragraph({
              alignment: b.firmas || b.compacta ? AlignmentType.CENTER : AlignmentType.LEFT,
              spacing: { before: b.firmas ? 740 : 0, after: 0, ...(b.compacta ? { line: 240 } : {}) },   // firmas: ~13 mm para firmar
              // "mantener con el siguiente" en todas las filas menos la última: Word no
              // parte la tabla entre dos hojas
              keepNext: r < ultima || undefined,
              children: c.map(x => corrida(x, { negrita: f.enc, size: b.letra ? Math.round(b.letra * 2) : undefined })),
            })],
          })),
        })),
      }))
      // Word pide un párrafo entre dos tablas seguidas y al final del documento: ahí va
      // uno diminuto. En los demás casos NO se pone: ese párrafo vacío, si la tabla
      // terminaba justo al pie, pasaba solo a la hoja siguiente y con el salto de página
      // dejaba una HOJA EN BLANCO (30 sep). El aire lo pone el párrafo que sigue.
      const sig = bloques[k + 1]
      if (!sig || sig.tipo === 'tabla') hijos.push(diminuto())
      else trasTabla = true
    }
  }

  const gris = { font: 'Arial', size: 15, color: '6E6E6E', italics: true }
  const anchoTexto = 11906 - 1247 * 2                                // A4 menos los márgenes
  // arriba de cada hoja: "Contrato de Compromiso de Compraventa - H.U.P. <proyecto>"
  const cabeza = new Header({ children: [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: encabezado, ...gris })] }),
  ] })
  // abajo: el pie en el centro y el foliado "1 de 10" a la derecha (campos de
  // Word: se numeran solos aunque se edite el documento)
  const pie = new Footer({ children: [
    new Paragraph({ spacing: { after: 0 },
      tabStops: [{ type: TabStopType.CENTER, position: anchoTexto / 2 }, { type: TabStopType.RIGHT, position: anchoTexto }],
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB', space: 4 } },
      children: [
        new TextRun({ ...gris, children: [new Tab(), PIE] }),
        new TextRun({ font: 'Arial', size: 20, bold: true, color: '111111', children: [new Tab(), PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES] }),
      ] }),
  ] })

  const doc = new Document({
    title: nombreArchivo(titulo), description: PIE,
    // interlineado sencillo: el espaciado mínimo que pidió el dueño
    styles: { default: { document: { run: { font: 'Times New Roman', size: TAM * 2 }, paragraph: { spacing: { line: 240 } } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1247, left: 1247, right: 1247, header: 567, footer: 567 } } },
      headers: { default: cabeza },
      footers: { default: pie },
      children: hijos,
    }],
  })
  return Packer.toBlob(doc)
}

// ---------------------------------------------------------------- impresión
// El mismo pie en cada hoja impresa. Solo mientras se imprime el contrato: una
// regla @page fija cambiaría también las otras impresiones del panel.
export function imprimirConPie(encabezado = '') {
  const css = t => String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const st = document.createElement('style')
  st.textContent = `@media print { @page { margin: 16mm 16mm 18mm;
    @top-center { content: "${css(encabezado)}"; font: italic 7.5pt Arial, sans-serif; color: #6e6e6e; }
    @bottom-center { content: "${css(PIE)}"; font: italic 7.5pt Arial, sans-serif; color: #6e6e6e; }
    @bottom-right { content: counter(page) " de " counter(pages); font: bold 10pt Arial, sans-serif; color: #111; } } }`
  document.head.appendChild(st)
  const quitar = () => { st.remove(); window.removeEventListener('afterprint', quitar) }
  window.addEventListener('afterprint', quitar)
  window.print()
  setTimeout(quitar, 1000)
}
