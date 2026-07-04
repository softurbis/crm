import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const MENU = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/leads', label: 'Leads', icon: '🎯' },
  { to: '/visitas', label: 'Visitas', icon: '📅' },
  { to: '/proyectos', label: 'Proyectos', icon: '🏗️' },
  { to: '/lotes', label: 'Mapa de lotes', icon: '🗺️' },
  { to: '/clientes', label: 'Clientes', icon: '👥' },
  { to: '/pagos', label: 'Cuotas', icon: '💵' },
  { to: '/contratos', label: 'Contratos', icon: '📄' },
  { to: '/gastos', label: 'Gastos', icon: '🧾' },
  { to: '/usuarios', label: 'Usuarios', icon: '🔐', admin: true },
  { to: '/bitacora', label: 'Bitácora', icon: '📋', admin: true },
]

export default function Layout() {
  const { profile, role, logout } = useAuth()
  const [open, setOpen] = useState(false)

  return (
    <div className="shell">
      <button className="menu-toggle" onClick={() => setOpen(!open)}>☰</button>
      <aside className={`sidebar glass ${open ? 'open' : ''}`}>
        <h2>URBIS <span className="accent">CONTROL</span></h2>
        <nav onClick={() => setOpen(false)}>
          {MENU.filter(m => !m.admin || role === 'admin').map(m => (
            <NavLink key={m.to} to={m.to} end={m.end}
              className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}>
              <span>{m.icon}</span> {m.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <p className="muted">{profile?.full_name}</p>
          <p className="muted small">{role}</p>
          <button className="btn-ghost" onClick={logout}>Cerrar sesión</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
