import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom'
import Portada from './pages/Portada'
import Publico from './pages/Publico'
import Landing from './pages/Landing'
import ComprobantePublico from './pages/ComprobantePublico'
import './styles/global.css'

// WEB PÚBLICA (urbisgroupinmobiliaria.com): portada con los proyectos (13 nov 2026),
// propiedades de terceros (/propiedades) y el landing de cada proyecto (/p/<slug>).
// Se compila aparte del panel (vite.publico.config.js): el visitante no
// descarga el CRM y aquí no existe sesión (lib/supabase.js). La vista previa
// de una landing en borrador se abre desde el panel, que sí tiene sesión.

// al pasar de una página a otra (portada → landing) se empieza ARRIBA; con "atrás" no se toca
function ArribaAlCambiar() {
  const { pathname } = useLocation()
  const tipo = useNavigationType()
  useEffect(() => { if (tipo !== 'POP') window.scrollTo(0, 0) }, [pathname, tipo])
  return null
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ArribaAlCambiar />
      <Routes>
        <Route path="/" element={<Portada />} />
        <Route path="/propiedades" element={<Publico />} />
        <Route path="/p/:slug" element={<Landing />} />
        {/* la boleta del cliente, el enlace corto del WhatsApp (sql/153) */}
        <Route path="/c/:token" element={<ComprobantePublico />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
