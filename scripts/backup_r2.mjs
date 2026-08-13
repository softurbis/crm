#!/usr/bin/env node
// ============================================================================
// RESPALDO DE LOS ARCHIVOS DE CLOUDFLARE R2
// ----------------------------------------------------------------------------
// Cloudflare NO hace copias de tus archivos: si se borra algo, se borró. Esto
// baja todo el bucket a disco (espejo incremental: solo trae lo que falta o
// cambió de tamaño), así que la segunda corrida en adelante es rápida.
//
// No necesita llaves: el bucket es público, y la lista de objetos se arma
// recorriendo el índice público del propio bucket... salvo que R2 no expone
// listados públicos, así que usamos la API S3 con credenciales de solo lectura.
//
//   node backup_r2.mjs --env RUTA_.env.r2 --out CARPETA
// ============================================================================
import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync, createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d }
const env = {}
for (const l of readFileSync(arg('env', '.env.r2'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim()
}
const OUT = arg('out', './copias/r2')
const PUB = (env.R2_PUBLIC_URL || '').replace(/\/$/, '')
const CONC = Number(arg('jobs', 5))
const mb = n => (n / 1048576).toFixed(1) + ' MB'

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
})

console.log('RESPALDO DE R2 — ' + new Date().toLocaleString())
const objetos = []
let token
do {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET, ContinuationToken: token }))
  for (const o of (r.Contents || [])) objetos.push({ key: o.Key, size: o.Size })
  token = r.NextContinuationToken
} while (token)
console.log(`${objetos.length} archivos · ${mb(objetos.reduce((s, o) => s + o.size, 0))}`)

let bajados = 0, saltados = 0, fallos = 0, bytes = 0
const cola = [...objetos]
const worker = async () => {
  for (;;) {
    const o = cola.shift()
    if (!o) return
    const destino = join(OUT, o.key)
    if (existsSync(destino) && statSync(destino).size === o.size) { saltados++; continue }
    try {
      // se descarga por la URL pública: no gasta operaciones de la API ni tiene costo de salida
      const r = await fetch(`${PUB}/${o.key.split('/').map(encodeURIComponent).join('/')}`)
      if (!r.ok) { fallos++; console.error(`  ✗ ${o.key}: HTTP ${r.status}`); continue }
      mkdirSync(dirname(destino), { recursive: true })
      await pipeline(Readable.fromWeb(r.body), createWriteStream(destino))
      bajados++; bytes += statSync(destino).size
      if (bajados % 100 === 0) console.log(`  ...${bajados} bajados (${mb(bytes)})`)
    } catch (e) { fallos++; console.error(`  ✗ ${o.key}: ${e.message}`) }
  }
}
await Promise.all(Array.from({ length: CONC }, worker))

writeFileSync(join(OUT, '_inventario.json'), JSON.stringify({ fecha: new Date().toISOString(), total: objetos.length, objetos }, null, 1))
console.log(`R2 OK → ${OUT} | nuevos: ${bajados} (${mb(bytes)}) | ya estaban: ${saltados} | fallos: ${fallos}`)
if (fallos) process.exitCode = 2
