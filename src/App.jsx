import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Reset from './pages/Reset'
import { SITIO_PUBLICO } from './lib/sitios'

// Cada pantalla se baja recien cuando se abre. Antes el celular bajaba 1,3 MB
// de JavaScript de golpe al entrar, con pantallas que la secretaria nunca usa
// (bot, marketing, migracion). Si se publica una version nueva con la pestaña
// abierta, main.jsx recarga sola (vite:preloadError).
const Inicio = lazy(() => import('./pages/Inicio'))
const Lots = lazy(() => import('./pages/Lots'))
const FichaLote = lazy(() => import('./pages/FichaLote'))
const Payments = lazy(() => import('./pages/Payments'))
const Clients = lazy(() => import('./pages/Clients'))
const Expenses = lazy(() => import('./pages/Expenses'))
const Bitacora = lazy(() => import('./pages/Bitacora'))
const Users = lazy(() => import('./pages/Users'))
const Projects = lazy(() => import('./pages/Projects'))
// ventas y contratos: una sola pantalla para las rutas /ventas y /contratos (1 oct 2026)
const Contracts = lazy(() => import('./pages/Contracts'))
const Campanas = lazy(() => import('./pages/Campanas'))
const Whatsapp = lazy(() => import('./pages/Whatsapp'))
const TestBot = lazy(() => import('./pages/TestBot'))
const CobranzaIA = lazy(() => import('./pages/CobranzaIA'))
const VentasIA = lazy(() => import('./pages/VentasIA'))
const Secretarias = lazy(() => import('./pages/Secretarias'))
const Visitas = lazy(() => import('./pages/Visitas'))
const Commissions = lazy(() => import('./pages/Commissions'))
const Corretaje = lazy(() => import('./pages/Corretaje'))
const Migracion = lazy(() => import('./pages/Migracion'))
const Conciliacion = lazy(() => import('./pages/Conciliacion'))
const Comprobantes = lazy(() => import('./pages/Comprobantes'))
const Planilla = lazy(() => import('./pages/Planilla'))
const Publico = lazy(() => import('./pages/Publico'))
const Landing = lazy(() => import('./pages/Landing'))

const Cargando = () => <div className="center-screen">Cargando…</div>

function Protected({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <Cargando />
  if (!session) return <Navigate to="/login" replace />
  return children
}

// el rol ASESOR entra directo a su chat (no ve el Dashboard del negocio) y la
// SECRETARIA a "Hoy": el buscador y lo urgente del dia (decision del 24 sep).
// Ella llega al Dashboard por /dashboard, desde el menu.
function Home() {
  const { role } = useAuth()
  if (role === 'asesor') return <Navigate to="/whatsapp" replace />
  if (role === 'secretary') return <Navigate to="/hoy" replace />
  return <Dashboard />
}

// PANTALLAS VEDADAS A UN ROL: no se abren ni escribiendo la dirección a mano (el
// menú ya no las muestra). A quien no le toca se le devuelve al inicio, igual
// que al asesor que pide el Dashboard. `para` recibe lo que da useAuth() y dice
// quién NO pasa, así sirve para otro rol el día que haga falta.
// El perfil llega un instante después que la sesión: hasta saber el rol no se
// dibuja la pantalla (ni se baja su código).
function Vedada({ para, children }) {
  const auth = useAuth()
  if (!auth.role) return <p className="muted" style={{ padding: '1rem 0' }}>Cargando…</p>
  return para(auth) ? <Navigate to="/" replace /> : children
}
// El OPERADOR trabaja como el superusuario, pero la administración no es suya:
// usuarios, bitácora, corretaje, campañas, agentes IA y la consola del bot.
const operador = a => a.esOperador
// Cobranza IA la abre un permiso por persona (sql/76), no el rol: el operador
// solo entra si el superusuario lo marcó como responsable de cobranza.
const operadorSinCobranza = a => a.esOperador && !(a.profile?.permisos || []).includes('cobranza')

// Con dominio propio la web pública se publica aparte (lib/sitios.js): el panel
// no la dibuja y manda al visitante allá. Solo se queda la vista previa de una
// landing, que necesita la sesión del panel para leer el borrador.
function AlSitioPublico() {
  const { pathname, search, hash } = useLocation()
  useEffect(() => { window.location.replace(SITIO_PUBLICO + pathname + search + hash) }, [pathname, search, hash])
  return <div className="center-screen">Abriendo…</div>
}

function VistaPreviaLanding() {
  const { session, loading } = useAuth()
  if (loading) return <Cargando />
  return session ? <Landing /> : <AlSitioPublico />
}

export default function App() {
  return (
    // las pantallas del panel tienen su propio "Cargando" dentro del Layout (el
    // menu no parpadea); este cubre las publicas
    <Suspense fallback={<Cargando />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="/propiedades" element={SITIO_PUBLICO ? <AlSitioPublico /> : <Publico />} />
        <Route path="/p/:slug" element={SITIO_PUBLICO ? <VistaPreviaLanding /> : <Landing />} />
        <Route path="/" element={<Protected><Layout /></Protected>}>
          <Route index element={<Home />} />
          <Route path="hoy" element={<Inicio />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="whatsapp" element={<Whatsapp />} />
          <Route path="probar-bot" element={<Vedada para={operador}><TestBot /></Vedada>} />
          <Route path="cobranza-ia" element={<Vedada para={operadorSinCobranza}><CobranzaIA /></Vedada>} />
          <Route path="ventas-ia" element={<Vedada para={operador}><VentasIA /></Vedada>} />
          <Route path="corretaje" element={<Vedada para={operador}><Corretaje /></Vedada>} />
          <Route path="campanas" element={<Vedada para={operador}><Campanas /></Vedada>} />
          <Route path="secretarias" element={<Secretarias />} />
          <Route path="visitas" element={<Visitas />} />
          <Route path="lotes" element={<Lots />} />
          <Route path="conciliacion" element={<Vedada para={a => !a.puedeCorregir}><Conciliacion /></Vedada>} />
          <Route path="lotes/:id" element={<FichaLote />} />
          <Route path="ventas" element={<Contracts />} />
          <Route path="pagos" element={<Payments />} />
          <Route path="comprobantes" element={<Comprobantes />} />
          <Route path="clientes" element={<Clients />} />
          <Route path="gastos" element={<Expenses />} />
          <Route path="planilla" element={<Vedada para={a => !a.esSuper && !(a.profile?.permisos || []).includes('planilla')}><Planilla /></Vedada>} />
          <Route path="contratos" element={<Contracts />} />
          <Route path="comisiones" element={<Commissions />} />
          <Route path="proyectos" element={<Projects />} />
          <Route path="usuarios" element={<Vedada para={operador}><Users /></Vedada>} />
          <Route path="bitacora" element={<Vedada para={operador}><Bitacora /></Vedada>} />
          <Route path="migracion" element={<Migracion />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
