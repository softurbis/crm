import { Link } from 'react-router-dom'
import { TIPO, ESTADO, precioTxt, refDe, tituloDe, lugarDe, datosCortos } from '../lib/propiedades'
import '../styles/propiedades.css'

// Tarjeta de una propiedad de terceros (corretaje): la usan /propiedades, la página de
// cada propiedad ("Otras propiedades") y la portada. Toda la tarjeta lleva a /propiedades/<ref>.
export default function TarjetaPropiedad({ p }) {
  const fotos = p.fotos || []
  const datos = datosCortos(p)
  const lugar = lugarDe(p)
  return (
    <Link to={'/propiedades/' + refDe(p)} className={'pp-card' + (p.estado === 'vendido' ? ' pp-card-vendida' : '')}>
      <div className="pp-card-foto">
        {fotos[0]
          ? <img src={fotos[0]} alt={tituloDe(p)} loading="lazy" decoding="async" />
          : <div className="pp-sinfoto"><IcoCasa /></div>}
        <span className={'pp-estado pp-e-' + (p.estado || 'disponible')}>{ESTADO[p.estado] || 'Disponible'}</span>
        {fotos.length > 1 && <span className="pp-nfotos"><IcoCamara /> {fotos.length}</span>}
      </div>
      <div className="pp-card-txt">
        <small className="pp-card-tipo">{TIPO[p.tipo] || 'Propiedad'}{p.distrito ? ' · ' + lugarDe({ distrito: p.distrito }) : ''}</small>
        <b className="pp-card-precio">{precioTxt(p.precio, p.moneda)}</b>
        <h3>{tituloDe(p)}</h3>
        {lugar && <p className="pp-card-lugar"><IcoPin /> {lugar}</p>}
        {datos.length > 0 && <ul className="pp-card-datos">{datos.map(d => <li key={d}>{d}</li>)}</ul>}
        <span className="pp-card-ver">Ver propiedad <IcoFlecha /></span>
      </div>
    </Link>
  )
}

export const IcoCasa = ({ size = 40 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></svg>
)
const IcoCamara = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" /><circle cx="12" cy="13" r="3.5" /></svg>
)
export const IcoPin = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="10" r="2.5" /></svg>
)
const IcoFlecha = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
