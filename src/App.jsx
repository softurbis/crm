import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Lots from './pages/Lots'

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
      <Route path="/" element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="lotes" element={<Lots />} />
        {/* Próximos módulos:
            /proyectos, /clientes, /pagos, /contratos,
            /gastos, /usuarios, /bitacora, /leads, /visitas */}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
