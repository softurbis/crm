import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useMsg } from '../lib/saveFx'

export default function Reset() {
  const [listo, setListo] = useState(false)
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useMsg(null)
  const [ok, setOk] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) setListo(true) })
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
      </div>
    </div>
  )
}
