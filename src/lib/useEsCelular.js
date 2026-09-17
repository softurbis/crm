import { useEffect, useState } from 'react'

// ¿La pantalla es de celular? Para cambiar tablas anchas por tarjetas.
// Mismo corte que el CSS de global.css (max-width: 760px).
const CONSULTA = '(max-width: 760px)'

export function useEsCelular() {
  const [es, setEs] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(CONSULTA).matches)
  useEffect(() => {
    if (!window.matchMedia) return
    const m = window.matchMedia(CONSULTA)
    const cambio = () => setEs(m.matches)
    cambio()
    m.addEventListener('change', cambio)
    return () => m.removeEventListener('change', cambio)
  }, [])
  return es
}
