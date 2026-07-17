import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
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
  // marketing
  mkt_brains: 'MKT · CEREBRO', mkt_proyectos: 'MKT · PROYECTOS',
}
// tablas cuyos cambios cuentan como "configuración del bot" en el resumen
const CONFIG_BOT = new Set(['projects', 'bot_brains'])

export default function Bitacora() {
  const { role } = useAuth()
  const [rows, setRows] = useState([])
  const [projects, setProjects] = useState([])
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
  }, [role])

  const filtradas = useMemo(() => {
    const t = fq.trim().toLowerCase()
    const desde = fper === 'todo' ? null : new Date(Date.now() - (fper === 'hoy' ? 0 : Number(fper)) * 86400000)
    if (desde && fper === 'hoy') desde.setHours(0, 0, 0, 0)
    if (desde && fper !== 'hoy') desde.setHours(0, 0, 0, 0)
    return rows.filter(r => {
      if (desde && new Date(r.created_at) < desde) return false
      if (fact !== 'todos' && r.action !== fact) return false
      if (ftab !== 'todos' && r.entity_type !== ftab) return false
      if (fproj !== 'todos' && (r.details?.project_id || null) !== fproj) return false
      if (fuser !== 'todos' && (r.user_email || 'SISTEMA') !== fuser) return false
      if (!t) return true
      return (r.user_email || '').toLowerCase().includes(t) ||
        JSON.stringify(r.details || {}).toLowerCase().includes(t)
    })
  }, [rows, fq, fact, ftab, fper, fproj, fuser])

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

  // resumen de productividad por usuario
  const resumen = useMemo(() => {
    const m = {}
    for (const r of filtradas) {
      const u = r.user_email || 'SISTEMA'
      if (!m[u]) m[u] = { pagos: 0, clientes: 0, ventas: 0, separaciones: 0, gastos: 0, lotes: 0, config: 0, otras: 0, total: 0 }
      m[u].total++
      if (r.entity_type === 'daily_income' && r.action === 'INSERT') m[u].pagos++
      else if (r.entity_type === 'clients' && r.action === 'INSERT') m[u].clientes++
      else if (r.entity_type === 'sales' && r.action === 'INSERT') m[u].ventas++
      else if (r.entity_type === 'separations' && r.action === 'INSERT') m[u].separaciones++
      else if (r.entity_type === 'expenses' && r.action === 'INSERT') m[u].gastos++
      else if (r.entity_type === 'lots') m[u].lotes++
      else if (CONFIG_BOT.has(r.entity_type)) m[u].config++
      else m[u].otras++
    }
    return Object.entries(m).sort((a, b) => b[1].total - a[1].total)
  }, [filtradas])

  const tablas = useMemo(() => [...new Set(rows.map(r => r.entity_type))].sort(), [rows])
  const pag = usePaginacion(filtradas, 50)   // 50 por pagina, sin recargar

  if (role !== 'superuser') return <p className="error">Solo el SUPERUSUARIO puede ver la bitacora.</p>

  return (
    <>
      <h1>Bitacora de actividades</h1>

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
        <select value={fuser} onChange={e => setFuser(e.target.value)} title="Filtrar por usuario">
          <option value="todos">TODOS LOS USUARIOS</option>
          {usuarios.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <input className="search" placeholder="Buscar por usuario o contenido..."
          value={fq} onChange={e => setFq(e.target.value)} />
      </div>

      {/* actividad por hora del dia — resumen visual del set filtrado */}
      <div className="glass hrs-card">
        <div className="hrs-head">
          <span>⏱ Actividad por hora del día {fuser !== 'todos' ? <b>· {fuser}</b> : ''}</span>
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

      <h2 className="sub">Avance por usuario ({fper === 'hoy' ? 'hoy' : fper === 'todo' ? 'historico' : `ultimos ${fper} dias`})</h2>
      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Usuario</th><th>Pagos reg.</th><th>Clientes</th><th>Ventas</th><th>Separaciones</th><th>Gastos</th><th>Cambios en lotes</th><th>Config. bot</th><th>Otras</th><th>Total acciones</th></tr></thead>
          <tbody>
            {resumen.map(([u, x]) => (
              <tr key={u}>
                <td><b>{u}</b></td>
                <td>{x.pagos}</td><td>{x.clientes}</td><td>{x.ventas}</td>
                <td>{x.separaciones}</td><td>{x.gastos}</td><td>{x.lotes}</td>
                <td>{x.config}</td><td>{x.otras}</td><td><b>{x.total}</b></td>
              </tr>
            ))}
            {resumen.length === 0 && <tr><td colSpan="10" className="muted">Sin actividad en el periodo.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="sub">Detalle ({filtradas.length})</h2>
      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Accion</th><th>Tabla</th><th></th></tr></thead>
          <tbody>
            {pag.pagina.map(r => (
              <tr key={r.id}>
                <td>{new Date(r.created_at).toLocaleString('es-PE')}</td>
                <td>{r.user_email || 'SISTEMA'}</td>
                <td className={r.action === 'DELETE' ? 'bad' : r.action === 'UPDATE' ? 'warn' : 'ok'}>{r.action}</td>
                <td>{TABLAS_LBL[r.entity_type] || r.entity_type}</td>
                <td><button className="link-btn" onClick={() => setDet(r)}>detalle</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Paginador {...pag} />

      {det && (
        <div className="modal-bg" onClick={() => setDet(null)}>
          <div className="glass modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{det.action} en {TABLAS_LBL[det.entity_type] || det.entity_type}</h2>
              <button className="btn-ghost" onClick={() => setDet(null)}>&#10005;</button>
            </div>
            <p className="muted small">{new Date(det.created_at).toLocaleString('es-PE')} | {det.user_email || 'SISTEMA'}</p>
            <pre className="json-box">{JSON.stringify(det.details, null, 2)}</pre>
          </div>
        </div>
      )}
    </>
  )
}
