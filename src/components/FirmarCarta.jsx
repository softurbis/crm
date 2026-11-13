import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const mmss = s => String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0')

// ============================================================
// LA SOCIA FIRMA UNA CARTA DE COBRANZA (sql/155)
// ------------------------------------------------------------
// Igual que firmar un gasto (AprobarGasto): su firma registrada + su contraseña
// escrita AHORA + un código de 6 dígitos que le llega al celular (lo manda el
// agente por Telegram, o WhatsApp si no lo tiene vinculado). Firmada, el texto
// de la carta ya no se puede cambiar.
// ============================================================
export default function FirmarCarta({ c, profile, onHecho }) {
  const [pass, setPass] = useState('')
  const [codigo, setCodigo] = useState('')
  const [envio, setEnvio] = useState(null)       // { destino } cuando el código ya salió
  const [quedan, setQuedan] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const firmaUrl = profile?.signature_url

  useEffect(() => {
    if (!quedan) return
    const t = setInterval(() => setQuedan(s => (s <= 1 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [quedan])

  async function pedirCodigo(e) {
    e?.preventDefault?.()
    if (!pass) { setErr('Escribe tu contraseña para firmar.'); return }
    setBusy(true); setErr('')
    const { error: e1 } = await supabase.auth.signInWithPassword({ email: profile?.email, password: pass })
    if (e1) { setBusy(false); setErr('Contraseña incorrecta.'); return }
    const { data, error } = await supabase.rpc('carta_pedir_codigo', { p_id: c.id })
    setBusy(false); setPass('')
    if (error) { setErr(error.message); return }
    setEnvio(data || {}); setQuedan((data?.minutos || 5) * 60); setCodigo('')
  }

  async function firmar(e) {
    e.preventDefault()
    if (codigo.replace(/\D/g, '').length !== 6) { setErr('El código son 6 dígitos.'); return }
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('carta_firmar', { p_id: c.id, p_codigo: codigo.replace(/\D/g, '') })
    setBusy(false)
    if (error) { setErr(error.message); setCodigo(''); return }
    onHecho?.('✅ CARTA N° ' + c.numero + ' FIRMADA · código ' + (data?.codigo || '') + '. Ya la pueden imprimir y entregar.')
  }

  async function reenviar() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('carta_pedir_codigo', { p_id: c.id })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setEnvio(data || {}); setQuedan((data?.minutos || 5) * 60); setCodigo('')
  }

  return (
    <form onSubmit={envio ? firmar : pedirCodigo} className="glass" style={{ padding: 12, marginTop: 12, borderLeft: '4px solid #e0b23f' }}>
      <b>✍ Firmar la carta</b>
      {firmaUrl
        ? (
          <div style={{ textAlign: 'center', margin: '6px 0' }}>
            <img src={firmaUrl} alt="Tu firma registrada" style={{ height: 60, background: '#fff', borderRadius: 6, padding: 4 }} />
            <div className="muted small">Tu firma registrada · {profile?.full_name}</div>
          </div>
        )
        : <p className="warn" style={{ textTransform: 'none' }}>Todavía no registraste tu firma. Regístrala en <b>Gastos</b> (la misma firma sirve para las dos cosas) y vuelve aquí.</p>}

      {!envio ? (
        <label>Tu contraseña, para confirmar que eres tú
          <input type="password" autoComplete="current-password" value={pass}
            onChange={e => setPass(e.target.value)} style={{ textTransform: 'none' }} />
        </label>
      ) : (
        <div>
          <p className="ok small" style={{ textTransform: 'none' }}>
            📲 Te mandamos un código al celular {envio.destino ? <b>{envio.destino}</b> : ''}. Escríbelo aquí:
          </p>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={codigo} autoFocus
            onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))} placeholder="000000"
            style={{ fontSize: 30, letterSpacing: 8, textAlign: 'center', width: '100%', fontVariantNumeric: 'tabular-nums' }} />
          <p className="muted small" style={{ textTransform: 'none', marginTop: 4 }}>
            {quedan > 0 ? <>Vence en <b>{mmss(quedan)}</b>.</> : <b>El código venció.</b>}{' '}
            <button type="button" className="link-btn" disabled={busy || quedan > 240} onClick={reenviar}>Reenviar</button>
          </p>
        </div>
      )}
      {err && <p className="error" style={{ textTransform: 'none' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn-primary" disabled={busy || !firmaUrl}>
          {busy ? (envio ? 'Firmando…' : 'Enviando el código…') : envio ? '✍ Confirmar y firmar' : 'Continuar'}
        </button>
        {envio && <button type="button" className="btn-ghost" disabled={busy} onClick={() => { setEnvio(null); setErr(''); setCodigo('') }}>Volver</button>}
      </div>
      <p className="muted small" style={{ textTransform: 'none', marginTop: 8 }}>
        Revisa el texto de arriba antes de firmar: firmada, la carta ya no se puede cambiar. Queda registrado quién firmó, cuándo y una huella del texto.
      </p>
    </form>
  )
}
