import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '../context/AuthContext'
import { PANELS } from '../components/Layout'
import Avatar from '../components/Avatar'

const signupClient = createClient(
  import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

const ROLES = [
  ['superuser', 'SUPERUSUARIO (control total)'],
  ['admin', 'ADMINISTRADOR (edita todo, sin usuarios)'],
  ['secretary', 'SECRETARIA (opera)'],
  ['manager', 'GERENCIA (solo ver)'],
  ['asesor', 'ASESOR (solo chat de sus proyectos)'],   // requiere sql/30 y asignarle proyecto(s) aquí
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
      await supabase.from('whatsapp_numbers').upsert({ phone: dig, tipo: tipo === 'gerencia' ? 'gerencia' : 'secretaria', note: (u.full_name || '').toUpperCase() + ' (' + tipo.toUpperCase() + ')' })
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

  // ---- foto de perfil ----
  async function subirFoto(u, file) {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) { setMsg({ ok: false, t: 'LA FOTO NO DEBE PASAR DE 4 MB' }); return }
    setBusy(true); setMsg(null)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      // el nombre cambia en cada subida para que el navegador no muestre la foto vieja en cache
      const path = `avatars/${u.id}-${Date.now()}.${ext}`
      const { error } = await supabase.storage.from('urbis-files').upload(path, file, { upsert: true })
      if (error) throw new Error(error.message)
      const url = supabase.storage.from('urbis-files').getPublicUrl(path).data.publicUrl
      const { error: e2 } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', u.id)
      if (e2) throw new Error(e2.message)
      setMsg({ ok: true, t: 'FOTO ACTUALIZADA' + (u.id === profile?.id ? ' — RECARGA PARA VERLA EN TU MENU' : '') })
      load()
    } catch (err) { setMsg({ ok: false, t: 'ERROR AL SUBIR LA FOTO: ' + err.message }) }
    setBusy(false)
  }
  async function quitarFoto(u) {
    if (!confirm('¿Quitar la foto de ' + (u.full_name || u.email) + '? Volveran a verse sus iniciales.')) return
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', u.id)
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: 'FOTO QUITADA' })
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

  async function togglePanel(u, to, on) {
    const cur = Array.isArray(u.panels) ? u.panels : PANELS.map(p => p.to)   // null = ve todos (según rol)
    const next = on ? [...new Set([...cur, to])] : cur.filter(x => x !== to)
    await supabase.from('profiles').update({ panels: next }).eq('id', u.id)
    load()
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, flex: 1 }}>Usuarios y permisos</h1>
        <a className="btn-act" href="https://claude.ai/code/artifact/5dfca0de-e60d-4bb7-9b7d-acd3fcbc3635" target="_blank" rel="noreferrer"
          title="Abrir la referencia visual: qué ve y qué edita cada rol">📖 Ver permisos por rol</a>
      </div>
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
          <thead><tr><th>Foto</th><th>Correo</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Seguimiento WSP</th><th>Proyectos asignados</th><th>Paneles visibles</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className={u.active === false ? 'row-perdida' : ''}>
                <td>
                  <div className="ava-cel">
                    <Avatar url={u.avatar_url} nombre={u.full_name || u.email} size={34} />
                    <div className="ava-acc">
                      <label className="link-btn" style={{ cursor: 'pointer' }} title="Subir o cambiar la foto">
                        {u.avatar_url ? 'cambiar' : 'subir'}
                        <input type="file" accept="image/*" hidden disabled={busy}
                          onChange={e => { subirFoto(u, e.target.files[0]); e.target.value = '' }} />
                      </label>
                      {u.avatar_url && <button className="link-btn" onClick={() => quitarFoto(u)} title="Quitar la foto">quitar</button>}
                    </div>
                  </div>
                </td>
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
                <td>
                  {u.role === 'superuser'
                    ? <span className="muted" style={{ fontSize: 11 }}>Todos</span>
                    : PANELS.map(p => {
                      const on = Array.isArray(u.panels) ? u.panels.includes(p.to) : true
                      return (
                        <label key={p.to} className="inline-check" style={{ fontSize: 11 }}>
                          <input type="checkbox" checked={on} onChange={e => togglePanel(u, p.to, e.target.checked)} />
                          {p.label}
                        </label>
                      )
                    })}
                  {u.role !== 'superuser' && <p className="muted" style={{ fontSize: 9, margin: '2px 0 0' }}>Todos marcados = ve según su rol. Desmarca para ocultar.</p>}
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
