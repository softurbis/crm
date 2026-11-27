// Termina de armar una publicación para Cloudflare (npm run build:panel / build:publico).
//   · publico: el index sale de publico.html y de public/ solo se copia la
//     política de privacidad (lo demás son documentos internos).
//   · panel: que Google no lo muestre y que nadie lo meta dentro de otra página.
// En Cloudflare cada cara es un Worker de solo archivos (wrangler.publico.jsonc /
// wrangler.panel.jsonc) en modo SPA: /p/<slug> responde index.html con 200. Por
// eso aquí no se crea 404.html.
import { renameSync, copyFileSync, writeFileSync, appendFileSync, cpSync, existsSync, readFileSync } from 'node:fs'
import { loadEnv } from 'vite'

const cara = process.argv[2]
const salida = { panel: 'dist-panel', publico: 'dist-publico' }[cara]
if (!salida) {
  console.error('Uso: node scripts/sitio-publicado.mjs panel|publico')
  process.exit(1)
}

// /assets/ son los archivos que arma Vite (JS y CSS): cada versión sale con OTRO nombre
// (index-DDvWsBnd.js), así que el navegador los puede guardar un año sin volver a
// preguntar. Antes Cloudflare decía "max-age=0" y en cada apertura el navegador
// reconfirmaba archivo por archivo con el servidor (26 nov: se notaba en PCs con
// antivirus que revisa la red). index.html sigue sin caché: por él llegan las versiones nuevas.
const ASSETS_INMUTABLES = '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n'
const cabeceras = lineas => writeFileSync(`${salida}/_headers`, '/*\n' + lineas.map(l => '  ' + l).join('\n') + '\n' + ASSETS_INMUTABLES)
const comunes = ['X-Content-Type-Options: nosniff', 'Referrer-Policy: strict-origin-when-cross-origin']

if (cara === 'publico') {
  renameSync(`${salida}/publico.html`, `${salida}/index.html`)
  copyFileSync('public/privacidad.html', `${salida}/privacidad.html`)
  // páginas públicas sueltas, tal cual: los recorridos 3D y las fotos 360° (/recorrido/<proyecto>/ y .../fotos/).
  // Sus imágenes están en R2 (recorridos/<proyecto>/), no en el repo.
  if (existsSync('sitio-publico')) cpSync('sitio-publico', salida, { recursive: true })
  // el contador de visitas (sql/231) lo cargan publico.html y los recorridos: aquí recibe la API y la
  // clave pública (las mismas que ya van dentro del JS de la web). Sin ellas, no cuenta nada.
  const env = loadEnv('production', process.cwd(), 'VITE_')
  const contador = `${salida}/contador.js`
  if (existsSync(contador)) {
    if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) console.warn('⚠ contador.js sin VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY: no va a contar')
    writeFileSync(contador, readFileSync(contador, 'utf8')
      .replace('%%SUPABASE_URL%%', String(env.VITE_SUPABASE_URL || '').replace(/\/+$/, ''))
      .replace('%%ANON_KEY%%', env.VITE_SUPABASE_ANON_KEY || ''))
  }
  cabeceras([...comunes, 'X-Frame-Options: SAMEORIGIN'])
  writeFileSync(`${salida}/robots.txt`, 'User-agent: *\nAllow: /\n')
} else {
  cabeceras([...comunes, 'X-Frame-Options: DENY', 'X-Robots-Tag: noindex, nofollow'])
  // la app instalable: el celular revisa el service worker en cada visita (si lo
  // guardara en caché, podría quedarse con uno viejo)
  appendFileSync(`${salida}/_headers`, '/sw.js\n  Cache-Control: no-cache\n/manifest.webmanifest\n  Cache-Control: no-cache\n')
  // la app de Windows (escritorio/compilar.ps1 la deja en public/app/): sin caché, para que la
  // versión nueva se vea apenas se publica; el .exe se descarga con su nombre
  appendFileSync(`${salida}/_headers`, '/app/*\n  Cache-Control: no-cache\n/app/UrbisControl.exe\n  Content-Disposition: attachment; filename="UrbisControl.exe"\n')
  writeFileSync(`${salida}/robots.txt`, 'User-agent: *\nDisallow: /\n')
}

console.log(`✔ ${salida}/ listo para Cloudflare (${cara})`)
