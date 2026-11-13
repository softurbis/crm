import { useState } from 'react'
import { Navigate, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'
import { correoDeCelular, soloCelular } from '../lib/celular'

// LA ENTRADA DE LOS VENDEDORES (12 nov 2026): /vendedores. Celular + clave, letras grandes,
// pensada para el teléfono. El celular queda recordado en ESE teléfono (nunca la clave) y la
// sesión no se cierra: a los 30 min sin uso solo pide el PIN (UsoActivo, sql/170).
const LS_CEL = 'urbis.vendedor.cel'
const leer = () => { try { return localStorage.getItem(LS_CEL) || '' } catch { return '' } }

export default function EntrarVendedor() {
  const { session, loading, login } = useAuth()
  const nav = useNavigate()
  const [cel, setCel] = useState(leer())
  const [clave, setClave] = useState('')
  const [ver, setVer] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!loading && session) return <Navigate to="/" replace />

  async function entrar(e) {
    e.preventDefault()
    const c = soloCelular(cel)
    if (!c) { setError('Escribe tu celular: 9 dígitos, empieza con 9.'); return }
    setBusy(true); setError('')
    const { error } = await login(correoDeCelular(c), clave)
    setBusy(false)
    if (error) {
      const m = (error.message || '').toLowerCase()
      setError(m.includes('invalid login') ? 'El celular o la clave no coinciden. Si la olvidaste, pídele una nueva al administrador.'
        : m.includes('fetch') ? 'Sin conexión. Revisa tu internet e intenta otra vez.' : error.message)
      return
    }
    try { localStorage.setItem(LS_CEL, c); localStorage.removeItem('uso_bloqueada') } catch { /* sin memoria */ }
    nav('/')
  }

  return (
    <div className="center-screen">
      <form className="glass login-card entrar-vend" onSubmit={entrar}>
        <div className="login-logo"><Logo size={72} /></div>
        <h1>VENDEDORES</h1>
        <p className="muted" style={{ textTransform: 'none' }}>Entra con tu celular y tu clave</p>
        <label>Tu celular
          <input type="tel" inputMode="numeric" autoComplete="username" placeholder="987 654 321" maxLength={15}
            value={cel} onChange={e => setCel(e.target.value)} required autoFocus={!cel} />
        </label>
        <label>Tu clave
          <span style={{ display: 'flex', gap: 6 }}>
            <input type={ver ? 'text' : 'password'} autoComplete="current-password" style={{ flex: 1, minWidth: 0, textTransform: 'none' }}
              value={clave} onChange={e => setClave(e.target.value)} required autoFocus={!!cel} />
            <button type="button" className="btn-ghost" onClick={() => setVer(v => !v)}>{ver ? 'Ocultar' : 'Ver'}</button>
          </span>
        </label>
        {error && <p className="error" style={{ textTransform: 'none' }}>{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <p className="muted" style={{ fontSize: 12, textTransform: 'none', marginTop: 10 }}>
          ¿Olvidaste tu clave? Pídele una nueva al administrador.<br />
          <Link to="/login" className="muted">Soy de oficina: entrar con correo</Link>
        </p>
      </form>
    </div>
  )
}
