import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMsg } from '../lib/saveFx'
import MiPin from '../components/MiPin'

export default function Reset() {
  const [listo, setListo] = useState(false)
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useMsg(null)
  const [ok, setOk] = useState(false)
  // PIN de desbloqueo (sql/170): null = aún no se sabe / base sin sql/170
  const [email, setEmail] = useState('')
  const [tienePin, setTienePin] = useState(null)
  const [pinMsg, setPinMsg] = useMsg(null)

  const verPin = () => supabase.rpc('pin_tengo').then(({ data, error }) => setTienePin(error ? null : !!data))

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return
      setListo(true); setEmail(data.session.user?.email || ''); verPin()
    })
    const { data: sub } = supabase.auth.onAuthStateChange((ev) => {
      if (ev === 'PASSWORD_RECOVERY' || ev === 'SIGNED_IN') setListo(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const guardar = async e => {
    e.preventDefault()
    if (pass.length < 8) { setMsg('Mínimo 8 caracteres.'); return }
    const { error } = await supabase.auth.updateUser({ password: pass })
    if (error) setMsg('ERROR: ' + error.message)
    else { setOk(true); setMsg('✅ Contraseña actualizada. Ya puedes entrar al sistema.') }
  }

  return (
    <div className="center-screen">
      <div className="glass login-card">
        <h1>Mi contraseña</h1>
        {!listo && <p className="muted">Primero entra al sistema con tu contraseña actual y vuelve a abrir esta página desde <b>🔑 Mi contraseña</b>, abajo en el menú.</p>}
        {listo && !ok && (
          <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label>Nueva contraseña
              <input type="password" value={pass} onChange={e => setPass(e.target.value)} minLength={6} required style={{ textTransform: 'none' }} />
            </label>
            <button className="btn-primary">GUARDAR</button>
          </form>
        )}
        {msg && <p className={ok ? 'ok' : 'error'}>{msg}</p>}
        {ok && <a className="btn-link btn-primary" href={import.meta.env.BASE_URL}>IR AL SISTEMA</a>}
        {listo && tienePin !== null && (
          <div style={{ borderTop: '1px solid rgba(127,148,118,.25)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, textAlign: 'center' }}>🔢 Mi PIN</h2>
            <p className="muted small" style={{ margin: 0 }}>
              {tienePin
                ? 'Ya tienes PIN. A los 30 minutos sin uso la pantalla se bloquea y la abres con él. Aquí puedes cambiarlo o quitarlo.'
                : 'A los 30 minutos sin uso el panel te saca. Con un PIN, en vez de sacarte se bloquea, y lo abres en un segundo.'}
            </p>
            <MiPin key={String(tienePin)} email={email} tienePin={tienePin}
              onListo={quitado => { verPin(); setPinMsg(quitado ? 'PIN quitado.' : '✅ PIN guardado.') }} />
            {pinMsg && <p className="ok" style={{ margin: 0 }}>{pinMsg}</p>}
          </div>
        )}
        {listo && !ok && <a className="btn-link btn-ghost" href={import.meta.env.BASE_URL}>VOLVER AL SISTEMA</a>}
      </div>
    </div>
  )
}
