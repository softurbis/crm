import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Publico from './pages/Publico'
import Landing from './pages/Landing'
import './styles/global.css'

// WEB PÚBLICA (urbisgroupinmobiliaria.com): solo propiedades y landing.
// Se compila aparte del panel (vite.publico.config.js): el visitante no
// descarga el CRM y aquí no existe sesión (lib/supabase.js). La vista previa
// de una landing en borrador se abre desde el panel, que sí tiene sesión.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Publico />} />
        <Route path="/propiedades" element={<Publico />} />
        <Route path="/p/:slug" element={<Landing />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
