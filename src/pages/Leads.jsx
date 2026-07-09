import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const ETAPAS = [
  ['nuevo', 'NUEVO', '#9ccb86'],
  ['contactado', 'CONTACTADO', '#7fa3c2'],
  ['interesado', 'INTERESADO', '#e0b23f'],
  ['visita_agendada', 'VISITA AGENDADA', '#b58ad9'],
  ['negociacion', 'NEGOCIACION', '#e0913f'],
]
const FUENTES = ['ads', 'whatsapp', 'feria', 'referido', 'walk_in', 'otro']
const TEMP = { frio: ['FRIO', '#7fa3c2'], tibio: ['TIBIO', '#e0b23f'], caliente: ['CALIENTE', '#e05252'] }

export default function Leads() {
  const { role, profile } = useAuth()
  const puedeEditar = ['admin', 'secretary', 'superuser', 'manager'].includes(role)
  const [leads, setLeads] = useState([])
  const [projects, setProjects] = useState([])
  const [advisors, setAdvisors] = useState([])
  const [vista, setVista] = useState('pipeline')  // pipeline | ganado | perdido
  const [q, setQ] = useState('')
  const [fproj, setFproj] = useState('todos')
  const [fadv, setFadv] = useState('todos')
  const [sel, setSel] = useState(null)      // lead en modal
  const [form, setForm] = useState({})
  const [nuevo, setNuevo] = useState(false)
  const [notas, setNotas] = useState([])
  const [nota, setNota] = useState('')
  const [msg, setMsg] = useState(null)
  const [dragId, setDragId] = useState(null)

  async function load() {
    const [l, p, a] = await Promise.all([
      supabase.from('leads').select('*, project:projects(name), advisor:advisors!leads_assigned_to_fkey(code)').order('created_at', { ascending: false }),
      supabase.from('projects').select('id, name'),
      supabase.from('advisors').select('id, code, full_name').eq('active', true).order('code'),
    ])
    setLeads(l.data || []); setProjects(p.data || []); setAdvisors(a.data || [])
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!sel?.id) { setNotas([]); return }
    supabase.from('lead_activities').select('*, autor:profiles(full_name)').eq('lead_id', sel.id).order('created_at', { ascending: false })
      .then(({ data }) => setNotas(data || []))
  }, [sel])

  const filtrados = useMemo(() => leads.filter(l => {
    if (fproj !== 'todos' && l.project_id !== fproj) return false
    if (fadv !== 'todos' && l.assigned_to !== fadv) return false
    const t = q.trim().toLowerCase()
    if (t && !(l.full_name || '').toLowerCase().includes(t) && !(l.phone || '').includes(t)) return false
    return true
  }), [leads, q, fproj, fadv])

  const porEtapa = e => filtrados.filter(l => l.status === e)
  const ganados = filtrados.filter(l => l.status === 'ganado')
  const perdidos = filtrados.filter(l => l.status === 'perdido')

  function abrir(l) {
    setSel(l); setNuevo(!l.id); setMsg(null); setNota('')
    setForm({
      full_name: l.full_name || '', phone: l.phone || '', source: l.source || 'otro',
      project_id: l.project_id || '', assigned_to: l.assigned_to || '',
      temperature: l.temperature || 'frio', budget_estimate: l.budget_estimate || '',
      next_action: l.next_action || '', next_action_date: l.next_action_date || '',
      optin_whatsapp: l.optin_whatsapp ?? true,
    })
  }

  async function guardar(e) {
    e.preventDefault()
    const payload = {
      full_name: form.full_name.toUpperCase().trim(),
      phone: form.phone.trim(),
      source: form.source, project_id: form.project_id || null,
      assigned_to: form.assigned_to || null,
      temperature: form.temperature,
      budget_estimate: form.budget_estimate ? Number(form.budget_estimate) : null,
      next_action: (form.next_action || '').toUpperCase() || null,
      next_action_date: form.next_action_date || null,
      optin_whatsapp: !!form.optin_whatsapp,
      optin_date: form.optin_whatsapp ? new Date().toISOString() : null,
    }
    const r = nuevo
      ? await supabase.from('leads').insert({ ...payload, status: 'nuevo', created_by: profile?.id })
      : await supabase.from('leads').update(payload).eq('id', sel.id)
    if (r.error) { setMsg({ ok: false, t: r.error.message }); return }
    setMsg({ ok: true, t: 'GUARDADO' })
    if (nuevo) setSel(null)
    load()
  }

  async function mover(id, etapa) {
    await supabase.from('leads').update({ status: etapa }).eq('id', id)
    load()
  }

  async function agregarNota() {
    if (!nota.trim()) return
    await supabase.from('lead_activities').insert({ lead_id: sel.id, note: nota.toUpperCase(), created_by: profile?.id })
    setNota('')
    const { data } = await supabase.from('lead_activities').select('*, autor:profiles(full_name)').eq('lead_id', sel.id).order('created_at', { ascending: false })
    setNotas(data || [])
  }

  async function ganar(l) {
    if (!confirm(`GANAR a ${l.full_name}?\n\nSe creara su ficha de CLIENTE automaticamente (sin recapturar datos) y luego registras su separacion en CUOTAS.`)) return
    try {
      let clientId = l.client_id
      if (!clientId) {
        const tel = (l.phone || '').replace(/\D/g, '')
        const { data: c, error } = await supabase.from('clients').insert({
          doc_type: 'PEND', doc_number: 'PEND-L' + String(l.id).slice(0, 6).toUpperCase(),
          full_name: l.full_name, phone: l.phone,
          phone_valid: tel.length >= 9 && !tel.includes('999999999'),
        }).select().single()
        if (error) throw error
        clientId = c.id
      }
      await supabase.from('leads').update({ status: 'ganado', client_id: clientId }).eq('id', l.id)
      setSel(null); load()
      alert(`LEAD GANADO ✔\n\n${l.full_name} ya es CLIENTE (completa su DNI y fotos en el modulo Clientes).\nAhora registra su SEPARACION en CUOTAS eligiendo su nombre.`)
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
  }

  async function perder(l) {
    const motivo = prompt('Motivo de la perdida (obligatorio):')
    if (!motivo || motivo.trim().length < 3) return
    await supabase.from('leads').update({ status: 'perdido', lost_reason: motivo.toUpperCase() }).eq('id', l.id)
    setSel(null); load()
  }

  const wa = l => {
    const tel = (l.phone || '').replace(/\D/g, '')
    const full = tel.startsWith('51') || tel.startsWith('52') || tel.startsWith('1') ? tel : '51' + tel
    const txt = `Hola ${l.full_name ? l.full_name.split(' ')[0] : ''}, le saluda Urbis Group 🌳 sobre su interes en ${l.project?.name || 'nuestros proyectos'}. ¿Le puedo compartir la informacion?`
    return `https://wa.me/${full}?text=${encodeURIComponent(txt)}`
  }

  const Card = l => (
    <div key={l.id} className="kcard glass" draggable={puedeEditar}
      onDragStart={() => setDragId(l.id)}
      onClick={() => abrir(l)}>
      <p className="kname">{l.full_name}</p>
      <p className="small muted">{l.phone} {l.project ? `| ${l.project.name}` : ''}</p>
      <p className="small">
        <span className="st-chip" style={{ background: (TEMP[l.temperature] || TEMP.frio)[1] + '33', color: (TEMP[l.temperature] || TEMP.frio)[1] }}>
          {(TEMP[l.temperature] || TEMP.frio)[0]}
        </span>
        {l.advisor && <span className="muted"> {l.advisor.code}</span>}
        {l.source && <span className="muted"> | {l.source}</span>}
      </p>
      {l.next_action && <p className="small warn">&#8594; {l.next_action} {l.next_action_date ? `(${l.next_action_date})` : ''}</p>}
      <a className="link-btn" href={wa(l)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>&#128172; WhatsApp</a>
    </div>
  )

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Leads</h1>
        {puedeEditar && role !== 'manager' && <button className="btn-primary" onClick={() => abrir({})}>+ Nuevo lead</button>}
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por nombre o telefono..." value={q} onChange={e => setQ(e.target.value)} />
        <select value={fproj} onChange={e => setFproj(e.target.value)}>
          <option value="todos">TODOS LOS PROYECTOS</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={fadv} onChange={e => setFadv(e.target.value)}>
          <option value="todos">TODOS LOS ASESORES</option>
          {advisors.map(a => <option key={a.id} value={a.id}>{a.code}</option>)}
        </select>
        <button className={`chip ${vista === 'pipeline' ? 'on' : ''}`} onClick={() => setVista('pipeline')}>PIPELINE</button>
        <button className={`chip ${vista === 'ganado' ? 'on' : ''}`} onClick={() => setVista('ganado')}>&#127942; GANADOS ({ganados.length})</button>
        <button className={`chip ${vista === 'perdido' ? 'on' : ''}`} onClick={() => setVista('perdido')}>PERDIDOS ({perdidos.length})</button>
      </div>
      {msg && !sel && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      {vista === 'pipeline' ? (
        <div className="kanban">
          {ETAPAS.map(([e, lbl, color]) => (
            <div key={e} className="kcol"
              onDragOver={ev => ev.preventDefault()}
              onDrop={() => { if (dragId) { mover(dragId, e); setDragId(null) } }}>
              <p className="kcol-head" style={{ borderColor: color }}>
                <span className="dot" style={{ background: color }} /> {lbl} ({porEtapa(e).length})
              </p>
              {porEtapa(e).map(Card)}
            </div>
          ))}
        </div>
      ) : (
        <div className="glass table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>Telefono</th><th>Proyecto</th><th>Asesor</th>{vista === 'perdido' && <th>Motivo</th>}<th></th></tr></thead>
            <tbody>
              {(vista === 'ganado' ? ganados : perdidos).map(l => (
                <tr key={l.id}>
                  <td>{l.full_name}</td><td>{l.phone}</td>
                  <td>{l.project?.name || '-'}</td><td>{l.advisor?.code || '-'}</td>
                  {vista === 'perdido' && <td>{l.lost_reason}</td>}
                  <td>
                    <button className="btn-ghost" onClick={() => abrir(l)}>ver</button>{' '}
                    {vista === 'perdido' && puedeEditar && role !== 'manager' &&
                      <button className="link-btn" onClick={() => mover(l.id, 'nuevo')}>reactivar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sel !== null && (
        <div className="modal-bg" onClick={() => setSel(null)}>
          <div className="glass modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <h2>{nuevo ? 'Nuevo lead' : sel.full_name}</h2>
              {!nuevo && <a className="btn-ghost" href={wa(sel)} target="_blank" rel="noreferrer">&#128172; WhatsApp</a>}
              <button className="btn-ghost" onClick={() => setSel(null)}>&#10005;</button>
            </div>

            <form onSubmit={guardar} className="form-grid">
              <label>Nombre completo <b className="bad">*</b>
                <input value={form.full_name || ''} required onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
              </label>
              <label>Telefono / WhatsApp <b className="bad">*</b>
                <input value={form.phone || ''} required onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </label>
              <label>Fuente
                <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                  {FUENTES.map(x => <option key={x} value={x}>{x.toUpperCase()}</option>)}
                </select>
              </label>
              <label>Proyecto de interes
                <select value={form.project_id || ''} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
                  <option value="">- por definir -</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label>Asesor
                <select value={form.assigned_to || ''} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
                  <option value="">- sin asignar -</option>
                  {advisors.map(a => <option key={a.id} value={a.id}>{a.code}</option>)}
                </select>
              </label>
              <label>Temperatura
                <select value={form.temperature} onChange={e => setForm(f => ({ ...f, temperature: e.target.value }))}>
                  <option value="frio">FRIO</option><option value="tibio">TIBIO</option><option value="caliente">CALIENTE</option>
                </select>
              </label>
              <label>Presupuesto aprox. S/
                <input type="number" value={form.budget_estimate || ''} onChange={e => setForm(f => ({ ...f, budget_estimate: e.target.value }))} />
              </label>
              <label>Proxima accion
                <input value={form.next_action || ''} onChange={e => setForm(f => ({ ...f, next_action: e.target.value }))} placeholder="LLAMAR / ENVIAR FOTOS / AGENDAR VISITA" />
              </label>
              <label>Fecha proxima accion
                <input type="date" value={form.next_action_date || ''} onChange={e => setForm(f => ({ ...f, next_action_date: e.target.value }))} />
              </label>
              <label className="inline-check" style={{ alignSelf: 'end' }}>
                <input type="checkbox" checked={!!form.optin_whatsapp} onChange={e => setForm(f => ({ ...f, optin_whatsapp: e.target.checked }))} />
                Acepta WhatsApp
              </label>
              <div className="span2">
                {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}
                <button className="btn-primary">{nuevo ? 'Crear lead' : 'Guardar cambios'}</button>
                {!nuevo && sel.status !== 'ganado' && role !== 'manager' && (<>
                  {' '}<button type="button" className="btn-ghost ok" onClick={() => ganar(sel)}>&#127942; GANADO</button>
                  {' '}<button type="button" className="btn-ghost bad" onClick={() => perder(sel)}>PERDIDO</button>
                </>)}
              </div>
            </form>

            {!nuevo && (<>
              <hr />
              <h3 className="sub">Historial / notas</h3>
              <div className="toolbar">
                <input className="search" placeholder="Escribe una nota (llamada, respuesta, acuerdo...)" value={nota} onChange={e => setNota(e.target.value)} />
                <button className="btn-ghost" onClick={agregarNota} type="button">+ Nota</button>
              </div>
              {notas.map(n => (
                <p key={n.id} className="small">
                  <span className="muted">{new Date(n.created_at).toLocaleString('es-PE')} — {n.autor?.full_name || ''}:</span> {n.note}
                </p>
              ))}
              {notas.length === 0 && <p className="muted small">Sin notas todavia.</p>}
            </>)}
          </div>
        </div>
      )}
    </>
  )
}
