// Dónde vive cada cara del sistema (dominio propio desde el 15 sep 2026):
//   · web pública (propiedades + landing): urbisgroupinmobiliaria.com, compilada
//     aparte y SIN sesión (npm run build:publico)
//   · panel: panel.urbisgroupinmobiliaria.com (npm run build:panel)
// VITE_SITIO_PUBLICO (.env.production) dice dónde está la web pública. Sin ella
// (npm run dev) todo sale del mismo sitio, y así se prueba en local.
const quitarBarra = s => String(s || '').replace(/\/+$/, '')
const aqui = () => window.location.origin + quitarBarra(import.meta.env.BASE_URL)
const sinBarraInicial = ruta => String(ruta || '').replace(/^\/+/, '')

export const SITIO_PUBLICO = quitarBarra(import.meta.env.VITE_SITIO_PUBLICO)
export const linkPublico = ruta => (SITIO_PUBLICO || aqui()) + '/' + sinBarraInicial(ruta)
export const linkPanel = ruta => aqui() + '/' + sinBarraInicial(ruta)
