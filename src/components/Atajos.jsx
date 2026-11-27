import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// ATAJOS DE TECLADO (26 nov 2026, fase 3). Funcionan cuando NO se está escribiendo:
//   ?          esta ayuda
//   Ctrl+K, /  el buscador general (components/BuscadorGeneral.jsx)
//   Alt+1…7    las pantallas de "En este proyecto", en el orden del menú
//   N          nuevo: en Gastos abre "Solicitar gasto" (la pantalla escucha 'urbis-nuevo')
//   Esc        cierra la ficha o el visor que esté encima. SOLO las ventanas para mirar:
//              una ventana con campos para llenar no se cierra, para no perder lo escrito.
const escribiendo = () => {
  const el = document.activeElement
  return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))
}

// la ventana emergente de más arriba, si es solo para mirar, se cierra con su ✕ / Cerrar
function cerrarVentanaDeArriba() {
  const ventanas = [...document.querySelectorAll('.modal-bg')]
  const arriba = ventanas[ventanas.length - 1]
  if (!arriba) return false
  const campos = [...arriba.querySelectorAll('input, textarea, select')].filter(c => !c.disabled && c.type !== 'hidden' && c.offsetParent !== null)
  if (campos.length) return false
  const boton = [...arriba.querySelectorAll('button')].find(b => {
    const t = (b.textContent || '').trim().toLowerCase()
    return t === '✕' || t === 'x' || t === 'cerrar' || /cerrar/i.test(b.getAttribute('aria-label') || '') || /^cerrar$/i.test(b.title || '')
  })
  if (!boton) return false
  boton.click()
  return true
}

export default function Atajos({ pantallasProyecto = [] }) {
  const nav = useNavigate()
  const [ayuda, setAyuda] = useState(false)

  useEffect(() => {
    const tecla = e => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        if (ayuda) { setAyuda(false); return }
        if (!escribiendo() && cerrarVentanaDeArriba()) e.preventDefault()
        return
      }
      if (escribiendo() || e.ctrlKey || e.metaKey) return
      // Alt+1…7: e.code (no e.key) para que funcione igual con cualquier teclado
      if (e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const p = pantallasProyecto[Number(e.code.slice(5)) - 1]
        if (p) { e.preventDefault(); nav(p.to) }
        return
      }
      if (e.altKey) return
      if (e.key === '?') { e.preventDefault(); setAyuda(a => !a); return }
      if (e.key === 'n' || e.key === 'N') {
        // si ninguna pantalla lo atiende, no pasa nada
        window.dispatchEvent(new Event('urbis-nuevo'))
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [ayuda, pantallasProyecto, nav])

  if (!ayuda) return null
  const fila = (teclas, que) => (
    <div className="at-fila" key={que}>
      <span className="at-teclas">{teclas.map((t, i) => <kbd key={i}>{t}</kbd>)}</span>
      <span>{que}</span>
    </div>
  )
  return (
    <div className="bus-fondo" onMouseDown={e => { if (e.target === e.currentTarget) setAyuda(false) }}>
      <div className="bus-caja at-caja" role="dialog" aria-label="Atajos de teclado">
        <div className="at-cab"><b>⌨ Atajos de teclado</b><button type="button" onClick={() => setAyuda(false)} aria-label="Cerrar">✕</button></div>
        <div className="at-cuerpo">
          <p className="at-sec">En cualquier pantalla</p>
          {fila(['Ctrl', 'K'], 'Buscar un lote, cliente, DNI, gasto o pantalla')}
          {fila(['/'], 'También abre el buscador')}
          {fila(['Esc'], 'Cerrar la ficha o el visor abierto')}
          {fila(['?'], 'Ver esta ayuda')}
          {pantallasProyecto.length > 0 && <>
            <p className="at-sec">Ir a una pantalla del proyecto</p>
            {pantallasProyecto.slice(0, 9).map((p, i) => fila(['Alt', String(i + 1)], p.label))}
          </>}
          <p className="at-sec">En Gastos</p>
          {fila(['N'], 'Nuevo gasto')}
          <p className="at-nota">Los atajos no se activan mientras escribes en un campo.</p>
        </div>
      </div>
    </div>
  )
}
