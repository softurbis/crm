import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await login(email, password)
    setBusy(false)
    if (error) setError('Credenciales incorrectas')
    else nav('/')
  }

  return (
    <div className="center-screen">
      <form className="glass login-card" onSubmit={onSubmit}>
        <h1>URBIS <span className="accent">CONTROL</span></h1>
        <p className="muted">Sistema de gestión inmobiliaria</p>
        <label>Correo
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>Contraseña
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn-primary" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </div>
  )
}
