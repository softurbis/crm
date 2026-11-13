import { NavLink } from 'react-router-dom'
import '../styles/vendedores.css'

// LA BARRA DEL VENDEDOR EN EL CELULAR (12 nov 2026): sus tres pantallas siempre a un toque,
// abajo, como en cualquier app. "Mi cuenta" abre el menú de siempre (clave, PIN, instalar,
// cerrar sesión). En computadora no se dibuja: ahí sigue el menú del costado.
export default function BarraVendedor({ pendientes, onCuenta }) {
  const Tab = (to, icono, texto, badge) => (
    <NavLink to={to} className={({ isActive }) => 'vend-tab' + (isActive ? ' on' : '')}>
      <span className="vend-tab-ico">{icono}{badge > 0 && <i className="vend-tab-badge">{badge > 99 ? '99+' : badge}</i>}</span>
      {texto}
    </NavLink>
  )
  return (
    <nav className="vend-barra">
      {Tab('/prospectos', '🎯', 'Prospectos', pendientes)}
      {Tab('/whatsapp', '💬', 'Chats')}
      {Tab('/vendedor', '🏷️', 'Lotes')}
      <button type="button" className="vend-tab" onClick={onCuenta}><span className="vend-tab-ico">👤</span>Mi cuenta</button>
    </nav>
  )
}
