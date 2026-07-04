import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const CAMPOS = [
  ['name', 'Nombre del proyecto'], ['titular_name', 'Titular'], ['titular_dni', 'DNI titular'],
  ['titular_phone', 'Telefono'], ['office_address', 'Direccion de oficina'],
  ['late_penalty_rate', 'Mora S/ por dia'], ['info_url', 'Link de informacion'],
]

export default function Projects() {
  const { role } = useAuth()
  const canEdit = role === 'admin'
  const [projects, setProjects] = useState([])
  const [stats, setStats] = useState({})
  const [accounts, setAccounts] = useState([])
  const [edit, setEdit] = useState(null)
  const [f, setF] = useState({})
  const [na, setNa] = useState({})   // nueva cuenta
  const [msg, setMsg] = useState(null)

  async function load() {
    const [p, l, i, g, a] = await Promise.all([
      supabase.from('projects').select('*').order('created_at'),
      supabase.from('lots').select('project_id, status'),
      supabase.from('daily_income').select('project_id, amount'),
      supabase.from('expenses').select('project_id, amount'),
      supabase.from('financial_accounts').select('*'),
    ])
    setProjects(p.data || []); setAccounts(a.data || [])
    const st = {}
    for (const pr of p.data || []) st[pr.id] = { lotes: {}, ingresos: 0, gastos: 0, total: 0 }
    for (const x of l.data || []) if (st[x.project_id]) { st[x.project_id].lotes[x.status] = (st[x.project_id].lotes[x.status] || 0) + 1; st[x.project_id].total++ }
    for (const x of i.data || []) if (st[x.project_id]) st[x.project_id].ingresos += Number(x.amount)
    for (const x of g.data || []) if (st[x.project_id]) st[x.project_id].gastos += Number(x.amount)
    setStats(st)
  }
  useEffect(() => { load() }, [])

  async function guardar(e) {
    e.preventDefault()
    const payload = {}
    for (const [k] of CAMPOS) payload[k] = k === 'late_penalty_rate' ? Number(f[k] || 0) : ((f[k] || '').toUpperCase().trim() || null)
    const { error } = await supabase.from('projects').update(payload).eq('id', edit)
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: 'PROYECTO ACTUALIZADO' })
    setEdit(null); load()
  }

  async function nuevoProyecto() {
    const name = prompt('Nombre del nuevo proyecto:')
    if (!name) return
    const { error } = await supabase.from('projects').insert({ name: name.toUpperCase() })
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: 'PROYECTO CREADO' })
    load()
  }

  async function agregarCuenta(pid) {
    if (!na.name) return
    const { error } = await supabase.from('financial_accounts').insert({
      project_id: pid, name: (na.name || '').toUpperCase(),
      type: na.type || 'bank', account_number: na.account_number || null,
      cci: na.cci || null, holder_name: (na.holder || '').toUpperCase() || null,
    })
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: 'CUENTA AGREGADA' })
    setNa({}); load()
  }

  return (
    <>
      <h1>Proyectos</h1>
      <div className="toolbar">
        <span className="hint">Vista general por proyecto: lotes, recaudo y gastos.</span>
        {canEdit && <button className="btn-primary" onClick={nuevoProyecto}>+ Nuevo proyecto</button>}
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      {projects.map(p => {
        const s = stats[p.id] || { lotes: {}, ingresos: 0, gastos: 0, total: 0 }
        return (
          <div className="glass form-card" key={p.id}>
            <div className="modal-head">
              <h2>{p.name}</h2>
              {canEdit && <button className="btn-ghost" onClick={() => {
                if (edit === p.id) { setEdit(null); return }
                setEdit(p.id)
                setF(Object.fromEntries(CAMPOS.map(([k]) => [k, p[k] ?? ''])))
              }}>{edit === p.id ? 'Cerrar' : 'Editar'}</button>}
            </div>

            <div className="cards">
              <div className="card glass"><p className="muted">Recaudado</p><p className="kpi">{soles(s.ingresos)}</p></div>
              <div className="card glass"><p className="muted">Gastos</p><p className="kpi">{soles(s.gastos)}</p></div>
              <div className="card glass"><p className="muted">Balance</p><p className="kpi">{soles(s.ingresos - s.gastos)}</p></div>
              <div className="card glass"><p className="muted">Lotes</p><p className="kpi">{s.total}</p></div>
            </div>
            <p>
              <span className="ok">&#9679; {s.lotes.disponible || 0} disponibles</span>{' '}
              <span style={{ color: '#4f83c2' }}>&#9679; {s.lotes.vendido || 0} vendidos</span>{' '}
              <span className="warn">&#9679; {s.lotes.separado || 0} separados</span>{' '}
              <span style={{ color: '#9a6bc9' }}>&#9679; {s.lotes.expropiado || 0} expropiados</span>{' '}
              <span className="bad">&#9679; {s.lotes.invadido || 0} invadidos</span>
            </p>
            <p className="muted small">Titular: {p.titular_name || '-'} | Mora: S/ {p.late_penalty_rate}/dia | Oficina: {p.office_address || '-'}</p>

            {edit === p.id && (
              <form className="form-grid" onSubmit={guardar}>
                {CAMPOS.map(([k, label]) => (
                  <label key={k} className={k === 'office_address' || k === 'info_url' ? 'span2' : ''}>
                    {label}
                    <input value={f[k] ?? ''} onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} />
                  </label>
                ))}
                <div className="span2"><button className="btn-primary">Guardar proyecto</button></div>
              </form>
            )}

            <hr />
            <p><b>CUENTAS DE COBRO:</b></p>
            {accounts.filter(a => a.project_id === p.id).map(a => (
              <p key={a.id} className={a.active ? '' : 'muted'}>
                &#127974; {a.name} {a.account_number ? `| CTA ${a.account_number}` : ''} {a.cci ? `| CCI ${a.cci}` : ''} {a.holder_name ? `| ${a.holder_name}` : ''}
                {!a.active && ' (INACTIVA)'}
                {canEdit && <button className="link-btn" style={{ marginLeft: 8 }}
                  onClick={async () => { await supabase.from('financial_accounts').update({ active: !a.active }).eq('id', a.id); load() }}>
                  {a.active ? 'desactivar' : 'activar'}</button>}
              </p>
            ))}
            {canEdit && (
              <div className="form-grid">
                <label>Banco/billetera <input value={na.name || ''} onChange={e => setNa(x => ({ ...x, name: e.target.value }))} /></label>
                <label>Tipo
                  <select value={na.type || 'bank'} onChange={e => setNa(x => ({ ...x, type: e.target.value }))}>
                    <option value="bank">BANCO</option><option value="digital_wallet">BILLETERA DIGITAL</option>
                  </select>
                </label>
                <label>N cuenta <input value={na.account_number || ''} onChange={e => setNa(x => ({ ...x, account_number: e.target.value }))} /></label>
                <label>CCI <input value={na.cci || ''} onChange={e => setNa(x => ({ ...x, cci: e.target.value }))} /></label>
                <label>Titular <input value={na.holder || ''} onChange={e => setNa(x => ({ ...x, holder: e.target.value }))} /></label>
                <div><button className="btn-ghost" type="button" onClick={() => agregarCuenta(p.id)}>+ Agregar cuenta</button></div>
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
