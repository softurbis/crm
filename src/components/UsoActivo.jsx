import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// USO ACTIVO + CIERRE POR INACTIVIDAD (sql/168, 29 oct 2026)
// · Cuenta un minuto (uso_minuto) solo si en ese minuto hubo mouse, teclado,
//   toque o desplazamiento: una PC olvidada con el panel abierto NO suma horas.
// · A los 29 min sin uso avisa "¿sigues ahí?"; a los 30 cierra la sesión
//   (uso_cierre lo anota) y el login dice por qué.
// Las pestañas se coordinan por localStorage: trabajar en una mantiene viva a
// las otras, y el mismo minuto no se cuenta dos veces.
const LIMITE = 30 * 60000
const AVISO = 29 * 60000
const K_ACT = 'uso_ultima_act'    // último movimiento, en cualquier pestaña
const K_MIN = 'uso_min_marca'     // último minuto ya contado
const K_CIERRE = 'uso_cierre_at'  // una sola pestaña anota el cierre

const leer = k => { try { return Number(localStorage.getItem(k)) || 0 } catch { return 0 } }
const poner = (k, v) => { try { localStorage.setItem(k, String(v)) } catch {} }

export default function UsoActivo({ activo }) {
  const ultima = useRef(Date.now())
  const [quedan, setQuedan] = useState(null)   // segundos para el cierre, si ya se avisó

  useEffect(() => {
    if (!activo) return
    ultima.current = Date.now()
    poner(K_ACT, ultima.current)
    let escrito = 0
    const mover = () => {
      const t = Date.now()
      ultima.current = t
      if (t - escrito > 5000) { escrito = t; poner(K_ACT, t) }   // sin escribir en cada pixel
    }
    const evs = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']
    evs.forEach(e => window.addEventListener(e, mover, { passive: true, capture: true }))

    const ultimoUso = () => Math.max(ultima.current, leer(K_ACT))
    const tick = async () => {
      const ahora = Date.now()
      const quieto = ahora - ultimoUso()
      // el minuto se cuenta si hubo uso en el último minuto y ninguna pestaña lo contó
      const min = Math.floor(ahora / 60000)
      if (quieto < 60000 && leer(K_MIN) !== min) {
        poner(K_MIN, min)
        supabase.rpc('uso_minuto').then(() => {}, () => {})
      }
      if (quieto >= LIMITE) {
        if (ahora - leer(K_CIERRE) > 120000) {
          poner(K_CIERRE, ahora)
          await supabase.rpc('uso_cierre').then(() => {}, () => {})
        }
        poner('uso_cerrada', 1)
        // 'local': solo esta computadora; el celular de la misma persona sigue dentro
        await supabase.auth.signOut({ scope: 'local' })
        return
      }
      setQuedan(quieto >= AVISO ? Math.max(0, Math.ceil((LIMITE - quieto) / 1000)) : null)
    }
    const t = setInterval(tick, 1000)
    return () => {
      clearInterval(t)
      evs.forEach(e => window.removeEventListener(e, mover, { capture: true }))
      setQuedan(null)
    }
  }, [activo])

  if (quedan === null) return null
  return (
    <div className="modal-bg" style={{ zIndex: 9999 }}>
      <div className="glass modal" style={{ maxWidth: 420, width: '92%', textAlign: 'center' }}>
        <div className="modal-head"><b>⏳ ¿SIGUES AHÍ?</b></div>
        <p>Llevas 29 minutos sin usar el panel.</p>
        <p>La sesión se cerrará en <b style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{quedan}</b> segundos.</p>
        <button className="btn-primary" onClick={() => setQuedan(null)}>Sigo aquí</button>
      </div>
    </div>
  )
}
