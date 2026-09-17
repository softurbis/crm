// ============================================================================
// Manual de ventas en Word (.docx) → texto para el agente IA           [sep 2026]
// ----------------------------------------------------------------------------
// mammoth saca el texto del Word, pero "a secas" cada celda de una tabla sale en
// su propio renglón y las tablas de precios quedan ilegibles (una cifra por línea,
// sin saber de qué columna es). Aquí se pasa por HTML y cada fila de tabla queda
// en UNA línea: | 300 m² | S/67 | S/20,100 | S/500 |. Así la lee bien el agente y
// ocupa menos tokens. Los títulos quedan con #, las listas con - o 1.
// mammoth se carga solo al usarlo (pesa 500 KB), igual que en VisorDoc.
// ============================================================================

const limpio = el => (el.textContent || '').replace(/\s+/g, ' ').trim()

function aTexto(nodo, out) {
  for (const el of nodo.children) {
    const tag = el.tagName
    if (/^H[1-6]$/.test(tag)) {
      const t = limpio(el)
      if (t) out.push('', '#'.repeat(Number(tag[1])) + ' ' + t)
    } else if (tag === 'P') {
      const t = limpio(el)
      if (t) out.push(t)
    } else if (tag === 'UL' || tag === 'OL') {
      let i = 0
      for (const li of el.children) {
        const t = limpio(li)
        if (t) out.push((tag === 'OL' ? (++i) + '. ' : '- ') + t)
      }
    } else if (tag === 'TABLE') {
      out.push('')
      for (const tr of el.querySelectorAll('tr')) {
        const celdas = [...tr.children].map(limpio)
        if (celdas.some(Boolean)) out.push('| ' + celdas.join(' | ') + ' |')
      }
      out.push('')
    } else {
      aTexto(el, out)
    }
  }
}

export async function textoDeWord(arrayBuffer) {
  const { default: mammoth } = await import('mammoth/mammoth.browser.js')
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer })
  // un espacio después de cada párrafo: una celda con dos párrafos no pega la última
  // palabra del primero con la primera del segundo
  const conEspacios = html.replace(/<\/(p|li|h[1-6])>/g, '$& ')
  const doc = new DOMParser().parseFromString('<div id="raiz">' + conEspacios + '</div>', 'text/html')
  const out = []
  aTexto(doc.getElementById('raiz'), out)
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
