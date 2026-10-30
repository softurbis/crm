import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import Logo from './Logo'
import MiPin from './MiPin'

// USO ACTIVO + CIERRE POR INACTIVIDAD (sql/168, 29 oct 2026)
// · Cuenta un minuto (uso_minuto) solo si en ese minuto hubo mouse, teclado,
//   toque o desplazamiento: una PC olvidada con el panel abierto NO suma horas.
// · A los 29 min sin uso avisa "¿sigues ahí?"; a los 30 (uso_cierre lo anota):
//   - con PIN (sql/170): la pantalla se BLOQUEA (tapada entera) y se abre con el
//     PIN. 5 fallos o 12 h bloqueada → se cierra de verdad.
//   - sin PIN: se cierra la sesión y el login dice por qué.
// Las pestañas se coordinan por localStorage: trabajar en una mantiene viva a
// las otras, el mismo minuto no se cuenta dos veces, y bloquear o desbloquear
// en una lo hace en todas (también sobrevive a recargar la página).
const LIMITE = 30 * 60000
const AVISO = 29 * 60000
const MAX_BLOQUEO = 12 * 3600000
const K_ACT = 'uso_ultima_act'    // último movimiento, en cualquier pestaña
const K_MIN = 'uso_min_marca'     // último minuto ya contado
const K_CIERRE = 'uso_cierre_at'  // una sola pestaña anota el cierre
const K_BLOQ = 'uso_bloqueada'    // desde cuándo está bloqueada (sql/170)
const K_OFRECIDO = 'pin_ofrecido' // el día en que ya se ofreció crear el PIN

const leer = k => { try { return Number(localStorage.getItem(k)) || 0 } catch { return 0 } }
const poner = (k, v) => { try { localStorage.setItem(k, String(v)) } catch {} }
const quitar = k => { try { localStorage.removeItem(k) } catch {} }
const hoyTxt = () => new Date().toISOString().slice(0, 10)

export default function UsoActivo({ activo, nombre, email }) {
  const ultima = useRef(Date.now())
  const tienePin = useRef(false)
  const [quedan, setQuedan] = useState(null)   // segundos para el cierre, si ya se avisó
  const [bloqueada, setBloqueada] = useState(false)
  const [conPin, setConPin] = useState(null)
  const [ofrecer, setOfrecer] = useState(false)

  // ¿tiene PIN? Sin sql/170 la función no existe: se sigue cerrando como antes
  useEffect(() => {
    if (!activo) return
    let vivo = true
    const ver = (primera) => supabase.rpc('pin_tengo').then(({ data, error }) => {
      if (!vivo || error) return
      tienePin.current = !!data
      setConPin(!!data)
      // una vez al día se ofrece crearlo a quien no lo tiene
      if (primera && !data) {
        let dia = ''
        try { dia = localStorage.getItem(K_OFRECIDO) || '' } catch {}
        if (dia !== hoyTxt()) setOfrecer(true)
      }
    })
    ver(true)
    const cambio = () => ver(false)
    window.addEventListener('pin-cambiado', cambio)
    return () => { vivo = false; window.removeEventListener('pin-cambiado', cambio) }
  }, [activo])

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
    let cerrando = false
    const tick = async () => {
      if (cerrando) return
      const ahora = Date.now()
      // bloqueada (en esta pestaña o en otra): no cuenta minutos ni vuelve a cerrar
      const bloq = leer(K_BLOQ)
      if (bloq) {
        setBloqueada(true); setQuedan(null)
        if (ahora - bloq > MAX_BLOQUEO) { cerrando = true; await cerrarSesion('') }
        return
      }
      setBloqueada(false)
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
        if (tienePin.current) { poner(K_BLOQ, ahora); setBloqueada(true); setQuedan(null); return }
        cerrando = true
        await cerrarSesion('')
        return
      }
      setQuedan(quieto >= AVISO ? Math.max(0, Math.ceil((LIMITE - quieto) / 1000)) : null)
    }
    const t = setInterval(tick, 1000)
    tick()
    return () => {
      clearInterval(t)
      evs.forEach(e => window.removeEventListener(e, mover, { capture: true }))
      setQuedan(null)
    }
  }, [activo])

  if (!activo) return null

  if (bloqueada) return (
    <Bloqueo nombre={nombre} onAbierta={() => {
      const t = Date.now()
      ultima.current = t
      poner(K_ACT, t)
      quitar(K_BLOQ)
      setBloqueada(false)
    }} />
  )

  if (quedan !== null) return (
    <div className="modal-bg" style={{ zIndex: 9999 }}>
      <div className="glass modal" style={{ maxWidth: 420, width: '92%', textAlign: 'center' }}>
        <div className="modal-head"><b>⏳ ¿SIGUES AHÍ?</b></div>
        <p>Llevas 29 minutos sin usar el panel.</p>
        <p>La sesión se {conPin ? 'bloqueará' : 'cerrará'} en <b style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{quedan}</b> segundos.</p>
        {conPin && <p className="muted small">Para volver solo necesitarás tu PIN.</p>}
        <button className="btn-primary" onClick={() => setQuedan(null)}>Sigo aquí</button>
      </div>
    </div>
  )

  if (ofrecer) {
    const noAhora = () => { poner(K_OFRECIDO, hoyTxt()); setOfrecer(false) }
    return (
      <div className="modal-bg" style={{ zIndex: 9999 }}>
        <div className="glass modal" style={{ maxWidth: 420, width: '92%' }}>
          <div className="modal-head"><b>🔢 CREA TU PIN</b></div>
          <p className="muted small" style={{ marginTop: 0 }}>
            A los 30 minutos sin usar el panel, la pantalla se bloquea. Con un PIN la abres en un segundo,
            sin volver a escribir tu correo y tu contraseña. Puedes cambiarlo luego en <b>🔑 Mi contraseña</b>.
          </p>
          <MiPin email={email} tienePin={false} onListo={() => { poner(K_OFRECIDO, hoyTxt()); setOfrecer(false) }} onCancelar={noAhora} />
        </div>
      </div>
    )
  }

  return null
}

// cierre de verdad: solo en esta computadora ('local'); el celular de la misma
// persona sigue dentro. motivo 'pin' = 5 PIN errados (el login lo explica).
async function cerrarSesion(motivo) {
  quitar(K_BLOQ)
  poner('uso_cerrada', motivo || 1)
  await supabase.auth.signOut({ scope: 'local' })
}

// la pantalla tapada entera: no se ve nada del panel hasta poner el PIN
function Bloqueo({ nombre, onAbierta }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function abrir(e) {
    e.preventDefault()
    if (!pin) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('pin_verificar', { p_pin: pin })
    setBusy(false); setPin('')
    if (error) { setErr('No se pudo comprobar el PIN. Revisa el internet e intenta otra vez.'); return }
    if (data?.ok) { onAbierta(); return }
    if (data?.bloqueado || data?.sin_pin) { await cerrarSesion(data?.bloqueado ? 'pin' : ''); return }
    setErr(`PIN incorrecto. Te quedan ${data?.quedan} intento${data?.quedan === 1 ? '' : 's'}.`)
  }

  return (
    <div className="center-screen" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'var(--bg)' }}>
      <form className="glass login-card" onSubmit={abrir}>
        <div className="login-logo"><Logo size={60} /></div>
        <h1>🔒 Bloqueado</h1>
        <p className="muted" style={{ margin: 0 }}>
          {nombre ? <><b>{nombre}</b><br /></> : null}
          Pasaron 30 minutos sin usar el panel. Escribe tu PIN para seguir.
        </p>
        <input type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="PIN" style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }} />
        {err && <p className="error" style={{ margin: 0 }}>{err}</p>}
        <button className="btn-primary" disabled={busy || pin.length < 4}>{busy ? 'COMPROBANDO…' : 'DESBLOQUEAR'}</button>
        <button type="button" className="btn-ghost" onClick={() => cerrarSesion('')}>No soy yo / entrar con contraseña</button>
      </form>
    </div>
  )
}
