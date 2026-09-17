import { useEffect, useState } from 'react'

// Botón "📲 Instalar app": deja el panel en la pantalla del celular, con su ícono, y
// se abre sin la barra del navegador.
//   · Android / Chrome: usa el aviso de instalación que guardó main.jsx.
//   · iPhone: Safari no deja instalar desde un botón; se explican los dos toques.
// Si ya se está usando como app instalada, no aparece.
const esIPhone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const yaInstalada = () => !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone)

const AYUDA_IPHONE = 'Para instalar Urbis en el iPhone:\n\n1. Abre el panel en SAFARI.\n2. Toca COMPARTIR (el cuadrado con la flecha hacia arriba).\n3. Elige «AGREGAR A PANTALLA DE INICIO».\n\nLa primera vez que abras la app te va a pedir tu contraseña.'
const AYUDA_ANDROID = 'Para instalar Urbis en el celular:\n\nEn Chrome, toca el menú ⋮ (arriba a la derecha) y elige «INSTALAR APLICACIÓN» o «AGREGAR A PANTALLA DE INICIO».'

export default function InstalarApp({ style }) {
  const [aviso, setAviso] = useState(() => window.__pedirInstalar || null)
  const [instalada, setInstalada] = useState(yaInstalada)

  useEffect(() => {
    const listo = () => setAviso(window.__pedirInstalar || null)
    const hecho = () => { setInstalada(true); setAviso(null) }
    window.addEventListener('urbis-instalable', listo)
    window.addEventListener('appinstalled', hecho)
    return () => { window.removeEventListener('urbis-instalable', listo); window.removeEventListener('appinstalled', hecho) }
  }, [])

  if (instalada || (!aviso && !esIPhone())) return null

  async function instalar() {
    if (!aviso) { alert(AYUDA_IPHONE); return }
    try {
      aviso.prompt()
      const r = await aviso.userChoice
      if (r?.outcome === 'accepted') setInstalada(true)
    } catch { alert(AYUDA_ANDROID) }
    window.__pedirInstalar = null        // el aviso de Chrome sirve una sola vez
    setAviso(null)
  }

  return (
    <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px', ...style }} onClick={instalar}
      title="Dejar el panel en la pantalla del celular, como una app">📲 Instalar app</button>
  )
}
