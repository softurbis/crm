import { Routes, Route, Navigate } from 'react-router-dom'
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
import Whatsapp from './pages/Whatsapp'
import TestBot from './pages/TestBot'
import Secretarias from './pages/Secretarias'
import Reset from './pages/Reset'
import Visitas from './pages/Visitas'
import Commissions from './pages/Commissions'

function Protected({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="center-screen">Cargando…</div>
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset" element={<Reset />} />
      <Route path="/" element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="whatsapp" element={<Whatsapp />} />
        <Route path="probar-bot" element={<TestBot />} />
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
