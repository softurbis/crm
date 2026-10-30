import { useState } from 'react'
import { supabase } from '../lib/supabase'

// CREAR / CAMBIAR EL PIN DE DESBLOQUEO (sql/170, 29 oct 2026)
// Pide la contraseña: quien encuentre la PC abierta no puede ponerle un PIN
// suyo a la cuenta de otro. La contraseña se comprueba como al firmar gastos
// (un inicio de sesión nuevo con la MISMA cuenta).
export default function MiPin({ email, tienePin, onListo, onCancelar }) {
  const [pass, setPass] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const soloNum = v => v.replace(/\D/g, '').slice(0, 6)

  async function guardar(e) {
    e.preventDefault()
    setErr('')
    if (!/^\d{4,6}$/.test(pin)) { setErr('El PIN debe tener de 4 a 6 números.'); return }
    if (pin !== pin2) { setErr('Los dos PIN no son iguales.'); return }
    setBusy(true)
    const { error: e1 } = await supabase.auth.signInWithPassword({ email, password: pass })
    if (e1) { setBusy(false); setErr('Contraseña incorrecta.'); return }
    const { error } = await supabase.rpc('pin_definir', { p_pin: pin })
    setBusy(false)
    if (error) { setErr(error.message); return }
    window.dispatchEvent(new Event('pin-cambiado'))
    onListo?.()
  }

  async function quitar() {
    setBusy(true)
    await supabase.rpc('pin_borrar').then(() => {}, () => {})
    setBusy(false)
    window.dispatchEvent(new Event('pin-cambiado'))
    onListo?.(true)
  }

  return (
    <form onSubmit={guardar} style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
      <label>Tu contraseña actual
        <input type="password" value={pass} onChange={e => setPass(e.target.value)} required
          autoComplete="current-password" style={{ textTransform: 'none' }} />
      </label>
      <label>{tienePin ? 'PIN nuevo' : 'PIN'} (4 a 6 números)
        <input type="password" inputMode="numeric" autoComplete="off" value={pin}
          onChange={e => setPin(soloNum(e.target.value))} required />
      </label>
      <label>Repite el PIN
        <input type="password" inputMode="numeric" autoComplete="off" value={pin2}
          onChange={e => setPin2(soloNum(e.target.value))} required />
      </label>
      {err && <p className="error" style={{ margin: 0 }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn-primary" disabled={busy}>{busy ? 'GUARDANDO…' : 'GUARDAR PIN'}</button>
        {onCancelar && <button type="button" className="btn-ghost" onClick={onCancelar} disabled={busy}>Ahora no</button>}
        {tienePin && <button type="button" className="btn-ghost" onClick={quitar} disabled={busy}>Quitar mi PIN</button>}
      </div>
    </form>
  )
}
