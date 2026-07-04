import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const soles = n => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })
const hoyISO = () => new Date().toISOString().slice(0, 10)

function diasPara(fecha) {
  if (!fecha) return null
  return Math.ceil((new Date(fecha + 'T12:00:00') - new Date(hoyISO() + 'T12:00:00')) / 86400000)
}

async function upload(path, file) {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
  const full = `${path}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('urbis-files').upload(full, file, { upsert: true })
  if (error) throw new Error(error.message)
  return supabase.storage.from('urbis-files').getPublicUrl(full).data.publicUrl
}

function LegalChip({ label, expiry, docUrl }) {
  const d = diasPara(expiry)
  if (!expiry || !docUrl) return <span className="chip-legal bad">&#9888; {label}: FALTA {!docUrl ? 'DOCUMENTO' : 'FECHA'}</span>
  if (d < 0) return <span className="chip-legal bad">&#9940; {label}: VENCIDA HACE {Math.abs(d)} DIAS</span>
  if (d <= 30) return <span className="chip-legal warn2">&#9888; {label}: VENCE EN {d} DIAS</span>
  return <span className="chip-legal ok2">&#10004; {label}: VIGENTE ({d} dias)</span>
}

export default function Projects() {
  const { role } = useAuth()
  const canEdit = role === 'admin'
  const [projects, setProjects] = useState([])
  const [stats, setStats] = useState({})
  const [accounts, setAccounts] = useState([])
  const [edit, setEdit] = useState(null)       // id | 'nuevo' | null
  const [f, setF] = useState({})
  const [fLiteral, setFLiteral] = useState(null)
  const [fPoder, setFPoder] = useState(null)
  const [na, setNa] = useState({})
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const CAMPOS = [
    ['name', 'Nombre del proyecto', true],
    ['description', 'Descripcion del proyecto', true, 'span2'],
    ['how_to_arrive', 'Como llegar (referencia escrita)', true, 'span2'],
    ['latitude', 'Latitud (ej. -8.3456)', true],
    ['longitude', 'Longitud (ej. -74.5678)', true],
    ['maps_url', 'Link de Google Maps', true],
    ['facebook_url', 'Link de Facebook', false],
    ['instagram_url', 'Link de Instagram', false],
    ['partida_number', 'Partida registral N.', true],
    ['titular_name', 'Titular (vendedor en contratos)', true],
    ['titular_dni', 'DNI del titular', true],
    ['titular_phone', 'WhatsApp oficial', true],
    ['office_address', 'Direccion de oficina', true, 'span2'],
  ]

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

  function abrirForm(p) {
    setEdit(p ? p.id : 'nuevo')
    const base = {}
    for (const [k] of CAMPOS) base[k] = p?.[k] ?? ''
    base.copia_literal_expiry = p?.copia_literal_expiry ?? ''
    base.poder_expiry = p?.poder_expiry ?? ''
    setF(base); setFLiteral(null); setFPoder(null); setMsg(null)
  }

  async function guardar(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const p = edit !== 'nuevo' ? projects.find(x => x.id === edit) : null
      if (!f.copia_literal_expiry) throw new Error('La fecha de vencimiento de la partida es obligatoria.')
      if (edit === 'nuevo' && !fLiteral) throw new Error('Debes subir la copia literal / partida registral (documento obligatorio).')
      if ((fPoder || p?.carta_poder_url) && !f.poder_expiry) throw new Error('Si hay carta poder, su vigencia es obligatoria.')

      let literalUrl = p?.copia_literal_url || null
      let poderUrl = p?.carta_poder_url || null
      if (fLiteral) literalUrl = await upload('legal/partida', fLiteral)
      if (fPoder) poderUrl = await upload('legal/poder', fPoder)

      const payload = {}
      for (const [k, , req] of CAMPOS) {
        const v = (String(f[k] ?? '')).trim()
        if (req && !v) throw new Error('Campo obligatorio: ' + k.replace(/_/g, ' '))
        payload[k] = k.includes('url') || k === 'latitude' || k === 'longitude' ? (v || null) : (v.toUpperCase() || null)
      }
      payload.latitude = f.latitude ? Number(f.latitude) : null
      payload.longitude = f.longitude ? Number(f.longitude) : null
      payload.copia_literal_url = literalUrl
      payload.copia_literal_expiry = f.copia_literal_expiry || null
      payload.carta_poder_url = poderUrl
      payload.poder_expiry = f.poder_expiry || null

      const r = edit === 'nuevo'
        ? await supabase.from('projects').insert(payload)
        : await supabase.from('projects').update(payload).eq('id', edit)
      if (r.error) throw new Error(r.error.message)
      setMsg({ ok: true, t: edit === 'nuevo' ? 'PROYECTO CREADO' : 'PROYECTO ACTUALIZADO' })
      setEdit(null); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
    setBusy(false)
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

  const FORM = (
    <form className="glass form-card" onSubmit={guardar}>
      <p><b>{edit === 'nuevo' ? 'NUEVO PROYECTO' : 'EDITAR PROYECTO'}</b> — todos los campos marcados son obligatorios.</p>
      <div className="form-grid">
        {CAMPOS.map(([k, label, req, cls]) => (
          <label key={k} className={cls || ''}>
            {label} {req && <b className="bad">*</b>}
            <input value={f[k] ?? ''} required={req}
              style={k.includes('url') ? { textTransform: 'none' } : {}}
              onChange={e => setF(x => ({ ...x, [k]: e.target.value }))} />
          </label>
        ))}
        <label>Partida / copia literal (PDF o foto) {edit === 'nuevo' && <b className="bad">*</b>}
          <input type="file" accept="image/*,.pdf" onChange={e => setFLiteral(e.target.files[0] || null)} />
        </label>
        <label>Vencimiento de la partida <b className="bad">*</b>
          <input type="date" value={f.copia_literal_expiry || ''} required
            onChange={e => setF(x => ({ ...x, copia_literal_expiry: e.target.value }))} />
        </label>
        <label>Carta poder (si aplica)
          <input type="file" accept="image/*,.pdf" onChange={e => setFPoder(e.target.files[0] || null)} />
        </label>
        <label>Vigencia del poder
          <input type="date" value={f.poder_expiry || ''}
            onChange={e => setF(x => ({ ...x, poder_expiry: e.target.value }))} />
        </label>
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      <div>
        <button className="btn-primary" disabled={busy}>{busy ? 'Guardando...' : 'Guardar proyecto'}</button>{' '}
        <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
      </div>
    </form>
  )

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Proyectos</h1>
        {canEdit && <button className="btn-primary" onClick={() => abrirForm(null)}>+ Nuevo proyecto</button>}
      </div>
      {msg && !edit && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
      {edit === 'nuevo' && FORM}

      {projects.map(p => {
        const s = stats[p.id] || { lotes: {}, ingresos: 0, gastos: 0, total: 0 }
        return (
          <div className="glass form-card" key={p.id}>
            <div className="modal-head">
              <h2>{p.name}</h2>
              {canEdit && <button className="btn-ghost" onClick={() => edit === p.id ? setEdit(null) : abrirForm(p)}>{edit === p.id ? 'Cerrar' : 'Editar'}</button>}
            </div>

            <p>
              <LegalChip label="PARTIDA" expiry={p.copia_literal_expiry} docUrl={p.copia_literal_url} />{' '}
              {(p.carta_poder_url || p.poder_expiry) && <LegalChip label="PODER" expiry={p.poder_expiry} docUrl={p.carta_poder_url} />}
              {p.copia_literal_url && <> <a href={p.copia_literal_url} target="_blank" rel="noreferrer" className="small">VER PARTIDA</a></>}
              {p.carta_poder_url && <> | <a href={p.carta_poder_url} target="_blank" rel="noreferrer" className="small">VER PODER</a></>}
            </p>

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
            {p.description && <p className="muted small">{p.description}</p>}
            {p.how_to_arrive && <p className="muted small">COMO LLEGAR: {p.how_to_arrive}</p>}
            <p className="small">
              {p.maps_url && <a href={p.maps_url} target="_blank" rel="noreferrer">&#128205; MAPS</a>}
              {p.facebook_url && <> | <a href={p.facebook_url} target="_blank" rel="noreferrer">FACEBOOK</a></>}
              {p.instagram_url && <> | <a href={p.instagram_url} target="_blank" rel="noreferrer">INSTAGRAM</a></>}
              {p.latitude && <span className="muted"> | {p.latitude}, {p.longitude}</span>}
              {p.partida_number && <span className="muted"> | PARTIDA N. {p.partida_number}</span>}
            </p>
            <p className="muted small">TITULAR: {p.titular_name || '-'} (DNI {p.titular_dni || '-'}) | OFICINA: {p.office_address || '-'}</p>

            {edit === p.id && FORM}

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
