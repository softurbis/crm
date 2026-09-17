import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ProjectProvider } from './context/ProjectContext'
import './styles/global.css'

// ---- APP INSTALABLE EN EL CELULAR ----
// El service worker no guarda nada (ver public/sw.js): está para que Chrome ofrezca
// "Instalar". El aviso de Chrome llega una sola vez y en cualquier pantalla (también en
// el login), así que se guarda aquí para que el botón "📲 Instalar app" lo use después.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}
window.addEventListener('beforeinstallprompt', e => {
  window.__pedirInstalar = e
  window.dispatchEvent(new Event('urbis-instalable'))
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <ProjectProvider>
          <App />
        </ProjectProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
