import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'
import { textoDeWord } from '../lib/manualWord'

// ============================================================================
// AGENTE DE VENTAS IA (sql/91 · 94)
// ----------------------------------------------------------------------------
// El agente (agente/ventas_ia.js) conversa en el mismo chat del número del
// proyecto. Aquí el dueño:
//   · ve los PASES que el agente le hizo al asesor (llamada, visita, separación),
//   · decide por PROYECTO quién atiende (bot, prueba o agente sin bot), a qué
//     asesor pasa, cómo se arma la cuota y qué lotes no se ofrecen; y ve la tabla
//     de precios y cuotas que va a decir el agente, calculada desde la base,
//   · carga el MANUAL de ventas (se puede leer directo del Word),
//   · ve los leads del agente, el experimento contra el supervisor y la configuración.
// Solo superusuario; el administrador mira.
// ============================================================================

const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const fCorta = iso => iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : '—'
const fHora = s => s ? new Date(s).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const dia = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('es-PE', { weekday: 'long', timeZone: 'UTC' })
const pct = (a, b) => b ? Math.round(a * 100 / b) + ' %' : '—'
const soles = n => 'S/' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const telDe = t => String(t || '').replace(/\D/g, '')
// US$ por millón de tokens: entrada, salida, lectura de caché
const PRECIOS = { 'claude-opus-5': [5, 25, 0.5], 'claude-sonnet-5': [2, 10, 0.2], 'claude-haiku-4-5': [1, 5, 0.1] }
const MODELOS = [['claude-opus-5', 'Claude Opus 5 (el más capaz)'], ['claude-sonnet-5', 'Claude Sonnet 5'], ['claude-haiku-4-5', 'Claude Haiku 4.5 (el más barato)']]
const tokensAprox = t => Math.round(String(t || '').length / 3.2)   // español con el tokenizador de Opus 5, a ojo
const FALTA_94 = 'Falta correr sql/94_manuales_de_ventas.sql en la base.'

// La regla del MANUAL DE VENTA v5, IGUAL que cuotasDe() en agente/ventas_ia.js: si se
// cambia una, se cambia la otra. La cuota es (precio − inicial) / N redondeada HACIA
// ARRIBA al paso del proyecto y la diferencia baja de la última. En céntimos.
function cuotasDe(precio, inicial, n, paso) {
  const saldo = Math.round(Number(precio) * 100) - Math.round(Number(inicial || 0) * 100)
  const N = Math.max(1, Math.round(Number(n) || 48))
  const p = Math.max(1, Math.round(Number(paso || 0.1) * 100))
  if (!(saldo > 0)) return null
  let cuota = Math.ceil(saldo / N / p - 1e-9) * p
  let ultima = saldo - cuota * (N - 1)
  if (ultima <= 0) { cuota = Math.ceil(saldo / N); ultima = saldo - cuota * (N - 1) }
  return { cuota: cuota / 100, ultima: ultima / 100, semanal: Math.round(cuota / 4) / 100, diaria: Math.round(cuota / 30) / 100, ingreso_25: Math.round(cuota * 4 / 100) }
}
// "Mz C Lt 10", "C-10", "c10" → "C-10" (igual que normLote() del agente)
function normLote(t) {
  const s = String(t || '').toUpperCase().replace(/MANZANA|MZ|LOTE|LT|\./g, ' ').replace(/\s+/g, ' ').trim()
  const m = s.match(/^([A-Z]+)\s*-?\s*0*(\d+)$/)
  return m ? m[1] + '-' + m[2] : s
}

export default function VentasIA() {
  const { role, profile } = useAuth()
  const puede = role === 'superuser'
  const ve = puede || role === 'admin'
  const [tab, setTab] = useState('pases')
  const [cfg, setCfg] = useState(null)
  const [falta, setFalta] = useState('')
  const [msg, setMsg] = useMsg(null)

  async function cargarCfg() {
    const { data, error } = await supabase.from('ventas_ia_config').select('*').eq('id', 1).maybeSingle()
    if (error) { setFalta(/ventas_ia_config/.test(error.message) ? 'Falta correr sql/91_agente_ventas_ia.sql en la base.' : 'ERROR: ' + error.message); return }
    setFalta(''); setCfg(data)
  }
  useEffect(() => {
    if (!ve) return
    cargarCfg()
    const t = setInterval(cargarCfg, 30000)
    return () => clearInterval(t)
  }, [ve])

  if (!ve) return <p className="error">Esta pantalla es del superusuario.</p>
  // el bot reporta cada 5 minutos
  const vivo = !!cfg?.latido && Date.now() - new Date(cfg.latido).getTime() < 12 * 60000
  const TABS = [['pases', '🙋 Pases al asesor'], ['proyectos', '🏗 Proyectos'], ['manual', '📘 Manual'], ['leads', '💬 Leads del agente'], ['resultados', '📊 Experimento'], ['config', '⚙️ Configuración']]

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Agente de ventas</h1>
        {cfg && (
          <span className="small" title={cfg.latido ? 'Último latido del bot: ' + fHora(cfg.latido) : 'El bot nunca reportó'}>
            {vivo ? '🟢 bot corriendo' : '🔴 el bot no reporta'}
            {vivo && cfg.latido_info && !cfg.latido_info.ia ? ' · ⚠ sin clave de Claude' : ''}
            {vivo && cfg.latido_info && cfg.latido_info.version !== 2 ? ' · ⚠ el bot tiene el código anterior: falta correr el 07' : ''}
          </span>
        )}
      </div>
      {falta && <p className="error">{falta}</p>}
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      {!puede && <p className="hint muted">Modo consulta: configurar y resolver pases es del superusuario.</p>}
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {!falta && cfg && tab === 'pases' && <Pases puede={puede} profile={profile} setMsg={setMsg} />}
      {!falta && cfg && tab === 'proyectos' && <Proyectos puede={puede} profile={profile} setMsg={setMsg} />}
      {!falta && cfg && tab === 'manual' && <Manual cfg={cfg} puede={puede} profile={profile} setMsg={setMsg} />}
      {!falta && cfg && tab === 'leads' && <Leads />}
      {!falta && cfg && tab === 'resultados' && <Resultados cfg={cfg} />}
      {!falta && cfg && tab === 'config' && <Configuracion cfg={cfg} puede={puede} profile={profile} recargar={cargarCfg} setMsg={setMsg} />}
    </>
  )
}

// ============================================================================
// PASES AL ASESOR (sql/94)
// ============================================================================
const COLS_PASE = 'id, lead_id, tipo, fecha, hora, cuando, lote_interes, nota, entendio, asesor_phone, estado, es_prueba, created_at, resuelto_at, lead:leads(full_name, phone), project:projects(name)'
const TIPO_PASE = { llamada: '📞 Llamada', visita: '📍 Visita', separacion: '💰 Separación' }
const cuandoPase = p => [p.fecha && dia(p.fecha) + ' ' + fCorta(p.fecha), p.hora && String(p.hora).slice(0, 5), p.cuando].filter(Boolean).join(' · ')

function Pases({ puede, profile, setMsg }) {
  const [abiertos, setAbiertos] = useState([])
  const [recientes, setRecientes] = useState([])
  const [verPruebas, setVerPruebas] = useState(false)
  const [falta, setFalta] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function cargar() {
    const [a, r] = await Promise.all([
      supabase.from('ventas_ia_pases').select(COLS_PASE).eq('estado', 'pendiente').eq('es_prueba', verPruebas).order('created_at'),
      supabase.from('ventas_ia_pases').select(COLS_PASE).neq('estado', 'pendiente').eq('es_prueba', verPruebas).order('resuelto_at', { ascending: false }).limit(20),
    ])
    if (a.error) { setFalta(/ventas_ia_pases/.test(a.error.message) ? FALTA_94 : 'ERROR: ' + a.error.message); return }
    setFalta(''); setAbiertos(a.data || []); setRecientes(r.data || [])
  }
  useEffect(() => { cargar(); const t = setInterval(cargar, 20000); return () => clearInterval(t) }, [verPruebas])

  async function resolver(p, estado) {
    if (estado === 'cancelado' && !confirm('¿Cancelar este pase?\n\nAl cliente no se le avisa nada: si ya quedaron en algo, escríbele tú.')) return
    setOcupado(true)
    const ahora = new Date().toISOString()
    const { error } = await supabase.from('ventas_ia_pases').update({ estado, resuelto_at: ahora, resuelto_por: profile?.id || null, updated_at: ahora }).eq('id', p.id)
    setOcupado(false)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: estado === 'atendido' ? 'PASE ATENDIDO' : 'PASE CANCELADO' })
    if (!error) cargar()
  }

  if (falta) return <p className="error">{falta}</p>
  // función y no componente: un componente definido aquí adentro se remonta en cada render
  const tarjeta = p => {
    const tel = telDe(p.lead?.phone)
    const ok = Object.values(p.entendio || {}).filter(v => v === true).length
    return (
      <div key={p.id} className="glass form-card" style={{ maxWidth: 'none', marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <b style={{ fontSize: '1.05em' }}>{TIPO_PASE[p.tipo] || p.tipo}{cuandoPase(p) ? ' · ' + cuandoPase(p) : ''}</b>
          <span>{p.lead?.full_name || '—'}</span>
          <a href={'https://wa.me/' + tel} target="_blank" rel="noreferrer" className="small">+{tel}</a>
          <span className="muted small">{p.project?.name || ''}</span>
          {p.es_prueba && <span className="small" style={{ color: '#c58ae0' }}>🧪 PRUEBA</span>}
          {p.fecha && p.fecha < hoyLima() && <span className="small error">ya pasó</span>}
        </div>
        <p className="small" style={{ textTransform: 'none', margin: '6px 0' }}>
          {p.lote_interes ? 'Lote: ' + p.lote_interes + ' · ' : ''}{ok === 5 ? '✅ entendió las 5 cosas' : '⚠ entendió ' + ok + ' de 5'} · pasado {fHora(p.created_at)}
          {p.asesor_phone ? ' · avisado a +' + p.asesor_phone : ' · ⚠ sin celular de asesor'}
          {p.nota && <><br />📝 {p.nota}</>}
        </p>
        {puede && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn-primary" disabled={ocupado} onClick={() => resolver(p, 'atendido')}>✅ Ya se atendió</button>
            <button className="btn-ghost" disabled={ocupado} onClick={() => resolver(p, 'cancelado')}>✖ Cancelar</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="toolbar">
        <label className="inline-check"><input type="checkbox" checked={verPruebas} onChange={e => setVerPruebas(e.target.checked)} /> Ver las pruebas</label>
      </div>
      <p className="hint" style={{ textTransform: 'none' }}>
        {abiertos.length
          ? <><b>{abiertos.length}</b> cliente(s) listos esperando al asesor. Al asesor ya le llegó el aviso por WhatsApp con el resumen; aquí se marca cuando se atendió.</>
          : 'No hay pases pendientes.'}
        {' '}El agente pasa a un cliente recién cuando confirmó que entendió qué compra, dónde está, cuánto paga, desde cuándo usa el lote y qué sigue.
      </p>
      {abiertos.map(tarjeta)}
      {recientes.length > 0 && (
        <>
          <p><b>Últimos resueltos</b></p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pase</th><th>Cliente</th><th>Proyecto</th><th>Estado</th><th>Resuelto</th></tr></thead>
              <tbody>
                {recientes.map(p => (
                  <tr key={p.id}>
                    <td>{TIPO_PASE[p.tipo]}{cuandoPase(p) ? <span className="small muted"> · {cuandoPase(p)}</span> : ''}</td>
                    <td>{p.lead?.full_name || '—'}</td>
                    <td>{p.project?.name || '—'}</td>
                    <td>{p.estado === 'atendido' ? '✅ atendido' : '✖ cancelado'}</td>
                    <td className="small">{fHora(p.resuelto_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

// ============================================================================
// PROYECTOS: quién atiende, a qué asesor pasa, cómo se arma la cuota (sql/94)
// ============================================================================
const MODOS = {
  bot: '🤖 Bot de siempre',
  prueba: '🧪 Agente solo en Probar Bot',
  agente: '✅ Agente desde el primer mensaje (sin bot)',
}
const formDe = (p, c) => ({
  modo: c?.modo || 'bot',
  asesor_nombre: c?.asesor_nombre || '',
  asesor_phone: c?.asesor_phone || telDe(p?.lead_notify_phone),
  cuotas: String(c?.cuotas ?? 48),
  redondeo_cuota: String(Number(c?.redondeo_cuota ?? 0.1)),
  separacion: String(c?.separacion ?? 100),
  subida_m2: String(c?.subida_m2 ?? 0),
  siguiente_meta: c?.siguiente_meta || '',
  no_ofrecer: (c?.lotes_no_ofrecer || []).join(', '),
})
const listaNoOfrecer = t => [...new Set(String(t || '').split(/[,;\n]+/).map(normLote).filter(Boolean))]

function Proyectos({ puede, profile, setMsg }) {
  const [proys, setProys] = useState([])
  const [cfgs, setCfgs] = useState({})          // project_id → fila de ventas_ia_proyectos
  const [mans, setMans] = useState([])
  const [sel, setSel] = useState('')
  const [f, setF] = useState(null)
  const [lotes, setLotes] = useState(null)      // disponibles del proyecto elegido
  const [falta, setFalta] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const proySel = proys.find(p => p.id === sel)
  const cambiado = !!f && !!proySel && JSON.stringify(f) !== JSON.stringify(formDe(proySel, cfgs[sel]))

  async function cargar() {
    const [p, c, m] = await Promise.all([
      supabase.from('projects').select('id, name, bot_enabled, lead_notify_phone').order('name'),
      supabase.from('ventas_ia_proyectos').select('*'),
      supabase.from('ventas_ia_manuales').select('id, titulo, proyectos'),
    ])
    if (c.error) { setFalta(/ventas_ia_proyectos/.test(c.error.message) ? FALTA_94 : 'ERROR: ' + c.error.message); return }
    setFalta('')
    const porId = Object.fromEntries((c.data || []).map(x => [x.project_id, x]))
    setCfgs(porId)
    setMans(m.data || [])
    setProys((p.data || []).filter(x => x.bot_enabled !== false || (porId[x.id] && porId[x.id].modo !== 'bot')))
    return porId
  }
  useEffect(() => { cargar() }, [])

  async function cargarLotes(pid) {
    setLotes(null)
    const out = []
    for (let desde = 0; ; desde += 1000) {    // Supabase corta en silencio a las 1000 filas
      const { data, error } = await supabase.from('lots').select('mz, lt, area_m2, price_per_m2, total_price, initial_payment_default')
        .eq('project_id', pid).eq('status', 'disponible').order('id').range(desde, desde + 999)
      if (error) { setMsg({ ok: false, t: 'ERROR AL LEER LOTES: ' + error.message }); break }
      out.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    setLotes(out)
  }

  function elegir(p) {
    if (p.id === sel) return
    if (cambiado && !confirm('Tienes cambios sin guardar en ' + proySel.name + '.\n\n¿Salir sin guardar?')) return
    setSel(p.id)
    setF(formDe(p, cfgs[p.id]))
    cargarLotes(p.id)
  }

  async function guardar() {
    const antes = cfgs[sel]?.modo || 'bot'
    const tel = telDe(f.asesor_phone).replace(/^(9\d{8})$/, '51$1')
    if (f.modo !== 'bot' && tel.length < 11) { setMsg({ ok: false, t: 'FALTA EL CELULAR DEL ASESOR: ahí le llegan los pases del agente' }); return }
    if (f.modo === 'agente' && antes !== 'agente' && !confirm('¿Prender el agente en ' + proySel.name + '?\n\nDesde ahora el agente contesta a TODOS los que escriban por este proyecto, desde el primer mensaje, y el bot deja de responder.\n\nAntes pruébalo en modo "solo en Probar Bot".')) return
    if (f.modo !== 'agente' && antes === 'agente' && !confirm('¿Apagar el agente en ' + proySel.name + '?\n\nLos leads nuevos vuelven al bot. Los que ya atiende el agente siguen con él.')) return
    const num = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0))
    setOcupado(true)
    const { error } = await supabase.from('ventas_ia_proyectos').upsert({
      project_id: sel, modo: f.modo,
      asesor_nombre: f.asesor_nombre.trim() || null, asesor_phone: tel || null,
      cuotas: Math.round(num(f.cuotas, 1, 120)), redondeo_cuota: Number(f.redondeo_cuota),
      separacion: num(f.separacion, 0, 1e6), subida_m2: num(f.subida_m2, 0, 1e4),
      siguiente_meta: f.siguiente_meta.trim() || null, lotes_no_ofrecer: listaNoOfrecer(f.no_ofrecer),
      updated_at: new Date().toISOString(), updated_by: profile?.id || null,
    })
    setOcupado(false)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'GUARDADO: el agente lo usa desde su próxima respuesta (máximo 1 minuto)' })
    const porId = await cargar()
    if (porId) setF(formDe(proySel, porId[sel]))
  }

  if (falta) return <p className="error">{falta}</p>
  const campo = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const manualDe = pid => mans.find(m => (m.proyectos || []).includes(pid))

  // la tabla que va a decir el agente, con lo que está escrito en el formulario (aún sin guardar)
  let grupos = [], excluidos = []
  if (f && lotes) {
    const fuera = new Set(listaNoOfrecer(f.no_ofrecer))
    const m = new Map()
    for (const l of lotes) {
      const nombre = l.mz + '-' + l.lt
      if (fuera.has(normLote(nombre))) { excluidos.push(nombre); continue }
      const k = Number(l.area_m2).toFixed(2) + '|' + Number(l.price_per_m2) + '|' + Number(l.initial_payment_default)
      if (!m.has(k)) m.set(k, { area: Number(l.area_m2), pm2: Number(l.price_per_m2), precio: Number(l.total_price), inicial: Number(l.initial_payment_default), lotes: [], q: cuotasDe(l.total_price, l.initial_payment_default, f.cuotas, f.redondeo_cuota) })
      m.get(k).lotes.push(nombre)
    }
    grupos = [...m.values()].sort((a, b) => a.pm2 - b.pm2 || a.area - b.area || a.inicial - b.inicial)
  }
  const noEstan = f && lotes ? listaNoOfrecer(f.no_ofrecer).filter(k => !lotes.some(l => normLote(l.mz + '-' + l.lt) === k)) : []
  const sube = Number(f?.subida_m2) || 0

  return (
    <>
      <p className="hint" style={{ textTransform: 'none' }}>
        Cada proyecto decide quién atiende a los que escriben a su número. Para prender el agente: primero <b>🧪 solo en Probar Bot</b>, pruébalo, y recién ahí <b>✅ sin bot</b>.
        Las cifras (precio, inicial, cuota) salen de los lotes de la base con la regla de abajo: revisa la tabla contra el manual antes de prenderlo.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Proyecto</th><th>Atiende</th><th>Asesor que recibe los pases</th><th>Manual</th><th></th></tr></thead>
          <tbody>
            {proys.map(p => {
              const c = cfgs[p.id], man = manualDe(p.id)
              return (
                <tr key={p.id} style={p.id === sel ? { background: 'rgba(197,138,224,.12)' } : undefined}>
                  <td>{p.name}</td>
                  <td className="small">{MODOS[c?.modo || 'bot']}</td>
                  <td className="small">{c?.asesor_phone ? (c.asesor_nombre ? c.asesor_nombre + ' · ' : '') + '+' + c.asesor_phone : <span className="muted">—</span>}</td>
                  <td className="small">{man ? '📘 ' + man.titulo : <span className="muted">— sin manual</span>}</td>
                  <td><button className={p.id === sel ? 'btn-primary' : 'btn-ghost'} onClick={() => elegir(p)}>{puede ? 'Configurar' : 'Ver'}</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {proySel && f && (
        <div className="glass form-card" style={{ maxWidth: 'none', marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <b style={{ flex: 1, fontSize: '1.05em' }}>🏗 {proySel.name}</b>
            {cambiado && <span className="small error">● cambios sin guardar</span>}
          </div>

          <p style={{ marginBottom: 4 }}><b>Quién atiende</b></p>
          <div className="form-grid">
            <label>Los que escriben a este proyecto
              <select value={f.modo} onChange={campo('modo')} disabled={!puede}>
                {Object.entries(MODOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </label>
            <label>Nombre del asesor <span className="muted small">(el agente lo nombra al pasar)</span><input value={f.asesor_nombre} onChange={campo('asesor_nombre')} disabled={!puede} style={{ textTransform: 'none' }} /></label>
            <label>Celular del asesor <span className="muted small">(le llegan los pases)</span><input value={f.asesor_phone} onChange={campo('asesor_phone')} disabled={!puede} placeholder="51987654321" /></label>
          </div>
          {!manualDe(sel) && f.modo !== 'bot' && <p className="small error" style={{ textTransform: 'none' }}>⚠ Este proyecto no tiene manual: el agente solo tendría la ficha de la landing. Cárgalo en 📘 Manual.</p>}

          <p style={{ marginBottom: 4 }}><b>Cómo se arma la cuota</b></p>
          <div className="form-grid">
            <label>Número de cuotas<input type="number" min="1" max="120" value={f.cuotas} onChange={campo('cuotas')} disabled={!puede} /></label>
            <label>Redondeo de la cuota (hacia arriba)
              <select value={f.redondeo_cuota} onChange={campo('redondeo_cuota')} disabled={!puede}>
                <option value="0.01">Al céntimo (S/0.01)</option>
                <option value="0.1">Al décimo (S/0.10)</option>
                <option value="1">Al sol (S/1)</option>
              </select>
            </label>
            <label>Separación (S/)<input type="number" min="0" value={f.separacion} onChange={campo('separacion')} disabled={!puede} /></label>
          </div>

          <p style={{ marginBottom: 4 }}><b>Escalonamiento</b> <span className="muted small">(el agente solo lo explica si el cliente pregunta si va a subir)</span></p>
          <div className="form-grid">
            <label>Sube por m² con cada meta (S/)<input type="number" min="0" value={f.subida_m2} onChange={campo('subida_m2')} disabled={!puede} /></label>
            <label>Siguiente meta<input value={f.siguiente_meta} onChange={campo('siguiente_meta')} disabled={!puede} style={{ textTransform: 'none' }} placeholder="la construcción del pozo de agua" /></label>
          </div>
          {sube > 0 && (
            <p className="small muted" style={{ textTransform: 'none' }}>
              Con la siguiente meta: {[300, 400, 500].map(a => `${a} m² sube ${soles(a * sube)} (cuota +${soles(a * sube / (Number(f.cuotas) || 48))}, al día +${soles(a * sube / (Number(f.cuotas) || 48) / 30)})`).join(' · ')}
            </p>
          )}

          <label style={{ display: 'block', marginTop: 8 }}>Lotes que NO se ofrecen <span className="muted small">(separados por coma: G-5, H-10)</span>
            <input value={f.no_ofrecer} onChange={campo('no_ofrecer')} disabled={!puede} style={{ width: '100%' }} />
          </label>
          {noEstan.length > 0 && <p className="small muted" style={{ textTransform: 'none' }}>No están disponibles hoy (no cambia nada): {noEstan.join(', ')}</p>}

          {puede && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              <button className="btn-primary" disabled={ocupado || !cambiado} onClick={guardar}>Guardar</button>
              {cambiado && <button className="btn-ghost" disabled={ocupado} onClick={() => setF(formDe(proySel, cfgs[sel]))}>Descartar cambios</button>}
            </div>
          )}

          <p style={{ marginTop: 16, marginBottom: 4 }}><b>Lo que va a decir el agente</b> <span className="muted small">(lotes disponibles de la base, con la regla de arriba)</span></p>
          {!lotes ? <p className="small muted">Leyendo lotes…</p> : !grupos.length ? <p className="small error">No hay lotes disponibles para ofrecer.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Área</th><th>S//m²</th><th>Precio</th><th>Inicial</th><th>Cuota</th><th>Última</th><th>Semana</th><th>Día</th><th>Ingreso 25 %</th><th>Lotes</th></tr></thead>
                <tbody>
                  {grupos.map(g => (
                    <tr key={g.area + '|' + g.pm2 + '|' + g.inicial}>
                      <td>{g.area.toLocaleString('en-US', { maximumFractionDigits: 2 })} m²</td>
                      <td>{soles(g.pm2)}</td>
                      <td>{soles(g.precio)}</td>
                      <td>{soles(g.inicial)}</td>
                      <td><b>{g.q ? soles(g.q.cuota) : '—'}</b></td>
                      <td>{g.q ? soles(g.q.ultima) : '—'}</td>
                      <td>{g.q ? soles(g.q.semanal) : '—'}</td>
                      <td>{g.q ? soles(g.q.diaria) : '—'}</td>
                      <td>{g.q ? soles(g.q.ingreso_25) : '—'}</td>
                      <td className="small">{g.lotes.length <= 3 ? g.lotes.join(', ') : g.lotes.length + ' lotes'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {excluidos.length > 0 && <p className="small muted" style={{ textTransform: 'none' }}>No se ofrecen: {excluidos.join(', ')}</p>}
        </div>
      )}
    </>
  )
}

// ============================================================================
// MANUAL DE VENTAS (sql/94)
// ============================================================================
// Un manual puede servir a varios proyectos (el de Cashibo sirve a Praderas y
// Brisas). El agente lee TODOS en cada conversación, en un bloque con caché: se
// paga completo al escribirlo y después a un décimo. El bot lo relee cada minuto.
const MANUAL_NUEVO = { titulo: 'Manual de ventas', proyectos: [], texto: '' }

function Manual({ cfg, puede, profile, setMsg }) {
  const [lista, setLista] = useState([])
  const [proys, setProys] = useState([])
  const [sel, setSel] = useState(null)          // id del manual, 'nuevo' o null
  const [f, setF] = useState(null)
  const [falta, setFalta] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [leyendo, setLeyendo] = useState(false)
  const archivo = useRef(null)
  const original = sel === 'nuevo' ? MANUAL_NUEVO : lista.find(m => m.id === sel)
  const cambiado = !!f && !!original && (f.titulo !== original.titulo || f.texto !== original.texto ||
    [...f.proyectos].sort().join() !== [...(original.proyectos || [])].sort().join())

  async function cargar() {
    const [m, p] = await Promise.all([
      supabase.from('ventas_ia_manuales').select('id, titulo, proyectos, texto, updated_at').order('titulo'),
      supabase.from('projects').select('id, name, bot_enabled').order('name'),
    ])
    if (m.error) { setFalta(/ventas_ia_manuales/.test(m.error.message) ? FALTA_94 : 'ERROR: ' + m.error.message); return }
    setFalta('')
    setLista(m.data || [])
    setProys(p.data || [])
    return m.data || []
  }
  useEffect(() => { cargar() }, [])
  // pegar o leer un manual largo y cerrar la pestaña por error no debe perderlo en silencio
  useEffect(() => {
    if (!cambiado) return
    const avisar = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [cambiado])

  function elegir(id) {
    if (id === sel) return
    if (cambiado && !confirm('Tienes cambios sin guardar en este manual.\n\n¿Salir sin guardar?')) return
    const m = id === 'nuevo' ? MANUAL_NUEVO : lista.find(x => x.id === id)
    setSel(id)
    setF({ titulo: m.titulo, proyectos: [...(m.proyectos || [])], texto: m.texto })
  }

  async function deWord(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (f.texto.trim() && !confirm('¿Reemplazar el texto de este manual por el del Word?')) return
    setLeyendo(true)
    try {
      const texto = await textoDeWord(await file.arrayBuffer())
      if (!texto) throw new Error('el Word no tiene texto')
      const titulo = file.name.replace(/\.docx$/i, '').replace(/\s+/g, ' ').trim()
      setF(x => ({ ...x, texto, titulo: x.titulo && x.titulo !== MANUAL_NUEVO.titulo ? x.titulo : titulo }))
      setMsg({ ok: true, t: 'WORD LEÍDO: revisa el texto (las tablas quedan fila por fila) y dale Guardar' })
    } catch (err) {
      setMsg({ ok: false, t: 'NO SE PUDO LEER EL WORD: ' + (err.message || err) + '. Tiene que ser .docx (no .doc).' })
    }
    setLeyendo(false)
  }

  async function guardar() {
    const titulo = f.titulo.trim()
    if (!titulo) { setMsg({ ok: false, t: 'FALTA EL TÍTULO DEL MANUAL' }); return }
    if (!f.proyectos.length) { setMsg({ ok: false, t: 'MARCA A QUÉ PROYECTOS SIRVE ESTE MANUAL' }); return }
    const choque = f.proyectos.map(pid => [pid, lista.find(m => m.id !== sel && (m.proyectos || []).includes(pid))]).find(([, m]) => m)
    if (choque) { setMsg({ ok: false, t: (proys.find(p => p.id === choque[0])?.name || 'Un proyecto') + ' ya está en «' + choque[1].titulo + '»: quítalo de ese manual primero' }); return }
    const fila = { titulo, proyectos: f.proyectos, texto: f.texto.trim(), updated_at: new Date().toISOString(), updated_by: profile?.id || null }
    setOcupado(true)
    const r = sel === 'nuevo'
      ? await supabase.from('ventas_ia_manuales').insert(fila).select('id').single()
      : await supabase.from('ventas_ia_manuales').update(fila).eq('id', sel)
    setOcupado(false)
    if (r.error) { setMsg({ ok: false, t: 'ERROR: ' + r.error.message }); return }
    setMsg({ ok: true, t: 'MANUAL GUARDADO: el agente lo usa desde su próxima respuesta (máximo 1 minuto)' })
    const id = sel === 'nuevo' ? r.data.id : sel
    const nuevos = await cargar()
    const m = (nuevos || []).find(x => x.id === id)
    setSel(id)
    if (m) setF({ titulo: m.titulo, proyectos: [...(m.proyectos || [])], texto: m.texto })
  }

  async function borrar() {
    if (!confirm('¿Borrar el manual «' + original.titulo + '»?\n\nEl agente deja de usarlo en un minuto. No se puede deshacer.')) return
    setOcupado(true)
    const { error } = await supabase.from('ventas_ia_manuales').delete().eq('id', sel)
    setOcupado(false)
    if (error) { setMsg({ ok: false, t: 'ERROR: ' + error.message }); return }
    setMsg({ ok: true, t: 'MANUAL BORRADO' })
    setSel(null); setF(null); cargar()
  }

  if (falta) return <p className="error">{falta}</p>
  const nombre = pid => proys.find(p => p.id === pid)?.name || '(proyecto borrado)'
  const total = lista.filter(m => String(m.texto || '').trim()).reduce((s, m) => s + tokensAprox(m.texto), 0)
  const [pin, , pcache] = PRECIOS[cfg.modelo] || PRECIOS['claude-opus-5']
  const lee = cfg.latido_info?.manuales
  const conBot = proys.filter(p => p.bot_enabled !== false || (f?.proyectos || []).includes(p.id))

  return (
    <>
      <p className="hint" style={{ textTransform: 'none' }}>
        El manual dice <b>cómo vende</b> el agente: qué contar del entorno, cómo responder objeciones, qué no decir. Un manual puede servir a varios proyectos.
        Manda sobre la ficha de la landing, <b>salvo las cifras</b> (precio, inicial, cuota), que salen de los lotes de la base con la regla de 🏗 Proyectos.
        Las indicaciones de ⚙️ Configuración mandan sobre el manual.
      </p>
      <p className="small muted" style={{ textTransform: 'none' }}>
        {lee === undefined ? '⚠ El bot todavía tiene el código anterior y no lee manuales: falta correr el 07.'
          : lee === null ? '⚠ El bot no encuentra la tabla de manuales: falta correr sql/94.'
          : `🤖 El bot lee ${lee} manual(es)`}
        {cfg.latido ? ' · dato de ' + fHora(cfg.latido) + ' (reporta cada 5 min)' : ''}
        {total > 0 && <><br />Manuales en total: ≈ {total.toLocaleString('en-US')} tokens · cada respuesta del agente suma ≈ US$ {(total * pcache / 1e6).toFixed(3)} cuando están en caché y ≈ US$ {(total * pin * 1.25 / 1e6).toFixed(3)} cuando no (la primera de una conversación o tras 5 min sin mensajes).</>}
      </p>

      <div className="toolbar">
        {puede && <button className="btn-ghost" onClick={() => elegir('nuevo')}>＋ Nuevo manual</button>}
      </div>
      {lista.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Manual</th><th>Sirve a</th><th>Tamaño</th><th>Última edición</th><th></th></tr></thead>
            <tbody>
              {lista.map(m => (
                <tr key={m.id} style={m.id === sel ? { background: 'rgba(197,138,224,.12)' } : undefined}>
                  <td>📘 {m.titulo}</td>
                  <td className="small">{(m.proyectos || []).map(nombre).join(', ') || <span className="error">ningún proyecto</span>}</td>
                  <td className="small">{String(m.texto || '').trim() ? '≈ ' + tokensAprox(m.texto).toLocaleString('en-US') + ' tokens' : <span className="muted">vacío</span>}</td>
                  <td className="small">{fHora(m.updated_at)}</td>
                  <td><button className={m.id === sel ? 'btn-primary' : 'btn-ghost'} onClick={() => elegir(m.id)}>{puede ? 'Editar' : 'Ver'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!lista.length && sel !== 'nuevo' && <p className="hint">Todavía no hay manuales.</p>}

      {f && (
        <div className="glass form-card" style={{ maxWidth: 'none', marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <b style={{ flex: 1 }}>{sel === 'nuevo' ? '📘 Manual nuevo' : '📘 ' + original?.titulo}</b>
            <span className="small muted">≈ {tokensAprox(f.texto).toLocaleString('en-US')} tokens</span>
            {cambiado && <span className="small error">● cambios sin guardar</span>}
          </div>
          <div className="form-grid">
            <label>Título<input value={f.titulo} onChange={e => setF(x => ({ ...x, titulo: e.target.value }))} disabled={!puede} style={{ textTransform: 'none' }} /></label>
          </div>
          <p className="small" style={{ margin: '8px 0 4px' }}><b>Sirve a</b></p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {conBot.map(p => (
              <label key={p.id} className="inline-check">
                <input type="checkbox" disabled={!puede} checked={f.proyectos.includes(p.id)}
                  onChange={e => setF(x => ({ ...x, proyectos: e.target.checked ? [...x.proyectos, p.id] : x.proyectos.filter(id => id !== p.id) }))} /> {p.name}
              </label>
            ))}
          </div>
          {puede && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              <button className="btn-ghost" disabled={leyendo} onClick={() => archivo.current?.click()}>{leyendo ? 'Leyendo el Word…' : '📄 Cargar desde Word (.docx)'}</button>
              <input ref={archivo} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: 'none' }} onChange={deWord} />
              <span className="small muted">o pega el texto abajo</span>
            </div>
          )}
          <textarea rows="24" value={f.texto} readOnly={!puede} onChange={e => setF(x => ({ ...x, texto: e.target.value }))}
            style={{ width: '100%', marginTop: 8, textTransform: 'none', fontFamily: 'inherit' }}
            placeholder={'El manual de ventas: el rol del agente, qué debe entender el cliente, el entorno, las respuestas a objeciones, lo prohibido…\n\nLas tablas de precios pueden ir, pero las cifras que dice el agente salen siempre de la base.'} />
          {puede && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn-primary" disabled={ocupado || !cambiado} onClick={guardar}>Guardar manual</button>
              {cambiado && sel !== 'nuevo' && <button className="btn-ghost" disabled={ocupado} onClick={() => setF({ titulo: original.titulo, proyectos: [...(original.proyectos || [])], texto: original.texto })}>Descartar cambios</button>}
              {sel !== 'nuevo' && <button className="btn-ghost" disabled={ocupado} onClick={borrar} style={{ marginLeft: 'auto' }}>🗑 Borrar manual</button>}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ============================================================================
// RESULTADOS: el experimento IA contra supervisor (proyectos con bot, sql/91)
// ============================================================================
function Resultados({ cfg }) {
  const [desde, setDesde] = useState('')
  const [filas, setFilas] = useState(null)
  const [error, setError] = useState('')

  async function cargar() {
    const { data, error } = await supabase.rpc('ventas_ia_resultados', { desde: desde || null })
    setError(error ? error.message : '')
    setFilas(data || [])
  }
  useEffect(() => { cargar() }, [desde])

  const g = k => (filas || []).find(f => f.grupo === k) || { leads: 0, respondieron: 0, visitas_agendadas: 0, visitas_realizadas: 0, ganados: 0, propuestas_agente: 0, derivados: 0, intervenidos: 0, costo_tokens_in: 0, costo_tokens_out: 0 }
  const ia = g('ia'), hu = g('humano')
  const [pin, pout] = PRECIOS[cfg.modelo] || PRECIOS['claude-opus-5']
  const usd = (Number(ia.costo_tokens_in) * pin + Number(ia.costo_tokens_out) * pout) / 1e6
  const filasTabla = [
    ['Leads repartidos', ia.leads, hu.leads, null],
    ['Siguieron escribiendo', ia.respondieron, hu.respondieron, 'respondieron'],
    ['Visitas agendadas', ia.visitas_agendadas, hu.visitas_agendadas, 'visitas_agendadas'],
    ['Visitas realizadas', ia.visitas_realizadas, hu.visitas_realizadas, 'visitas_realizadas'],
    ['Compraron', ia.ganados, hu.ganados, 'ganados'],
  ]
  const pocos = Number(ia.leads) < 10 || Number(hu.leads) < 20

  return (
    <>
      <p className="hint" style={{ textTransform: 'none' }}>
        El experimento solo corre en los proyectos que siguen con bot: de cada 10 leads que piden asesor, algunos los atiende el agente. Los proyectos sin bot no entran aquí.
      </p>
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label className="small">Desde <input type="date" value={desde} onChange={e => setDesde(e.target.value)} /></label>
        <button className="btn-ghost" onClick={cargar}>Actualizar</button>
      </div>
      {error && <p className="error">ERROR: {error}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th></th><th>🤖 Agente IA</th><th>👤 Supervisor</th></tr></thead>
          <tbody>
            {filasTabla.map(([t, a, h, k]) => (
              <tr key={t}>
                <td>{t}</td>
                <td><b>{a}</b>{k && <span className="muted small"> · {pct(Number(a), Number(ia.leads))}</span>}</td>
                <td><b>{h}</b>{k && <span className="muted small"> · {pct(Number(h), Number(hu.leads))}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ textTransform: 'none' }}>
        El agente propuso {ia.propuestas_agente} visita(s) y pasó {ia.derivados} lead(s) a una persona. Costo aproximado de Claude: US$ {usd.toFixed(2)}
        {Number(ia.leads) ? ` (US$ ${(usd / Number(ia.leads)).toFixed(2)} por lead)` : ''}.
      </p>
      {Number(ia.intervenidos) > 0 && (
        <p className="error" style={{ textTransform: 'none' }}>
          ⚠ {ia.intervenidos} lead(s) del agente fueron tocados por una persona (escribió desde el celular o el panel). Esas conversaciones no las terminó el agente: míralas en <b>Leads del agente</b>.
        </p>
      )}
      <p className="hint" style={{ textTransform: 'none' }}>
        <b>Cómo se mide:</b> los dos grupos salen del mismo reparto al azar y se miden igual: una visita cuenta si está en <b>Visitas</b> con el celular del lead
        y fue registrada después del reparto. Las pruebas no cuentan.
        {pocos && <><br />⚠ Todavía son pocos leads: con menos de 10 del agente y 20 del supervisor, una diferencia puede ser suerte.</>}
      </p>
    </>
  )
}

// ============================================================================
// LEADS DEL AGENTE
// ============================================================================
function Leads() {
  const [lista, setLista] = useState([])
  const [verPruebas, setVerPruebas] = useState(false)

  async function cargar() {
    const { data } = await supabase.from('ventas_ia_leads')
      .select('lead_id, grupo, es_prueba, motivo, asignado_at, primer_mensaje_at, ultimo_turno_at, turnos, derivado_at, derivado_motivo, intervenido_at, intervenido_por, intervenido_texto, lead:leads(full_name, phone, status, temperature, budget_estimate), project:projects(name)')
      .eq('grupo', 'ia').eq('es_prueba', verPruebas).order('asignado_at', { ascending: false }).limit(100)
    setLista(data || [])
  }
  useEffect(() => { cargar(); const t = setInterval(cargar, 30000); return () => clearInterval(t) }, [verPruebas])

  return (
    <>
      <div className="toolbar">
        <label className="inline-check"><input type="checkbox" checked={verPruebas} onChange={e => setVerPruebas(e.target.checked)} /> Ver las pruebas</label>
      </div>
      {!lista.length && <p className="hint">{verPruebas ? 'No hay pruebas.' : 'El agente todavía no atiende leads reales.'}</p>}
      {lista.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lead</th><th>Proyecto</th><th>Llegó</th><th>Tiempo a 1ª respuesta</th><th>Turnos</th><th>Estado</th></tr></thead>
            <tbody>
              {lista.map(v => {
                const seg = v.primer_mensaje_at ? Math.round((new Date(v.primer_mensaje_at) - new Date(v.asignado_at)) / 1000) : null
                return (
                  <tr key={v.lead_id}>
                    <td>{v.lead?.full_name || '—'}<br /><a className="small" href={'https://wa.me/' + telDe(v.lead?.phone)} target="_blank" rel="noreferrer">+{telDe(v.lead?.phone)}</a></td>
                    <td>{v.project?.name || '—'}</td>
                    <td className="small">{fHora(v.asignado_at)}<br /><span className="muted">{v.motivo === 'primer_mensaje' ? 'sin bot' : v.motivo}</span></td>
                    <td>{seg == null ? '—' : seg < 90 ? seg + ' s' : Math.round(seg / 60) + ' min'}</td>
                    <td>{v.turnos}</td>
                    <td className="small">
                      {String(v.lead?.status || '').replace('_', ' ')}{v.lead?.temperature === 'caliente' ? ' 🔥' : ''}
                      {v.derivado_at && <><br />🙋 pasado a persona: {v.derivado_motivo}</>}
                      {v.intervenido_at && <><br /><span className="error" title={v.intervenido_texto || ''}>⚠ tocado por {v.intervenido_por === 'celular' ? 'el celular del chip' : v.intervenido_por} · {fHora(v.intervenido_at)}</span></>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ textTransform: 'none' }}>Las conversaciones completas están en <b>WhatsApp</b>. Si le escribes al lead desde ahí, el agente se calla en ese chat.</p>
    </>
  )
}

// ============================================================================
// CONFIGURACIÓN
// ============================================================================
function Configuracion({ cfg, puede, profile, recargar, setMsg }) {
  const [f, setF] = useState(null)
  useEffect(() => {
    if (!cfg || f) return
    setF({ ...cfg, hora_inicio: String(cfg.hora_inicio || '08:00').slice(0, 5), hora_fin: String(cfg.hora_fin || '21:00').slice(0, 5) })
  }, [cfg])
  if (!f) return null
  const campo = k => e => setF(x => ({ ...x, [k]: e.target.value }))
  const info = cfg.latido_info || {}

  async function guardar(campos, t = 'CONFIGURACIÓN GUARDADA') {
    const { error } = await supabase.from('ventas_ia_config').update({ ...campos, updated_at: new Date().toISOString(), updated_by: profile?.id || null }).eq('id', 1)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t })
    recargar()
    return !error
  }
  async function interruptor(on) {
    if (on && !confirm('¿Prender el experimento?\n\nEn los proyectos que siguen con bot, de cada 10 leads que pidan asesor, ' + f.ia_por_cada_10 + ' los atiende el agente en vez del supervisor.')) return
    if (await guardar({ activo: on }, on ? 'EXPERIMENTO PRENDIDO' : 'EXPERIMENTO APAGADO: los leads que piden asesor van todos al supervisor')) setF(x => ({ ...x, activo: on }))
  }
  function guardarForm(e) {
    e.preventDefault()
    const txt = v => (v || '').trim() || null
    const min = Math.max(0, Number(f.lectura_min_seg) || 0)
    guardar({
      ia_por_cada_10: Math.min(10, Math.max(0, Math.round(Number(f.ia_por_cada_10) || 0))),
      aviso_phone: telDe(f.aviso_phone).replace(/^(9\d{8})$/, '51$1') || '51924947651',
      encargado_nombre: txt(f.encargado_nombre), nombre_agente: txt(f.nombre_agente),
      modelo: f.modelo, esfuerzo: f.esfuerzo,
      hora_inicio: f.hora_inicio, hora_fin: f.hora_fin,
      lectura_min_seg: min, lectura_max_seg: Math.max(min, Number(f.lectura_max_seg) || 0),
      punto_encuentro: txt(f.punto_encuentro), notas: txt(f.notas),
    })
  }

  return (
    <>
      <div className="glass form-card" style={{ maxWidth: 'none' }}>
        <p className="small muted" style={{ textTransform: 'none', marginTop: 0 }}>
          Bot: {cfg.latido ? 'último latido ' + fHora(cfg.latido) : 'nunca reportó'} · Claude {info.ia ? (info.clave_propia ? '✅ clave propia' : '⚠ usando la clave general') : '❌ sin clave'}
          <br />Qué proyectos atiende el agente se decide en <b>🏗 Proyectos</b>. Para probarlo sin tocar clientes: <b>Probar Bot</b> → perfil lead → escribe como cliente nombrando el proyecto.
        </p>
      </div>

      <form className="glass form-card" style={{ maxWidth: 'none' }} onSubmit={guardarForm}>
        <p><b>El agente</b></p>
        <div className="form-grid">
          <label>Nombre con el que se presenta <span className="muted small">(vacío = "del equipo de ventas")</span><input value={f.nombre_agente || ''} onChange={campo('nombre_agente')} disabled={!puede} style={{ textTransform: 'none' }} /></label>
          <label>Modelo
            <select value={f.modelo} onChange={campo('modelo')} disabled={!puede}>
              {MODELOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label>Esfuerzo al pensar <span className="muted small">(Haiku lo ignora)</span>
            <select value={f.esfuerzo} onChange={campo('esfuerzo')} disabled={!puede}>
              <option value="low">Bajo: más rápido y barato</option>
              <option value="medium">Medio</option>
              <option value="high">Alto (recomendado para empezar)</option>
            </select>
          </label>
          <label>Contesta desde (Lima)<input type="time" value={f.hora_inicio} onChange={campo('hora_inicio')} disabled={!puede} /></label>
          <label>…hasta<input type="time" value={f.hora_fin} onChange={campo('hora_fin')} disabled={!puede} /></label>
          <label>Espera antes de contestar: mínimo (seg)<input type="number" min="0" max="300" value={f.lectura_min_seg} onChange={campo('lectura_min_seg')} disabled={!puede} /></label>
          <label>…máximo (seg)<input type="number" min="0" max="600" value={f.lectura_max_seg} onChange={campo('lectura_max_seg')} disabled={!puede} /></label>
          <label>Celular del dueño <span className="muted small">(alarmas del agente)</span><input value={f.aviso_phone || ''} onChange={campo('aviso_phone')} disabled={!puede} placeholder="51924947651" /></label>
        </div>
        <p className="small muted" style={{ textTransform: 'none' }}>
          Para parecer una persona: espera un rato al azar antes de contestar (y si el cliente sigue escribiendo, espera a que termine), muestra "escribiendo…" según el largo del mensaje y parte las respuestas en mensajes cortos.
          Fuera de horario no contesta: lo hace al abrir.
        </p>

        <label style={{ marginTop: 10, display: 'block' }}>Indicaciones para el agente <span className="muted small">(mandan sobre el manual: una oferta de este mes CONFIRMADA, un cambio de horario de visitas, qué no decir…)</span>
          <textarea rows="6" value={f.notas || ''} onChange={campo('notas')} disabled={!puede} style={{ textTransform: 'none' }}
            placeholder={'Ej: Las visitas salen de la oficina de Pucallpa a las 9 y a las 3.\nEste sábado la oficina está cerrada.'} />
        </label>

        <p style={{ marginTop: 16 }}><b>Experimento contra el supervisor</b> <span className="muted small">(solo proyectos que siguen con bot)</span></p>
        <label className="inline-check" style={{ display: 'flex', margin: '6px 0' }}>
          <input type="checkbox" disabled={!puede} checked={!!cfg.activo} onChange={e => interruptor(e.target.checked)} />
          🧪 Repartir los leads que piden asesor entre el agente y el supervisor
        </label>
        <div className="form-grid">
          <label>De cada 10 leads, cuántos al agente<input type="number" min="0" max="10" value={f.ia_por_cada_10} onChange={campo('ia_por_cada_10')} disabled={!puede} /></label>
          <label>Encargado de sus visitas (sale en Visitas)<input value={f.encargado_nombre || ''} onChange={campo('encargado_nombre')} disabled={!puede} placeholder="CESAR" /></label>
          <label>Punto de encuentro para las visitas<input value={f.punto_encuentro || ''} onChange={campo('punto_encuentro')} disabled={!puede} style={{ textTransform: 'none' }} /></label>
        </div>
        {puede && <button className="btn-primary" style={{ marginTop: 10 }}>Guardar configuración</button>}
      </form>
    </>
  )
}
