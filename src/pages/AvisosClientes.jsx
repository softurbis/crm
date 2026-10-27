import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMsg } from '../lib/saveFx'
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
// ============================================================================

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
function motivoLegible(m) {
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
  promesa: ['📅', 'Con promesa', 'warn'],
  voucher: ['🧾', 'Voucher en revisión', 'warn'],
  sin_celular: ['📵', 'Sin celular validado', 'bad'],
  sin_plantilla: ['⚠', 'Falta plantilla', 'warn'],
  al_dia: ['✅', 'Al día', 'muted'],
  nada: ['·', 'Nada programado', 'muted'],
}
const LEAD_STATUS = { nuevo: 'Nuevo', contactado: 'Contactado', interesado: 'Interesado', visita_agendada: 'Visita agendada', negociacion: 'Negociación', perdido: 'Perdido' }

export default function AvisosClientes() {
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

  async function cargar(silencioso = false) {
    const { data, error } = await supabase.rpc('avisos_por_cliente')
    if (error) {
      if (!silencioso) setMsg({ ok: false, t: /avisos_por_cliente/.test(error.message) ? 'Falta correr sql/159 en el servidor.' : error.message })
      setDatos(d => d || { clientes: [], leads: [], cfg: {} })
      return
    }
    setDatos(data)
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
      && (!t || sinTildes([f.nombre, f.extra, f.lote, f.lote?.replace(/MZ | LT /g, ''), f.telefono, f.telefono2, f.proyecto].join(' ')).includes(t)))
      .sort((a, b) => a.proyecto.localeCompare(b.proyecto) || (a.tipo === b.tipo ? 0 : a.tipo === 'cliente' ? -1 : 1) || a.orden.localeCompare(b.orden) || a.nombre.localeCompare(b.nombre))
  }, [filas, proy, tipo, recibe, q])

  const tot = useMemo(() => ({
    clientes: vista.filter(f => f.tipo === 'cliente').length,
    leads: vista.filter(f => f.tipo === 'lead').length,
    reciben: vista.filter(f => f.recibe).length,
    hoy: vista.filter(f => f.proximo?.estado === 'programado' && f.proximo?.fecha === hoyLima()).length,
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
        <h1 style={{ margin: 0, flex: 1 }}>Avisos por cliente</h1>
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
        Todos los clientes con venta vigente y los leads del kanban, por proyecto, con el aviso de cobranza que le toca a cada uno y cuándo. Marca a quién se le escribe y a quién no. <b>Desde aquí no se manda nada</b>: los avisos los envía el agente a su hora.
      </p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      {!puede && <p className="hint muted">Modo consulta: cambiar quién recibe es de la responsable de cobranza.</p>}
      {sinProyeccion && <p className="error" style={{ textTransform: 'none' }}>⚠ El agente todavía no calculó ningún "próximo aviso": falta actualizar el agente en el servidor (migracion/07) después de correr sql/159. Las casillas igual funcionan.</p>}
      {datos && !cfg.avisos_activos && <p className="hint" style={{ textTransform: 'none' }}>Los avisos automáticos están APAGADOS en Cobranza IA → Configuración: lo programado no sale hasta prenderlos.</p>}

      <div className="chips">
        {[['todos', 'Todos'], ['clientes', '🏠 Clientes'], ['leads', '🆕 Leads']].map(([v, t]) => <button key={v} className={`chip ${tipo === v ? 'on' : ''}`} onClick={() => setTipo(v)}>{t}</button>)}
        <span className="muted small" style={{ alignSelf: 'center' }}>|</span>
        {[['todos', 'Reciben y no'], ['si', '✅ Sí se les escribe'], ['no', '🚫 No se les escribe']].map(([v, t]) => <button key={v} className={`chip ${recibe === v ? 'on' : ''}`} onClick={() => setRecibe(v)}>{t}</button>)}
        {proyectos.length > 1 && (
          <select value={proy} onChange={e => setProy(e.target.value)}>
            <option value="todos">Todos los proyectos</option>
            {proyectos.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre, lote (A1, G-7), celular…" style={{ flex: '1 1 220px', maxWidth: 360 }} />
      </div>

      {datos === null && <p className="muted">Cargando…</p>}
      {datos && !!filas.length && (
        <p className="hint">
          <b>{tot.clientes}</b> cliente{tot.clientes === 1 ? '' : 's'} · <b>{tot.leads}</b> lead{tot.leads === 1 ? '' : 's'} · reciben mensajes <b>{tot.reciben}</b> de {vista.length}
          {tot.hoy > 0 && <> · <b className="warn">{tot.hoy}</b> con aviso programado para HOY</>}
        </p>
      )}
      {datos && !!filas.length && !vista.length && <p className="muted">Nada con ese filtro.</p>}
      {datos && !filas.length && <p className="muted">No hay ventas vigentes ni leads que mostrar.</p>}

      {puede && sel.size > 0 && (
        <div className="glass" style={{ padding: '.6rem .9rem', marginBottom: '.8rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>{sel.size} seleccionado{sel.size === 1 ? '' : 's'}</b>
          <button className="btn-primary" disabled={busy} onClick={() => marcar(seleccionadas, true)}>✅ Sí escribirles</button>
          <button className="btn-ghost" disabled={busy} onClick={() => marcar(seleccionadas, false)} style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>🚫 No escribirles</button>
          <button className="link-btn" onClick={() => setSel(new Set())}>quitar selección</button>
        </div>
      )}

      {!!vista.length && (
        <div className="glass table-wrap">
          <table>
            <thead><tr>
              {puede && <th style={{ width: 28 }}><input type="checkbox" checked={todasVisibles} onChange={toggleTodas} title="Seleccionar todo lo que se ve" /></th>}
              <th>Tipo</th><th>Proyecto · lote</th><th>Nombre</th><th>Celular</th>
              <th>Próximo aviso</th><th>Último aviso</th><th>¿Se le escribe?</th>
            </tr></thead>
            <tbody>
              {vista.map((f, i) => {
                const nuevoProy = i === 0 || vista[i - 1].proyecto !== f.proyecto
                return (
                  <FilaConGrupo key={f.key} f={f} grupo={nuevoProy && proy === 'todos' ? f.proyecto : null} puede={puede} busy={busy} cols={puede ? 8 : 7}
                    marcado={sel.has(f.key)} onSel={() => toggleSel(f.key)} onMarcar={on => marcar([f], on)} onTexto={() => setVerTexto(f)} />
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

      <details style={{ marginTop: '1.2rem' }}>
        <summary className="small">📖 Cómo se usa esta pantalla</summary>
        <div className="muted small" style={{ textTransform: 'none', lineHeight: 1.55 }}>
          <p><b>Qué muestra.</b> Cada <b>cliente</b> con una venta vigente (una fila por lote) y cada <b>lead</b> del kanban que todavía no compró, agrupados por proyecto. Un lead cuyo celular ya está en la ficha de un cliente aparece marcado: el sistema lo trata como cliente.</p>
          <p><b>Próximo aviso.</b> Lo calcula el agente de cobranza con la misma escalera de siempre (recordatorio 3 días antes, vence hoy, pago vencido a los 2 y 5 días y luego cada 7, aviso por contrato desde 4 cuotas vencidas), respetando sábados, domingos y feriados. Toca el aviso para leer el mensaje tal cual le llegaría. Si no recibe, dice por qué: pausado, con promesa de pago, voucher en revisión, sin celular validado o falta la plantilla. Los leads no reciben avisos de cobranza: a ellos les escribe el bot de ventas.</p>
          <p><b>¿Se le escribe?</b> La casilla de un cliente es la misma que "pausar/reactivar" en la ficha del lote (<i>auto_cobranza</i>). La de un lead es el <b>silencio total</b> del directorio del bot: el bot ni le responde ni le escribe. Marca varias filas y usa "Sí escribirles" / "No escribirles" para cambiarlas en bloque.</p>
          <p><b>Desde aquí no se manda nada.</b> Los avisos salen a la hora configurada en Cobranza IA → Configuración, solo si los avisos están prendidos. "Recalcular" le pide al agente que vuelva a calcular qué le toca a cada uno (también lo hace solo cada 30 minutos y después de cada envío).</p>
          <p><b>Quién la ve.</b> El superusuario y quien tenga el permiso de cobranza (Usuarios). El administrador solo mira.</p>
        </div>
      </details>
    </>
  )
}

function FilaConGrupo({ f, grupo, puede, busy, cols, marcado, onSel, onMarcar, onTexto }) {
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
              ? <><div>{motivoLegible(f.ultimo.motivo)}</div><div className="muted">{fHora(f.ultimo.at)} · {f.ultimo.estado}{f.ultimo.error ? ' ⚠' : ''}</div></>
              : <span className="muted">ninguno</span>}
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
