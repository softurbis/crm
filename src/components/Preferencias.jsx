import { useState } from 'react'
import '../styles/preferencias.css'

// PREFERENCIAS DE CADA PERSONA (26 nov 2026, fase 5). Dos botoncitos al pie del menú:
//   Aa   → texto tal como se escribió, sin las MAYÚSCULAS forzadas de todo el panel
//   ☀/🌙 → contenido claro u oscuro (el menú izquierdo sigue oscuro: es la marca)
// Se guarda en esta computadora (localStorage) y se pone como clase en <html>; main.jsx la
// pone antes de dibujar para que no parpadee. Por defecto, todo queda como siempre.
const PREFS = { mayus: 'urbis.pref.mayus', tema: 'urbis.pref.tema' }
export function aplicarPreferencias() {
  try {
    const h = document.documentElement
    h.classList.toggle('sin-mayus', localStorage.getItem(PREFS.mayus) === '0')
    h.classList.toggle('tema-claro', localStorage.getItem(PREFS.tema) === 'claro')
  } catch { /* sin memoria: como siempre */ }
}

export default function Preferencias() {
  const leer = () => {
    try { return { mayus: localStorage.getItem(PREFS.mayus) !== '0', claro: localStorage.getItem(PREFS.tema) === 'claro' } }
    catch { return { mayus: true, claro: false } }
  }
  const [p, setP] = useState(leer)
  const guardar = nuevo => {
    try {
      localStorage.setItem(PREFS.mayus, nuevo.mayus ? '1' : '0')
      localStorage.setItem(PREFS.tema, nuevo.claro ? 'claro' : 'oscuro')
    } catch { /* sin memoria */ }
    setP(nuevo)
    aplicarPreferencias()
  }
  return (
    <span className="pref-botones">
      <button type="button" className={'btn-ghost pref-btn' + (p.mayus ? '' : ' on')} onClick={() => guardar({ ...p, mayus: !p.mayus })}
        title={p.mayus ? 'Ver el texto sin MAYÚSCULAS forzadas' : 'Volver a ver todo en MAYÚSCULAS'}>Aa</button>
      <button type="button" className={'btn-ghost pref-btn' + (p.claro ? ' on' : '')} onClick={() => guardar({ ...p, claro: !p.claro })}
        title={p.claro ? 'Volver al tema oscuro' : 'Usar el tema claro'}>{p.claro ? '🌙' : '☀️'}</button>
    </span>
  )
}
