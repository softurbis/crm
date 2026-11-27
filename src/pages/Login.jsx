import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import { aCorreo, mostrarUsuario } from '../lib/celular'
import '../styles/login.css'

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

// ---- íconos (trazo simple, toman el color del texto) ----
const Ico = ({ children }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
)
const IcoUsuario = () => <Ico><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.6 3.6-6 8-6s8 2.4 8 6" /></Ico>
const IcoCandado = () => <Ico><rect x="5" y="11" width="14" height="10" rx="2.5" /><path d="M8 11V7.5a4 4 0 0 1 8 0V11" /></Ico>
const IcoOjo = () => <Ico><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Ico>
const IcoOjoNo = () => <Ico><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" /></Ico>
const IcoFlecha = () => <Ico><path d="M5 12h14M13 6l6 6-6 6" /></Ico>
const IcoAlerta = () => <Ico><circle cx="12" cy="12" r="9.5" /><path d="M12 7.5v5.5M12 16.5v.01" /></Ico>
const IcoInfo = () => <Ico><circle cx="12" cy="12" r="9.5" /><path d="M12 11v5.5M12 7.5v.01" /></Ico>
const IcoEscudo = () => <Ico><path d="M12 3l7.5 3v5.5c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V6z" /><path d="M9 12l2 2 4-4" /></Ico>
const IcoPlano = () => <Ico><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 12h18M9 4v16M15 4v16" /></Ico>
const IcoCalendario = () => <Ico><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M8 14h3" /></Ico>
const IcoFirma = () => <Ico><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Ico>
const IcoRecibo = () => <Ico><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></Ico>

// ---- el plano de lotes del fondo: manzanas repetidas y algunos lotes "vendidos" ----
// [manzana x, manzana y, lote, fila, brillo]
const VENDIDOS = [[1, 1, 2, 0, ''], [1, 1, 3, 0, 'b'], [2, 2, 5, 1, ''], [3, 1, 1, 1, 'c'], [2, 4, 6, 0, ''], [3, 3, 2, 0, 'b'],
  [1, 5, 4, 1, ''], [4, 2, 0, 0, ''], [4, 4, 3, 1, 'c'], [2, 6, 1, 0, ''], [0, 3, 6, 1, ''], [3, 6, 5, 0, 'b'], [4, 5, 7, 1, ''], [0, 1, 4, 0, 'c']]
function PlanoLotes() {
  return (
    <svg className="lg-plano" viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="lg-manzana" width="160" height="100" patternUnits="userSpaceOnUse">
          <rect x="12" y="12" width="136" height="76" rx="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M12 50h136M29 12v76M46 12v76M63 12v76M80 12v76M97 12v76M114 12v76M131 12v76" stroke="currentColor" strokeWidth=".7" />
        </pattern>
        <radialGradient id="lg-desvanece" cx="62%" cy="42%" r="68%">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset=".75" stopColor="#fff" stopOpacity=".35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="lg-mascara"><rect width="800" height="800" fill="url(#lg-desvanece)" /></mask>
      </defs>
      <g mask="url(#lg-mascara)">
        <g transform="rotate(-14 400 400)">
          <rect x="-400" y="-400" width="1600" height="1600" fill="url(#lg-manzana)" />
          {VENDIDOS.map(([mx, my, c, r, b], i) => (
            <rect key={i} className={'lg-vendido ' + b} x={mx * 160 + 12 + c * 17 + 1.5} y={my * 100 + 12 + r * 38 + 1.5} width="14" height="35" rx="1.5" />
          ))}
        </g>
      </g>
    </svg>
  )
}

const Marca = () => <b>URBIS <span>CONTROL</span></b>
const inicial = u => (String(mostrarUsuario(u) || '?').match(/[a-z0-9]/i)?.[0] || '?').toUpperCase()

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [mayus, setMayus] = useState(false)
  const [error, setError] = useState('')
  // si la sesión se cerró por 30 min sin uso o por 5 PIN errados (UsoActivo.jsx), se dice por qué
  const [aviso, setAviso] = useState(() => {
    try {
      const m = localStorage.getItem('uso_cerrada')
      if (!m) return ''
      localStorage.removeItem('uso_cerrada')
      if (m === 'pin') return 'Se escribió mal el PIN 5 veces y la sesión se cerró. Entra con tu contraseña.'
      return 'Tu sesión se cerró porque pasaron 30 minutos sin usar el panel. Vuelve a ingresar. Consejo: crea un PIN en 🔑 Mi contraseña y la próxima vez solo lo escribes.'
    } catch { return '' }
  })
  const [busy, setBusy] = useState(false)
  const [recordados, setRecordados] = useState(usuariosRecordados())

  async function onSubmit(e) {
    e.preventDefault()
    setBusy(true); setError(''); setAviso('')
    // los vendedores entran con su celular (lib/celular.js); el resto, con su correo
    const usuario = aCorreo(email)
    const { error } = await login(usuario, password)
    setBusy(false)
    if (error) {
      const m = (error.message || '').toLowerCase()
      if (m.includes('invalid login')) setError('Correo, celular o contraseña incorrectos')
      else if (m.includes('not confirmed')) setError('CORREO SIN CONFIRMAR: pide al administrador confirmar tu correo en Supabase')
      else if (m.includes('disabled') || m.includes('banned')) setError('USUARIO DESACTIVADO')
      else if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed'))
        setError('No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.')
      else setError(error.message)
    } else {
      // entrar con contraseña quita cualquier bloqueo de PIN que quedara en esta PC
      try { localStorage.removeItem('uso_bloqueada') } catch {}
      recordarUsuario(usuario)
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

  // aviso de Bloq Mayús: la causa más común de "mi contraseña no entra"
  const mirarMayus = e => setMayus(!!e.getModifierState?.('CapsLock'))

  return (
    <div className="lg">
      <aside className="lg-hero">
        <PlanoLotes />
        <div className="lg-hero-top">
          <span className="lg-azulejo"><Logo size={40} /></span>
          <Marca />
        </div>
        <div className="lg-hero-txt">
          <div className="lg-kicker"><i />Sistema de gestión inmobiliaria</div>
          <h2>Tus proyectos,<br /><span>bajo control.</span></h2>
          <p>Lotes, ventas, cobranzas, gastos y facturación de cada proyecto, al día y en un solo lugar.</p>
          <ul className="lg-puntos">
            <li><span><IcoPlano /></span>Plano de lotes y ventas al instante</li>
            <li><span><IcoCalendario /></span>Cronogramas y cobranzas al día</li>
            <li><span><IcoFirma /></span>Gastos con firma y código de seguridad</li>
            <li><span><IcoRecibo /></span>Facturación electrónica SUNAT</li>
          </ul>
        </div>
        <div className="lg-hero-pie">© {new Date().getFullYear()} Urbis Control</div>
      </aside>

      <main className="lg-lado">
        <form className="lg-form" onSubmit={onSubmit}>
          <div className="lg-form-marca">
            <span className="lg-azulejo"><Logo size={44} /></span>
            <Marca />
          </div>
          <div className="lg-titulo">Iniciar sesión</div>
          <p className="lg-sub">Ingresa con tu correo o tu número de celular.</p>

          {recordados.length > 0 && (
            <div className="lg-recordados">
              <small>Entrar como</small>
              <div>
                {recordados.map(u => (
                  <span key={u} className={'lg-quien' + (aCorreo(email) === u ? ' activo' : '')}>
                    <button type="button" title="Usar este usuario"
                      onClick={() => { setEmail(u); setError(''); setAviso(''); document.getElementById('lg-clave')?.focus() }}>
                      <span className="lg-inicial">{inicial(u)}</span><span>{mostrarUsuario(u)}</span>
                    </button>
                    <button type="button" className="lg-quitar" title="Quitar de la lista" aria-label={'Quitar ' + mostrarUsuario(u)}
                      onClick={() => { olvidarUsuario(u); setRecordados(usuariosRecordados()) }}>✕</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="lg-campo">
            <label htmlFor="lg-usuario">Correo o celular</label>
            <div className="lg-input">
              <IcoUsuario />
              <input id="lg-usuario" type="text" inputMode="email" autoCapitalize="none" spellCheck={false}
                value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com o 9XX XXX XXX"
                autoComplete="username" required autoFocus />
            </div>
          </div>
          <div className="lg-campo">
            <label htmlFor="lg-clave">Contraseña</label>
            <div className="lg-input">
              <IcoCandado />
              <input id="lg-clave" type={verClave ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={mirarMayus} onKeyUp={mirarMayus} onBlur={() => setMayus(false)}
                placeholder="Tu contraseña" autoComplete="current-password" required />
              <button type="button" className="lg-ojo" onClick={() => setVerClave(v => !v)}
                title={verClave ? 'Ocultar la contraseña' : 'Mostrar la contraseña'} aria-label={verClave ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}>
                {verClave ? <IcoOjoNo /> : <IcoOjo />}
              </button>
            </div>
            {mayus && <div className="lg-mayus">⇪ Bloq Mayús está activado</div>}
          </div>

          {error && <div className="lg-alerta error" role="alert"><IcoAlerta /><span>{error}</span></div>}
          {aviso && <div className="lg-alerta aviso" role="status"><IcoInfo /><span>{aviso}</span></div>}

          <button className="lg-boton" disabled={busy}>
            {busy ? <><span className="lg-giro" />Ingresando…</> : <>Ingresar<IcoFlecha /></>}
          </button>
          <button type="button" className="lg-olvide" disabled={busy} onClick={olvide}>¿Olvidaste tu contraseña?</button>

          <div className="lg-seguro"><IcoEscudo />Conexión segura y cifrada</div>
        </form>
      </main>
    </div>
  )
}
