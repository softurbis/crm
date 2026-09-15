import { subirRuta } from './archivos'

// ============================================================
// FOTOS PARA PÁGINAS PÚBLICAS (landing de proyectos)
// ------------------------------------------------------------
// Alta calidad sin hacer esperar: cada foto se guarda en 4 anchos WebP
// (640 · 1280 · 1920 · 2560 px) y la página le pide al navegador solo el que
// va a mostrar. El celular baja 640 o 1280; el de 2560 solo lo pide una
// pantalla grande o el visor a pantalla completa en una PC.
//
// Medido con las tomas de dron de Cashibo (15 sep 2026): el pasto y la palma
// son detalle puro y ningún formato las deja livianas a 2560 px (ni AVIF baja
// de 1.3 MB). Lo que de verdad ahorra es no mandar píxeles que la pantalla no
// muestra. Calidad 75: a ojo igual que 82 y ~25 % menos peso.
//
// Se convierte EN EL NAVEGADOR antes de subir: lo que viaja son archivos
// livianos, no la foto de 10 MB del dron. No usa el compresor general de
// archivos.js porque ese pasa todo a JPEG (y al logo le mataba la transparencia).
// ============================================================
export const ANCHOS = [[640, 's'], [1280, 'm'], [1920, 'l'], [2560, 'url']]

// planos, mapas y rutas llevan texto: más calidad para que se lea
const ES_NITIDO = /plano|mapa|ruta|satelit|ubicaci|wayfinding|croquis/i
const CALIDAD = 0.75, CALIDAD_NITIDA = 0.88

async function codificar(bitmap, ancho, calidad, respaldo) {
  const escala = Math.min(1, ancho / bitmap.width)
  const w = Math.round(bitmap.width * escala), h = Math.round(bitmap.height * escala)
  const lienzo = document.createElement('canvas')
  lienzo.width = w; lienzo.height = h
  const ctx = lienzo.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  let blob = await new Promise(r => lienzo.toBlob(r, 'image/webp', calidad))
  // navegador que no sabe escribir WebP (devuelve PNG): respaldo
  if (!blob || blob.type !== 'image/webp') blob = await new Promise(r => lienzo.toBlob(r, respaldo, calidad))
  lienzo.width = lienzo.height = 0                                  // soltar memoria
  return blob
}

const extDe = tipo => (tipo === 'image/webp' ? 'webp' : tipo === 'image/png' ? 'png' : 'jpg')
const base = carpeta => `${carpeta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

// Devuelve { url (2560), l (1920), m (1280), s (640) } — la forma de cada foto en corr_proyectos_pub.galeria
export async function subirFotoWeb(file, carpeta) {
  const bitmap = await createImageBitmap(file)
  const calidad = ES_NITIDO.test(file.name) ? CALIDAD_NITIDA : CALIDAD
  const raiz = base(carpeta)
  try {
    const subidas = []
    for (const [ancho] of ANCHOS) {
      // se codifica de a una (varios lienzos de 2560 px a la vez revientan la memoria)
      // pero cada archivo empieza a subir apenas está listo
      const blob = await codificar(bitmap, ancho, calidad, 'image/jpeg')
      const ext = extDe(blob.type)
      subidas.push(subirRuta(`${raiz}-${ancho}.${ext}`, new File([blob], `${ancho}.${ext}`, { type: blob.type }), { comprimir: false, abrirWord: false }))
    }
    const urls = await Promise.all(subidas)
    return Object.fromEntries(ANCHOS.map(([, campo], k) => [campo, urls[k]]))
  } finally { bitmap.close?.() }
}

// El logo conserva la transparencia (WebP o, si no se puede, PNG)
export async function subirLogoWeb(file, carpeta) {
  const bitmap = await createImageBitmap(file)
  try {
    const blob = await codificar(bitmap, 900, 0.92, 'image/png')
    const ext = extDe(blob.type)
    return await subirRuta(`${base(carpeta)}-logo.${ext}`, new File([blob], `logo.${ext}`, { type: blob.type }), { comprimir: false, abrirWord: false })
  } finally { bitmap.close?.() }
}

// srcset para <img> con los tamaños que la foto tenga (las viejas traen solo url)
export const srcsetDe = g => {
  if (!g?.url || !g.s) return undefined
  return ANCHOS.filter(([, campo]) => g[campo]).map(([ancho, campo]) => `${g[campo]} ${ancho}w`).join(', ')
}
// la versión mediana para el src de respaldo
export const medianaDe = g => g?.m || g?.l || g?.url
