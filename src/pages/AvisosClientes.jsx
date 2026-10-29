import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { upload } from '../lib/archivos'
import { useMsg, savedFx } from '../lib/saveFx'
import { confirmar } from '../lib/dialogos'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import LoteLink from '../components/LoteLink'

// ============================================================================
// AVISOS POR CLIENTE (sql/159, 27 oct 2026) — quién recibe avisos y qué le toca
// ----------------------------------------------------------------------------
// Pedido del dueño: "un panel con todos los clientes por proyecto y su mensaje
// programado para cobranza, recordatorio o cosas así, para poder seleccionar
// clientes o leads o a quienes ya no se les escriba".
//
// Una fila por CLIENTE con venta vigente (lote, celular, qué aviso le toca y
// cuándo, el último que salió) y una por LEAD del kanban (celular, estado, su
// conversación). Casillas para marcar a quién SÍ y a quién NO se le escribe:
//   · cliente → sales.auto_cobranza (la misma casilla "pausar" de la ficha del lote)
//   · lead    → whatsapp_numbers tipo 'silencio' (el SILENCIO TOTAL del directorio
//               del bot: ni le responde ni le escribe)
// Desde aquí NO se manda nada: solo se decide quién recibe. Qué aviso le toca lo
// calcula el agente (agente/cobranza.js, la misma escalera de siempre) y lo deja
// en cobranza_proximo_aviso; el panel lo lee por avisos_por_cliente().
//
// 28 oct (sql/161): vive como la PRIMERA pestaña de Cobranza IA ("Clientes y
// avisos"); /avisos-clientes redirige ahí. Se sumó, por cliente: el interruptor
// del AGENTE (contesta solo a los marcados), si RESPONDIÓ al último aviso, el
// SEGUIMIENTO (notas y resultados: prometió pagar, no contesta, número
// equivocado, pagó con voucher que queda en "Por validar") y el mensaje propio
// (instrucciones para el agente y texto del próximo aviso).
// ============================================================================

// el motivo con el que el agente deja el chat a la secretaria cuando está apagado
// para ese cliente (agente/cobranza.js, AGENTE_APAGADO)
const AGENTE_APAGADO = 'el agente está apagado para este cliente: lo atiende la secretaria'
const RESULTADOS = {
  nota: ['📝', 'Nota'],
  promesa: ['📅', 'Prometió pagar'],
  no_contesta: ['📵', 'No contesta'],
  numero_equivocado: ['❌', 'Número equivocado'],
  pago: ['💵', 'Pagó / mandó voucher'],
}

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const fCorta = iso => iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : '—'
const fHora = s => s ? new Date(s).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const hace = ts => {
  if (!ts) return 'nunca'
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'recién'
  if (m < 60) return 'hace ' + m + ' min'
  if (m < 48 * 60) return 'hace ' + Math.floor(m / 60) + ' h'
  return 'hace ' + Math.floor(m / 1440) + ' días'
}
const enDias = iso => {
  if (!iso) return ''
  const d = Math.round((new Date(iso + 'T12:00:00Z') - new Date(hoyLima() + 'T12:00:00Z')) / 86400000)
  return d === 0 ? 'HOY' : d === 1 ? 'mañana' : d < 0 ? 'atrasado ' + (-d) + ' d' : 'en ' + d + ' días'
}

// el motivo del aviso en palabras (los nombres son los de decidirAviso)
export function motivoLegible(m) {
  if (!m) return '—'
  let x
  if ((x = m.match(/^antes_(\d+)$/))) return 'Recordatorio (' + x[1] + ' días antes)'
  if (m === 'vence_hoy') return 'Vence hoy'
  if ((x = m.match(/^(vencido|vencida|repite)_(\d+)$/))) return 'Pago vencido (' + x[2] + ' días)'
  if (/^(contrato|grave)/.test(m)) return 'Aviso por contrato'
  if (m === 'promesa') return 'Recordatorio de promesa'
  if (m === 'redirige_cobranza') return 'Redirección al número de cobranza'
  return m
}
const ESTADO = {
  programado: ['📨', 'Recibe', 'ok'],
  pausado: ['⏸', 'Pausado', 'bad'],
  proyecto_pausado: ['🏗️', 'Proyecto apagado', 'bad'],   // sql/165
  promesa: ['📅', 'Con promesa', 'warn'],
  voucher: ['🧾', 'Voucher en revisión', 'warn'],
  sin_celular: ['📵', 'Sin celular validado', 'bad'],
  sin_plantilla: ['⚠', 'Falta plantilla', 'warn'],
  al_dia: ['✅', 'Al día', 'muted'],
  nada: ['·', 'Nada programado', 'muted'],
}
const LEAD_STATUS = { nuevo: 'Nuevo', contactado: 'Contactado', interesado: 'Interesado', visita_agendada: 'Visita agendada', negociacion: 'Negociación', perdido: 'Perdido' }

// la ruta vieja lleva a la pestaña nueva
export default function AvisosClientes() {
  return <Navigate to="/cobranza-ia?tab=clientes" replace />
}

export function ClientesYAvisos() {
  const { profile, role } = useAuth()
  const { pid } = useProject()
  const puede = role === 'superuser' || (profile?.permisos || []).includes('cobranza')
  const ve = puede || role === 'admin'
  const [msg, setMsg] = useMsg(null)
  const [datos, setDatos] = useState(null)
  const [tipo, setTipo] = useState('todos')          // todos | clientes | leads
  const [recibe, setRecibe] = useState('todos')      // todos | si | no
  const [proy, setProy] = useState(pid && pid !== 'general' ? pid : 'todos')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [verTexto, setVerTexto] = useState(null)
  const [resp, setResp] = useState('todos')          // todos | respondio | sin_respuesta | agente
  const [ficha, setFicha] = useState(null)           // fila abierta en el panel de seguimiento
  // sql/165: interruptores POR PROYECTO (avisos / agente). Sin fila = los dos prendidos.
  const [proyCfg, setProyCfg] = useState(() => new Map())
  const cfgDe = id => proyCfg.get(id) || { avisos: true, agente: true }

  async function cargar(silencioso = false) {
    const [{ data, error }, pc] = await Promise.all([
      supabase.rpc('avisos_por_cliente'),
      supabase.from('cobranza_proyectos_cfg').select('project_id, avisos, agente'),
    ])
    if (!pc.error) setProyCfg(new Map((pc.data || []).map(p => [p.project_id, { avisos: p.avisos !== false, agente: p.agente !== false }])))
    if (error) {
      if (!silencioso) setMsg({ ok: false, t: /avisos_por_cliente/.test(error.message) ? 'Falta correr sql/159 en el servidor.' : error.message })
      setDatos(d => d || { clientes: [], leads: [], cfg: {} })
      return
    }
    setDatos(data)
  }
  // prender/apagar un proyecto entero: manda sobre las casillas de sus clientes
  async function setProyecto(id, campo, on) {
    if (!puede || !id) return
    const nombre = proyectos.find(([pid]) => pid === id)?.[1] || 'este proyecto'
    if (!on && !await confirmar(campo === 'avisos'
      ? 'APAGAR los avisos de TODO ' + nombre + ': ningún cliente de ese proyecto recibe avisos automáticos, aunque tenga ✅ Sí. ¿Seguimos?'
      : 'APAGAR el agente de TODO ' + nombre + ': a sus clientes les contesta solo la secretaria, aunque tengan 🤖 ON. ¿Seguimos?',
      { titulo: campo === 'avisos' ? 'Apagar avisos del proyecto' : 'Apagar el agente del proyecto', peligro: true })) return
    setBusy(true)
    const { error } = await supabase.rpc('cobranza_proyecto_set', { p_project: id, p_avisos: campo === 'avisos' ? on : null, p_agente: campo === 'agente' ? on : null })
    setBusy(false)
    if (error) { setMsg({ ok: false, t: /cobranza_proyecto_set/.test(error.message) ? 'Falta correr sql/165 en el servidor.' : 'No se pudo: ' + error.message }); return }
    setProyCfg(m => { const n = new Map(m); n.set(id, { ...cfgDe(id), [campo]: on }); return n })
    savedFx()
    setMsg({ ok: true, t: (campo === 'avisos' ? '📨 Avisos de ' : '🤖 Agente de ') + nombre + (on ? ': PRENDIDO' : ': APAGADO') })
    setTimeout(() => cargar(true), 25000)
  }
  useEffect(() => {
    if (!ve) return
    cargar()
    const t = setInterval(() => { if (!document.hidden) cargar(true) }, 60000)
    return () => clearInterval(t)
  }, [ve])
  // si cambian el proyecto arriba, la pantalla lo sigue
  useEffect(() => { if (pid && pid !== 'general') setProy(pid) }, [pid])

  // las dos listas en una, con la misma cara
  const filas = useMemo(() => {
    if (!datos) return []
    const cli = (datos.clientes || []).map(c => ({
      key: 'v:' + c.sale_id, tipo: 'cliente', id: c.sale_id, project_id: c.project_id, proyecto: c.proyecto,
      nombre: c.cliente, extra: c.co_cliente ? '+ ' + c.co_cliente : (c.doc_number ? 'DNI ' + c.doc_number : ''),
      lote: 'MZ ' + c.mz + ' LT ' + c.lt, lot_id: c.lot_id, mz: c.mz, lt: c.lt,
      telefono: c.telefono, telefono_ok: c.telefono_ok, telefono2: c.telefono2, telefono2_ok: c.telefono2_ok,
      recibe: c.recibe !== false, estado: c.proximo?.estado || (c.recibe === false ? 'pausado' : null),
      proximo: c.proximo, ultimo: c.ultimo, n_vencidas: c.n_vencidas, deuda: c.deuda_vencida, n_pendientes: c.n_pendientes, proxima_cuota: c.proxima_cuota,
      client_id: c.client_id, agente: !!c.agente, instrucciones: c.instrucciones || '', aviso_texto: c.aviso_texto || '',
      respondio_at: c.respondio_at, seguimiento: c.seguimiento,
      // respondió = escribió DESPUÉS del último aviso que se le mandó
      respondio: c.ultimo?.at ? !!(c.respondio_at && new Date(c.respondio_at) > new Date(c.ultimo.at)) : null,
      orden: c.proximo?.fecha || '9999',
    }))
    const leads = (datos.leads || []).map(l => ({
      key: 'l:' + l.lead_id, tipo: 'lead', id: l.lead_id, project_id: l.project_id, proyecto: l.proyecto,
      nombre: l.nombre, extra: (LEAD_STATUS[l.status] || l.status) + (l.temperature ? ' · ' + l.temperature : '') + (l.es_cliente_registrado ? ' · ⚠ celular de un cliente' : ''),
      lote: null, telefono: l.telefono, telefono_ok: true,
      recibe: l.recibe !== false, silenciado: l.silenciado, status: l.status,
      conv_modo: l.conv_modo, conv_estado: l.conv_estado, conv_ultimo: l.conv_ultimo, creado: l.creado,
      orden: '9999' + (l.conv_ultimo || ''),
    }))
    return [...cli, ...leads]
  }, [datos])

  const proyectos = useMemo(() => {
    const m = new Map()
    for (const f of filas) if (f.project_id) m.set(f.project_id, f.proyecto)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [filas])

  const vista = useMemo(() => {
    const t = sinTildes(q.trim())
    return filas.filter(f => (proy === 'todos' || f.project_id === proy)
      && (tipo === 'todos' || (tipo === 'clientes' ? f.tipo === 'cliente' : f.tipo === 'lead'))
      && (recibe === 'todos' || (recibe === 'si' ? f.recibe : !f.recibe))
      && (resp === 'todos' || (resp === 'agente' ? f.agente : resp === 'respondio' ? f.respondio === true : f.respondio === false))
      && (!t || sinTildes([f.nombre, f.extra, f.lote, f.lote?.replace(/MZ | LT /g, ''), f.telefono, f.telefono2, f.proyecto].join(' ')).includes(t)))
      .sort((a, b) => a.proyecto.localeCompare(b.proyecto) || (a.tipo === b.tipo ? 0 : a.tipo === 'cliente' ? -1 : 1) || a.orden.localeCompare(b.orden) || a.nombre.localeCompare(b.nombre))
  }, [filas, proy, tipo, recibe, resp, q])

  const tot = useMemo(() => ({
    clientes: vista.filter(f => f.tipo === 'cliente').length,
    leads: vista.filter(f => f.tipo === 'lead').length,
    reciben: vista.filter(f => f.recibe).length,
    hoy: vista.filter(f => f.proximo?.estado === 'programado' && f.proximo?.fecha === hoyLima()).length,
    agente: vista.filter(f => f.agente).length,
    sinResp: vista.filter(f => f.respondio === false).length,
  }), [vista])

  const cfg = datos?.cfg || {}
  const vivo = !!cfg.latido && Date.now() - new Date(cfg.latido).getTime() < 3 * 60000
  const sinProyeccion = datos && Number(cfg.filas_proyectadas || 0) === 0 && (datos.clientes || []).length > 0

  // ---- selección ----
  const todasVisibles = vista.length > 0 && vista.every(f => sel.has(f.key))
  const toggleSel = k => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleTodas = () => setSel(s => { const n = new Set(s); if (todasVisibles) vista.forEach(f => n.delete(f.key)); else vista.forEach(f => n.add(f.key)); return n })
  const seleccionadas = filas.filter(f => sel.has(f.key))

  // ---- cambiar quién recibe (una fila o varias) ----
  async function marcar(lista, on) {
    if (!puede || !lista.length) return
    const ventas = lista.filter(f => f.tipo === 'cliente').map(f => f.id)
    const leads = lista.filter(f => f.tipo === 'lead').map(f => f.telefono)
    const partes = []
    if (ventas.length) partes.push(ventas.length + ' cliente' + (ventas.length === 1 ? '' : 's'))
    if (leads.length) partes.push(leads.length + ' lead' + (leads.length === 1 ? '' : 's'))
    if (lista.length > 1 || !on) {
      const que = []
      if (ventas.length) que.push(on ? 'los clientes vuelven a recibir los avisos de cobranza' : 'los clientes dejan de recibir los avisos automáticos (igual que "pausar" en la ficha del lote)')
      if (leads.length) que.push(on ? 'a los leads el bot les vuelve a contestar' : 'a los leads el bot deja de responderles y de escribirles (silencio total)')
      const ok = await confirmar((on ? 'Volver a escribirle a ' : 'NO escribirle más a ') + partes.join(' y ') + ': ' + que.join('; ') + '. ¿Seguimos?',
        { titulo: on ? 'Volver a escribirles' : 'Dejar de escribirles', peligro: !on })
      if (!ok) return
    }
    setBusy(true)
    try {
      let n = 0
      if (ventas.length) { const { data, error } = await supabase.rpc('avisos_marcar_ventas', { p_sale_ids: ventas, p_on: on }); if (error) throw error; n += data || 0 }
      if (leads.length) { const { data, error } = await supabase.rpc('avisos_marcar_leads', { p_phones: leads, p_on: on }); if (error) throw error; n += data || 0 }
      // la pantalla cambia al instante; el "próximo aviso" lo recalcula el agente en ≤ 20 s
      setDatos(d => d && {
        ...d,
        clientes: d.clientes.map(c => ventas.includes(c.sale_id) ? { ...c, recibe: on } : c),
        leads: d.leads.map(l => leads.includes(l.telefono) ? { ...l, recibe: on, silenciado: on ? null : 'silencio' } : l),
      })
      setSel(new Set())
      setMsg({ ok: true, t: 'LISTO: ' + n + (on ? ' ahora sí reciben mensajes' : ' ya no reciben mensajes') })
      setTimeout(() => cargar(true), 25000)
    } catch (e) { setMsg({ ok: false, t: 'No se pudo guardar: ' + (e.message || e) }) }
    setBusy(false)
  }

  // ---- el agente por cliente (sql/161) ----
  async function marcarAgente(lista, on) {
    const cli = [...new Map(lista.filter(f => f.tipo === 'cliente' && f.client_id).map(f => [f.client_id, f])).values()]
    if (!puede || !cli.length) return
    if (cli.length > 1 && !await confirmar((on ? 'El agente le CONTESTARÁ a ' : 'El agente DEJA de contestarle a ') + cli.length + ' clientes' + (on ? '' : ': sus mensajes los atiende la secretaria') + '. ¿Seguimos?', { titulo: on ? 'Prender el agente' : 'Apagar el agente' })) return
    setBusy(true)
    const { error } = await supabase.from('cobranza_clientes_cfg').upsert(cli.map(f => ({ client_id: f.client_id, agente: on, updated_at: new Date().toISOString() })), { onConflict: 'client_id' })
    if (error) { setBusy(false); setMsg({ ok: false, t: /cobranza_clientes_cfg/.test(error.message) ? 'Falta correr sql/161 en el servidor.' : 'No se pudo: ' + error.message }); return }
    // los chats que el agente dejó a la secretaria SOLO porque estaba apagado vuelven al agente
    if (on) {
      const tels = cli.flatMap(f => [f.telefono, f.telefono2]).map(t => String(t || '').replace(/\D/g, '').slice(-9)).filter(t => t.length === 9)
      if (tels.length) await supabase.from('cobranza_chats').update({ modo: 'agente', motivo_humano: null, humano_desde: null })
        .eq('motivo_humano', AGENTE_APAGADO).or(tels.map(t => 'phone.ilike.%' + t).join(',')).then(() => {}, () => {})
    }
    const ids = new Set(cli.map(f => f.client_id))
    setDatos(d => d && { ...d, clientes: d.clientes.map(c => ids.has(c.client_id) ? { ...c, agente: on } : c) })
    setSel(new Set()); setBusy(false); savedFx()
    setMsg({ ok: true, t: (on ? '🤖 El agente ya le contesta a ' : '⏸ El agente dejó de contestarle a ') + cli.length + (cli.length === 1 ? ' cliente' : ' clientes') })
  }

  async function recalcular() {
    setBusy(true)
    const { error } = await supabase.rpc('avisos_recalcular')
    setBusy(false)
    if (error) { setMsg({ ok: false, t: error.message }); return }
    setMsg({ ok: true, t: 'PEDIDO: el agente recalcula en menos de un minuto' })
    setTimeout(() => cargar(true), 25000)
  }

  if (!ve) return <p className="error">Esta pantalla es de la responsable de cobranza. El superusuario da el permiso desde Usuarios.</p>

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0, flex: 1, fontSize: '1.05rem' }}>👥 Clientes y avisos</h2>
        {datos && (
          <span className="small" title={cfg.latido ? 'Último latido del agente: ' + fHora(cfg.latido) : 'El agente nunca reportó'}>
            {vivo ? '🟢 agente corriendo' : '🔴 el agente no responde'}
            {' · '}{cfg.avisos_activos ? '📨 avisos ON' : '📨 avisos APAGADOS'}
            {' · '}cálculo {hace(cfg.proyeccion_at)}
          </span>
        )}
        {puede && <button className="btn-ghost" disabled={busy} onClick={recalcular} title="Le pide al agente que vuelva a calcular qué aviso le toca a cada venta">↻ Recalcular</button>}
      </div>
      <p className="muted small" style={{ margin: '-.4rem 0 .8rem', textTransform: 'none' }}>
        Todos los clientes con venta vigente y los leads del kanban, por proyecto: el aviso que le toca a cada uno y cuándo, si respondió al último, su seguimiento y si el agente le contesta. <b>Desde aquí no se manda nada</b>: los avisos los envía el agente a su hora.
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      {!puede && <p className="hint muted">Modo consulta: cambiar quién recibe es de la responsable de cobranza.</p>}
      {sinProyeccion && <p className="error" style={{ textTransform: 'none' }}>⚠ El agente todavía no calculó ningún "próximo aviso": falta actualizar el agente en el servidor (migracion/07) después de correr sql/159. Las casillas igual funcionan.</p>}
      {datos && !cfg.avisos_activos && <p className="hint" style={{ textTransform: 'none' }}>Los avisos automáticos están APAGADOS en Cobranza IA → Configuración: lo programado no sale hasta prenderlos.</p>}
      {datos && proy === 'todos' && [...proyCfg.entries()].some(([, c]) => !c.avisos || !c.agente) && (
        <p className="hint" style={{ textTransform: 'none' }}>⏸ Proyectos apagados: {[...proyCfg.entries()].filter(([, c]) => !c.avisos || !c.agente).map(([id, c]) => (proyectos.find(([pid]) => pid === id)?.[1] || id) + ' (' + [!c.avisos && 'sin avisos', !c.agente && 'sin agente'].filter(Boolean).join(', ') + ')').join(' · ')}. Elige el proyecto en el selector para prenderlo.</p>
      )}

      <div className="chips">
        {[['todos', 'Todos'], ['clientes', '🏠 Clientes'], ['leads', '🆕 Leads']].map(([v, t]) => <button key={v} className={`chip ${tipo === v ? 'on' : ''}`} onClick={() => setTipo(v)}>{t}</button>)}
        <span className="muted small" style={{ alignSelf: 'center' }}>|</span>
        {[['todos', 'Reciben y no'], ['si', '✅ Sí se les escribe'], ['no', '🚫 No se les escribe']].map(([v, t]) => <button key={v} className={`chip ${recibe === v ? 'on' : ''}`} onClick={() => setRecibe(v)}>{t}</button>)}
        {proyectos.length > 1 && (
          <select value={proy} onChange={e => setProy(e.target.value)}>
            <option value="todos">Todos los proyectos</option>
            {proyectos.map(([id, n]) => <option key={id} value={id}>{n}{cfgDe(id).avisos && cfgDe(id).agente ? '' : ' ⏸'}</option>)}
          </select>
        )}
        {proy !== 'todos' && (() => {
          // sql/165: los dos interruptores del proyecto elegido
          const c = cfgDe(proy)
          return (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} title="Interruptores de TODO el proyecto: mandan sobre las casillas de cada cliente">
              <button className={c.avisos ? 'btn-primary' : 'btn-ghost'} disabled={!puede || busy} onClick={() => setProyecto(proy, 'avisos', !c.avisos)}
                style={{ padding: '.25rem .6rem', fontSize: '.8rem', ...(c.avisos ? {} : { borderColor: 'var(--error)', color: 'var(--error)' }) }}
                title={c.avisos ? 'Los avisos automáticos del proyecto están prendidos. Clic para apagarlos a todos sus clientes.' : 'AVISOS APAGADOS para todo el proyecto. Clic para prenderlos.'}>
                📨 avisos del proyecto {c.avisos ? 'ON' : 'OFF'}</button>
              <button className={c.agente ? 'btn-primary' : 'btn-ghost'} disabled={!puede || busy} onClick={() => setProyecto(proy, 'agente', !c.agente)}
                style={{ padding: '.25rem .6rem', fontSize: '.8rem', ...(c.agente ? {} : { borderColor: 'var(--error)', color: 'var(--error)' }) }}
                title={c.agente ? 'El agente contesta a los clientes del proyecto que tengan 🤖 ON. Clic para apagarlo a todos.' : 'AGENTE APAGADO para todo el proyecto: contesta solo la secretaria. Clic para prenderlo.'}>
                🤖 agente del proyecto {c.agente ? 'ON' : 'OFF'}</button>
            </span>
          )
        })()}
        <span className="muted small" style={{ alignSelf: 'center' }}>|</span>
        {[['todos', 'Todo'], ['agente', '🤖 Con agente'], ['respondio', '✅ Respondió'], ['sin_respuesta', '⏳ Sin respuesta']].map(([v, t]) => <button key={v} className={`chip ${resp === v ? 'on' : ''}`} onClick={() => setResp(v)}>{t}</button>)}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre, lote (A1, G-7), celular…" style={{ flex: '1 1 220px', maxWidth: 360 }} />
      </div>

      {datos === null && <p className="muted">Cargando…</p>}
      {datos && !!filas.length && (
        <p className="hint">
          <b>{tot.clientes}</b> cliente{tot.clientes === 1 ? '' : 's'} · <b>{tot.leads}</b> lead{tot.leads === 1 ? '' : 's'} · reciben mensajes <b>{tot.reciben}</b> de {vista.length}
          {tot.hoy > 0 && <> · <b className="warn">{tot.hoy}</b> con aviso programado para HOY</>}
          {' · '}🤖 agente con <b>{tot.agente}</b>{tot.sinResp > 0 && <> · <b className="warn">{tot.sinResp}</b> sin responder el último aviso</>}
        </p>
      )}
      {datos && !!filas.length && !vista.length && <p className="muted">Nada con ese filtro.</p>}
      {datos && !filas.length && <p className="muted">No hay ventas vigentes ni leads que mostrar.</p>}

      {puede && sel.size > 0 && (
        <div className="glass" style={{ padding: '.6rem .9rem', marginBottom: '.8rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>{sel.size} seleccionado{sel.size === 1 ? '' : 's'}</b>
          <button className="btn-primary" disabled={busy} onClick={() => marcar(seleccionadas, true)}>✅ Sí escribirles</button>
          <button className="btn-ghost" disabled={busy} onClick={() => marcar(seleccionadas, false)} style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>🚫 No escribirles</button>
          <span className="muted small">|</span>
          <button className="btn-ghost" disabled={busy} onClick={() => marcarAgente(seleccionadas, true)} title="El agente de cobranza les contesta cuando escriben">🤖 Agente ON</button>
          <button className="btn-ghost" disabled={busy} onClick={() => marcarAgente(seleccionadas, false)} title="Sus mensajes los atiende la secretaria">⏸ Agente OFF</button>
          <button className="link-btn" onClick={() => setSel(new Set())}>quitar selección</button>
        </div>
      )}

      {!!vista.length && (
        <div className="glass table-wrap">
          <table>
            <thead><tr>
              {puede && <th style={{ width: 28 }}><input type="checkbox" checked={todasVisibles} onChange={toggleTodas} title="Seleccionar todo lo que se ve" /></th>}
              <th>Tipo</th><th>Proyecto · lote</th><th>Nombre</th><th>Celular</th>
              <th>Próximo aviso</th><th>Último aviso · ¿respondió?</th><th>Seguimiento</th><th>Agente</th><th>¿Avisos?</th>
            </tr></thead>
            <tbody>
              {vista.map((f, i) => {
                const nuevoProy = i === 0 || vista[i - 1].proyecto !== f.proyecto
                return (
                  <FilaConGrupo key={f.key} f={f} grupo={nuevoProy && proy === 'todos' ? f.proyecto : null} puede={puede} busy={busy} cols={puede ? 10 : 9}
                    marcado={sel.has(f.key)} onSel={() => toggleSel(f.key)} onMarcar={on => marcar([f], on)} onTexto={() => setVerTexto(f)}
                    onAgente={on => marcarAgente([f], on)} onFicha={() => setFicha(f)} abierta={ficha?.key === f.key} />
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {verTexto && (
        <div className="glass" style={{ padding: '1rem', marginTop: '1rem', textTransform: 'none' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <b style={{ flex: 1 }}>📨 {motivoLegible(verTexto.proximo?.motivo)} · {verTexto.nombre} · {verTexto.lote}</b>
            <button className="btn-ghost" onClick={() => setVerTexto(null)}>Cerrar</button>
          </div>
          <p className="muted small" style={{ margin: '.3rem 0' }}>
            Saldría el {fCorta(verTexto.proximo?.fecha)} ({enDias(verTexto.proximo?.fecha)}) con la plantilla <code>{verTexto.proximo?.plantilla || '(sin configurar)'}</code>. Así le llegaría:
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, padding: '.6rem .8rem', borderRadius: 10, background: 'rgba(255,255,255,.05)' }}>{verTexto.proximo?.texto || '(sin texto)'}</pre>
        </div>
      )}

      {ficha && (
        <PanelSeguimiento key={ficha.key} f={filas.find(x => x.key === ficha.key) || ficha} puede={puede} setMsg={setMsg}
          cerrar={() => setFicha(null)} alGuardar={() => cargar(true)} onAgente={on => marcarAgente([ficha], on)} />
      )}

      <details style={{ marginTop: '1.2rem' }}>
        <summary className="small">📖 Cómo se usa esta pantalla</summary>
        <div className="muted small" style={{ textTransform: 'none', lineHeight: 1.55 }}>
          <p><b>Qué muestra.</b> Cada <b>cliente</b> con una venta vigente (una fila por lote) y cada <b>lead</b> del kanban que todavía no compró, agrupados por proyecto. Un lead cuyo celular ya está en la ficha de un cliente aparece marcado: el sistema lo trata como cliente.</p>
          <p><b>Próximo aviso.</b> Lo calcula el agente de cobranza con la misma escalera de siempre (recordatorio 3 días antes, vence hoy, pago vencido a los 2 y 5 días y luego cada 7, aviso por contrato desde 4 cuotas vencidas), respetando sábados, domingos y feriados. Toca el aviso para leer el mensaje tal cual le llegaría. Si no recibe, dice por qué: pausado, con promesa de pago, voucher en revisión, sin celular validado o falta la plantilla. Los leads no reciben avisos de cobranza: a ellos les escribe el bot de ventas.</p>
          <p><b>¿Se le escribe?</b> La casilla de un cliente es la misma que "pausar/reactivar" en la ficha del lote (<i>auto_cobranza</i>). La de un lead es el <b>silencio total</b> del directorio del bot: el bot ni le responde ni le escribe. Marca varias filas y usa "Sí escribirles" / "No escribirles" para cambiarlas en bloque.</p>
          <p><b>Desde aquí no se manda nada.</b> Los avisos salen a la hora configurada en Cobranza IA → Configuración, solo si los avisos están prendidos. "Recalcular" le pide al agente que vuelva a calcular qué le toca a cada uno (también lo hace solo cada 30 minutos y después de cada envío).</p>
          <p><b>¿Respondió?</b> Debajo del último aviso dice <b>✅ respondió</b> si el cliente escribió al 960 después de ese aviso, o <b>⏳ sin respuesta</b> si no. Los filtros "Respondió" y "Sin respuesta" sirven para armar la lista de llamadas.</p>
          <p><b>Agente.</b> El agente de cobranza le contesta <b>solo</b> a los clientes con <b>🤖 ON</b>. A los demás, el mensaje queda en Conversaciones para la secretaria (y le llega el aviso por Telegram). Al prenderlo, el chat que esperaba a la secretaria por eso vuelve al agente.</p>
          <p><b>Seguimiento (📝).</b> Abre la ficha de cobranza del cliente: historial de notas y resultados, y el formulario para anotar uno nuevo. <b>Prometió pagar</b> crea la promesa (pestaña Promesas) y desde ahí ese cliente recibe solo el recordatorio de la promesa. <b>Pagó</b> con voucher lo deja en <b>Por validar</b>, igual que si lo hubiera mandado el cliente: nada suma en Cuotas hasta validarlo. <b>No contesta</b> y <b>Número equivocado</b> quedan anotados para la siguiente llamada o para corregir la ficha.</p>
          <p><b>Mensaje propio.</b> En la misma ficha: <b>instrucciones para el agente</b> (las lee antes de contestarle a ese cliente, por ejemplo "tiene acuerdo de pagar los 30" o "no mencionar el contrato") y <b>texto del próximo aviso</b>. El texto propio sale tal cual solo si el cliente escribió en las últimas 24 horas, porque Meta no deja mandar texto libre fuera de esa ventana; si no, sale la plantilla de siempre. Se usa una sola vez. Para que no reciba ningún aviso automático, pon <b>¿Avisos?</b> en 🚫 No.</p>
          <p><b>Por proyecto (29 oct).</b> Al elegir un proyecto en el selector aparecen sus dos interruptores: <b>📨 avisos del proyecto</b> y <b>🤖 agente del proyecto</b>. Apagar uno manda sobre las casillas de cada cliente: con los avisos del proyecto en OFF nadie de ese proyecto recibe avisos (en la tabla sale "🏗️ Proyecto apagado"); con el agente en OFF, a sus clientes les contesta solo la secretaria. Un cliente con lotes en dos proyectos recibe del que esté prendido.</p>
          <p><b>Quién la ve.</b> El superusuario y quien tenga el permiso de cobranza (Usuarios). El administrador solo mira.</p>
        </div>
      </details>
    </>
  )
}

function FilaConGrupo({ f, grupo, puede, busy, cols, marcado, onSel, onMarcar, onTexto, onAgente, onFicha, abierta }) {
  const est = ESTADO[f.estado] || null
  const px = f.proximo
  return (
    <>
      {grupo && <tr><td colSpan={cols} style={{ background: 'rgba(255,255,255,.04)', fontWeight: 700, letterSpacing: '.3px' }}>🏗️ {grupo}</td></tr>}
      <tr style={!f.recibe ? { opacity: .6 } : undefined}>
        {puede && <td><input type="checkbox" checked={marcado} onChange={onSel} /></td>}
        <td className="small" style={{ whiteSpace: 'nowrap' }}>
          {f.tipo === 'cliente'
            ? <span className="badge" style={{ background: '#5fd38d' }}>Cliente</span>
            : <span className="badge" style={{ background: '#8ab4f8' }}>Lead</span>}
        </td>
        <td className="small" style={{ whiteSpace: 'normal', minWidth: 120 }}>
          {f.tipo === 'cliente'
            ? <b><LoteLink lot={{ id: f.lot_id, mz: f.mz, lt: f.lt }}>{f.lote}</LoteLink></b>
            : <span className="muted">{f.proyecto}</span>}
          {f.tipo === 'cliente' && f.n_vencidas > 0 && <div className="bad" style={{ fontSize: 11 }}>{f.n_vencidas} vencida{f.n_vencidas === 1 ? '' : 's'} · {soles(f.deuda)}</div>}
          {f.tipo === 'cliente' && !f.n_vencidas && f.proxima_cuota && <div className="muted" style={{ fontSize: 11 }}>próxima cuota {fCorta(f.proxima_cuota)}</div>}
        </td>
        <td className="small" style={{ textTransform: 'none', whiteSpace: 'normal', minWidth: 170 }}>
          <b>{f.nombre}</b>
          {f.extra && <div className="muted">{f.extra}</div>}
        </td>
        <td className="small" style={{ whiteSpace: 'nowrap' }}>
          {f.telefono ? <span title={f.telefono_ok ? 'Validado y habilitado para el bot' : 'NO validado o no habilitado para el bot: no recibe'}>{f.telefono_ok ? '' : '⚠ '}{f.telefono}</span> : <span className="muted">—</span>}
          {f.telefono2 && <div className="muted">{f.telefono2_ok ? '' : '⚠ '}{f.telefono2}</div>}
        </td>
        <td className="small" style={{ textTransform: 'none', whiteSpace: 'normal', minWidth: 190 }}>
          {f.tipo === 'lead' ? (
            <>
              <span className="muted">{f.conv_modo === 'humano' ? '👤 lo atiende una persona' : f.conv_estado === 'ia' ? '🤖 bot de ventas (IA)' : f.conv_estado ? '🤖 bot de ventas · ' + f.conv_estado : 'sin conversación'}</span>
              {f.silenciado && <div className="bad" style={{ fontSize: 11 }}>{f.silenciado === 'silencio' ? '🔇 silencio total' : '🚫 número administrativo'}</div>}
            </>
          ) : !px ? <span className="muted">{est ? est[1] : 'sin calcular'}</span> : (
            <>
              {px.estado === 'programado' && px.motivo && (
                <button className="link-btn" style={{ textTransform: 'none', textAlign: 'left' }} onClick={onTexto} title="Ver el mensaje tal cual le llegaría">
                  {motivoLegible(px.motivo)}{px.cuota ? ' · cuota ' + px.cuota : ''}
                </button>
              )}
              {px.estado === 'programado' && <div><b className={px.fecha === hoyLima() ? 'warn' : ''}>{fCorta(px.fecha)}</b> <span className="muted">{enDias(px.fecha)}</span></div>}
              {px.estado !== 'programado' && est && <div className={est[2]} title={px.detalle || ''}>{est[0]} {est[1]}</div>}
              {px.estado !== 'programado' && px.motivo && <div className="muted" style={{ fontSize: 11 }}>si recibiera: {motivoLegible(px.motivo)} el {fCorta(px.fecha)}</div>}
            </>
          )}
        </td>
        <td className="small" style={{ textTransform: 'none', whiteSpace: 'normal', minWidth: 140 }}>
          {f.tipo === 'lead'
            ? <span className="muted">{f.conv_ultimo ? 'último mensaje ' + fHora(f.conv_ultimo) : 'lead creado ' + fCorta(String(f.creado || '').slice(0, 10))}</span>
            : f.ultimo
              ? <>
                  <div>{motivoLegible(f.ultimo.motivo)}{f.ultimo.plantilla === 'texto_propio' ? ' ✍️' : ''}</div>
                  <div className="muted">{fHora(f.ultimo.at)} · {f.ultimo.estado}{f.ultimo.error ? ' ⚠' : ''}</div>
                  {f.respondio === true && <div className="ok" style={{ fontSize: 11 }}>✅ respondió {fHora(f.respondio_at)}</div>}
                  {f.respondio === false && <div className="warn" style={{ fontSize: 11 }}>⏳ sin respuesta {hace(f.ultimo.at)}</div>}
                </>
              : <><span className="muted">ninguno</span>{f.respondio_at && <div className="muted" style={{ fontSize: 11 }}>escribió {fHora(f.respondio_at)}</div>}</>}
        </td>
        <td className="small" style={{ textTransform: 'none', whiteSpace: 'normal', minWidth: 150 }}>
          {f.tipo === 'cliente' ? (
            <>
              {f.seguimiento
                ? <div title={f.seguimiento.nota || ''}>{(RESULTADOS[f.seguimiento.resultado] || ['📝'])[0]} {(RESULTADOS[f.seguimiento.resultado] || [0, f.seguimiento.resultado])[1]}
                    {f.seguimiento.fecha_promesa ? ' · ' + fCorta(f.seguimiento.fecha_promesa) : ''}
                    <div className="muted" style={{ fontSize: 11 }}>{f.seguimiento.nota ? '“' + String(f.seguimiento.nota).slice(0, 60) + (String(f.seguimiento.nota).length > 60 ? '…' : '') + '” · ' : ''}{String(f.seguimiento.por || '').split(' ')[0]} {hace(f.seguimiento.at)}{f.seguimiento.n > 1 ? ' · ' + f.seguimiento.n + ' notas' : ''}</div>
                  </div>
                : <span className="muted">—</span>}
              <button className={abierta ? 'btn-primary' : 'btn-ghost'} onClick={onFicha} style={{ padding: '.15rem .55rem', fontSize: '.75rem', marginTop: 3 }}
                title="Notas, resultados, voucher y mensaje propio de este cliente">📝 {puede ? 'Seguimiento' : 'Ver'}{(f.instrucciones || f.aviso_texto) ? ' ✍️' : ''}</button>
            </>
          ) : <span className="muted">—</span>}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {f.tipo === 'cliente'
            ? <button className={f.agente ? 'btn-primary' : 'btn-ghost'} disabled={!puede || busy} onClick={() => onAgente(!f.agente)}
                title={f.agente ? 'El agente le contesta. Clic para que lo atienda solo la secretaria.' : 'El agente NO le contesta: lo atiende la secretaria. Clic para prenderlo.'}
                style={{ padding: '.25rem .6rem', fontSize: '.8rem' }}>{f.agente ? '🤖 ON' : '⏸ OFF'}</button>
            : <span className="muted small">bot de ventas</span>}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button className={f.recibe ? 'btn-primary' : 'btn-ghost'} disabled={!puede || busy} onClick={() => onMarcar(!f.recibe)}
            title={f.recibe ? 'Sí se le escribe. Clic para dejar de escribirle.' : 'NO se le escribe. Clic para volver a escribirle.'}
            style={{ padding: '.25rem .7rem', fontSize: '.8rem', ...(f.recibe ? {} : { borderColor: 'var(--error)', color: 'var(--error)' }) }}>
            {f.recibe ? '✅ Sí' : '🚫 No'}
          </button>
        </td>
      </tr>
    </>
  )
}

// ============================================================================
// SEGUIMIENTO de un cliente (sql/161): historial, nueva entrada (con promesa o
// voucher) y el mensaje propio (agente, instrucciones y texto del próximo aviso)
// ============================================================================
function PanelSeguimiento({ f, puede, setMsg, cerrar, alGuardar, onAgente }) {
  const [hist, setHist] = useState(null)
  const [n, setN] = useState({ resultado: 'nota', nota: '', fecha: '', monto: '', op: '', banco: '' })
  const [archivo, setArchivo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [instr, setInstr] = useState(f.instrucciones || '')
  const [texto, setTexto] = useState(f.aviso_texto || '')
  const hoy = hoyLima()

  async function cargarHist() {
    const { data, error } = await supabase.rpc('cobranza_seguimiento_de', { p_sale: f.id })
    setHist(error ? [] : (data || []))
  }
  useEffect(() => { cargarHist() }, [f.id])

  async function guardar() {
    if (n.resultado === 'nota' && !n.nota.trim()) { setMsg({ ok: false, t: 'ESCRIBE LA NOTA.' }); return }
    if (n.resultado === 'promesa' && !n.fecha) { setMsg({ ok: false, t: 'PON LA FECHA EN QUE PROMETIÓ PAGAR.' }); return }
    if (n.resultado === 'pago' && archivo && (!(Number(n.monto) > 0) || !n.fecha)) { setMsg({ ok: false, t: 'CON VOUCHER: PON EL MONTO Y LA FECHA DEL PAGO.' }); return }
    setBusy(true)
    let url = null
    try { if (n.resultado === 'pago' && archivo) url = await upload('cobranza/vouchers-secretaria/' + f.id, archivo) }
    catch (e) { setBusy(false); setMsg({ ok: false, t: 'No se pudo subir el voucher: ' + (e.message || e) }); return }
    const { error } = await supabase.rpc('cobranza_seguimiento_agregar', {
      p_sale: f.id, p_resultado: n.resultado, p_nota: n.nota.trim() || null,
      p_fecha: (n.resultado === 'promesa' || n.resultado === 'pago') && n.fecha ? n.fecha : null,
      p_monto: Number(n.monto) > 0 ? Number(n.monto) : null,
      p_voucher_url: url, p_operacion: n.op.trim() || null, p_banco: n.banco.trim() || null,
    })
    setBusy(false)
    if (error) { setMsg({ ok: false, t: /cobranza_seguimiento/.test(error.message) ? 'Falta correr sql/161 en el servidor.' : 'ERROR: ' + error.message }); return }
    savedFx()
    setMsg({ ok: true, t: n.resultado === 'promesa' ? '📅 PROMESA ANOTADA (queda en Promesas)' : url ? '💵 VOUCHER SUBIDO: QUEDA EN "POR VALIDAR"' : 'SEGUIMIENTO GUARDADO' })
    setN({ resultado: 'nota', nota: '', fecha: '', monto: '', op: '', banco: '' }); setArchivo(null)
    cargarHist(); alGuardar()
  }

  async function guardarMensaje() {
    setBusy(true)
    const { error } = await supabase.from('cobranza_clientes_cfg').upsert({
      client_id: f.client_id, agente: f.agente, instrucciones: instr.trim() || null, aviso_texto: texto.trim() || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id' })
    setBusy(false)
    if (error) { setMsg({ ok: false, t: /cobranza_clientes_cfg/.test(error.message) ? 'Falta correr sql/161 en el servidor.' : 'ERROR: ' + error.message }); return }
    await supabase.rpc('avisos_recalcular').then(() => {}, () => {})
    savedFx(); setMsg({ ok: true, t: 'MENSAJE PROPIO GUARDADO' }); alGuardar()
  }

  const conFecha = n.resultado === 'promesa' || n.resultado === 'pago'
  return (
    <div className="glass" style={{ padding: '1rem', marginTop: '1rem', textTransform: 'none' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ flex: 1 }}>📝 Seguimiento · {f.nombre} · {f.lote} · {f.proyecto}</b>
        <button className={f.agente ? 'btn-primary' : 'btn-ghost'} disabled={!puede || busy} onClick={() => onAgente(!f.agente)}>{f.agente ? '🤖 Agente ON' : '⏸ Agente OFF'}</button>
        <button className="btn-ghost" onClick={cerrar}>Cerrar</button>
      </div>
      <p className="muted small" style={{ margin: '.3rem 0 .8rem' }}>
        {f.n_vencidas > 0 ? <>{f.n_vencidas} cuota(s) vencida(s) · {soles(f.deuda)}</> : 'Sin cuotas vencidas'}
        {f.ultimo && <> · último aviso {fHora(f.ultimo.at)} · {f.respondio ? '✅ respondió' : '⏳ sin respuesta'}</>}
        {f.telefono && <> · 📱 {f.telefono}</>}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, alignItems: 'start' }}>
        <div>
          {puede && (
            <div className="form-card" style={{ marginBottom: 10 }}>
              <b className="small">Anotar</b>
              <div className="chips" style={{ margin: '.4rem 0' }}>
                {Object.entries(RESULTADOS).map(([k, [ic, t]]) => <button key={k} className={`chip ${n.resultado === k ? 'on' : ''}`} onClick={() => setN(x => ({ ...x, resultado: k }))}>{ic} {t}</button>)}
              </div>
              <textarea value={n.nota} onChange={e => setN(x => ({ ...x, nota: e.target.value }))} rows={2} style={{ width: '100%', textTransform: 'none' }}
                placeholder={n.resultado === 'no_contesta' ? 'Ej. llamé 2 veces, no contesta (opcional)' : n.resultado === 'numero_equivocado' ? 'Quién contestó / qué número es el correcto (opcional)' : 'Qué se habló'} />
              {conFecha && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <label className="small">{n.resultado === 'promesa' ? 'Pagará el' : 'Pagó el'}{' '}
                    <input type="date" value={n.fecha} min={n.resultado === 'promesa' ? hoy : undefined} max={n.resultado === 'pago' ? hoy : undefined} onChange={e => setN(x => ({ ...x, fecha: e.target.value }))} />
                  </label>
                  <label className="small">Monto S/{' '}
                    <input type="number" min="0" step="0.01" value={n.monto} onChange={e => setN(x => ({ ...x, monto: e.target.value }))} style={{ width: 110 }} />
                  </label>
                </div>
              )}
              {n.resultado === 'pago' && (
                <div style={{ marginTop: 6 }}>
                  <label className="btn-ghost" style={{ cursor: 'pointer', display: 'inline-block' }}>
                    📎 {archivo ? archivo.name : 'Subir voucher (foto o PDF)'}
                    <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={e => { setArchivo(e.target.files?.[0] || null); e.target.value = '' }} />
                  </label>
                  {archivo && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                      <input value={n.op} onChange={e => setN(x => ({ ...x, op: e.target.value }))} placeholder="N° de operación" style={{ flex: '1 1 140px' }} />
                      <input value={n.banco} onChange={e => setN(x => ({ ...x, banco: e.target.value }))} placeholder="Banco / billetera" style={{ flex: '1 1 140px' }} />
                    </div>
                  )}
                  <p className="muted small" style={{ margin: '.3rem 0 0' }}>Con voucher queda en <b>Por validar</b>: se aprueba ahí y recién suma en Cuotas.</p>
                </div>
              )}
              <button className="btn-primary" disabled={busy} onClick={guardar} style={{ marginTop: 8 }}>{busy ? '…' : 'Guardar'}</button>
            </div>
          )}
          <b className="small">Historial</b>
          {hist === null && <p className="muted small">Cargando…</p>}
          {hist && !hist.length && <p className="muted small">Todavía no hay seguimiento de este cliente.</p>}
          {(hist || []).map(h => {
            const r = RESULTADOS[h.resultado] || ['📝', h.resultado]
            return (
              <div key={h.id} style={{ borderLeft: '2px solid rgba(255,255,255,.15)', padding: '.2rem .6rem', margin: '.4rem 0' }}>
                <div className="small"><b>{r[0]} {r[1]}</b>
                  {h.fecha_promesa && <> · para el {fCorta(h.fecha_promesa)}</>}
                  {h.monto && <> · {soles(h.monto)}</>}
                  {h.pago_estado && <> · voucher {h.pago_estado === 'pendiente' ? '⏳ por validar' : h.pago_estado === 'validado' ? '✅ validado' : '❌ rechazado'}</>}
                  {h.promesa_estado && h.promesa_estado !== 'vigente' && <> · promesa {h.promesa_estado}</>}
                </div>
                {h.nota && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{h.nota}</div>}
                <div className="muted" style={{ fontSize: 11 }}>{h.por || '?'} · {fHora(h.at)}</div>
              </div>
            )
          })}
        </div>

        <div className="form-card">
          <b className="small">✍️ Mensaje propio de este cliente</b>
          <label className="small" style={{ display: 'block', marginTop: 6 }}>Instrucciones para el agente
            <textarea value={instr} disabled={!puede} onChange={e => setInstr(e.target.value)} rows={3} style={{ width: '100%', textTransform: 'none' }}
              placeholder='Ej. "Tiene acuerdo de pagar los días 30, no insistir antes." · "No mencionar el contrato." · "Tratarlo de usted."' />
          </label>
          <p className="muted small" style={{ margin: '.2rem 0 .6rem' }}>El agente las lee antes de contestarle a este cliente. No se las muestra al cliente.</p>
          <label className="small" style={{ display: 'block' }}>Texto del próximo aviso
            <textarea value={texto} disabled={!puede} onChange={e => setTexto(e.target.value)} rows={3} style={{ width: '100%', textTransform: 'none' }}
              placeholder="Vacío = sale la plantilla de siempre." />
          </label>
          <p className="muted small" style={{ margin: '.2rem 0 .6rem' }}>
            Sale tal cual <b>solo si el cliente escribió en las últimas 24 h</b> (regla de Meta). Si no, sale la plantilla aprobada. Se usa una sola vez.
            {f.proximo?.estado === 'programado' && f.proximo?.fecha && <> Próximo aviso: <b>{fCorta(f.proximo.fecha)}</b> ({motivoLegible(f.proximo.motivo)}).</>}
          </p>
          {puede && <button className="btn-primary" disabled={busy} onClick={guardarMensaje}>Guardar mensaje propio</button>}
          {!f.recibe && <p className="warn small" style={{ marginTop: 6 }}>Este cliente tiene los avisos automáticos en 🚫 No: no le sale ningún aviso.</p>}
        </div>
      </div>
    </div>
  )
}
