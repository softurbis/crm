import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '../context/AuthContext'

const signupClient = createClient(
  import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

const ROLES = [
  ['superuser', 'SUPERUSUARIO (control total)'],
  ['admin', 'ADMINISTRADOR (edita todo, sin usuarios)'],
  ['secretary', 'SECRETARIA (opera)'],
  ['manager', 'GERENCIA (solo ver)'],
]

export default function Users() {
  const { role, profile } = useAuth()
  const [users, setUsers] = useState([])
  const [projects, setProjects] = useState([])
  const [asig, setAsig] = useState([])
  const [msg, setMsg] = useState(null)
  const [nu, setNu] = useState({ role: 'secretary' })
  const [busy, setBusy] = useState(false)

  const [seguim, setSeguim] = useState([])
  const [segAcc, setSegAcc] = useState([])
  async function load() {
    const [u, p, a, s, sa] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('projects').select('id, name'),
      supabase.from('project_assignments').select('*'),
      supabase.from('secretaries').select('*').order('full_name'),
      supabase.from('seguimiento_access').select('*'),
    ])
    setUsers(u.data || []); setProjects(p.data || []); setAsig(a.data || []); setSeguim(s.data || []); setSegAcc(sa.data || [])
  }
  async function toggleSegAcc(u, sid, on) {
    if (on) await supabase.from('seguimiento_access').insert({ user_id: u.id, secretary_id: sid })
    else await supabase.from('seguimiento_access').delete().eq('user_id', u.id).eq('secretary_id', sid)
    load()
  }

  async function vincularSeguimiento(u, val) {
    if (!val) return
    if (val === 'nuevo') {
      const tel = prompt('NÚMERO DE WHATSAPP de ' + (u.full_name || u.email) + ' para su seguimiento de actividades.\n\nFormato: 51 + número (ej. 51961234567):', '51')
      if (!tel) return
      const dig = String(tel).replace(/\D/g, '')
      if (dig.length < 11) { alert('Número inválido: debe incluir el 51 adelante.'); return }
      const tipo = u.role === 'manager' ? 'gerencia' : 'secretaria'
      // si el numero ya existe en seguimiento, vincular ese registro en vez de crear otro
      const { data: ya } = await supabase.from('secretaries').select('id, user_id, full_name').eq('phone', dig).maybeSingle()
      if (ya) {
        if (ya.user_id && ya.user_id !== u.id) { alert('Ese número ya está vinculado a otro usuario (' + ya.full_name + '). Desvincúlalo primero.'); return }
        await supabase.from('secretaries').update({ user_id: u.id, tipo }).eq('id', ya.id)
        setMsg({ ok: true, t: 'NÚMERO EXISTENTE VINCULADO: +' + dig }); load(); return
      }
      const { error } = await supabase.from('secretaries').insert({ full_name: (u.full_name || u.email).toUpperCase(), phone: dig, tipo, user_id: u.id })
      if (error) { alert('ERROR: ' + error.message); return }
      await supabase.from('whatsapp_numbers').upsert({ phone: dig, tipo: 'secretaria', note: (u.full_name || '').toUpperCase() + ' (' + tipo.toUpperCase() + ')' })
      setMsg({ ok: true, t: 'SEGUIMIENTO CREADO Y VINCULADO: +' + dig })
    } else {
      await supabase.from('secretaries').update({ user_id: null }).eq('user_id', u.id)
      await supabase.from('secretaries').update({ user_id: u.id }).eq('id', val)
      setMsg({ ok: true, t: 'SEGUIMIENTO VINCULADO' })
    }
    load()
  }
  async function desvincularSeguimiento(u) {
    await supabase.from('secretaries').update({ user_id: null }).eq('user_id', u.id)
    load()
  }
  useEffect(() => { if (role === 'superuser') load() }, [role])

  if (role !== 'superuser') return <p className="error">Solo el SUPERUSUARIO puede gestionar usuarios.</p>

  async function crearUsuario(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const { data, error } = await signupClient.auth.signUp({
        email: nu.email, password: nu.pass,
        options: { data: { full_name: (nu.name || '').toUpperCase() } },
      })
      if (error) throw new Error(error.message)
      if (data.user) {
        await supabase.from('profiles').update({ role: nu.role, full_name: (nu.name || '').toUpperCase() }).eq('id', data.user.id)
      }
      setMsg({ ok: true, t: 'USUARIO CREADO: ' + nu.email + '. Ya puede iniciar sesion.' })
      setNu({ role: 'secretary' }); load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR: ' + err.message }) }
    setBusy(false)
  }

  async function cambiarRol(u, r) {
    const { error } = await supabase.from('profiles').update({ role: r }).eq('id', u.id)
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: `ROL DE ${u.email} ACTUALIZADO` })
    load()
  }

  async function cambiarNombre(u, name) {
    if (!name || name === u.full_name) return
    await supabase.from('profiles').update({ full_name: name.toUpperCase() }).eq('id', u.id)
    load()
  }

  async function resetPass(u) {
    if (!confirm('¿Enviar correo de recuperación de contraseña a ' + u.email + '?\n\nRecibirá un enlace para crear su nueva clave.')) return
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, { redirectTo: window.location.origin + '/crm/reset' })
    setMsg(error ? { ok: false, t: 'ERROR: ' + error.message } : { ok: true, t: 'CORREO DE RECUPERACIÓN ENVIADO A ' + u.email })
  }

  async function toggleActivo(u) {
    if (u.id === profile?.id) return
    const accion = u.active === false ? 'REACTIVAR' : 'DESACTIVAR'
    if (!confirm(`${accion} a ${u.email}?\n\n${accion === 'DESACTIVAR' ? 'Perdera el acceso al sistema de inmediato.' : 'Recuperara el acceso.'}`)) return
    const { error } = await supabase.from('profiles').update({ active: u.active === false }).eq('id', u.id)
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: `${u.email} ${accion === 'DESACTIVAR' ? 'DESACTIVADO' : 'REACTIVADO'}` })
    load()
  }

  async function toggleAsig(u, pid, on) {
    if (on) await supabase.from('project_assignments').insert({ user_id: u.id, project_id: pid })
    else await supabase.from('project_assignments').delete().eq('user_id', u.id).eq('project_id', pid)
    load()
  }

  return (
    <>
      <h1>Usuarios y permisos</h1>
      <p className="muted small">Jerarquia: SUPERUSUARIO (tu) &#8594; ADMINISTRADOR (edita todo, sin acceso a usuarios ni bitacora) &#8594; SECRETARIA (opera) &#8594; GERENCIA (solo ver).</p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      <form className="glass form-card" onSubmit={crearUsuario}>
        <p><b>CREAR USUARIO NUEVO</b></p>
        <div className="form-grid">
          <label>Correo <input type="email" style={{ textTransform: 'none' }} value={nu.email || ''} onChange={e => setNu(x => ({ ...x, email: e.target.value }))} required /></label>
          <label>Contrasena <input type="text" style={{ textTransform: 'none' }} value={nu.pass || ''} onChange={e => setNu(x => ({ ...x, pass: e.target.value }))} required minLength="6" /></label>
          <label>Nombre completo <input value={nu.name || ''} onChange={e => setNu(x => ({ ...x, name: e.target.value }))} required /></label>
          <label>Rol
            <select value={nu.role} onChange={e => setNu(x => ({ ...x, role: e.target.value }))}>
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <button className="btn-primary" disabled={busy}>{busy ? 'Creando...' : 'Crear usuario'}</button>
        <p className="muted small">Si al entrar sale "Email not confirmed": Supabase &#8594; Authentication &#8594; Sign In / Providers &#8594; Email &#8594; desactivar "Confirm email".</p>
      </form>

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Seguimiento WSP</th><th>Proyectos asignados</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className={u.active === false ? 'row-perdida' : ''}>
                <td>{u.email}{u.id === profile?.id && <b className="accent"> (TU)</b>}</td>
                <td><input defaultValue={u.full_name || ''} onBlur={e => cambiarNombre(u, e.target.value)} style={{ minWidth: 160 }} /></td>
                <td>
                  <select value={u.role} disabled={u.id === profile?.id}
                    onChange={e => cambiarRol(u, e.target.value)}>
                    {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </td>
                <td>
                  {u.id === profile?.id
                    ? <span className="ok">ACTIVO</span>
                    : <button className={u.active === false ? 'btn-ghost' : 'link-btn bad'} onClick={() => toggleActivo(u)}>
                        {u.active === false ? 'REACTIVAR' : 'DESACTIVAR (eliminar acceso)'}
                      </button>}
                  {' '}<button className="btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} title="Enviar correo para crear nueva contraseña" onClick={() => resetPass(u)}>🔑 RESET</button>
                </td>
                <td>
                  {(() => {
                    const v = seguim.find(s => s.user_id === u.id)
                    if (v) return (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                        <span style={{ color: v.tipo === 'gerencia' ? '#e7c15a' : '#e8a0c8', fontWeight: 700 }}>{v.tipo === 'gerencia' ? '👔' : '🗓️'} +{v.phone}</span>
                        <button className="btn-ghost" style={{ padding: '1px 7px', fontSize: 11 }} title="Desvincular" onClick={() => desvincularSeguimiento(u)}>✕</button>
                      </span>
                    )
                    return (
                      <select value="" onChange={e => vincularSeguimiento(u, e.target.value)} style={{ fontSize: 12 }}>
                        <option value="">— SIN SEGUIMIENTO —</option>
                        <option value="nuevo">➕ VINCULAR NÚMERO NUEVO…</option>
                        {seguim.filter(s => !s.user_id).map(s => <option key={s.id} value={s.id}>{s.full_name} (+{s.phone})</option>)}
                      </select>
                    )
                  })()}
                  {u.role !== 'superuser' && seguim.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <span className="muted" style={{ fontSize: 10, fontWeight: 700 }}>VE A:</span>
                      {seguim.map(s => {
                        const on = segAcc.some(a => a.user_id === u.id && a.secretary_id === s.id)
                        return (
                          <label key={s.id} className="inline-check" style={{ fontSize: 11 }}>
                            <input type="checkbox" checked={on} onChange={e => toggleSegAcc(u, s.id, e.target.checked)} />
                            {s.tipo === 'gerencia' ? '👔' : ''}{s.full_name.split(' ')[0]}
                          </label>
                        )
                      })}
                      <p className="muted" style={{ fontSize: 9, margin: '2px 0 0' }}>SIN MARCAR NINGUNO = ve según su rol (admin: todas las secretarias).</p>
                    </div>
                  )}
                </td>
                <td>
                  {projects.map(p => {
                    const on = asig.some(a => a.user_id === u.id && a.project_id === p.id)
                    return (
                      <label key={p.id} className="inline-check">
                        <input type="checkbox" checked={on} onChange={e => toggleAsig(u, p.id, e.target.checked)} />
                        {p.name}
                      </label>
                    )
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">DESACTIVAR corta el acceso al instante (queda en la lista por historial). Para borrarlo definitivamente: Supabase &#8594; Authentication &#8594; usuario &#8594; Delete.</p>
      </div>
    </>
  )
}
