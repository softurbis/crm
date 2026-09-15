// Dónde vive cada cara del sistema.
//   · Hoy (GitHub Pages) todo sale de softurbis.github.io/crm/: sin variables,
//     estos links dan exactamente lo mismo que antes.
//   · Con dominio propio, la web pública (propiedades + landing) se publica
//     aparte y SIN sesión (npm run build:publico) y el panel en panel.<dominio>
//     (npm run build:panel), con VITE_SITIO_PUBLICO apuntando a la web pública.
const quitarBarra = s => String(s || '').replace(/\/+$/, '')
const aqui = () => window.location.origin + quitarBarra(import.meta.env.BASE_URL)
const sinBarraInicial = ruta => String(ruta || '').replace(/^\/+/, '')

export const SITIO_PUBLICO = quitarBarra(import.meta.env.VITE_SITIO_PUBLICO)
export const linkPublico = ruta => (SITIO_PUBLICO || aqui()) + '/' + sinBarraInicial(ruta)
export const linkPanel = ruta => aqui() + '/' + sinBarraInicial(ruta)
