import { NavLink } from 'react-router-dom'
import { useProject } from '../context/ProjectContext'

// Pagos y sus boletas/facturas son UNA pantalla con dos pestañas (1 oct 2026): un
// comprobante siempre es de un pago, y al anularlo es el pago el que queda libre
// para emitirle otro. Antes eran dos entradas del menú. Solo aparece en los
// proyectos que emiten desde el panel (sql/113).
export default function PagosTabs() {
  const { pidOp, projects } = useProject()
  if (!projects.find(p => p.id === pidOp)?.fact_activo) return null
  const clase = ({ isActive }) => 'fl-tab' + (isActive ? ' on' : '')
  return (
    <div className="fl-tabs" role="tablist" style={{ marginBottom: '.8rem' }}>
      <NavLink to="/pagos" className={clase} style={{ textDecoration: 'none' }}>💵 Pagos</NavLink>
      <NavLink to="/comprobantes" className={clase} style={{ textDecoration: 'none' }}>🧾 Boletas y facturas</NavLink>
    </div>
  )
}
