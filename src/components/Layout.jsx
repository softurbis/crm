import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import Logo from './Logo'

const GLOBAL = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true, color: '#56c7d6' },
  { to: '/leads', label: 'Leads', icon: '🎯', color: '#f5a25d' },
  { to: '/whatsapp', label: 'WhatsApp Bot', icon: '🤖', staff: true, color: '#58c482' },
  { to: '/secretarias', label: 'Secretarias', icon: '🗓️', color: '#e8a0c8' },
  { to: '/visitas', label: 'Visitas', icon: '📅', color: '#7ba7f7' },
  { to: '/clientes', label: 'Clientes', icon: '👥', color: '#b792e8' },
  { to: '/proyectos', label: 'Proyectos', icon: '🏗️', color: '#e7c15a' },
  { to: '/usuarios', label: 'Usuarios', icon: '🔐', admin: true, color: '#f08080' },
  { to: '/bitacora', label: 'Bitácora', icon: '📋', admin: true, color: '#9daab6' },
]
const PROYECTO = [
  { to: '/lotes', label: 'Mapa de lotes', icon: '🗺️', color: '#8fd16f' },
  { to: '/pagos', label: 'Cuotas', icon: '💵', color: '#4fc3a1' },
  { to: '/gastos', label: 'Gastos', icon: '🧾', color: '#f2785c' },
  { to: '/contratos', label: 'Contratos', icon: '📄', color: '#c9a97f' },
]

export default function Layout() {
  const { profile, role, logout } = useAuth()
  const { current, projects } = useProject()
  const [open, setOpen] = useState(false)

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
          {GLOBAL.filter(m => (!m.admin || role === 'superuser') && (!m.staff || ['admin', 'superuser'].includes(role))).map(Item)}
          <p className="menu-section">
            Proyecto{projects.length > 0 && <>: <span className="accent">{current ? current.name : projects[0]?.name}</span></>}
          </p>
          {PROYECTO.map(Item)}
        </nav>
        <div className="sidebar-footer">
          <p className="muted">{profile?.full_name}</p>
          <p className="muted small">{role === 'superuser' ? 'SUPERUSUARIO' : role === 'manager' ? 'GERENCIA (solo ver)' : role === 'admin' ? 'ADMINISTRADOR' : 'SECRETARIA'}</p>
          <button className="btn-ghost" onClick={logout}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="content" style={{ '--accent-mod': accentMod }}>
        <Outlet />
      </main>
    </div>
  )
}
