import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Lots from './pages/Lots'
import Sales from './pages/Sales'
import Payments from './pages/Payments'
import Clients from './pages/Clients'
import Expenses from './pages/Expenses'
import Bitacora from './pages/Bitacora'
import Users from './pages/Users'
import Projects from './pages/Projects'
import Contracts from './pages/Contracts'
import Campanas from './pages/Campanas'
import Whatsapp from './pages/Whatsapp'
import TestBot from './pages/TestBot'
import CobranzaIA from './pages/CobranzaIA'
import Secretarias from './pages/Secretarias'
import Reset from './pages/Reset'
import Visitas from './pages/Visitas'
import Commissions from './pages/Commissions'
import Corretaje from './pages/Corretaje'
import Migracion from './pages/Migracion'
import Publico from './pages/Publico'
import Landing from './pages/Landing'
import { SITIO_PUBLICO } from './lib/sitios'

function Protected({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="center-screen">Cargando…</div>
  if (!session) return <Navigate to="/login" replace />
  return children
}

// el rol ASESOR entra directo a su chat (no ve el Dashboard del negocio)
function Home() {
  const { role } = useAuth()
  if (role === 'asesor') return <Navigate to="/whatsapp" replace />
  return <Dashboard />
}

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
  if (loading) return <div className="center-screen">Cargando…</div>
  return session ? <Landing /> : <AlSitioPublico />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset" element={<Reset />} />
      <Route path="/propiedades" element={SITIO_PUBLICO ? <AlSitioPublico /> : <Publico />} />
      <Route path="/p/:slug" element={SITIO_PUBLICO ? <VistaPreviaLanding /> : <Landing />} />
      <Route path="/" element={<Protected><Layout /></Protected>}>
        <Route index element={<Home />} />
        <Route path="whatsapp" element={<Whatsapp />} />
        <Route path="probar-bot" element={<TestBot />} />
        <Route path="cobranza-ia" element={<CobranzaIA />} />
        <Route path="corretaje" element={<Corretaje />} />
        <Route path="campanas" element={<Campanas />} />
        <Route path="secretarias" element={<Secretarias />} />
        <Route path="visitas" element={<Visitas />} />
        <Route path="lotes" element={<Lots />} />
        <Route path="ventas" element={<Sales />} />
        <Route path="pagos" element={<Payments />} />
        <Route path="clientes" element={<Clients />} />
        <Route path="gastos" element={<Expenses />} />
        <Route path="contratos" element={<Contracts />} />
        <Route path="comisiones" element={<Commissions />} />
        <Route path="proyectos" element={<Projects />} />
        <Route path="usuarios" element={<Users />} />
        <Route path="bitacora" element={<Bitacora />} />
        <Route path="migracion" element={<Migracion />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
