// ============================================================
// FASE 6 (26 nov 2026): los estilos sueltos más repetidos → clases compartidas
// ------------------------------------------------------------
// El panel tenía ~2.230 style={{…}} escritos a mano. Este script pasa los más repetidos
// (tamaños de letra, márgenes, alineación, flex, "sin mayúsculas"…) a clases chicas de
// src/styles/utilidades.css, que genera él mismo desde la tabla CLASES de abajo.
//
// Reglas para no cambiar NADA de cómo se ve:
//  · solo style={{…}} LITERALES (números y textos fijos) y solo si TODAS sus propiedades
//    están en la tabla; si sobra una, el estilo se queda como está
//  · nunca colores ni fondos ni bordes (el tema claro los ajusta por su estilo en línea)
//  · solo en etiquetas HTML (div, span, td…): un componente propio podría no aceptar className
//  · se salta la etiqueta si tiene {...props} o un className calculado
//  · las clases llevan !important (como el estilo en línea, ganan a las reglas normales) y
//    utilidades.css se carga ANTES que global.css (las pocas reglas !important de ahí, como
//    las de impresión, siguen ganando igual que antes)
//
//   node scripts/estilos-a-clases.mjs          → muestra qué cambiaría
//   node scripts/estilos-a-clases.mjs --hacer  → lo cambia y escribe utilidades.css
// ============================================================
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@babel/parser'
import traverseMod from '@babel/traverse'
const traverse = traverseMod.default || traverseMod

const HACER = process.argv.includes('--hacer')
const px = n => (n === 0 ? '0' : n + 'px')

// propiedad de React → { valor escrito en el código → [clase, css] }
const CLASES = {
  textTransform: { none: ['u-tt-n', 'text-transform: none'] },
  fontSize: Object.fromEntries([9, 10, 11, 12, 13, 14, 15, 16].map(n => [n, ['u-fs-' + n, 'font-size: ' + px(n)]])),
  textAlign: { right: ['u-ta-r', 'text-align: right'], center: ['u-ta-c', 'text-align: center'], left: ['u-ta-l', 'text-align: left'] },
  whiteSpace: { nowrap: ['u-nw', 'white-space: nowrap'] },
  flex: { 1: ['u-f1', 'flex: 1'] },
  margin: {
    0: ['u-m0', 'margin: 0'],
    ...Object.fromEntries([4, 6, 8, 10, 12].flatMap(n => [
      ['0 0 ' + n + 'px', ['u-m-00' + n, 'margin: 0 0 ' + n + 'px']],
      [n + 'px 0 0', ['u-m-' + n + '00', 'margin: ' + n + 'px 0 0']],
    ])),
  },
  marginTop: Object.fromEntries([0, 2, 4, 6, 8, 10, 12, 14, 16].map(n => [n, ['u-mt-' + n, 'margin-top: ' + px(n)]])),
  marginBottom: { ...Object.fromEntries([0, 2, 4, 6, 8, 10, 12, 14, 16].map(n => [n, ['u-mb-' + n, 'margin-bottom: ' + px(n)]])), '1rem': ['u-mb-1r', 'margin-bottom: 1rem'] },
  marginLeft: { auto: ['u-ml-a', 'margin-left: auto'], ...Object.fromEntries([4, 6, 8].map(n => [n, ['u-ml-' + n, 'margin-left: ' + px(n)]])) },
  cursor: { pointer: ['u-cp', 'cursor: pointer'] },
  maxWidth: { none: ['u-mxw-n', 'max-width: none'] },
  display: { none: ['u-d-n', 'display: none'], flex: ['u-d-f', 'display: flex'], block: ['u-d-b', 'display: block'], 'inline-block': ['u-d-ib', 'display: inline-block'], grid: ['u-d-g', 'display: grid'], 'inline-flex': ['u-d-if', 'display: inline-flex'] },
  padding: { 0: ['u-p0', 'padding: 0'], 8: ['u-p-8', 'padding: 8px'], 10: ['u-p-10', 'padding: 10px'], 12: ['u-p-12', 'padding: 12px'], 16: ['u-p-16', 'padding: 16px'], '1px 7px': ['u-p-1-7', 'padding: 1px 7px'] },
  width: { '100%': ['u-w-100', 'width: 100%'] },
  alignItems: { center: ['u-ai-c', 'align-items: center'], 'flex-start': ['u-ai-fs', 'align-items: flex-start'] },
  justifyContent: { 'space-between': ['u-jc-sb', 'justify-content: space-between'], center: ['u-jc-c', 'justify-content: center'], 'flex-end': ['u-jc-fe', 'justify-content: flex-end'] },
  flexWrap: { wrap: ['u-fwr', 'flex-wrap: wrap'] },
  flexDirection: { column: ['u-fd-c', 'flex-direction: column'] },
  gap: Object.fromEntries([4, 6, 8, 10, 12].map(n => [n, ['u-g-' + n, 'gap: ' + px(n)]])),
  fontWeight: { 600: ['u-fw-6', 'font-weight: 600'], 700: ['u-fw-7', 'font-weight: 700'], bold: ['u-fw-7', 'font-weight: 700'] },
}

const valorLiteral = n => {
  if (!n) return undefined
  if (n.type === 'StringLiteral') return n.value
  if (n.type === 'NumericLiteral') return n.value
  if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'NumericLiteral') return -n.argument.value
  return undefined
}

const archivos = []
const recorrer = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) recorrer(p); else if (p.endsWith('.jsx')) archivos.push(p) } }
recorrer('src')

let total = 0
const usadas = new Map()                         // clase → css
const porArchivo = []
for (const f of archivos) {
  const src = readFileSync(f, 'utf8')
  let ast
  try { ast = parse(src, { sourceType: 'module', plugins: ['jsx'] }) } catch (e) { console.warn('no se pudo leer', f, e.message); continue }
  const cambios = []                             // { desde, hasta, texto }
  traverse(ast, {
    JSXAttribute(p) {
      const at = p.node
      if (at.name.name !== 'style' || at.value?.type !== 'JSXExpressionContainer' || at.value.expression.type !== 'ObjectExpression') return
      const abre = p.parent
      if (abre.type !== 'JSXOpeningElement' || abre.name.type !== 'JSXIdentifier' || !/^[a-z]/.test(abre.name.name)) return
      if (abre.attributes.some(a => a.type === 'JSXSpreadAttribute')) return
      const props = at.value.expression.properties
      if (!props.length) return
      const clases = []
      for (const pr of props) {
        if (pr.type !== 'ObjectProperty' || pr.computed || pr.key.type !== 'Identifier') return
        const v = valorLiteral(pr.value)
        const fila = CLASES[pr.key.name]
        if (v === undefined || !fila || !fila[v]) return
        clases.push(fila[v])
      }
      const cn = abre.attributes.find(a => a.type === 'JSXAttribute' && a.name.name === 'className')
      let textoCn
      if (!cn) textoCn = null
      else if (cn.value?.type === 'StringLiteral') textoCn = cn.value.value
      else if (cn.value?.type === 'JSXExpressionContainer' && cn.value.expression.type === 'StringLiteral') textoCn = cn.value.expression.value
      else if (cn.value?.type === 'JSXExpressionContainer' && cn.value.expression.type === 'TemplateLiteral' && !cn.value.expression.expressions.length) textoCn = cn.value.expression.quasis[0].value.cooked
      else return                                 // className calculado: se deja como está
      const nombres = clases.map(c => c[0])
      clases.forEach(([c, css]) => usadas.set(c, css))
      // se quita el style (con el espacio de antes) y se pone/une el className
      let i = at.start; while (i > 0 && /\s/.test(src[i - 1])) i--
      cambios.push({ desde: i, hasta: at.end, texto: '' })
      if (!cn) cambios.push({ desde: abre.name.end, hasta: abre.name.end, texto: ` className="${nombres.join(' ')}"` })
      else cambios.push({ desde: cn.start, hasta: cn.end, texto: `className="${[textoCn.trim(), ...nombres].filter(Boolean).join(' ')}"` })
    },
  })
  if (!cambios.length) continue
  total += cambios.filter(c => c.texto === '').length
  porArchivo.push([f, cambios.filter(c => c.texto === '').length])
  if (HACER) {
    let out = src
    for (const c of cambios.sort((a, b) => b.desde - a.desde)) out = out.slice(0, c.desde) + c.texto + out.slice(c.hasta)
    writeFileSync(f, out)
  }
}

porArchivo.sort((a, b) => b[1] - a[1]).forEach(([f, n]) => console.log(String(n).padStart(4), f))
console.log('\nestilos pasados a clases:', total, '| clases usadas:', usadas.size, HACER ? '(HECHO)' : '(solo vista previa: --hacer para aplicar)')

if (HACER) {
  const css = `/* ============================================================
   CLASES CHICAS (fase 6, 26 nov 2026) — las GENERA scripts/estilos-a-clases.mjs
   Reemplazan los style={{…}} fijos más repetidos. Llevan !important para ganar a las
   reglas normales como ganaba el estilo en línea, y este archivo se carga ANTES que
   global.css (main.jsx) para que sus pocas reglas !important (impresión) sigan ganando.
   No editar a mano: agregar la clase en la tabla del script y volver a correrlo.
   ============================================================ */
` + [...usadas.entries()].sort().map(([c, v]) => `.${c} { ${v} !important; }`).join('\n') + '\n'
  writeFileSync('src/styles/utilidades.css', css)
  console.log('escrito src/styles/utilidades.css')
}
