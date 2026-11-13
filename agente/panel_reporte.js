// ============================================================================
// REPORTERO DEL PANEL DE C-SOFT — resumen (solo totales)              [oct 2026]
// ----------------------------------------------------------------------------
// Proceso APARTE (pm2 `panel-reporte`): no toca el bot de leads ni el agente de
// cobranza. Cada minuto le manda un LATIDO liviano a panel.csoft.men y, una de
// cada cinco vueltas, el REPORTE COMPLETO: cobrado del mes y de hoy, cuotas
// vencidas y por vencer, ventas, leads, estado del agente de cobranza, totales
// por proyecto y lo cobrado por dia.
//
//  · SOLO TOTALES. Del sistema no sale ningun nombre, telefono, DNI ni detalle
//    de un contrato: se leen montos y fechas, se suman aca y viajan las sumas.
//  · SOLO INFORMA. Este proceso no cambia nada en la base (solo lee) y no
//    atiende ordenes del panel: no declara controles y, si la respuesta del
//    panel trae `ordenes`, las ignora.
//  · Sin PANEL_REPORTE_CLAVE no hace nada (ni consulta ni envia ni avisa): el
//    codigo puede estar desplegado antes de tener la clave. La clave se puede
//    pegar despues en el .env sin reiniciar: se relee solo.
//  · Cualquier error se anota con el prefijo [panel-reporte] y se sigue. Si el
//    panel no contesta no se insiste: se prueba en la vuelta siguiente.
//
// Correr:  pm2 start panel_reporte.js --name panel-reporte && pm2 save
// Probar:  node panel_reporte.js --una-vez     (un reporte completo y sale)
//          node panel_reporte.js --latido      (un latido y sale)
// .env:    PANEL_REPORTE_CLAVE (obligatoria para que haga algo), y opcionales
//          PANEL_REPORTE_URL y PANEL_REPORTE_SISTEMA. Usa SUPABASE_URL y
//          SUPABASE_SERVICE_KEY, que ya estan.
// Contrato: docs/panel-sistemas-externos.md del proyecto C-Soft (v1 + latido).
// ============================================================================
const dotenv = require('dotenv')
const fs = require('fs')
const path = require('path')

const ENV_ARCHIVO = path.join(process.cwd(), '.env')
const ENV_INICIAL = dotenv.config()

const PREFIJO = '[panel-reporte]'
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), PREFIJO, ...a)
// la clave jamas va al log, ni dentro de un mensaje de error
const limpio = e => {
  const t = String((e && e.message) || e || 'error').slice(0, 300)
  const c = (process.env.PANEL_REPORTE_CLAVE || '').trim()
  return c ? t.split(c).join('***') : t
}
// el mismo problema no se anota cada minuto: una vez, y de nuevo a la media hora
const _avisos = new Map()
function avisar(tema, texto) {
  const v = _avisos.get(tema)
  if (v && v.texto === texto && Date.now() - v.t < 30 * 60000) return
  _avisos.set(tema, { texto, t: Date.now() })
  log(texto)
}

// ---------- tiempos y topes ----------
const T_ENVIO = 10000            // espera maxima del panel (contrato)
const T_CONSULTA = 8000          // cada consulta a la base
const T_TOTAL = 25000            // todas las consultas del reporte completo
const CADA_COMPLETO = 5 * 60000 - 15000
const PAGINA = 500               // Supabase corta en silencio a las 1000 filas
const MAX_FILAS = 20000
const LATIDO_VIVO = 5 * 60000    // el agente de cobranza late cada minuto

// ---------- utilidades (calendario de Peru: UTC-5, sin horario de verano) ----------
const TZ = 'America/Lima'
const hoyLima = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const isoLima = (d = new Date()) => new Date(d.getTime() - 5 * 3600000).toISOString().slice(0, 19) + '-05:00'
const inicioDiaLima = iso => new Date(iso + 'T05:00:00Z').toISOString()
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const r2 = n => Math.round((Number(n) || 0) * 100) / 100
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cuantos = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios)
const hace = ms => {
  const min = Math.max(1, Math.round(ms / 60000))
  if (min < 90) return min + ' min'
  const h = Math.round(min / 60)
  return h < 48 ? h + ' h' : Math.round(h / 24) + ' días'
}

function config() {
  const e = process.env
  return {
    clave: (e.PANEL_REPORTE_CLAVE || '').trim(),
    url: (e.PANEL_REPORTE_URL || 'https://panel.csoft.men/api/panel/reporte').trim(),
    sistema: (e.PANEL_REPORTE_SISTEMA || 'urbis-crm').trim(),
    respaldoDir: e.PANEL_REPORTE_RESPALDO_DIR || '/opt/urbis-backup/copias/pg',
    panelUrl: (e.PANEL_URL || 'https://panel.urbisgroupinmobiliaria.com').replace(/\/+$/, ''),
  }
}

// La clave se pega en el .env cuando el panel la entrega. Para no obligar a
// reiniciar nada, las PANEL_REPORTE_* se releen cuando el archivo cambia.
// Lo que venga del entorno (no del archivo) no se pisa.
const ENV_CLAVES = ['PANEL_REPORTE_CLAVE', 'PANEL_REPORTE_URL', 'PANEL_REPORTE_SISTEMA', 'PANEL_REPORTE_RESPALDO_DIR']
const _delArchivo = new Set(ENV_CLAVES.filter(k => ENV_INICIAL.parsed && k in ENV_INICIAL.parsed && process.env[k] === ENV_INICIAL.parsed[k]))
let _envMtime = (() => { try { return fs.statSync(ENV_ARCHIVO).mtimeMs } catch { return 0 } })()
function refrescarEnv() {
  try {
    const m = fs.statSync(ENV_ARCHIVO).mtimeMs
    if (m === _envMtime) return
    _envMtime = m
    const kv = dotenv.parse(fs.readFileSync(ENV_ARCHIVO))
    for (const k of ENV_CLAVES) {
      if (k in kv) { if (_delArchivo.has(k) || !(k in process.env)) { process.env[k] = kv[k]; _delArchivo.add(k) } }
      else if (_delArchivo.has(k)) { delete process.env[k]; _delArchivo.delete(k) }
    }
  } catch { /* sin .env (pruebas): manda el entorno */ }
}

// ---------- la base: la misma de los otros procesos, con tope de tiempo ----------
let _sb = null
function base() {
  if (_sb) return _sb
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return null
  const { createClient } = require('@supabase/supabase-js')
  _sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(T_CONSULTA) }) },
  })
  return _sb
}

// paginado con orden explicito (sin orden las paginas se pisan) y con reloj
async function todas(hacer, limite) {
  const out = []
  for (let desde = 0; ; desde += PAGINA) {
    if (Date.now() > limite) throw new Error('se acabó el tiempo')
    const { data, error } = await hacer().range(desde, desde + PAGINA - 1)
    if (error) throw new Error(error.message || 'error')
    out.push(...(data || []))
    if (!data || data.length < PAGINA) break
    if (out.length >= MAX_FILAS) throw new Error('demasiadas filas')
  }
  return out
}

// ============================================================================
// LO QUE SE LEE (solo lectura; filas minimas: montos, fechas y de que proyecto)
// ============================================================================
async function leerDatos(sb, hoy) {
  const limite = Date.now() + T_TOTAL
  const mes1 = hoy.slice(0, 7) + '-01'
  const desdePagos = [mes1, sumarDias(hoy, -13)].sort()[0]
  const raw = { fallos: [] }
  // `nombre` es como se le dice al dueño que parte no se pudo leer; las opcionales (sin nombre) no afectan la salud
  // Si la base no contesta (dos lecturas seguidas sin respuesta) o se acaba el
  // tiempo, no se sigue insistiendo: lo que falta se da por no leido.
  let sinRespuesta = 0
  const leer = async (campo, nombre, fn) => {
    try {
      if (sinRespuesta >= 2) throw new Error('la base no responde')
      if (Date.now() > limite) throw new Error('se acabó el tiempo')
      raw[campo] = await fn()
      sinRespuesta = 0
    } catch (e) {
      if (/TimeoutError|AbortError|fetch failed|se acabó el tiempo/i.test(String(e && e.message))) sinRespuesta++
      raw[campo] = null
      if (nombre) raw.fallos.push(nombre)
      avisar('leer:' + campo, 'no se pudo leer ' + (nombre || campo) + ': ' + limpio(e))
    }
  }
  const contar = async q => { const { count, error } = await q; if (error) throw new Error(error.message || 'error'); return count || 0 }

  await leer('proyectos', 'proyectos', async () => {
    const { data, error } = await sb.from('projects').select('id, name').order('name').limit(200)
    if (error) throw new Error(error.message)
    return data || []
  })
  // la observacion y el N° de operacion se usan aca para clasificar y agrupar: no viajan
  await leer('pagos', 'pagos', () => todas(() => sb.from('daily_income')
    .select('id, project_id, amount, date, observation, operation_number, financial_account_id, sale:sales(status)')
    .gte('date', desdePagos).order('id'), limite))
  // vencidas + las que vencen en 7 dias, de ventas en proceso (igual que el Dashboard)
  await leer('cuotas', 'cuotas', () => todas(() => sb.from('installments')
    .select('id, amount, amount_paid, due_date, sales!inner(status, client_id, lot:lots!inner(project_id))')
    .neq('status', 'pagado').lte('due_date', sumarDias(hoy, 7)).eq('sales.status', 'en_proceso').order('id'), limite))
  await leer('ventas', 'ventas', () => todas(() => sb.from('sales')
    .select('id, sale_date, total_sale_price, status').gte('sale_date', mes1).order('id'), limite))
  await leer('separaciones', 'separaciones', () => todas(() => sb.from('separations')
    .select('id, date, amount, status').gte('date', mes1).order('id'), limite))
  await leer('leadsMes', 'leads', () => contar(sb.from('leads')
    .select('id', { count: 'exact', head: true }).gte('created_at', inicioDiaLima(mes1)).eq('is_test', false)))
  // opcionales: si la tabla no esta (base sin sql/76 o sin multi-numero) esa ficha o aviso no sale
  await leer('cob', null, async () => {
    const { data, error } = await sb.from('cobranza_config').select('agente_activo, avisos_activos, latido, latido_info').eq('id', 1).maybeSingle()
    if (error) throw new Error(error.message)
    return data || null
  })
  await leer('reportados', null, () => contar(sb.from('cobranza_pagos_reportados')
    .select('id', { count: 'exact', head: true }).eq('estado', 'pendiente').eq('es_prueba', false)))
  await leer('botActivo', null, async () => {
    const { data, error } = await sb.from('bot_settings').select('key, value').in('key', ['bot_activo'])
    if (error) throw new Error(error.message)
    return !(data || []).some(r => r.key === 'bot_activo' && r.value === '0')   // sin fila = prendido, como en index.js
  })
  await leer('botLatido', null, async () => {
    const { data, error } = await sb.from('wa_sessions').select('latido').not('latido', 'is', null).order('latido', { ascending: false }).limit(1)
    if (error) throw new Error(error.message)
    return data && data[0] ? data[0].latido : null
  })
  return raw
}

// ============================================================================
// LAS SUMAS (funcion pura: filas -> totales; es lo que cubren las pruebas)
// ============================================================================
// Mismo criterio que el panel (src/lib/pagos.js): el estado sale de la VENTA y
// la observacion queda de respaldo. Solo cuenta como cobrado lo ACEPTADO.
function estadoPago(p) {
  if (p.sale && p.sale.status === 'expropiado') return 'EXPROPIADO'
  const o = String(p.observation || '').toUpperCase()
  if (o.includes('EXPROP')) return 'EXPROPIADO'
  if (o.includes('PERDIDA')) return 'PERDIDA'
  return 'ACEPTADO'
}
// Un deposito aplicado en cascada son varias filas: "N pagos" cuenta depositos,
// como el historial de Pagos (misma fecha + N° de operacion + cuenta).
function claveDeposito(p) {
  const op = String(p.operation_number || '').trim().toUpperCase()
  return !op || op === 'SIN-REF' ? 'fila:' + p.id : (p.date || '') + '|' + op + '|' + (p.financial_account_id || '')
}
const sumar = (filas, f) => r2(filas.reduce((s, x) => s + (Number(f(x)) || 0), 0))
const depositos = filas => new Set(filas.map(claveDeposito)).size

// Prendido = contesta a clientes · Modo prueba = el proceso corre pero no le
// llega nada a ningun cliente (solo "Probar agente") · Apagado = no contesta
// (o el proceso no da señal: cobranza.js late cada minuto en cobranza_config).
function estadoAgente(cob, ahoraMs) {
  if (!cob) return null
  const edad = cob.latido ? ahoraMs - Date.parse(cob.latido) : Infinity
  const vivo = edad <= LATIDO_VIVO
  const avisos = cob.avisos_activos ? 'avisos prendidos' : 'avisos apagados'
  if (!vivo) return { valor: 'Apagado', vivo, edad, detalle: cob.latido ? 'El proceso no da señal hace ' + hace(edad) : 'El proceso nunca dio señal' }
  const sinToken = cob.latido_info && cob.latido_info.whatsapp === false ? ' · sin token de WhatsApp' : ''
  if (cob.agente_activo) return { valor: 'Prendido', vivo, edad, detalle: 'Contesta a clientes · ' + avisos + sinToken }
  if (cob.avisos_activos) return { valor: 'Apagado', vivo, edad, detalle: 'No contesta a clientes · ' + avisos + sinToken }
  return { valor: 'Modo prueba', vivo, edad, detalle: 'Solo pruebas desde el panel · ' + avisos + sinToken }
}

function armarResumen(raw, hoy, ahoraMs) {
  const ym = hoy.slice(0, 7)
  const resumen = [], grupos = [], alertas = []
  let serie = null
  const nombres = raw.proyectos ? new Map(raw.proyectos.map(p => [p.id, String(p.name || '').trim() || 'Sin nombre'])) : null
  const porProyecto = (filas, idDe, valorDe, contarDe) => {
    const m = new Map()
    for (const x of filas) { const id = idDe(x) || ''; if (!m.has(id)) m.set(id, []); m.get(id).push(x) }
    return [...m.entries()].map(([id, fs_]) => ({ nombre: (nombres && nombres.get(id)) || 'Sin proyecto', valor: sumar(fs_, valorDe), detalle: contarDe(fs_) }))
      .filter(f => f.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, 12)
      .map(f => ({ nombre: f.nombre, valor: f.valor, formato: 'soles', detalle: f.detalle }))
  }

  // ---- lo cobrado ----
  if (raw.pagos) {
    const ok = raw.pagos.filter(p => estadoPago(p) === 'ACEPTADO' && p.date)
    const delMes = ok.filter(p => String(p.date).slice(0, 7) === ym)
    const deHoy = ok.filter(p => p.date === hoy)
    resumen.push({ clave: 'cobrado_mes', titulo: 'Cobrado en el mes', valor: sumar(delMes, p => p.amount), formato: 'soles', detalle: cuantos(depositos(delMes), 'pago', 'pagos') })
    resumen.push({ clave: 'cobrado_hoy', titulo: 'Cobrado hoy', valor: sumar(deHoy, p => p.amount), formato: 'soles', detalle: cuantos(depositos(deHoy), 'pago', 'pagos') })
    serie = []
    for (let i = 13; i >= 0; i--) {
      const dia = sumarDias(hoy, -i)
      const f = ok.filter(p => p.date === dia)
      serie.push({ dia, total: sumar(f, p => p.amount), n: depositos(f) })
    }
    if (nombres) {
      const filas = porProyecto(delMes, p => p.project_id, p => p.amount, f => cuantos(depositos(f), 'pago', 'pagos'))
      if (filas.length) grupos.push({ titulo: 'Cobrado del mes por proyecto', filas })
    }
  }

  // ---- las cuotas ----
  if (raw.cuotas) {
    const pend = raw.cuotas.map(q => ({ ...q, saldo: r2(Number(q.amount) - Number(q.amount_paid)) })).filter(q => q.saldo > 0.004 && q.due_date)
    const venc = pend.filter(q => q.due_date < hoy)
    const porVencer = pend.filter(q => q.due_date >= hoy && q.due_date <= sumarDias(hoy, 7))
    const clientes = new Set(venc.map(q => q.sales && q.sales.client_id).filter(Boolean)).size
    resumen.push({ clave: 'cuotas_vencidas', titulo: 'Cuotas vencidas', valor: sumar(venc, q => q.saldo), formato: 'soles', detalle: cuantos(venc.length, 'cuota', 'cuotas') + ' de ' + cuantos(clientes, 'cliente', 'clientes') })
    resumen.push({ clave: 'por_vencer_7d', titulo: 'Por vencer en 7 días', valor: sumar(porVencer, q => q.saldo), formato: 'soles', detalle: cuantos(porVencer.length, 'cuota', 'cuotas') })
    if (nombres) {
      const filas = porProyecto(venc, q => q.sales && q.sales.lot && q.sales.lot.project_id, q => q.saldo, f => cuantos(f.length, 'cuota', 'cuotas'))
      if (filas.length) grupos.push({ titulo: 'Vencido por proyecto', filas })
      // Para el selector de proyecto del panel: lo que vence esta semana.
      const proximas = porProyecto(porVencer, q => q.sales && q.sales.lot && q.sales.lot.project_id, q => q.saldo, f => cuantos(f.length, 'cuota', 'cuotas'))
      if (proximas.length) grupos.push({ titulo: 'Por vencer en 7 días por proyecto', filas: proximas })
    }
    const viejas = venc.filter(q => q.due_date < sumarDias(hoy, -60))
    if (viejas.length) alertas.push({ nivel: 'warn', texto: cuantos(viejas.length, 'cuota', 'cuotas') + ' con más de 60 días de atraso (' + soles(sumar(viejas, q => q.saldo)) + ')' })
  }

  // ---- ventas, separaciones y leads del mes ----
  if (raw.ventas) {
    const v = raw.ventas.filter(s => String(s.sale_date || '').slice(0, 7) === ym && s.status !== 'anulado')
    const sep = raw.separaciones ? raw.separaciones.filter(s => String(s.date || '').slice(0, 7) === ym) : null
    resumen.push({ clave: 'ventas_mes', titulo: 'Ventas del mes', valor: v.length, formato: 'numero', detalle: soles(sumar(v, s => s.total_sale_price)) + (sep ? ' · ' + cuantos(sep.length, 'separación', 'separaciones') : '') })
  }
  if (typeof raw.leadsMes === 'number') resumen.push({ clave: 'leads_mes', titulo: 'Leads nuevos del mes', valor: raw.leadsMes, formato: 'numero', detalle: 'sin contar pruebas' })

  // ---- los agentes (solo informativo) ----
  const ag = estadoAgente(raw.cob, ahoraMs)
  if (ag) {
    resumen.push({ clave: 'agente_cobranza', titulo: 'Agente de cobranza', valor: ag.valor, formato: 'texto', detalle: ag.detalle })
    if (!ag.vivo && ag.edad > 10 * 60000 && (raw.cob.agente_activo || raw.cob.avisos_activos))
      alertas.push({ nivel: 'err', texto: 'El agente de cobranza está prendido pero ' + (raw.cob.latido ? 'no da señal desde hace ' + hace(ag.edad) : 'nunca dio señal') })
  }
  if (raw.botLatido && raw.botActivo === true) {
    const edad = ahoraMs - Date.parse(raw.botLatido)
    if (edad > 10 * 60000) alertas.push({ nivel: 'err', texto: 'El bot de leads no da señal desde hace ' + hace(edad) })
  }
  if (raw.reportados > 0) alertas.push({ nivel: 'info', texto: cuantos(raw.reportados, 'pago reportado', 'pagos reportados') + ' por validar en Cobranza IA' })

  const salud = { ok: !raw.fallos.length, detalle: raw.fallos.length ? 'No se pudo leer: ' + raw.fallos.join(', ') : '' }
  return { salud, resumen: resumen.slice(0, 8), grupos: grupos.slice(0, 3), serie, alertas: alertas.slice(0, 10) }
}

// ---------- version y respaldo: solo si hay un dato real que leer ----------
function leerVersion() {
  try {
    const raiz = path.join(__dirname, '..')
    const v = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version
    if (!v) return null
    let hash = ''
    try {
      const git = path.join(raiz, '.git')
      const head = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim()
      if (/^[0-9a-f]{40}$/.test(head)) hash = head
      else {
        const ref = head.replace(/^ref:\s*/, '')
        try { hash = fs.readFileSync(path.join(git, ref), 'utf8').trim() }
        catch { hash = ((fs.readFileSync(path.join(git, 'packed-refs'), 'utf8').split('\n').find(l => l.endsWith(' ' + ref)) || '').split(' ')[0]) || '' }
      }
    } catch { /* sin git: va solo el numero */ }
    return 'v' + v + (/^[0-9a-f]{40}$/.test(hash) ? ' · ' + hash.slice(0, 12) : '')
  } catch { return null }
}
// el pg_dump diario que instala migracion/05_backup.sh (urbis-AAAA-MM-DD.dump)
function leerRespaldo(dir, ahoraMs) {
  try {
    let ult = null
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.dump')) continue
      const st = fs.statSync(path.join(dir, f))
      if (!ult || st.mtimeMs > ult.mtimeMs) ult = st
    }
    if (!ult) return null
    return { ultimo: isoLima(new Date(ult.mtimeMs)), ok: ult.size > 0 && ahoraMs - ult.mtimeMs <= 36 * 3600000 }
  } catch { return null }
}

async function armarCompleto(sb, cfg, ahora) {
  const hoy = hoyLima(ahora)
  const raw = await leerDatos(sb, hoy)
  const r = armarResumen(raw, hoy, ahora.getTime())
  const cuerpo = { v: 1, sistema: cfg.sistema, tipo: 'crm', nombre: 'Urbis Control', url: cfg.panelUrl, generado: isoLima(ahora) }
  const version = leerVersion()
  if (version) cuerpo.version = version
  cuerpo.salud = r.salud
  const respaldo = leerRespaldo(cfg.respaldoDir, ahora.getTime())
  if (respaldo) {
    cuerpo.respaldo = respaldo
    if (!respaldo.ok) r.alertas.unshift({ nivel: 'warn', texto: 'El último respaldo de la base tiene más de 36 horas' })
  }
  cuerpo.resumen = r.resumen
  if (r.grupos.length) cuerpo.grupos = r.grupos
  if (r.serie) cuerpo.serie = r.serie
  if (r.alertas.length) cuerpo.alertas = r.alertas.slice(0, 10)
  return cuerpo
}

// ============================================================================
// EL ENVIO (de la respuesta solo se mira si el panel lo recibio)
// ============================================================================
async function enviar(cfg, cuerpo) {
  try {
    const r = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sistema': cfg.sistema, 'X-Clave': cfg.clave },
      body: JSON.stringify(cuerpo),
      redirect: 'manual',                  // la clave no se va detras de una redireccion
      signal: AbortSignal.timeout(T_ENVIO),
    })
    const texto = (await r.text()).slice(0, 65536)
    if (r.status !== 200) return { ok: false, error: 'el panel respondió ' + r.status }
    let j = null
    try { j = JSON.parse(texto) } catch { /* se trata abajo */ }
    if (!j || j.ok !== true) return { ok: false, error: 'el panel respondió 200 pero sin {"ok":true}' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: 'no se pudo enviar: ' + (e && e.name === 'TimeoutError' ? 'el panel no contestó en 10 s' : limpio(e)) }
  }
}

// ============================================================================
// UNA VUELTA (cada minuto)
// ============================================================================
let _completo = null            // { t, cuerpo }: el ultimo reporte completo armado
let _completoPendiente = false  // se armo pero el panel todavia no lo recibio

async function vuelta(opc = {}) {
  refrescarEnv()
  const cfg = config()
  if (!cfg.clave) return null                                  // sin clave: nada, en silencio
  const ahora = new Date()

  // el reporte completo se ARMA como mucho cada 5 minutos; si el envio falla,
  // en la vuelta siguiente se manda el mismo, sin volver a consultar la base
  const toca = opc.forzar === 'completo' || (opc.forzar !== 'latido' && (!_completo || Date.now() - _completo.t >= CADA_COMPLETO))
  if (toca) {
    const sb = base()
    if (!sb) { avisar('base', 'faltan SUPABASE_URL / SUPABASE_SERVICE_KEY en .env: no se envía nada'); return null }
    _completo = { t: Date.now(), cuerpo: await armarCompleto(sb, cfg, ahora) }
    _completoPendiente = true
  }
  // sin controles: este sistema solo informa (el panel no puede pedirle nada)
  const esCompleto = _completoPendiente && opc.forzar !== 'latido'
  const cuerpo = esCompleto
    ? { ..._completo.cuerpo, controles: [], ordenes_hechas: [] }
    : { v: 1, sistema: cfg.sistema, latido: true, generado: isoLima(ahora), controles: [], ordenes_hechas: [] }

  const resp = await enviar(cfg, cuerpo)
  if (!resp.ok) { avisar('envio', resp.error); return { cuerpo, resp } }
  _avisos.delete('envio')
  if (esCompleto) _completoPendiente = false
  return { cuerpo, resp }
}

// ============================================================================
// ARRANQUE
// ============================================================================
if (require.main === module) {
  const unaVez = process.argv.includes('--una-vez')
  const soloLatido = process.argv.includes('--latido')
  if (unaVez || soloLatido) {
    vuelta({ forzar: soloLatido ? 'latido' : 'completo' })
      .then(r => { if (r && r.resp.ok) log(soloLatido ? 'latido enviado' : 'reporte completo enviado') })
      .catch(e => log('error:', limpio(e)))
      .finally(() => process.exit(0))
  } else {
    // Cuando un `git pull` trae una version nueva de ESTE archivo, el proceso
    // sale limpio y pm2 lo levanta con el codigo nuevo (igual que el reinicio
    // del bot pedido desde el panel). Asi no hay que tocar el script 07.
    const MI_MTIME = fs.statSync(__filename).mtimeMs
    const recargarSiCambio = () => {
      if (process.env.pm_id === undefined) return
      try {
        const m = fs.statSync(__filename).mtimeMs
        if (m !== MI_MTIME && Date.now() - m > 10000) { log('código actualizado: saliendo para que pm2 levante la versión nueva'); process.exit(0) }
      } catch { /* el archivo se esta reescribiendo: se mira en la proxima */ }
    }
    let ocupado = false
    const tic = async () => {
      if (ocupado) return
      ocupado = true
      try { recargarSiCambio(); await vuelta() }
      catch (e) { avisar('vuelta', 'error: ' + limpio(e)) }
      finally { ocupado = false }
    }
    require('node-cron').schedule('* * * * *', tic, { timezone: TZ })
    log('corriendo · latido cada minuto, reporte completo cada 5' + (config().clave ? '' : ' · sin PANEL_REPORTE_CLAVE: en espera, no envía nada'))
    tic()
  }
}

module.exports = { vuelta, armarResumen, armarCompleto, estadoAgente, estadoPago, claveDeposito, leerVersion, leerRespaldo, hoyLima, isoLima, sumarDias }
