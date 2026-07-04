import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useProject } from '../context/ProjectContext'
import Logo from './Logo'

const GLOBAL = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/leads', label: 'Leads', icon: '🎯' },
  { to: '/visitas', label: 'Visitas', icon: '📅' },
  { to: '/clientes', label: 'Clientes', icon: '👥' },
  { to: '/proyectos', label: 'Proyectos', icon: '🏗️' },
  { to: '/usuarios', label: 'Usuarios', icon: '🔐', admin: true },
  { to: '/bitacora', label: 'Bitácora', icon: '📋', admin: true },
]
const PROYECTO = [
  { to: '/lotes', label: 'Mapa de lotes', icon: '🗺️' },
  { to: '/pagos', label: 'Cuotas', icon: '💵' },
  { to: '/gastos', label: 'Gastos', icon: '🧾' },
  { to: '/contratos', label: 'Contratos', icon: '📄' },
]

export default function Layout() {
  const { profile, role, logout } = useAuth()
  const { current, projects } = useProject()
  const [open, setOpen] = useState(false)

  const Item = m => (
    <NavLink key={m.to} to={m.to} end={m.end}
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
          {GLOBAL.filter(m => !m.admin || role === 'superuser').map(Item)}
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
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
