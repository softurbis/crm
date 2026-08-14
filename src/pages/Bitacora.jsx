import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Avatar from '../components/Avatar'
import Paginador, { usePaginacion } from '../components/Paginador'

const TABLAS_LBL = {
  daily_income: 'PAGOS', clients: 'CLIENTES', sales: 'VENTAS', separations: 'SEPARACIONES',
  expenses: 'GASTOS', lots: 'LOTES', installments: 'CUOTAS', leads: 'LEADS', visits: 'VISITAS',
  commissions: 'COMISIONES',
  // configuración del bot
  projects: 'CONFIG BOT / PROYECTO', bot_brains: 'CONFIG BOT (COB/SEC/GER)',
  // operación / administración
  financial_accounts: 'CUENTAS', advisors: 'VENDEDORES', secretaries: 'SECRETARIAS',
  secretary_tasks: 'TAREAS SECRET.', contracts: 'CONTRATOS', profiles: 'USUARIOS',
  // corretaje
  corr_propiedades: 'CORRETAJE · PROP.', corr_config: 'CORRETAJE · CONFIG',
  corr_gastos: 'CORRETAJE · GASTOS', corr_documentos: 'CORRETAJE · DOCS',
  corr_consultas: 'CORRETAJE · CONSULTAS', corr_proyectos_pub: 'CORRETAJE · PROYECTOS',
  // marketing (histórico: el agente salió del CRM en ago 2026; se conservan
  // estos nombres para que los registros viejos de la bitácora sigan legibles)
  mkt_brains: 'MKT · CEREBRO', mkt_proyectos: 'MKT · PROYECTOS',
}
// tablas cuyos cambios cuentan como "configuración del bot" en el resumen
const CONFIG_BOT = new Set(['projects', 'bot_brains'])

// lo que hizo cada acción, en el idioma del negocio. El orden importa: la primera
// que calza manda (un INSERT en daily_income es "pago", no "otra cosa").
const CLASES = [
  ['pagos', 'pagos registrados', r => r.entity_type === 'daily_income' && r.action === 'INSERT'],
  ['pagosEdit', 'pagos corregidos', r => r.entity_type === 'daily_income'],
  ['cuotas', 'cuotas tocadas', r => r.entity_type === 'installments'],
  ['clientes', 'clientes creados', r => r.entity_type === 'clients' && r.action === 'INSERT'],
  ['ventas', 'ventas', r => r.entity_type === 'sales'],
  ['separaciones', 'separaciones', r => r.entity_type === 'separations'],
  ['gastos', 'gastos', r => r.entity_type === 'expenses'],
  ['lotes', 'cambios en lotes', r => r.entity_type === 'lots'],
  ['contratos', 'contratos', r => r.entity_type === 'contracts'],
  ['visitas', 'visitas', r => r.entity_type === 'visits'],
  ['config', 'config. del bot', r => CONFIG_BOT.has(r.entity_type)],
]
const claseDe = r => (CLASES.find(([, , test]) => test(r)) || ['otras'])[0]

// día LOCAL (Perú), no UTC: si no, todo lo trabajado después de las 19:00 caería
// en el día siguiente y el horario de la persona saldría partido en dos.
const dia = iso => {
  const d = new Date(iso)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const diaCorto = d => d.slice(8, 10) + '/' + d.slice(5, 7)
const minutos = iso => { const x = new Date(iso); return x.getHours() * 60 + x.getMinutes() }
const hhmm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0')
const mediana = arr => {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

export default function Bitacora() {
  const { role } = useAuth()
  const [rows, setRows] = useState([])
  const [projects, setProjects] = useState([])
  const [perfiles, setPerfiles] = useState([])
  const [vista, setVista] = useState('personas')   // 'personas' | 'detalle'
  const [fq, setFq] = useState('')
  const [fact, setFact] = useState('todos')
  const [ftab, setFtab] = useState('todos')
  const [fper, setFper] = useState('7')      // dias | 'hoy' | 'todo'
  const [fproj, setFproj] = useState('todos')
  const [fuser, setFuser] = useState('todos') // filtro por usuario
  const [det, setDet] = useState(null)

  useEffect(() => {
    if (role !== 'superuser') return
    supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(1500)
      .then(({ data }) => setRows(data || []))
    supabase.from('projects').select('id, name').then(({ data }) => setProjects(data || []))
    supabase.from('profiles').select('id, email, full_name, role, avatar_url')
      .then(({ data }) => setPerfiles(data || []), () => {})
  }, [role])

  // quien es cada correo del log (nombre, rol y foto), para que las tarjetas no
  // muestren solo un email
  const quien = useMemo(() => {
    const m = {}
    for (const p of perfiles) if (p.email) m[p.email.toLowerCase()] = p
    return m
  }, [perfiles])
  const perfilDe = u => quien[String(u).toLowerCase()] || null
  const nombreDe = u => perfilDe(u)?.full_name || u

  // Todo menos el filtro de usuario: las tarjetas siguen mostrando a todos aunque
  // se esté mirando el detalle de una sola persona.
  const base = useMemo(() => {
    const t = fq.trim().toLowerCase()
    const desde = fper === 'todo' ? null : new Date(Date.now() - (fper === 'hoy' ? 0 : Number(fper)) * 86400000)
    if (desde) desde.setHours(0, 0, 0, 0)
    return rows.filter(r => {
      if (desde && new Date(r.created_at) < desde) return false
      if (fact !== 'todos' && r.action !== fact) return false
      if (ftab !== 'todos' && r.entity_type !== ftab) return false
      if (fproj !== 'todos' && (r.details?.project_id || null) !== fproj) return false
      if (!t) return true
      return (r.user_email || '').toLowerCase().includes(t) ||
        nombreDe(r.user_email || 'SISTEMA').toLowerCase().includes(t) ||
        JSON.stringify(r.details || {}).toLowerCase().includes(t)
    })
  }, [rows, fq, fact, ftab, fper, fproj, quien])

  const filtradas = useMemo(
    () => fuser === 'todos' ? base : base.filter(r => (r.user_email || 'SISTEMA') === fuser),
    [base, fuser],
  )

  // usuarios presentes en el log (para el filtro)
  const usuarios = useMemo(() => [...new Set(rows.map(r => r.user_email || 'SISTEMA'))].sort(), [rows])

  // actividad por HORA del día (0-23) del set filtrado → gráfico de barras
  const porHora = useMemo(() => {
    const h = Array.from({ length: 24 }, () => 0)
    for (const r of filtradas) { const d = new Date(r.created_at); h[d.getHours()]++ }
    const max = Math.max(1, ...h)
    const total = filtradas.length
    const picoIdx = h.indexOf(Math.max(...h))
    return { h, max, total, picoIdx }
  }, [filtradas])

  // ---- UNA FICHA POR PERSONA ----
  // Lo que hizo en el periodo, su ritmo por día y su horario REAL de trabajo
  // (a qué hora abre y a qué hora deja de tocar el sistema, en la práctica).
  const personas = useMemo(() => {
    const m = new Map()
    for (const r of base) {
      const u = r.user_email || 'SISTEMA'
      if (!m.has(u)) m.set(u, { u, total: 0, cuentas: {}, porDia: {}, ultima: r.created_at })
      const p = m.get(u)
      p.total++
      const c = claseDe(r)
      p.cuentas[c] = (p.cuentas[c] || 0) + 1
      const d = dia(r.created_at)
      const dd = p.porDia[d] = p.porDia[d] || { total: 0, pagos: 0, min: 1e9, max: -1 }
      dd.total++
      if (c === 'pagos') dd.pagos++
      const min = minutos(r.created_at)
      dd.min = Math.min(dd.min, min); dd.max = Math.max(dd.max, min)
      if (r.created_at > p.ultima) p.ultima = r.created_at
    }
    return [...m.values()].map(p => {
      const dias = Object.entries(p.porDia)
      const entra = mediana(dias.map(([, d]) => d.min))
      const sale = mediana(dias.map(([, d]) => d.max))
      const top = dias.sort((a, b) => b[1].total - a[1].total)[0]
      const maxDia = top ? top[1].total : 0
      return {
        ...p, diasActivos: dias.length, entra, sale, maxDia,
        diaTop: top ? top[0] : null, diaTopN: maxDia,
        promedio: dias.length ? Math.round(p.total / dias.length * 10) / 10 : 0,
      }
    }).sort((a, b) => b.total - a.total)
  }, [base])

  // eje de días común a todas las tarjetas: se comparan mirando el mismo periodo
  const ejeDias = useMemo(() => {
    const set = new Set(base.map(r => dia(r.created_at)))
    return [...set].sort().slice(-30)
  }, [base])

  const tablas = useMemo(() => [...new Set(rows.map(r => r.entity_type))].sort(), [rows])
  const pag = usePaginacion(filtradas, 50)   // 50 por pagina, sin recargar
  const periodoTxt = fper === 'hoy' ? 'hoy' : fper === 'todo' ? 'histórico' : `últimos ${fper} días`

  const verPersona = u => { setFuser(u); setVista('detalle') }

  if (role !== 'superuser') return <p className="error">Solo el SUPERUSUARIO puede ver la bitacora.</p>

  return (
    <>
      <h1>Bitacora de actividades</h1>

      <div className="chips">
        <button className={`chip ${vista === 'personas' ? 'on' : ''}`} onClick={() => setVista('personas')}>
          👥 Por persona ({personas.length})
        </button>
        <button className={`chip ${vista === 'detalle' ? 'on' : ''}`} onClick={() => setVista('detalle')}>
          ☰ Detalle ({filtradas.length})
        </button>
      </div>

      <div className="toolbar">
        <select value={fper} onChange={e => setFper(e.target.value)}>
          <option value="hoy">HOY</option>
          <option value="7">ULTIMOS 7 DIAS</option>
          <option value="30">ULTIMOS 30 DIAS</option>
          <option value="90">ULTIMOS 90 DIAS</option>
          <option value="todo">TODO</option>
        </select>
        <select value={fproj} onChange={e => setFproj(e.target.value)}>
          <option value="todos">TODOS LOS PROYECTOS</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={fact} onChange={e => setFact(e.target.value)}>
          <option value="todos">TODAS LAS ACCIONES</option>
          <option value="INSERT">CREACION</option>
          <option value="UPDATE">MODIFICACION</option>
          <option value="DELETE">ELIMINACION</option>
        </select>
        <select value={ftab} onChange={e => setFtab(e.target.value)}>
          <option value="todos">TODAS LAS TABLAS</option>
          {tablas.map(t => <option key={t} value={t}>{TABLAS_LBL[t] || t}</option>)}
        </select>
        {vista === 'detalle' && (
          <select value={fuser} onChange={e => setFuser(e.target.value)} title="Filtrar por usuario">
            <option value="todos">TODOS LOS USUARIOS</option>
            {usuarios.map(u => <option key={u} value={u}>{nombreDe(u)}</option>)}
          </select>
        )}
        <input className="search" placeholder="Buscar por persona o contenido..."
          value={fq} onChange={e => setFq(e.target.value)} />
      </div>

      {vista === 'personas' ? (
        <>
          <p className="muted small" style={{ margin: '0 0 10px' }}>
            Una ficha por persona con lo que hizo en el periodo ({periodoTxt}), su ritmo por día y el
            horario en que realmente trabajó. Haz clic en la ficha para ver su detalle acción por acción.
          </p>
          {!personas.length && <p className="muted">Sin actividad en el periodo.</p>}
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
            {personas.map(p => {
              const perfil = perfilDe(p.u)
              return (
                <div key={p.u} className="glass" style={{ padding: '12px 14px', cursor: 'pointer' }}
                  onClick={() => verPersona(p.u)} title={'Ver el detalle de ' + nombreDe(p.u)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar url={perfil?.avatar_url} nombre={nombreDe(p.u)} size={38} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombreDe(p.u)}</b>
                      <span className="muted small" style={{ textTransform: 'none' }}>
                        {perfil?.role ? perfil.role.toUpperCase() + ' · ' : ''}{p.u}
                      </span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <b style={{ fontSize: '1.3rem' }}>{p.total}</b>
                      <span className="muted small" style={{ display: 'block' }}>acciones</span>
                    </div>
                  </div>

                  <p className="small" style={{ margin: '8px 0 2px' }}>
                    🕐 {p.entra != null
                      ? <>trabaja de <b>{hhmm(p.entra)}</b> a <b>{hhmm(p.sale)}</b></>
                      : <span className="muted">sin horario</span>}
                    <span className="muted"> · {p.diasActivos} {p.diasActivos === 1 ? 'día' : 'días'} activo{p.diasActivos === 1 ? '' : 's'} · {p.promedio}/día</span>
                  </p>

                  {/* ritmo por día: cada barra es un día del periodo */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 34, margin: '6px 0 2px' }}>
                    {ejeDias.map(d => {
                      const x = p.porDia[d]
                      const n = x?.total || 0
                      return (
                        <div key={d} title={`${diaCorto(d)} — ${n} ${n === 1 ? 'acción' : 'acciones'}${x?.pagos ? ' · ' + x.pagos + ' pagos' : ''}`}
                          style={{
                            flex: 1, minWidth: 3, borderRadius: 2,
                            height: Math.max(2, n / Math.max(1, p.maxDia) * 100) + '%',
                            background: !n ? 'rgba(255,255,255,.07)'
                              : d === p.diaTop ? 'var(--accent)' : 'rgba(156,203,134,.45)',
                          }} />
                      )
                    })}
                  </div>
                  <p className="muted small" style={{ margin: '0 0 6px' }}>
                    {ejeDias.length > 1 && <>{diaCorto(ejeDias[0])} → {diaCorto(ejeDias[ejeDias.length - 1])} · </>}
                    {p.diaTop ? <>día más activo: <b>{diaCorto(p.diaTop)}</b> ({p.diaTopN})</> : null}
                  </p>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {CLASES.map(([k, lbl]) => p.cuentas[k]
                      ? <span key={k} className="st-chip st-ok" style={{ fontWeight: 600 }}>{p.cuentas[k]} {lbl}</span>
                      : null)}
                    {p.cuentas.otras ? <span className="st-chip st-na">{p.cuentas.otras} otras</span> : null}
                  </div>

                  <p className="muted small" style={{ margin: '8px 0 0' }}>
                    última acción: {new Date(p.ultima).toLocaleString('es-PE')} · <span className="accent">ver su detalle →</span>
                  </p>
                </div>
              )
            })}
          </div>

          {personas.length > 0 && (
            <details style={{ marginTop: 14 }}>
              <summary className="muted small" style={{ cursor: 'pointer' }}>Ver los mismos números como tabla</summary>
              <div className="glass table-wrap" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th>Persona</th><th>Pagos reg.</th><th>Cuotas</th><th>Clientes</th><th>Ventas</th><th>Separaciones</th><th>Gastos</th><th>Lotes</th><th>Config. bot</th><th>Total</th></tr></thead>
                  <tbody>
                    {personas.map(p => (
                      <tr key={p.u}>
                        <td><b>{nombreDe(p.u)}</b></td>
                        <td>{p.cuentas.pagos || 0}</td><td>{p.cuentas.cuotas || 0}</td><td>{p.cuentas.clientes || 0}</td>
                        <td>{p.cuentas.ventas || 0}</td><td>{p.cuentas.separaciones || 0}</td><td>{p.cuentas.gastos || 0}</td>
                        <td>{p.cuentas.lotes || 0}</td><td>{p.cuentas.config || 0}</td><td><b>{p.total}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      ) : (
        <>
          {fuser !== 'todos' && (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px' }}>
              <Avatar url={perfilDe(fuser)?.avatar_url} nombre={nombreDe(fuser)} size={30} />
              <b>{nombreDe(fuser)}</b> <span className="muted small">{periodoTxt} · {filtradas.length} acciones</span>
              <button className="btn-ghost" onClick={() => { setFuser('todos'); setVista('personas') }}>← Volver a las personas</button>
            </p>
          )}

          {/* actividad por hora del dia — resumen visual del set filtrado */}
          <div className="glass hrs-card">
            <div className="hrs-head">
              <span>⏱ Actividad por hora del día {fuser !== 'todos' ? <b>· {nombreDe(fuser)}</b> : ''}</span>
              <span className="muted small">{porHora.total} acciones · pico a las {String(porHora.picoIdx).padStart(2, '0')}:00</span>
            </div>
            <div className="hrs-bars">
              {porHora.h.map((n, hora) => (
                <div className="hrs-col" key={hora} title={`${String(hora).padStart(2, '0')}:00 — ${n} acci${n === 1 ? 'ón' : 'ones'}`}>
                  <div className="hrs-bar-wrap">
                    {n > 0 && <span className="hrs-n">{n}</span>}
                    <div className={`hrs-bar ${hora === porHora.picoIdx && n > 0 ? 'pico' : ''}`} style={{ height: (n / porHora.max * 100) + '%' }}></div>
                  </div>
                  <span className="hrs-x">{hora % 3 === 0 ? String(hora).padStart(2, '0') : ''}</span>
                </div>
              ))}
            </div>
          </div>

          <h2 className="sub">Detalle ({filtradas.length})</h2>
          <div className="glass table-wrap">
            <table>
              <thead><tr><th>Fecha y hora</th><th>Persona</th><th>Accion</th><th>Tabla</th><th></th></tr></thead>
              <tbody>
                {pag.pagina.map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.created_at).toLocaleString('es-PE')}</td>
                    <td>{nombreDe(r.user_email || 'SISTEMA')}</td>
                    <td className={r.action === 'DELETE' ? 'bad' : r.action === 'UPDATE' ? 'warn' : 'ok'}>{r.action}</td>
                    <td>{TABLAS_LBL[r.entity_type] || r.entity_type}</td>
                    <td><button className="link-btn" onClick={() => setDet(r)}>detalle</button></td>
                  </tr>
                ))}
                {!filtradas.length && <tr><td colSpan="5" className="muted">Sin actividad con estos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          <Paginador {...pag} />
        </>
      )}

      {det && (
        <div className="modal-bg" onClick={() => setDet(null)}>
          <div className="glass modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{det.action} en {TABLAS_LBL[det.entity_type] || det.entity_type}</h2>
              <button className="btn-ghost" onClick={() => setDet(null)}>&#10005;</button>
            </div>
            <p className="muted small">{new Date(det.created_at).toLocaleString('es-PE')} | {nombreDe(det.user_email || 'SISTEMA')}</p>
            <pre className="json-box">{JSON.stringify(det.details, null, 2)}</pre>
          </div>
        </div>
      )}
    </>
  )
}
