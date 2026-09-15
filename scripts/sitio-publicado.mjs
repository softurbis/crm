// Termina de armar una publicación para Cloudflare (npm run build:panel / build:publico).
//   · publico: el index sale de publico.html y de public/ solo se copia la
//     política de privacidad (lo demás son documentos internos).
//   · panel: que Google no lo muestre y que nadie lo meta dentro de otra página.
// Cloudflare sirve index.html en cualquier ruta cuando NO hay 404.html (modo
// SPA), así /p/<slug> responde 200. El truco del 404.html es solo de GitHub Pages.
import { renameSync, copyFileSync, writeFileSync } from 'node:fs'

const cara = process.argv[2]
const salida = { panel: 'dist-panel', publico: 'dist-publico' }[cara]
if (!salida) {
  console.error('Uso: node scripts/sitio-publicado.mjs panel|publico')
  process.exit(1)
}

const cabeceras = lineas => writeFileSync(`${salida}/_headers`, '/*\n' + lineas.map(l => '  ' + l).join('\n') + '\n')
const comunes = ['X-Content-Type-Options: nosniff', 'Referrer-Policy: strict-origin-when-cross-origin']

if (cara === 'publico') {
  renameSync(`${salida}/publico.html`, `${salida}/index.html`)
  copyFileSync('public/privacidad.html', `${salida}/privacidad.html`)
  cabeceras([...comunes, 'X-Frame-Options: SAMEORIGIN'])
  writeFileSync(`${salida}/robots.txt`, 'User-agent: *\nAllow: /\n')
} else {
  cabeceras([...comunes, 'X-Frame-Options: DENY', 'X-Robots-Tag: noindex, nofollow'])
  writeFileSync(`${salida}/robots.txt`, 'User-agent: *\nDisallow: /\n')
}

console.log(`✔ ${salida}/ listo para Cloudflare (${cara})`)
