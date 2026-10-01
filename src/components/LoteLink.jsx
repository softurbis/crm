import { Link } from 'react-router-dom'

// El lote como enlace a su ficha, que es donde se cobra, se ven las cuotas y el
// contrato. Las listas viejas (Ventas, Cuotas, Contratos, Comisiones, Clientes)
// mostraban "G-12" como texto y no había cómo llegar a la ficha desde ahí.
// Con el id va directo; las listas que solo traen manzana y lote pasan por el mapa,
// que abre la ficha de ese lote del proyecto elegido (Lots.jsx, ?lote=G-12).
export default function LoteLink({ lot, children }) {
  if (!lot?.mz) return children || '-'
  const to = lot.id ? `/lotes/${lot.id}` : `/lotes?lote=${encodeURIComponent(lot.mz + '-' + lot.lt)}`
  return <Link className="lote-chip" to={to} title="Abrir la ficha del lote">{children || `${lot.mz}-${lot.lt}`}</Link>
}
