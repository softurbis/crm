import { enApp } from '../lib/appEscritorio'

// "💻 App de Windows" al pie del menú (26 nov 2026): solo en computadoras con Windows y
// cuando el panel se usa en el navegador (dentro de la app no hace falta). Baja el .exe que
// publica escritorio/compilar.ps1 en public/app/. Ver escritorio/LEEME.md.
const enWindows = () => typeof navigator !== 'undefined' && /Windows NT/i.test(navigator.userAgent) && !/Mobile|Android/i.test(navigator.userAgent)

export default function DescargarApp() {
  if (enApp() || !enWindows()) return null
  return (
    <a className="btn-ghost pref-btn" href="/app/UrbisControl.exe" download="UrbisControl.exe"
      title="Bajar Urbis Control para Windows: el mismo panel en su propia ventana, con avisos de Windows">💻 App</a>
  )
}
