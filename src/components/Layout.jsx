import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProject, colorProyecto } from '../context/ProjectContext'
import { supabase } from '../lib/supabase'
import Logo from './Logo'
import Avatar from './Avatar'

// Boton flotante "volver arriba": aparece al bajar y desaparece arriba del todo.
// En listas largas (clientes, cuotas, contratos) evita tener que scrollear a mano.
function VolverArriba() {
  const [ver, setVer] = useState(false)
  useEffect(() => {
    const onScroll = () => setVer(window.scrollY > 400)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <button className={`to-top ${ver ? 'show' : ''}`} title="Volver arriba" aria-label="Volver arriba"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>&#8593;</button>
  )
}

// Resalta la ULTIMA palabra del nombre, que suele ser la que distingue proyectos
// parecidos: "LAS PRADERAS DE **CASHIBO**" vs "LAS PRADERAS DE **PUCALLPA**".
const nombreProy = n => {
  const p = String(n || '').trim().split(/\s+/)
  if (p.length < 2) return n
  return <>{p.slice(0, -1).join(' ')} <b>{p[p.length - 1]}</b></>
}

const haceCuanto = desde => {
  if (!desde) return ''
  const m = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000))
  if (m < 1) return 'recién'
  if (m < 60) return m + ' min'
  const h = Math.floor(m / 60)
  return h + 'h ' + (m % 60) + 'm'
}

const GLOBAL = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true, color: '#56c7d6' },
  { to: '/whatsapp', label: 'WhatsApp Bot', icon: '🤖', staff: true, color: '#58c482' },
  { to: '/probar-bot', label: 'Probar Bot', icon: '🧪', staff: true, color: '#c58ae0' },
  { to: '/marketing', label: 'Marketing', icon: '🎨', staff: true, color: '#e6a4d0' },
  { to: '/corretaje', label: 'Corretaje', icon: '🏠', staff: true, color: '#6fd1c0' },
  { to: '/secretarias', label: 'Seguimiento', icon: '🗓️', color: '#e8a0c8' },
  { to: '/visitas', label: 'Visitas', icon: '📅', color: '#7ba7f7' },
  { to: '/clientes', label: 'Clientes', icon: '👥', color: '#b792e8' },
  { to: '/proyectos', label: 'Proyectos', icon: '🏗️', color: '#e7c15a' },
  { to: '/usuarios', label: 'Usuarios', icon: '🔐', admin: true, color: '#f08080' },
  { to: '/bitacora', label: 'Bitácora', icon: '📋', admin: true, color: '#9daab6' },
]
const PROYECTO = [
  { to: '/lotes', label: 'Mapa de lotes', icon: '🗺️', color: '#8fd16f' },
  { to: '/ventas', label: 'Ventas', icon: '🏷️', color: '#7bb6e0' },
  { to: '/pagos', label: 'Cuotas', icon: '💵', color: '#4fc3a1' },
  { to: '/gastos', label: 'Gastos', icon: '🧾', color: '#f2785c' },
  { to: '/contratos', label: 'Contratos', icon: '📄', color: '#c9a97f' },
  { to: '/comisiones', label: 'Comisiones', icon: '🪙', color: '#e8b04f' },
]
// Paneles que el superusuario puede habilitar/ocultar por usuario (excluye los solo-superusuario).
export const PANELS = [...GLOBAL, ...PROYECTO].filter(m => !m.admin && m.to !== '/').map(m => ({ to: m.to, label: m.label, icon: m.icon }))

export default function Layout() {
  const { profile, role, logout } = useAuth()
  const { projects, pid, select } = useProject()
  const [open, setOpen] = useState(false)
  const [expandido, setExpandido] = useState(null)   // proyecto con su menu desplegado
  const [conectados, setConectados] = useState([])
  const esAdmin = ['admin', 'superuser'].includes(role)
  // Paneles habilitados por usuario (null = según su rol, sin restricción extra). El superusuario ve todo.
  const panelsUser = Array.isArray(profile?.panels) ? profile.panels : null
  const enPanel = m => role === 'superuser' || m.to === '/' || m.admin || !panelsUser || panelsUser.includes(m.to)

  // el proyecto seleccionado arranca desplegado (asi entras y ya ves sus modulos)
  useEffect(() => { if (pid && pid !== 'general') setExpandido(x => x ?? pid) }, [pid])

  // latido de presencia del usuario actual (cada 45s)
  useEffect(() => {
    if (!profile?.id) return
    const now = () => new Date().toISOString()
    supabase.from('profiles').update({ last_seen: now(), online_since: now() }).eq('id', profile.id).then(() => {}, () => {})
    const t = setInterval(() => { supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', profile.id).then(() => {}, () => {}) }, 45000)
    return () => clearInterval(t)
  }, [profile?.id])

  // lista de conectados (solo admin/superuser), refresca cada 20s
  useEffect(() => {
    if (!esAdmin) return
    const cargar = () => {
      // select('*') a proposito: si se nombra avatar_url y la columna aun no existe
      // (sql/26 sin correr), PostgREST rechaza el query entero y la lista de
      // conectados desaparece. Con '*' simplemente no hay foto y se ven las iniciales.
      supabase.from('profiles').select('*').gte('last_seen', new Date(Date.now() - 130000).toISOString()).order('online_since')
        .then(({ data }) => setConectados(data || []))
    }
    cargar()
    const t = setInterval(cargar, 20000)
    return () => clearInterval(t)
  }, [esAdmin])

  const { pathname } = useLocation()
  const accentMod = [...GLOBAL, ...PROYECTO].find(m => m.to === '/' ? pathname === '/' : pathname.startsWith(m.to))?.color

  const Item = m => (
    <NavLink key={m.to} to={m.to} end={m.end} style={{ '--mi': m.color }}
      className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
      <span>{m.icon}</span> {m.label}
    </NavLink>
  )

  return (
    <div className="shell">
      <button className="menu-toggle" onClick={() => setOpen(!open)}>☰</button>
      <aside className={`sidebar glass ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-badge"><Logo size={34} /></span>
          <span><b>URBIS GROUP</b><br /><small>REAL ESTATE</small></span>
        </div>
        <nav onClick={() => setOpen(false)}>
          <p className="menu-section">General</p>
          {GLOBAL.filter(m => (!m.admin || role === 'superuser') && (!m.staff || ['admin', 'superuser'].includes(role)) && enPanel(m)).map(Item)}
          {/* Cada proyecto asignado, con su color y su propio desplegable de modulos.
              Al abrir uno se selecciona ese proyecto, asi los modulos operan sobre el. */}
          <p className="menu-section">Proyectos{projects.length > 1 && <span className="muted"> ({projects.length})</span>}</p>
          {projects.map((p, i) => {
            const pc = colorProyecto(p, i)
            const abierto = expandido === p.id
            const activo = pid === p.id
            return (
              <div key={p.id} className={`proj-grp ${abierto ? 'open' : ''}`} style={{ '--pc': pc }}>
                <button type="button" className={`proj-head ${activo ? 'on' : ''}`}
                  onClick={e => { e.stopPropagation(); select(p.id); setExpandido(abierto ? null : p.id) }}>
                  <span className="proj-dot" />
                  <span className="proj-name" title={p.name}>{nombreProy(p.name)}</span>
                  <span className={`proj-caret ${abierto ? 'open' : ''}`}>&#9656;</span>
                </button>
                {abierto && (
                  <div className="proj-items">
                    {PROYECTO.filter(m => (!m.roles || m.roles.includes(role)) && enPanel(m)).map(m => (
                      <NavLink key={m.to} to={m.to} style={{ '--mi': m.color }}
                        onClick={() => select(p.id)}
                        className={({ isActive }) => (isActive && activo) ? 'nav-item active' : 'nav-item'}>
                        <span>{m.icon}</span> {m.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
        {esAdmin && conectados.length > 0 && (
          // lista con scroll propio: aunque haya muchos conectados, nunca empuja el pie fuera de vista
          <div style={{ padding: '6px 14px', borderTop: '1px solid rgba(255,255,255,.08)', fontSize: 11, display: 'flex', flexDirection: 'column', maxHeight: '32vh', minHeight: 0 }}>
            <p className="muted" style={{ fontWeight: 700, letterSpacing: '.5px', margin: '0 0 4px', flexShrink: 0 }}>🟢 CONECTADOS ({conectados.length})</p>
            <div style={{ overflowY: 'auto', minHeight: 0 }}>
              {conectados.map(u => (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '3px 0' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                    <Avatar url={u.avatar_url} nombre={u.full_name} size={20} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name || '—'}</span>
                  </span>
                  <span className="muted" style={{ whiteSpace: 'nowrap' }}>{haceCuanto(u.online_since)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="sidebar-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
            <Avatar url={profile?.avatar_url} nombre={profile?.full_name} size={30} title={profile?.full_name} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <p className="muted small" style={{ margin: 0, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={profile?.full_name}>{profile?.full_name}</p>
              <p className="muted" style={{ margin: 0, fontSize: 10, opacity: .75 }}>{role === 'superuser' ? 'SUPERUSUARIO' : role === 'manager' ? 'GERENCIA (solo ver)' : role === 'admin' ? 'ADMINISTRADOR' : 'SECRETARIA'}</p>
            </div>
          </div>
          <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px', marginTop: 5 }} onClick={logout}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="content" style={{ '--accent-mod': accentMod }}>
        <Outlet />
      </main>
      <VolverArriba />
    </div>
  )
}
