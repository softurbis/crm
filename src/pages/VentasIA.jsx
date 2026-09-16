import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMsg } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'

// ============================================================================
// AGENTE DE VENTAS IA — el experimento contra el supervisor (sql/91)
// ----------------------------------------------------------------------------
// De cada 10 leads que piden asesor, N los atiende el agente (agente/ventas_ia.js)
// en el mismo chat del bot y el resto sigue con el supervisor. Aqui el dueño:
//   · confirma, cambia de hora o cancela las visitas que propuso el agente
//     (recien al confirmar, el agente se la confirma al cliente),
//   · compara IA contra supervisor con las mismas medidas,
//   · ve los leads que atiende el agente,
//   · prende el experimento y ajusta al agente.
// Solo superusuario; el administrador mira.
// ============================================================================

const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const fCorta = iso => iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : '—'
const fHora = s => s ? new Date(s).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const dia = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('es-PE', { weekday: 'long', timeZone: 'UTC' })
const pct = (a, b) => b ? Math.round(a * 100 / b) + ' %' : '—'
// US$ por millón de tokens: entrada, salida, lectura de caché
const PRECIOS = { 'claude-opus-5': [5, 25, 0.5], 'claude-sonnet-5': [2, 10, 0.2], 'claude-haiku-4-5': [1, 5, 0.1] }
const MODELOS = [['claude-opus-5', 'Claude Opus 5 (el más capaz)'], ['claude-sonnet-5', 'Claude Sonnet 5'], ['claude-haiku-4-5', 'Claude Haiku 4.5 (el más barato)']]

export default function VentasIA() {
  const { role, profile } = useAuth()
  const puede = role === 'superuser'
  const ve = puede || role === 'admin'
  const [tab, setTab] = useState('citas')
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
  const TABS = [['citas', '📅 Visitas por confirmar'], ['resultados', '📊 IA vs. supervisor'], ['leads', '💬 Leads del agente'], ['config', '⚙️ Configuración']]

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Agente de ventas</h1>
        {cfg && (
          <span className="small" title={cfg.latido ? 'Último latido del bot: ' + fHora(cfg.latido) : 'El bot nunca reportó'}>
            {vivo ? '🟢 bot corriendo' : '🔴 el bot no reporta'}
            {' · '}{cfg.activo ? `🧪 experimento ON (${cfg.ia_por_cada_10} de cada 10)` : '⏸ experimento apagado'}
            {vivo && cfg.latido_info && !cfg.latido_info.ia ? ' · ⚠ sin clave de Claude' : ''}
          </span>
        )}
      </div>
      {falta && <p className="error">{falta}</p>}
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      {!puede && <p className="hint muted">Modo consulta: confirmar visitas y configurar es del superusuario.</p>}
      <div className="toolbar" style={{ flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {!falta && cfg && tab === 'citas' && <Citas puede={puede} setMsg={setMsg} />}
      {!falta && cfg && tab === 'resultados' && <Resultados cfg={cfg} />}
      {!falta && cfg && tab === 'leads' && <Leads />}
      {!falta && cfg && tab === 'config' && <Configuracion cfg={cfg} puede={puede} profile={profile} recargar={cargarCfg} setMsg={setMsg} />}
    </>
  )
}

// ============================================================================
// VISITAS POR CONFIRMAR
// ============================================================================
const COLS_CITA = 'id, lead_id, fecha, hora, personas, lote_interes, nota, estado, es_prueba, cambio_hora, created_at, confirmada_at, aviso_cliente_at, lead:leads(full_name, phone), project:projects(name)'

function Citas({ puede, setMsg }) {
  const [abiertas, setAbiertas] = useState([])
  const [recientes, setRecientes] = useState([])
  const [cambio, setCambio] = useState(null)   // { id, fecha, hora }
  const [ocupado, setOcupado] = useState(false)

  async function cargar() {
    const [a, r] = await Promise.all([
      supabase.from('ventas_ia_citas').select(COLS_CITA).eq('estado', 'por_confirmar').order('fecha').order('hora'),
      supabase.from('ventas_ia_citas').select(COLS_CITA).neq('estado', 'por_confirmar').order('updated_at', { ascending: false }).limit(15),
    ])
    setAbiertas(a.data || []); setRecientes(r.data || [])
  }
  useEffect(() => { cargar(); const t = setInterval(cargar, 20000); return () => clearInterval(t) }, [])

  async function confirmar(c, fecha, hora) {
    setOcupado(true)
    const { error } = await supabase.rpc('ventas_ia_confirmar', { cid: c.id, nueva_fecha: fecha || null, nueva_hora: hora || null })
    setOcupado(false)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'VISITA CONFIRMADA: el agente se lo dice al cliente en un momento' + (c.es_prueba ? ' (prueba: no va a Visitas)' : ' y ya está en Visitas') })
    if (!error) { setCambio(null); cargar() }
  }
  async function cancelar(c) {
    if (!confirm('¿No puedes atender esta visita?\n\nEl agente se disculpa con el cliente y le propone otro día.')) return
    setOcupado(true)
    const { error } = await supabase.rpc('ventas_ia_cancelar', { cid: c.id })
    setOcupado(false)
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'CANCELADA: el agente le propone otro día al cliente' })
    if (!error) cargar()
  }

  // funcion y no componente: un componente definido aqui adentro se remonta en
  // cada tecla y el campo de hora pierde el foco
  const tarjeta = c => (
    <div key={c.id} className="glass form-card" style={{ maxWidth: 'none', marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <b style={{ fontSize: '1.05em' }}>{dia(c.fecha)} {fCorta(c.fecha)} · {String(c.hora).slice(0, 5)}</b>
        <span>{c.lead?.full_name || '—'}</span>
        <a href={'https://wa.me/' + String(c.lead?.phone || '').replace(/\D/g, '')} target="_blank" rel="noreferrer" className="small">+{String(c.lead?.phone || '').replace(/\D/g, '')}</a>
        <span className="muted small">{c.project?.name || ''}</span>
        {c.es_prueba && <span className="small" style={{ color: '#c58ae0' }}>🧪 PRUEBA</span>}
        {c.fecha < hoyLima() && <span className="small error">ya pasó</span>}
      </div>
      <p className="small" style={{ textTransform: 'none', margin: '6px 0' }}>
        {c.personas ? c.personas + ' persona(s) · ' : ''}{c.lote_interes ? 'Quiere ver ' + c.lote_interes + ' · ' : ''}propuesta {fHora(c.created_at)}
        {c.nota && <><br />📝 {c.nota}</>}
      </p>
      {puede && (cambio?.id === c.id
        ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="date" min={hoyLima()} value={cambio.fecha} onChange={e => setCambio({ ...cambio, fecha: e.target.value })} />
            <input type="time" value={cambio.hora} onChange={e => setCambio({ ...cambio, hora: e.target.value })} />
            <button className="btn-primary" disabled={ocupado || !cambio.fecha || !cambio.hora} onClick={() => confirmar(c, cambio.fecha, cambio.hora)}>Confirmar en esta fecha</button>
            <button className="btn-ghost" onClick={() => setCambio(null)}>Volver</button>
          </div>
        : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn-primary" disabled={ocupado} onClick={() => confirmar(c)}>✅ Confirmar</button>
            <button className="btn-ghost" disabled={ocupado} onClick={() => setCambio({ id: c.id, fecha: c.fecha, hora: String(c.hora).slice(0, 5) })}>🕐 Otra fecha u hora</button>
            <button className="btn-ghost" disabled={ocupado} onClick={() => cancelar(c)}>✖ No puedo</button>
          </div>)}
    </div>
  )

  return (
    <>
      <p className="hint">
        {abiertas.length
          ? <><b>{abiertas.length}</b> visita(s) esperando tu confirmación. El cliente sabe que se la vas a confirmar: mientras más rápido, mejor.</>
          : 'No hay visitas por confirmar.'}
      </p>
      {abiertas.map(tarjeta)}
      {recientes.length > 0 && (
        <>
          <p><b>Últimas resueltas</b></p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Cuándo</th><th>Cliente</th><th>Proyecto</th><th>Estado</th><th>Avisado al cliente</th></tr></thead>
              <tbody>
                {recientes.map(c => (
                  <tr key={c.id}>
                    <td>{fCorta(c.fecha)} {String(c.hora).slice(0, 5)}{c.cambio_hora ? ' 🕐' : ''}</td>
                    <td>{c.lead?.full_name || '—'}{c.es_prueba ? ' 🧪' : ''}</td>
                    <td>{c.project?.name || '—'}</td>
                    <td>{c.estado === 'confirmada' ? '✅ confirmada' : '✖ cancelada'}</td>
                    <td>{c.aviso_cliente_at ? fHora(c.aviso_cliente_at) : '⏳ en camino'}</td>
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
// RESULTADOS: IA contra supervisor
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

  const g = k => (filas || []).find(f => f.grupo === k) || { leads: 0, respondieron: 0, visitas_agendadas: 0, visitas_realizadas: 0, ganados: 0, propuestas_agente: 0, derivados: 0, costo_tokens_in: 0, costo_tokens_out: 0 }
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
      <p className="hint" style={{ textTransform: 'none' }}>
        <b>Cómo se mide:</b> los dos grupos salen del mismo reparto al azar y se miden igual: una visita cuenta si está en <b>Visitas</b> con el celular del lead
        y fue registrada después del reparto (las del supervisor las carga él; las del agente entran al confirmarlas aquí). Las pruebas no cuentan.
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
      .select('lead_id, grupo, es_prueba, motivo, asignado_at, primer_mensaje_at, ultimo_turno_at, turnos, derivado_at, derivado_motivo, lead:leads(full_name, phone, status, temperature, budget_estimate), project:projects(name)')
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
                    <td>{v.lead?.full_name || '—'}<br /><a className="small" href={'https://wa.me/' + String(v.lead?.phone || '').replace(/\D/g, '')} target="_blank" rel="noreferrer">+{String(v.lead?.phone || '').replace(/\D/g, '')}</a></td>
                    <td>{v.project?.name || '—'}</td>
                    <td className="small">{fHora(v.asignado_at)}<br /><span className="muted">{v.motivo}</span></td>
                    <td>{seg == null ? '—' : seg < 90 ? seg + ' s' : Math.round(seg / 60) + ' min'}</td>
                    <td>{v.turnos}</td>
                    <td className="small">
                      {String(v.lead?.status || '').replace('_', ' ')}{v.lead?.temperature === 'caliente' ? ' 🔥' : ''}
                      {v.derivado_at && <><br />🙋 pasado a persona: {v.derivado_motivo}</>}
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
    setF({ ...cfg, hora_inicio: String(cfg.hora_inicio || '07:30').slice(0, 5), hora_fin: String(cfg.hora_fin || '21:30').slice(0, 5) })
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
    if (on && !confirm('¿Prender el experimento?\n\nDesde ahora, de cada 10 leads que pidan asesor, ' + f.ia_por_cada_10 + ' los atiende el agente en vez del supervisor.')) return
    if (await guardar({ activo: on }, on ? 'EXPERIMENTO PRENDIDO' : 'EXPERIMENTO APAGADO: los leads nuevos van todos al supervisor')) setF(x => ({ ...x, activo: on }))
  }
  function guardarForm(e) {
    e.preventDefault()
    const txt = v => (v || '').trim() || null
    const min = Math.max(0, Number(f.lectura_min_seg) || 0)
    guardar({
      ia_por_cada_10: Math.min(10, Math.max(0, Math.round(Number(f.ia_por_cada_10) || 0))),
      aviso_phone: String(f.aviso_phone || '').replace(/\D/g, '').replace(/^(9\d{8})$/, '51$1') || '51924947651',
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
        <label className="inline-check" style={{ display: 'flex', margin: '6px 0' }}>
          <input type="checkbox" disabled={!puede} checked={!!cfg.activo} onChange={e => interruptor(e.target.checked)} />
          🧪 <b>Experimento</b>: reparte los leads que piden asesor entre el agente y el supervisor
        </label>
        <p className="small muted" style={{ textTransform: 'none' }}>
          Bot: {cfg.latido ? 'último latido ' + fHora(cfg.latido) : 'nunca reportó'} · Claude {info.ia ? (info.clave_propia ? '✅ clave propia' : '⚠ usando la clave general') : '❌ sin clave'}
          <br />Para probarlo sin tocar clientes: <b>Probar Bot</b> → perfil lead → escribe como cliente y pide un asesor. En las pruebas siempre atiende el agente, aunque el experimento esté apagado.
        </p>
      </div>

      <form className="glass form-card" style={{ maxWidth: 'none' }} onSubmit={guardarForm}>
        <p><b>El experimento</b></p>
        <div className="form-grid">
          <label>De cada 10 leads, cuántos al agente<input type="number" min="0" max="10" value={f.ia_por_cada_10} onChange={campo('ia_por_cada_10')} disabled={!puede} /></label>
          <label>Celular que confirma las visitas<input value={f.aviso_phone || ''} onChange={campo('aviso_phone')} disabled={!puede} placeholder="51924947651" /></label>
          <label>Encargado de esas visitas (sale en Visitas)<input value={f.encargado_nombre || ''} onChange={campo('encargado_nombre')} disabled={!puede} placeholder="CESAR" /></label>
          <label>Punto de encuentro para las visitas<input value={f.punto_encuentro || ''} onChange={campo('punto_encuentro')} disabled={!puede} style={{ textTransform: 'none' }} /></label>
        </div>

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
        </div>
        <p className="small muted" style={{ textTransform: 'none' }}>
          Para parecer una persona: espera un rato al azar antes de contestar (y si el cliente sigue escribiendo, espera a que termine), muestra "escribiendo…" según el largo del mensaje y parte las respuestas en mensajes cortos.
          Fuera de horario no contesta: lo hace al abrir.
        </p>

        <label style={{ marginTop: 10, display: 'block' }}>Indicaciones para el agente <span className="muted small">(mandan sobre todo lo demás: horario de visitas, cómo llegar, oferta vigente CONFIRMADA, qué no decir…)</span>
          <textarea rows="6" value={f.notas || ''} onChange={campo('notas')} disabled={!puede} style={{ textTransform: 'none' }}
            placeholder={'Ej: Las visitas son de lunes a domingo de 8 a 5. Se sale en movilidad desde la oficina de Pucallpa a las 9 y a las 3.\nEste mes la inicial es S/ 500 para todos los lotes.'} />
        </label>
        {puede && <button className="btn-primary" style={{ marginTop: 10 }}>Guardar configuración</button>}
      </form>
    </>
  )
}
