import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createClient } from '@supabase/supabase-js'

const signupClient = createClient(
  import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
import { useAuth } from '../context/AuthContext'

const ROLES = [['admin', 'ADMINISTRADOR (todo)'], ['secretary', 'SECRETARIA (opera)'], ['manager', 'GERENCIA (solo ver)']]

export default function Users() {
  const { role, profile } = useAuth()
  const [users, setUsers] = useState([])
  const [projects, setProjects] = useState([])
  const [asig, setAsig] = useState([])
  const [msg, setMsg] = useState(null)
  const [nu, setNu] = useState({ role: 'secretary' })
  const [busy, setBusy] = useState(false)

  async function load() {
    const [u, p, a] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('projects').select('id, name'),
      supabase.from('project_assignments').select('*'),
    ])
    setUsers(u.data || []); setProjects(p.data || []); setAsig(a.data || [])
  }
  useEffect(() => { if (role === 'admin') load() }, [role])

  if (role !== 'admin') return <p className="error">Solo el administrador puede gestionar usuarios.</p>

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

  async function cambiarNombre(u, name) {
    if (!name || name === u.full_name) return
    await supabase.from('profiles').update({ full_name: name.toUpperCase() }).eq('id', u.id)
    load()
  }

  async function cambiarRol(u, r) {
    const { error } = await supabase.from('profiles').update({ role: r }).eq('id', u.id)
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: `ROL DE ${u.email} → ${r.toUpperCase()}` })
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
        <p className="muted small">Si sale "Email not confirmed" al entrar: Supabase &#8594; Authentication &#8594; Sign In / Providers &#8594; Email &#8594; desactivar "Confirm email".</p>
      </form>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Proyectos asignados (gerencia)</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.email}{u.id === profile?.id && <b className="accent"> (TU)</b>}</td>
                <td><input defaultValue={u.full_name || ''} onBlur={e => cambiarNombre(u, e.target.value)} style={{ minWidth: 160 }} /></td>
                <td>
                  <select value={u.role} disabled={u.id === profile?.id}
                    onChange={e => cambiarRol(u, e.target.value)}>
                    {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
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
      </div>
    </>
  )
}
