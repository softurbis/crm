import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'

// Usuarios que ya entraron en ESTE navegador (solo el correo, nunca la clave).
// En la oficina se comparte la PC: elegir tu correo de una lista ahorra
// teclearlo cada vez y evita los "no entro" que eran un correo mal escrito.
const LS_USUARIOS = 'urbis.usuarios'
const usuariosRecordados = () => {
  try { const v = JSON.parse(localStorage.getItem(LS_USUARIOS) || '[]'); return Array.isArray(v) ? v : [] }
  catch { return [] }
}
const recordarUsuario = email => {
  try {
    const lista = [email, ...usuariosRecordados().filter(u => u !== email)].slice(0, 6)
    localStorage.setItem(LS_USUARIOS, JSON.stringify(lista))
  } catch { /* modo incognito: sin memoria y sin drama */ }
}
const olvidarUsuario = email => {
  try { localStorage.setItem(LS_USUARIOS, JSON.stringify(usuariosRecordados().filter(u => u !== email))) }
  catch { /* idem */ }
}

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [busy, setBusy] = useState(false)
  const [recordados, setRecordados] = useState(usuariosRecordados())

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true); setError(''); setAviso('')
    const { error } = await login(email.trim().toLowerCase(), password)
    setBusy(false)
    if (error) {
      const m = (error.message || '').toLowerCase()
      if (m.includes('invalid login')) setError('Correo o contraseña incorrectos')
      else if (m.includes('not confirmed')) setError('CORREO SIN CONFIRMAR: pide al administrador confirmar tu correo en Supabase')
      else if (m.includes('disabled') || m.includes('banned')) setError('USUARIO DESACTIVADO')
      else setError(error.message)
    } else {
      recordarUsuario(email.trim().toLowerCase())
      nav('/')
    }
  }

  // "Olvidé mi contraseña": este servidor NO puede mandar correos (DigitalOcean
  // bloquea los puertos de correo). La repone el administrador desde Usuarios
  // (sql/83), se la dicta, y cada quien la cambia después desde su menú.
  function olvide() {
    setError('')
    setAviso('Pídele al administrador que te ponga una contraseña nueva desde Usuarios. Te la dicta y la cambias tú apenas entres.')
  }

  return (
    <div className="center-screen">
      <form className="glass login-card" onSubmit={onSubmit}>
        <div className="login-logo"><Logo size={72} /></div>
        <h1>URBIS <span className="accent">CONTROL</span></h1>
        <p className="muted">Sistema de gestión inmobiliaria</p>
        {recordados.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 4 }}>
            {recordados.map(u => (
              <span key={u} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button type="button" className="chip" style={{ textTransform: 'none' }}
                  onClick={() => { setEmail(u); setError(''); setAviso('') }}
                  title="Usar este correo">{u}</button>
                <button type="button" className="link-btn muted" title="Quitar de la lista"
                  onClick={() => { olvidarUsuario(u); setRecordados(usuariosRecordados()) }}>✕</button>
              </span>
            ))}
          </div>
        )}
        <label>Correo
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            autoComplete="username" required autoFocus style={{ textTransform: 'none' }} />
        </label>
        <label>Contraseña
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        {aviso && <p className="ok" style={{ textTransform: 'none' }}>{aviso}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        <button type="button" className="link-btn muted" style={{ marginTop: 8 }} disabled={busy}
          onClick={olvide}>¿Olvidaste tu contraseña?</button>
      </form>
    </div>
  )
}
