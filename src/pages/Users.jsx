import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

const ROLES = [['admin', 'ADMINISTRADOR (todo)'], ['secretary', 'SECRETARIA (opera)'], ['manager', 'GERENCIA (solo ver)']]

export default function Users() {
  const { role, profile } = useAuth()
  const [users, setUsers] = useState([])
  const [projects, setProjects] = useState([])
  const [asig, setAsig] = useState([])
  const [msg, setMsg] = useState(null)

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
      <p className="hint">Para CREAR un usuario: Supabase &#8594; Authentication &#8594; Add user (correo y contrasena). Al iniciar sesion por primera vez aparecera aqui y le asignas su rol.</p>
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.t}</p>}

      <div className="glass table-wrap">
        <table>
          <thead><tr><th>Correo</th><th>Nombre</th><th>Rol</th><th>Proyectos asignados (gerencia)</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>{u.email}{u.id === profile?.id && <b className="accent"> (TU)</b>}</td>
                <td>{u.full_name}</td>
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
