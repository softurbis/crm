import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { onSaveFx } from '../lib/saveFx'
import { useAuth } from '../context/AuthContext'

// Capa que dibuja el aviso de "guardado" sobre el punto del último clic.
// Montada una sola vez (en Layout), escucha savedFx() de toda la app.
// La cara loca solo se usa en sesión de superusuario; el resto ve el ✓.
export default function SaveFx() {
  const { role } = useAuth()
  const [items, setItems] = useState([])

  useEffect(() => onSaveFx(({ x, y, face }) => {
    const id = Date.now() + Math.random()
    const useFace = !!face && role === 'superuser'
    setItems(a => [...a, { id, x, y, face: useFace ? face : '' }])
    // se limpia solo cuando la animación termina
    setTimeout(() => setItems(a => a.filter(i => i.id !== id)), 1300)
  }), [role])

  if (!items.length) return null
  return createPortal(
    <div className="savefx-layer" aria-hidden="true">
      {items.map(i => (
        <span key={i.id} className={`savefx ${i.face ? 'savefx-face' : 'savefx-check'}`}
          style={{ left: i.x, top: i.y }}>
          {i.face
            ? <img src={i.face} alt="" draggable="false" />
            : <svg viewBox="0 0 24 24" width="26" height="26"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
      ))}
    </div>,
    document.body,
  )
}
