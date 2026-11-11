import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import { useMsg, savedFx } from '../lib/saveFx'
import { avisar, pedir } from '../lib/dialogos'
import { useEsCelular } from '../lib/useEsCelular'

// PROSPECTOS (10 nov 2026, pedido del dueño): el panel de seguimiento del VENDEDOR.
// Cada vendedor (rol 'asesor') ve SOLO los leads que tiene asignados: sus números, sus
// notas, en qué va cada uno y cuándo le toca volver a contactarlo. Lo hace valer la
// base (sql/190), no esta pantalla. El resto del equipo ve todos; el superusuario, el
// administrador y el operador además los reparten.
// Los datos son la tabla `leads` de siempre (la que llena el bot) y `lead_activities`.

const ESTADOS = [
  ['nuevo', 'Nuevo', '#7ba7f7'],
  ['contactado', 'Contactado', '#56c7d6'],
  ['interesado', 'Interesado', '#e0b34c'],
  ['visita_agendada', 'Visita', '#b792e8'],
  ['negociacion', 'Negociación', '#f0a35c'],
  ['ganado', 'Ganado', '#6fdd9b'],
  ['perdido', 'Perdido', '#9daab6'],
]
const EST = Object.fromEntries(ESTADOS.map(([v, t, c]) => [v, { t, c }]))
const TEMPS = [['frio', '❄️ Frío', '#7ba7f7'], ['tibio', '🌤️ Tibio', '#e0b34c'], ['caliente', '🔥 Caliente', '#f2785c']]
const TEMP = Object.fromEntries(TEMPS.map(([v, t, c]) => [v, { t, c }]))
const ORIGENES = [['referido', 'Referido'], ['feria', 'Feria o volanteo'], ['walk_in', 'Vino a la oficina'], ['ads', 'Publicidad / redes'], ['whatsapp', 'WhatsApp'], ['otro', 'Otro']]
const ORIGEN = Object.fromEntries(ORIGENES)
const TIPOS_NOTA = [['nota', '📝 Nota'], ['llamada', '📞 Llamada'], ['whatsapp', '💬 WhatsApp'], ['visita', '🚗 Visita']]
const ICONO_NOTA = { nota: '📝', llamada: '📞', whatsapp: '💬', visita: '🚗', sistema: '⚙️' }
const ABIERTOS = ['nuevo', 'contactado', 'interesado', 'visita_agendada', 'negociacion']

const COLS = 'id, full_name, phone, phone2, source, status, temperature, project_id, assigned_to, interes, budget_estimate, next_action, next_action_date, next_action_time, lost_reason, ultimo_contacto_at, asignado_at, created_at, client_id'
const PAGINA = 150

const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
const dig = s => String(s || '').replace(/\D/g, '')
const cel = s => { const d = dig(s); return d.length === 11 && d.startsWith('51') ? d.slice(2).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : d }
const fecha = iso => iso ? new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', timeZone: 'America/Lima' }) : ''
const fechaHora = iso => iso ? new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' }) : ''
const hace = iso => {
  if (!iso) return ''
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : 'hace ' + d + ' días'
}
const falta190 = e => /phone2|interes|ultimo_contacto_at|asignado_at|next_action_time|prospecto_crear|asignar_leads|vendedores_lista|schema cache/i.test(e?.message || '')
const FALTA = 'Falta correr sql/190 y sql/191 (vendedores y recordatorios) en la base.'
// "15:30:00" -> "3:30 p. m."
const hora12 = h => { if (!h) return ''; const [hh, mm] = String(h).split(':').map(Number); return ((hh % 12) || 12) + ':' + String(mm).padStart(2, '0') + (hh < 12 ? ' a. m.' : ' p. m.') }

// ¿qué le toca hoy a este prospecto? vencido · hoy · sin siguiente paso
function alerta(l, hoy) {
  if (!ABIERTOS.includes(l.status)) return null
  if (!l.next_action_date) return { t: 'Sin siguiente paso', c: 'var(--muted)', k: 'sin' }
  if (l.next_action_date < hoy) return { t: 'Vencido · ' + fecha(l.next_action_date), c: '#ff8e7a', k: 'vencido' }
  const h = l.next_action_time ? ' · ' + hora12(l.next_action_time) : ''
  if (l.next_action_date === hoy) return { t: 'Hoy' + h, c: '#e0b34c', k: 'hoy' }
  return { t: fecha(l.next_action_date) + h, c: 'var(--muted)', k: 'luego' }
}

export default function Prospectos() {
  const { role, profile, esJefe } = useAuth()
  const { projects } = useProject()
  const irA = useNavigate()
  const celular = useEsCelular()
  const esVendedor = role === 'asesor'
  const puedeRegistrar = esVendedor || esJefe || role === 'secretary'
  const hoy = hoyISO()

  const [filas, setFilas] = useState(null)
  const [total, setTotal] = useState(0)
  const [limite, setLimite] = useState(PAGINA)
  const [error, setError] = useState('')
  const [msg, setMsg] = useMsg(null)
  const [fEstado, setFEstado] = useState('abiertos')   // abiertos | toca | todos | <estado>
  const [fProy, setFProy] = useState('')
  const [fVend, setFVend] = useState('')               // '' todos · 'ninguno' · id
  const [fTemp, setFTemp] = useState('')
  const [texto, setTexto] = useState('')
  const [buscar, setBuscar] = useState('')
  const [vendedores, setVendedores] = useState([])
  const [resumen, setResumen] = useState(null)         // solo el vendedor: cuántos tiene en cada estado
  const [tablero, setTablero] = useState(null)         // el equipo: cómo va cada vendedor (sql/191)
  const [marcados, setMarcados] = useState([])
  const [darA, setDarA] = useState('')
  const [abierto, setAbierto] = useState(null)         // id del prospecto con la ficha abierta
  const [nuevo, setNuevo] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  // el texto se busca medio segundo después de dejar de escribir
  useEffect(() => { const t = setTimeout(() => setBuscar(texto.trim()), 400); return () => clearTimeout(t) }, [texto])

  const cargar = useCallback(async () => {
    let q = supabase.from('leads').select(COLS, { count: 'exact' }).or('is_test.is.null,is_test.eq.false')
    if (fEstado === 'abiertos') q = q.in('status', ABIERTOS)
    else if (fEstado === 'toca') q = q.in('status', ABIERTOS).lte('next_action_date', hoy)
    else if (fEstado !== 'todos') q = q.eq('status', fEstado)
    if (fProy) q = q.eq('project_id', fProy)
    if (fVend === 'ninguno') q = q.is('assigned_to', null)
    else if (fVend) q = q.eq('assigned_to', fVend)
    if (fTemp) q = q.eq('temperature', fTemp)
    if (buscar) {
      const limpio = buscar.replace(/[,()%*]/g, ' ').trim()
      const d = dig(limpio)
      if (d.length >= 3 && d.length === limpio.replace(/\s/g, '').length) q = q.or(`phone.ilike.%${d}%,phone2.ilike.%${d}%`)
      else if (limpio) q = q.ilike('full_name', '%' + limpio + '%')
    }
    // el vendedor: primero lo que toca antes; el jefe: lo más nuevo arriba
    q = esVendedor || fEstado === 'toca'
      ? q.order('next_action_date', { ascending: true, nullsFirst: false }).order('next_action_time', { ascending: true, nullsFirst: true }).order('created_at', { ascending: false })
      : q.order('created_at', { ascending: false })
    const { data, error, count } = await q.range(0, limite - 1)
    if (error) { setError(falta190(error) ? FALTA : error.message); setFilas([]); return }
    setError(''); setFilas(data || []); setTotal(count || 0)
  }, [fEstado, fProy, fVend, fTemp, buscar, limite, esVendedor, hoy])

  const cargarResumen = useCallback(async () => {
    if (!esVendedor) return
    const { data } = await supabase.from('leads').select('status, next_action_date').or('is_test.is.null,is_test.eq.false').limit(1000)
    if (!data) return
    const r = { abiertos: 0, toca: 0, sin: 0 }
    for (const l of data) {
      r[l.status] = (r[l.status] || 0) + 1
      if (ABIERTOS.includes(l.status)) {
        r.abiertos++
        if (!l.next_action_date) r.sin++
        else if (l.next_action_date <= hoy) r.toca++
      }
    }
    setResumen(r)
  }, [esVendedor, hoy])

  const cargarTablero = useCallback(() => {
    if (esVendedor || !role) return
    supabase.rpc('vendedores_tablero').then(({ data, error }) => { if (!error && data) setTablero(data) })
  }, [esVendedor, role])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { cargarResumen() }, [cargarResumen])
  useEffect(() => { cargarTablero() }, [cargarTablero])
  useEffect(() => {
    if (esVendedor || !role) return
    supabase.rpc('vendedores_lista').then(({ data, error }) => { if (!error) setVendedores((data || []).filter(v => v.activo)) })
  }, [esVendedor, role])
  useEffect(() => { setMarcados([]) }, [fEstado, fProy, fVend, fTemp, buscar])

  // el menú del vendedor vuelve a contar los que le tocan (Layout)
  const refrescar = () => { cargar(); cargarResumen(); cargarTablero(); window.dispatchEvent(new Event('urbis-prospectos')) }
  const nomProy = id => projects.find(p => p.id === id)?.name || ''
  const vend = id => vendedores.find(v => v.id === id)
  const nomVend = id => { const v = vend(id); return v ? (v.usuario || v.full_name || v.code) : '' }

  async function repartir() {
    if (!marcados.length || !darA) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('asignar_leads', { p_ids: marcados, p_vendedor: darA === 'ninguno' ? null : darA })
    setOcupado(false)
    if (error) { setMsg({ ok: false, t: falta190(error) ? FALTA : error.message }); return }
    setMsg({ ok: true, t: darA === 'ninguno' ? `${data} prospectos quedaron sin vendedor` : `${data} prospectos asignados a ${nomVend(darA)}` })
    setMarcados([]); refrescar()
    supabase.rpc('vendedores_lista').then(({ data }) => data && setVendedores(data.filter(v => v.activo)))
  }

  const chips = [
    ['abiertos', 'En seguimiento', resumen?.abiertos],
    ['toca', '⏰ Toca hoy o está vencido', resumen?.toca],
    ...ESTADOS.map(([v, t]) => [v, t, resumen?.[v]]),
    ['todos', 'Todos'],
  ]
  const todosMarcados = filas?.length > 0 && filas.every(l => marcados.includes(l.id))

  return (
    <>
      <div className="toolbar" style={{ alignItems: 'center' }}>
        <h1 style={{ margin: 0, flex: 1 }}>{esVendedor ? 'Mis prospectos' : 'Prospectos'}</h1>
        <button type="button" className="btn-ghost" onClick={() => irA('/vendedor')}>🏷️ Precios y cuotas</button>
        {puedeRegistrar && <button type="button" className="btn-primary" onClick={() => setNuevo({ source: 'referido', project_id: fProy || (projects.length === 1 ? projects[0].id : '') })}>＋ Nuevo prospecto</button>}
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      {error && <p className="error">{error}</p>}

      {esVendedor && resumen && (
        <div className="pr-kpis">
          <button type="button" className={'glass pr-kpi' + (fEstado === 'toca' ? ' on' : '')} style={{ '--kc': '#e0b34c' }} onClick={() => setFEstado('toca')}>
            <b>{resumen.toca}</b><span>te tocan hoy o están vencidos</span>
          </button>
          <button type="button" className={'glass pr-kpi' + (fEstado === 'abiertos' ? ' on' : '')} style={{ '--kc': '#9ccb86' }} onClick={() => setFEstado('abiertos')}>
            <b>{resumen.abiertos}</b><span>en seguimiento</span>
          </button>
          <div className="glass pr-kpi" style={{ '--kc': resumen.sin ? '#ff8e7a' : '#9daab6' }}>
            <b>{resumen.sin}</b><span>sin siguiente paso</span>
          </div>
          <button type="button" className={'glass pr-kpi' + (fEstado === 'ganado' ? ' on' : '')} style={{ '--kc': '#6fdd9b' }} onClick={() => setFEstado('ganado')}>
            <b>{resumen.ganado || 0}</b><span>ganados</span>
          </button>
        </div>
      )}

      {!esVendedor && tablero && (
        <div className="pr-tablero">
          <button type="button" className={'glass pr-vend' + (fVend === 'ninguno' ? ' on' : '')} style={{ '--kc': tablero.sin_vendedor ? '#f08fb0' : '#9daab6' }}
            onClick={() => { setFVend(fVend === 'ninguno' ? '' : 'ninguno'); setFEstado('abiertos') }} title="Leads en seguimiento que todavía no tienen vendedor">
            <span className="pr-vend-n">Sin vendedor</span>
            <b>{tablero.sin_vendedor}</b>
            <span className="pr-vend-d">por repartir</span>
          </button>
          {tablero.vendedores.map(v => (
            <button key={v.id} type="button" className={'glass pr-vend' + (fVend === v.id ? ' on' : '')} style={{ '--kc': v.vencidos ? '#ff8e7a' : '#9ccb86' }}
              onClick={() => { setFVend(fVend === v.id ? '' : v.id); setFEstado('abiertos') }}>
              <span className="pr-vend-n">{v.nombre}{!v.con_usuario && ' (sin usuario)'}</span>
              <b>{v.abiertos}</b>
              <span className="pr-vend-d">
                {v.hoy > 0 && <i style={{ color: '#e0b34c' }}>{v.hoy} hoy</i>}
                {v.vencidos > 0 && <i style={{ color: '#ff8e7a' }}>{v.vencidos} {v.vencidos === 1 ? 'vencido' : 'vencidos'}</i>}
                {v.sin_contactar > 0 && <i style={{ color: '#7ba7f7' }}>{v.sin_contactar} sin contactar</i>}
                {v.sin_paso > 0 && <i>{v.sin_paso} sin siguiente paso</i>}
                {!v.hoy && !v.vencidos && !v.sin_contactar && !v.sin_paso && <i>{v.abiertos ? 'al día' : 'sin prospectos'}</i>}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="pr-chips">
        {chips.map(([v, t, n]) => (
          <button key={v} type="button" className={'chip' + (fEstado === v ? ' on' : '')} onClick={() => { setFEstado(v); setLimite(PAGINA) }}>
            {EST[v] && <span className="dot" style={{ '--dot': EST[v].c }} />}{t}{n != null ? ' · ' + n : ''}
          </button>
        ))}
      </div>

      <div className="pv-ctrl glass">
        <label style={{ flex: '1 1 220px' }}>Buscar
          <input style={{ width: '100%' }} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Nombre o celular" />
        </label>
        {projects.length > 1 && (
          <label>Proyecto
            <select style={{ width: 170 }} value={fProy} onChange={e => setFProy(e.target.value)}>
              <option value="">Todos</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label>Temperatura
          <select value={fTemp} onChange={e => setFTemp(e.target.value)}>
            <option value="">Todas</option>
            {TEMPS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        {!esVendedor && (
          <label>Vendedor
            <select style={{ width: 190 }} value={fVend} onChange={e => setFVend(e.target.value)}>
              <option value="">Todos</option>
              <option value="ninguno">— Sin vendedor —</option>
              {vendedores.map(v => <option key={v.id} value={v.id}>{v.usuario || v.full_name} ({v.abiertos})</option>)}
            </select>
          </label>
        )}
      </div>

      {esJefe && marcados.length > 0 && (
        <div className="glass pr-repartir">
          <b>{marcados.length} {marcados.length === 1 ? 'marcado' : 'marcados'}</b>
          <select value={darA} onChange={e => setDarA(e.target.value)}>
            <option value="">Asignar a…</option>
            {vendedores.map(v => <option key={v.id} value={v.id}>{v.usuario || v.full_name}{v.profile_id ? '' : ' (sin usuario)'} · lleva {v.abiertos}</option>)}
            <option value="ninguno">— Dejar sin vendedor —</option>
          </select>
          <button type="button" className="btn-primary" disabled={!darA || ocupado} onClick={repartir}>{ocupado ? 'Asignando…' : 'Asignar'}</button>
          <button type="button" className="btn-ghost" onClick={() => setMarcados([])}>Quitar marcas</button>
          {!vendedores.some(v => v.profile_id) && <span className="muted small">Ningún vendedor tiene usuario todavía: créalo en Usuarios con el rol VENDEDOR.</span>}
        </div>
      )}

      {filas === null ? <p className="muted">Cargando…</p>
        : !filas.length ? (
          <div className="glass" style={{ padding: '1.4rem' }}>
            <p className="muted" style={{ margin: 0 }}>
              {esVendedor && fEstado === 'abiertos' && !buscar
                ? 'Todavía no tienes prospectos. Registra el primero con "Nuevo prospecto", o espera a que te asignen los que entran por WhatsApp.'
                : 'No hay prospectos con ese filtro.'}
            </p>
          </div>
        )
        : celular ? (
          <div className="pr-cards">
            {filas.map(l => {
              const a = alerta(l, hoy)
              return (
                <div key={l.id} role="button" tabIndex={0} className={'glass pr-card' + (marcados.includes(l.id) ? ' marcado' : '')} style={{ '--ec': EST[l.status]?.c }} onClick={() => setAbierto(l.id)}>
                  {esJefe && <input type="checkbox" className="pr-card-chk" checked={marcados.includes(l.id)} title="Marcar para asignar" onClick={e => e.stopPropagation()}
                    onChange={e => setMarcados(m => e.target.checked ? [...m, l.id] : m.filter(x => x !== l.id))} />}
                  <span className="pr-card-n">{l.full_name}</span>
                  <span className="pr-card-e">{EST[l.status]?.t}{l.temperature && l.temperature !== 'frio' ? ' · ' + TEMP[l.temperature].t : ''}</span>
                  <span className="muted small">{cel(l.phone)}{nomProy(l.project_id) ? ' · ' + nomProy(l.project_id) : ''}</span>
                  {l.next_action && <span className="pr-card-a">{l.next_action}</span>}
                  {a && <span className="small" style={{ color: a.c, fontWeight: 600 }}>{a.k === 'luego' ? 'Próximo: ' : ''}{a.t}</span>}
                  {!esVendedor && <span className="muted small">{l.assigned_to ? '👤 ' + nomVend(l.assigned_to) : 'Sin vendedor'}</span>}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="glass table-wrap">
            <table>
              <thead><tr>
                {esJefe && <th style={{ width: 28 }}><input type="checkbox" checked={todosMarcados} title="Marcar todos los de la lista"
                  onChange={e => setMarcados(e.target.checked ? filas.map(l => l.id) : [])} /></th>}
                <th>Prospecto</th><th>Celular</th><th>Proyecto</th><th>Estado</th><th>Siguiente paso</th><th>Último contacto</th>
                {!esVendedor && <th>Vendedor</th>}
              </tr></thead>
              <tbody>
                {filas.map(l => {
                  const a = alerta(l, hoy)
                  return (
                    <tr key={l.id} className="pr-fila" onClick={() => setAbierto(l.id)}>
                      {esJefe && <td onClick={e => e.stopPropagation()}><input type="checkbox" checked={marcados.includes(l.id)}
                        onChange={e => setMarcados(m => e.target.checked ? [...m, l.id] : m.filter(x => x !== l.id))} /></td>}
                      <td><b>{l.full_name}</b>{l.interes && <div className="muted small">{l.interes}</div>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{cel(l.phone)}{l.phone2 && <div className="muted small">{cel(l.phone2)}</div>}</td>
                      <td>{nomProy(l.project_id) || <span className="muted">—</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className="pr-est" style={{ '--ec': EST[l.status]?.c }}>{EST[l.status]?.t || l.status}</span>
                        {l.temperature && l.temperature !== 'frio' && <span title={TEMP[l.temperature].t}> {TEMP[l.temperature].t.split(' ')[0]}</span>}
                      </td>
                      <td>
                        {l.next_action && <div>{l.next_action}</div>}
                        {a && <span className="small" style={{ color: a.c, fontWeight: a.k === 'luego' ? 400 : 700 }}>{a.t}</span>}
                        {l.status === 'perdido' && l.lost_reason && <span className="muted small">{l.lost_reason}</span>}
                      </td>
                      <td className="muted small" style={{ whiteSpace: 'nowrap' }}>{l.ultimo_contacto_at ? hace(l.ultimo_contacto_at) : 'nunca'}</td>
                      {!esVendedor && <td>{l.assigned_to ? nomVend(l.assigned_to) || '…' : <span className="muted">Sin vendedor</span>}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      {filas && filas.length > 0 && (
        <p className="muted small" style={{ marginTop: '.6rem' }}>
          {filas.length < total ? `Se ven ${filas.length} de ${total}. ` : `${total} ${total === 1 ? 'prospecto' : 'prospectos'}. `}
          {filas.length < total && <button type="button" className="link-btn" onClick={() => setLimite(n => n + PAGINA)}>Ver más</button>}
        </p>
      )}

      {abierto && <Ficha id={abierto} onCerrar={() => setAbierto(null)} onCambio={refrescar}
        projects={projects} vendedores={vendedores} esVendedor={esVendedor} esJefe={esJefe} soloVer={role === 'manager'} profile={profile} />}
      {nuevo && <Nuevo datos={nuevo} projects={projects} vendedores={vendedores} esVendedor={esVendedor}
        onCerrar={() => setNuevo(null)} onListo={id => { setNuevo(null); refrescar(); setAbierto(id) }} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// REGISTRAR UN PROSPECTO: la base avisa si el número ya está en el sistema
// ---------------------------------------------------------------------------
function Nuevo({ datos, projects, vendedores, esVendedor, onCerrar, onListo }) {
  const [f, setF] = useState(datos)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  async function guardar(e) {
    e.preventDefault()
    setAviso(''); setOcupado(true)
    const { data, error } = await supabase.rpc('prospecto_crear', {
      p_nombre: f.nombre || '', p_phone: f.phone || '', p_phone2: f.phone2 || null, p_project: f.project_id || null,
      p_source: f.source || 'otro', p_interes: f.interes || null, p_nota: f.nota || null, p_vendedor: f.vendedor || null,
    })
    setOcupado(false)
    if (error) { setAviso(falta190(error) && !/dígitos|nombre|proyecto|vendedor/i.test(error.message) ? FALTA : error.message); return }
    if (data?.ok) {
      if (data.ya_estaba) await avisar('Ese número ya estaba entre ' + (esVendedor ? 'tus prospectos' : 'los prospectos') + ': se abre su ficha.')
      else savedFx()
      onListo(data.id); return
    }
    setAviso(data?.motivo === 'otro_vendedor'
      ? `Ese número ya lo atiende ${data.vendedor || 'otro vendedor'} (${data.nombre}). Manda quien lo registró primero.`
      : data?.motivo === 'sin_asignar'
        ? `Ese número ya escribió a la empresa (${data.nombre}) y todavía no tiene vendedor. Pide que te lo asignen.`
        : 'No se pudo registrar.')
  }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <form className="glass modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()} onSubmit={guardar}>
        <div className="modal-head"><h2>Nuevo prospecto</h2><button type="button" className="btn-ghost" onClick={onCerrar}>✕</button></div>
        <div className="form-grid">
          <label>Nombre <input value={f.nombre || ''} onChange={e => set('nombre', e.target.value)} required autoFocus /></label>
          <label>Celular <input inputMode="numeric" value={f.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="9 dígitos" required /></label>
          <label>Otro celular (opcional) <input inputMode="numeric" value={f.phone2 || ''} onChange={e => set('phone2', e.target.value)} /></label>
          <label>Proyecto
            <select value={f.project_id || ''} onChange={e => set('project_id', e.target.value)}>
              <option value="">— Aún no sabe —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>¿De dónde salió?
            <select value={f.source} onChange={e => set('source', e.target.value)}>
              {ORIGENES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
          <label>Qué le interesa <input value={f.interes || ''} onChange={e => set('interes', e.target.value)} placeholder="Lote en esquina, hasta S/ 300 al mes…" /></label>
          {!esVendedor && (
            <label>Vendedor
              <select value={f.vendedor || ''} onChange={e => set('vendedor', e.target.value)}>
                <option value="">— Sin vendedor por ahora —</option>
                {vendedores.map(v => <option key={v.id} value={v.id}>{v.usuario || v.full_name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label style={{ display: 'block', marginTop: '.9rem' }}>Primera nota (opcional)
          <textarea rows={2} style={{ width: '100%', textTransform: 'none' }} value={f.nota || ''} onChange={e => set('nota', e.target.value)} />
        </label>
        {aviso && <p className="error" style={{ textTransform: 'none' }}>{aviso}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
          <button className="btn-primary" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar prospecto'}</button>
          <button type="button" className="btn-ghost" onClick={onCerrar}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LA FICHA: datos, en qué va, siguiente paso y el historial de notas
// ---------------------------------------------------------------------------
function Ficha({ id, onCerrar, onCambio, projects, vendedores, esVendedor, esJefe, soloVer, profile }) {
  const irA = useNavigate()
  const [l, setL] = useState(null)
  const [notas, setNotas] = useState([])
  const [chats, setChats] = useState([])
  const [gente, setGente] = useState({})
  const [nota, setNota] = useState('')
  const [tipo, setTipo] = useState('nota')
  const [verAuto, setVerAuto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [pidePaso, setPidePaso] = useState(false)   // acaba de anotar y no tiene siguiente paso a futuro
  const hoy = hoyISO()

  const cargar = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('leads').select(COLS).eq('id', id).maybeSingle(),
      supabase.from('lead_activities').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(300),
      supabase.from('whatsapp_conversations').select('id, phone, last_message_at').eq('lead_id', id).order('last_message_at', { ascending: false }).limit(3),
    ])
    if (a.error) { setError(falta190(a.error) ? FALTA : a.error.message); return }
    if (!a.data) { setError('Este prospecto ya no está entre los tuyos.'); return }
    setL(a.data); setNotas(b.data || []); setChats(c.data || [])
    const ids = [...new Set((b.data || []).map(n => n.created_by).filter(Boolean))]
    if (ids.length) supabase.from('profiles').select('id, full_name').in('id', ids).then(({ data }) => setGente(Object.fromEntries((data || []).map(p => [p.id, p.full_name]))))
  }, [id])
  useEffect(() => { cargar() }, [cargar])

  // guarda un cambio y lo deja ver al instante
  async function guardar(patch) {
    if (soloVer) return
    const antes = l
    setL(x => ({ ...x, ...patch }))
    const { error } = await supabase.from('leads').update(patch).eq('id', id)
    if (error) { setL(antes); avisar('No se guardó: ' + error.message); return }
    savedFx(); onCambio()
  }
  async function cambiarEstado(st) {
    if (st === l.status) return
    if (st === 'perdido') {
      const motivo = await pedir('¿Por qué se perdió?\n\nSirve para saber qué está fallando: precio, ubicación, no contesta, compró en otro lado…', { valor: l.lost_reason || '', obligatorio: true, titulo: 'Marcar como perdido' })
      if (motivo === null) return
      return guardar({ status: st, lost_reason: String(motivo).trim().toUpperCase(), next_action: null, next_action_date: null, next_action_time: null })
    }
    guardar({ status: st })
  }
  async function agregarNota() {
    const t = nota.trim()
    if (!t) return
    setOcupado(true)
    const { error } = await supabase.from('lead_activities').insert({ lead_id: id, note: t, created_by: profile.id, tipo })
    setOcupado(false)
    if (error) { avisar('No se guardó la nota: ' + (falta190(error) ? FALTA : error.message)); return }
    setNota(''); setTipo('nota'); savedFx()
    // ningún prospecto se queda sin siguiente paso: si no tiene uno a futuro, se le pide
    if (ABIERTOS.includes(l.status) && (!l.next_action_date || l.next_action_date <= hoy)) {
      setPidePaso(true)
      document.getElementById('pr-paso')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    // quien recién le habló a un "nuevo" ya lo contactó
    if (l.status === 'nuevo' && tipo !== 'nota') await supabase.from('leads').update({ status: 'contactado' }).eq('id', id)
    cargar(); onCambio()
  }
  async function reasignar(v) {
    const { error } = await supabase.rpc('asignar_leads', { p_ids: [id], p_vendedor: v || null })
    if (error) { avisar(error.message); return }
    savedFx(); cargar(); onCambio()
  }

  const visibles = verAuto ? notas : notas.filter(n => n.created_by)
  const automaticas = notas.length - notas.filter(n => n.created_by).length
  const wa = n => 'https://wa.me/' + dig(n)
  const a = l && alerta(l, hoy)

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="glass modal pr-ficha" onClick={e => e.stopPropagation()}>
        {error ? <><p className="error">{error}</p><button type="button" className="btn-ghost" onClick={onCerrar}>Cerrar</button></>
          : !l ? <p className="muted">Cargando…</p> : (
            <>
              <div className="modal-head">
                <input className="pr-nombre" defaultValue={l.full_name} readOnly={soloVer}
                  onBlur={e => { const v = e.target.value.trim().toUpperCase(); if (v && v !== l.full_name) guardar({ full_name: v }) }} />
                <button type="button" className="btn-ghost" onClick={onCerrar}>✕</button>
              </div>

              <div className="pr-tel">
                {[l.phone, l.phone2].filter(Boolean).map(n => (
                  <span key={n} className="pr-tel-n">
                    <b>{cel(n)}</b>
                    <a className="btn-act" href={'tel:+' + dig(n)}>📞 Llamar</a>
                    <a className="btn-act" href={wa(n)} target="_blank" rel="noreferrer">💬 WhatsApp</a>
                  </span>
                ))}
                {chats[0] && <button type="button" className="btn-act alt" onClick={() => irA('/whatsapp?chat=' + chats[0].id)} title="El chat de este prospecto con el número de la empresa">Abrir su chat en la Bandeja</button>}
                <button type="button" className="btn-act alt" onClick={() => irA('/vendedor')}>🏷️ Cotizarle un lote</button>
              </div>

              <p className="pr-sub">En qué va</p>
              <div className="pr-chips">
                {ESTADOS.map(([v, t, c]) => (
                  <button key={v} type="button" disabled={soloVer} className={'chip' + (l.status === v ? ' on' : '')} onClick={() => cambiarEstado(v)}>
                    <span className="dot" style={{ '--dot': c }} />{t}
                  </button>
                ))}
              </div>
              {l.status === 'perdido' && l.lost_reason && <p className="muted small">Motivo: {l.lost_reason}</p>}
              <div className="pr-chips">
                {TEMPS.map(([v, t]) => (
                  <button key={v} type="button" disabled={soloVer} className={'chip' + (l.temperature === v ? ' on' : '')} onClick={() => guardar({ temperature: v })}>{t}</button>
                ))}
              </div>

              <p className="pr-sub" id="pr-paso">Siguiente paso {a && a.k !== 'luego' && <span style={{ color: a.c }}>· {a.t}</span>}</p>
              {pidePaso && <p className="pr-pide">Nota guardada. ¿Cuándo lo vuelves a contactar? Ponle fecha y hora y te llega el aviso por Telegram.</p>}
              <div className={'pr-paso' + (pidePaso ? ' pide' : '')}>
                <input defaultValue={l.next_action || ''} key={'na' + (l.next_action || '')} readOnly={soloVer} placeholder="Llamarlo, mandarle el plano, llevarlo al terreno…"
                  onBlur={e => { const v = e.target.value.trim().toUpperCase() || null; if (v !== (l.next_action || null)) guardar({ next_action: v }) }} />
                <input type="date" value={l.next_action_date || ''} readOnly={soloVer} min={hoy} title="Qué día"
                  onChange={e => { setPidePaso(false); guardar({ next_action_date: e.target.value || null, ...(e.target.value ? {} : { next_action_time: null }) }) }} />
                <input type="time" value={(l.next_action_time || '').slice(0, 5)} readOnly={soloVer} disabled={!l.next_action_date} title="A qué hora te aviso (vacío = 9:00 a. m.)"
                  onChange={e => guardar({ next_action_time: e.target.value || null })} />
                {!soloVer && [['Mañana', 1], ['3 días', 3], ['1 semana', 7]].map(([t, n]) => (
                  <button key={t} type="button" className="chip" onClick={() => { const d = new Date(hoy + 'T12:00:00'); d.setDate(d.getDate() + n); setPidePaso(false); guardar({ next_action_date: d.toLocaleDateString('en-CA') }) }}>{t}</button>
                ))}
              </div>
              {!soloVer && l.next_action_date && <p className="muted small" style={{ margin: '.4rem 0 0', textTransform: 'none' }}>⏰ Aviso por Telegram el {fecha(l.next_action_date)} a las {hora12(l.next_action_time || '09:00')}</p>}

              <p className="pr-sub">Sus datos</p>
              <div className="form-grid">
                <label>Proyecto
                  <select value={l.project_id || ''} disabled={soloVer} onChange={e => guardar({ project_id: e.target.value || null })}>
                    <option value="">— Aún no sabe —</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    {l.project_id && !projects.some(p => p.id === l.project_id) && <option value={l.project_id}>Otro proyecto</option>}
                  </select>
                </label>
                <label>Qué le interesa
                  <input defaultValue={l.interes || ''} readOnly={soloVer}
                    onBlur={e => { const v = e.target.value.trim() || null; if (v !== (l.interes || null)) guardar({ interes: v }) }} />
                </label>
                <label>Puede pagar (S/)
                  <input type="number" min="0" defaultValue={l.budget_estimate ?? ''} readOnly={soloVer}
                    onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (l.budget_estimate ?? null)) guardar({ budget_estimate: v }) }} />
                </label>
                <label>Otro celular
                  <input inputMode="numeric" defaultValue={cel(l.phone2)} readOnly={soloVer}
                    onBlur={e => {
                      let d = dig(e.target.value); if (d.length === 9) d = '51' + d
                      if (d && d.length < 11) { avisar('El celular tiene que tener 9 dígitos.'); return }
                      if ((d || null) !== (l.phone2 || null)) guardar({ phone2: d || null })
                    }} />
                </label>
                {esJefe && (
                  <label>Vendedor
                    <select value={l.assigned_to || ''} onChange={e => reasignar(e.target.value)}>
                      <option value="">— Sin vendedor —</option>
                      {vendedores.map(v => <option key={v.id} value={v.id}>{v.usuario || v.full_name}{v.profile_id ? '' : ' (sin usuario)'}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <p className="muted small" style={{ marginTop: '.5rem' }}>
                {ORIGEN[l.source] || 'Otro'} · registrado el {fecha(l.created_at)}
                {l.asignado_at ? ' · asignado el ' + fecha(l.asignado_at) : ''}
                {l.client_id ? ' · ya es cliente' : ''}
              </p>

              <p className="pr-sub">Notas</p>
              {!soloVer && (
                <div className="pr-nota-nueva">
                  <div className="pr-chips" style={{ margin: 0 }}>
                    {TIPOS_NOTA.map(([v, t]) => <button key={v} type="button" className={'chip' + (tipo === v ? ' on' : '')} onClick={() => setTipo(v)}>{t}</button>)}
                  </div>
                  <textarea rows={2} value={nota} onChange={e => setNota(e.target.value)} placeholder="Qué pasó, qué dijo, qué quedó pendiente…"
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) agregarNota() }} />
                  <button type="button" className="btn-primary" disabled={ocupado || !nota.trim()} onClick={agregarNota}>{ocupado ? 'Guardando…' : 'Guardar nota'}</button>
                </div>
              )}
              <div className="pr-notas">
                {visibles.map(n => (
                  <div key={n.id} className={'pr-nota' + (n.created_by ? '' : ' auto')}>
                    <span className="pr-nota-cab">
                      {ICONO_NOTA[n.tipo] || '📝'} {n.created_by ? (n.created_by === profile.id ? 'Tú' : gente[n.created_by] || 'Equipo') : 'Automático'} · {fechaHora(n.created_at)}
                    </span>
                    <span className="pr-nota-txt">{n.note}</span>
                  </div>
                ))}
                {!visibles.length && <p className="muted small">Todavía no hay notas tuyas.</p>}
                {automaticas > 0 && (
                  <button type="button" className="link-btn" onClick={() => setVerAuto(v => !v)}>
                    {verAuto ? 'Ocultar' : 'Ver'} las {automaticas} del bot (lo que respondió por WhatsApp)
                  </button>
                )}
              </div>
            </>
          )}
      </div>
    </div>
  )
}
