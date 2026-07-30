#!/usr/bin/env node
// ============================================================================
// BACKUP DE SUPABASE (datos + storage) — Urbis Control
// ----------------------------------------------------------------------------
// Respaldar TODO lo que vive en Supabase usando la service_role:
//   1. DATOS: exporta cada tabla del esquema public a NDJSON (1 archivo/tabla).
//      La lista de tablas se descubre sola (OpenAPI de PostgREST) — si mañana
//      se crea una tabla nueva, entra al backup sin tocar este script.
//   2. STORAGE: espeja todos los buckets a disco (incremental: solo baja lo
//      que no existe o cambió de tamaño — las corridas siguientes son rápidas).
//
// Uso:
//   node backup_supabase.mjs --env RUTA_AL_.env --out CARPETA [--skip-storage]
//   El .env debe tener SUPABASE_URL y SUPABASE_SERVICE_KEY (NUNCA al repo).
//
// Estructura resultante:
//   CARPETA/data/AAAA-MM-DD/<tabla>.ndjson + _manifest.json
//   CARPETA/storage/<bucket>/<ruta del archivo>   (espejo acumulativo)
// ============================================================================
import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync, createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d }
const flag = n => process.argv.includes('--' + n)

const ENV_PATH = arg('env', '.env')
const OUT = arg('out', './backup-supabase')
const CONCURRENCY = Number(arg('jobs', 5))

// --- credenciales (del .env, jamás impresas) --------------------------------
const env = {}
for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)\s*=\s*(.+)\s*$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const URL_BASE = (env.SUPABASE_URL || '').replace(/\/$/, '')
const KEY = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_BASE || !KEY) { console.error('FALTA SUPABASE_URL o SUPABASE_SERVICE_KEY en ' + ENV_PATH); process.exit(1) }
const HDR = { apikey: KEY, Authorization: 'Bearer ' + KEY }

const hoy = new Date().toISOString().slice(0, 10)
const dataDir = join(OUT, 'data', hoy)
const storageDir = join(OUT, 'storage')
mkdirSync(dataDir, { recursive: true })

const fmtMB = b => (b / 1048576).toFixed(1) + ' MB'
async function req(url, opts = {}, intento = 1) {
  const r = await fetch(url, { ...opts, headers: { ...HDR, ...(opts.headers || {}) } })
  if (r.status === 429 || r.status >= 500) {
    if (intento <= 4) { await new Promise(s => setTimeout(s, 1500 * intento)); return req(url, opts, intento + 1) }
  }
  return r
}

// --- 1. DATOS ---------------------------------------------------------------
async function backupDatos() {
  console.log('— DATOS —')
  const spec = await (await req(URL_BASE + '/rest/v1/', { headers: { Accept: 'application/openapi+json' } })).json()
  const tablas = Object.keys(spec.definitions || {}).sort()
  if (!tablas.length) throw new Error('No pude listar las tablas (¿service key inválida/rotada?)')
  console.log(tablas.length + ' tablas descubiertas')

  const manifest = { fecha: new Date().toISOString(), tablas: {} }
  for (const t of tablas) {
    const cols = Object.keys(spec.definitions[t].properties || {})
    const orden = cols.includes('id') ? 'id' : cols.includes('created_at') ? 'created_at' : cols[0]
    let desde = 0, total = 0
    const out = createWriteStream(join(dataDir, t + '.ndjson'))
    for (;;) {
      const r = await req(`${URL_BASE}/rest/v1/${t}?select=*&order=${orden}.asc`, { headers: { Range: `${desde}-${desde + 999}`, 'Range-Unit': 'items' } })
      if (!r.ok && r.status !== 206 && r.status !== 416) { console.error(`  ${t}: HTTP ${r.status} — omitida`); break }
      const filas = r.status === 416 ? [] : await r.json()
      if (!Array.isArray(filas) || !filas.length) break
      for (const f of filas) out.write(JSON.stringify(f) + '\n')
      total += filas.length
      if (filas.length < 1000) break
      desde += 1000
    }
    out.end()
    manifest.tablas[t] = total
    console.log(`  ${t}: ${total} filas`)
  }
  writeFileSync(join(dataDir, '_manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('Datos OK → ' + dataDir)
}

// --- 2. STORAGE -------------------------------------------------------------
async function listarBucket(bucket, prefix = '') {
  const archivos = []
  let offset = 0
  for (;;) {
    const r = await req(`${URL_BASE}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    })
    if (!r.ok) { console.error(`  lista ${bucket}/${prefix}: HTTP ${r.status}`); break }
    const items = await r.json()
    for (const it of items) {
      const ruta = prefix ? prefix + '/' + it.name : it.name
      if (it.id === null) archivos.push(...await listarBucket(bucket, ruta))     // carpeta → recursar
      else archivos.push({ ruta, size: it.metadata?.size ?? -1 })
    }
    if (items.length < 1000) break
    offset += 1000
  }
  return archivos
}

async function backupStorage() {
  console.log('— STORAGE —')
  const buckets = await (await req(URL_BASE + '/storage/v1/bucket')).json()
  if (!Array.isArray(buckets)) throw new Error('No pude listar buckets: ' + JSON.stringify(buckets).slice(0, 200))
  let bajados = 0, saltados = 0, bytes = 0, fallos = 0

  for (const b of buckets) {
    const archivos = await listarBucket(b.name)
    console.log(`bucket "${b.name}": ${archivos.length} archivos`)
    const cola = [...archivos]
    const worker = async () => {
      for (;;) {
        const a = cola.shift()
        if (!a) return
        const destino = join(storageDir, b.name, a.ruta)
        if (existsSync(destino) && a.size >= 0 && statSync(destino).size === a.size) { saltados++; continue }
        try {
          const r = await req(`${URL_BASE}/storage/v1/object/${b.name}/${encodeURIComponent(a.ruta).replace(/%2F/g, '/')}`)
          if (!r.ok) { fallos++; console.error(`  FALLO ${b.name}/${a.ruta}: HTTP ${r.status}`); continue }
          mkdirSync(dirname(destino), { recursive: true })
          await pipeline(Readable.fromWeb(r.body), createWriteStream(destino))
          bajados++; bytes += statSync(destino).size
          if (bajados % 50 === 0) console.log(`  ...${bajados} bajados (${fmtMB(bytes)})`)
        } catch (e) { fallos++; console.error(`  FALLO ${b.name}/${a.ruta}: ${e.message}`) }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  }
  console.log(`Storage OK → ${storageDir} | bajados: ${bajados} (${fmtMB(bytes)}) | ya estaban: ${saltados} | fallos: ${fallos}`)
  if (fallos) process.exitCode = 2
}

// --- main -------------------------------------------------------------------
console.log('BACKUP SUPABASE — ' + new Date().toLocaleString())
await backupDatos()
if (!flag('skip-storage')) await backupStorage()
console.log('LISTO.')
