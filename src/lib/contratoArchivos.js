// ============================================================================
// EL CONTRATO COMO ARCHIVO — PDF y Word                           [28 sep 2026]
// ----------------------------------------------------------------------------
// Lee el contrato TAL COMO ESTÁ EN PANTALLA (con lo corregido en "Editar texto")
// y lo arma como:
//   · PDF (jsPDF): texto de verdad, no una foto; se puede buscar y copiar
//   · Word (.docx): editable, en Times New Roman como el papel
// Las dos librerías se cargan recién al tocar el botón. Toda hoja lleva el pie
// de Urbis Control, igual que la impresión (piePaginaImpresion).
// ============================================================================

export const PIE = 'Documento generado por Urbis Control · Sistema de gestión de Urbis Group Inmobiliaria'
const WEB = 'panel.urbisgroupinmobiliaria.com'
// Foliado de cada hoja, abajo a la derecha: "1 de 10", "2 de 10"...
const folio = (n, total) => n + ' de ' + total
const ahoraPe = () => new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

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
        tipo: 'tabla', firmas: n.classList.contains('firmas'),
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
async function logoPng(cab) {
  let src = null
  try {
    if (cab.img?.src) {
      const r = await fetch(cab.img.src, { mode: 'cors' })
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

function bajar(blob, archivo) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = archivo
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// ---------------------------------------------------------------- PDF
// Las fuentes estándar del PDF solo tienen Latin-1: las tildes y la ñ entran,
// las comillas tipográficas y la raya larga se pasan a su versión simple.
const latin = s => String(s || '')
  .replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"')
  .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/•/g, '-')
  .replace(/[   ]/g, ' ').replace(/[^\x00-\xFF]/g, '')

export async function descargarPdf(raiz, titulo) {
  bajar(await armarPdf(raiz), nombreArchivo(titulo) + '.pdf')
}
export async function descargarWord(raiz, titulo) {
  bajar(await armarWord(raiz, titulo), nombreArchivo(titulo) + '.docx')
}

export async function armarPdf(raiz) {
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

  // párrafo con negritas en medio, justificado palabra por palabra
  function parrafo(runs, { size = 12, alinear = 'justify', antes = 0, despues = 2.2, negrita = false } = {}) {
    const lh = size * PT * 1.45
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

  function firmas(b) {
    const size = 11, lh = size * PT * 1.4
    for (const f of b.filas) {
      const wCol = ancho / (f.celdas.length || 1)
      const cels = f.celdas.map(runs => { const ls = [[]]; for (const r of runs) r.br ? ls.push([]) : ls[ls.length - 1].push(r); return ls })
      const alto = 14 + Math.max(1, ...cels.map(c => c.length)) * lh
      if (y + alto > limite) nuevaHoja()
      cels.forEach((ls, i) => {
        let yy = y + 14
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

  function tabla(b) {
    if (b.firmas) return firmas(b)
    const texto = runs => runs.map(r => (r.br ? '\n' : latin(r.t))).join('')
    const todaNegrita = runs => { const t = runs.filter(r => !r.br && r.t.trim()); return t.length > 0 && t.every(r => r.b) }
    const fila = f => f.celdas.map(c => ({ content: texto(c), styles: todaNegrita(c) ? { fontStyle: 'bold' } : {} }))
    autoTable(doc, {
      startY: y + 1,
      head: b.filas.filter(f => f.enc).map(fila),
      body: b.filas.filter(f => !f.enc).map(fila),
      theme: 'grid',
      margin: { left: M.izq, right: M.der, top: M.arriba, bottom: M.abajo },
      styles: { font: 'times', fontSize: 10.5, textColor: 17, lineColor: [68, 68, 68], lineWidth: 0.2, fillColor: [255, 255, 255], cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 }, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: [255, 255, 255], textColor: 17, fontStyle: 'bold' },
      rowPageBreak: 'avoid',
      showHead: 'everyPage',
    })
    y = doc.lastAutoTable.finalY + 3
    enBlanco = false
  }

  for (const b of bloques) {
    if (b.tipo === 'cabecera') await cabecera(b)
    else if (b.tipo === 'salto') { if (!enBlanco) nuevaHoja() }
    else if (b.tipo === 'h2') parrafo(b.runs, { size: 13, alinear: 'center', negrita: true, antes: enBlanco ? 0 : 2, despues: 3 })
    else if (b.tipo === 'h3') {
      if (y + 3 * 12 * PT * 1.45 > limite) nuevaHoja()                // el título no queda solo al pie
      parrafo(b.runs, { alinear: 'left', negrita: true, antes: enBlanco ? 0 : 2.5, despues: 1.2 })
    }
    else if (b.tipo === 'p') parrafo(b.runs, { alinear: b.centro ? 'center' : 'justify' })
    else if (b.tipo === 'tabla') tabla(b)
  }

  const cuando = ahoraPe()
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    const yp = A4.h - 15
    doc.setDrawColor(185); doc.setLineWidth(0.2); doc.line(M.izq, yp, A4.w - M.der, yp)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110)
    doc.text(latin(PIE), M.izq, yp + 4)
    doc.text(latin(WEB + ' · generado el ' + cuando), M.izq, yp + 7.5)
    // foliado: "1 de 10", "2 de 10"...
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(17)
    doc.text(folio(i, total), A4.w - M.der, yp + 5.5, { align: 'right' })
  }
  return doc.output('blob')
}

// ---------------------------------------------------------------- Word
export async function armarWord(raiz, titulo) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ImageRun, Footer, PageNumber, Tab, TabStopType } = await import('docx')
  const bloques = leerContrato(raiz)
  const hijos = []
  let saltoPendiente = false
  const corrida = (r, { size, negrita } = {}) => (r.br ? new TextRun({ break: 1 }) : new TextRun({ text: r.t, bold: negrita || r.b || undefined, size }))
  const parrafo = (runs, { alinear = AlignmentType.JUSTIFIED, size, negrita, antes = 0, despues = 120, keepNext } = {}) => {
    hijos.push(new Paragraph({
      alignment: alinear, keepNext, pageBreakBefore: saltoPendiente || undefined,
      spacing: { before: antes, after: despues },
      children: runs.map(r => corrida(r, { size, negrita })),
    }))
    saltoPendiente = false
  }
  const borde = { style: BorderStyle.SINGLE, size: 4, color: '444444' }
  const nada = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const todos = x => ({ top: x, bottom: x, left: x, right: x, insideHorizontal: x, insideVertical: x })

  for (const b of bloques) {
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
    else if (b.tipo === 'h2') parrafo(b.runs, { alinear: AlignmentType.CENTER, size: 26, negrita: true, antes: 120, despues: 200 })
    else if (b.tipo === 'h3') parrafo(b.runs, { alinear: AlignmentType.LEFT, negrita: true, antes: 240, despues: 80, keepNext: true })
    else if (b.tipo === 'p') parrafo(b.runs, { alinear: b.centro ? AlignmentType.CENTER : AlignmentType.JUSTIFIED })
    else if (b.tipo === 'tabla') {
      if (saltoPendiente) { hijos.push(new Paragraph({ pageBreakBefore: true, spacing: { after: 0 }, children: [] })); saltoPendiente = false }
      hijos.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: todos(b.firmas ? nada : borde),
        rows: b.filas.map(f => new TableRow({
          tableHeader: f.enc || undefined,
          cantSplit: true,
          children: f.celdas.map(c => new TableCell({
            borders: b.firmas ? { top: nada, bottom: nada, left: nada, right: nada } : undefined,
            margins: { top: 40, bottom: 40, left: 100, right: 100 },
            children: [new Paragraph({
              alignment: b.firmas ? AlignmentType.CENTER : AlignmentType.LEFT,
              spacing: { before: b.firmas ? 900 : 0, after: 0 },
              children: c.map(r => corrida(r, { size: 22, negrita: f.enc })),
            })],
          })),
        })),
      }))
      hijos.push(new Paragraph({ spacing: { after: 60 }, children: [] }))
    }
  }

  const cuando = ahoraPe()
  const gris = { font: 'Arial', size: 15, color: '6E6E6E' }
  // a la izquierda Urbis Control; a la derecha el foliado "1 de 10" (campos de
  // Word: se numeran solos aunque se edite el documento)
  const pie = new Footer({ children: [
    new Paragraph({ spacing: { after: 0 },
      tabStops: [{ type: TabStopType.RIGHT, position: 11906 - 1247 * 2 }],   // el borde derecho del texto (A4 menos márgenes)
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB', space: 4 } },
      children: [
        new TextRun({ text: PIE, ...gris }),
        new TextRun({ font: 'Arial', size: 20, bold: true, color: '111111', children: [new Tab(), PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES] }),
      ] }),
    new Paragraph({ spacing: { after: 0 },
      children: [new TextRun({ text: WEB + ' · generado el ' + cuando, ...gris })] }),
  ] })

  const doc = new Document({
    creator: 'Urbis Control', title: nombreArchivo(titulo), description: PIE,
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 }, paragraph: { spacing: { line: 300 } } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1247, left: 1247, right: 1247, footer: 567 } } },
      footers: { default: pie },
      children: hijos,
    }],
  })
  return Packer.toBlob(doc)
}

// ---------------------------------------------------------------- impresión
// El mismo pie en cada hoja impresa. Solo mientras se imprime el contrato: una
// regla @page fija cambiaría también las otras impresiones del panel.
export function imprimirConPie() {
  const st = document.createElement('style')
  st.textContent = `@media print { @page { margin: 16mm 16mm 18mm;
    @bottom-left { content: "${PIE} · ${WEB}"; font: 7pt Arial, sans-serif; color: #6e6e6e; }
    @bottom-right { content: counter(page) " de " counter(pages); font: bold 10pt Arial, sans-serif; color: #111; } } }`
  document.head.appendChild(st)
  const quitar = () => { st.remove(); window.removeEventListener('afterprint', quitar) }
  window.addEventListener('afterprint', quitar)
  window.print()
  setTimeout(quitar, 1000)
}
