// ============================================================
// SUBIDA DE ARCHIVOS — Cloudflare R2 (con respaldo a Supabase)
// ------------------------------------------------------------
// Un solo lugar para subir archivos en todo el panel. Antes cada página tenía
// su propio helper apuntando a Supabase Storage; ahora todas pasan por aquí.
//
// Qué hace:
//  1. COMPRIME las imágenes antes de subirlas (fotos de proyectos, del bot,
//     avatares, adjuntos de chat). Los DOCUMENTOS —contratos, DNI, vouchers,
//     comprobantes, legales— se suben TAL CUAL: ahí hay firmas y huellas que
//     no se deben tocar.
//  2. Sube a R2 a través del Worker, que valida la sesión del usuario.
//  3. Si el Worker falla, cae de vuelta a Supabase Storage para que nadie se
//     quede sin poder trabajar.
import { supabase } from './supabase'

const WORKER = import.meta.env.VITE_R2_WORKER || ''

// Carpetas cuyo contenido es evidencia: NUNCA se comprime.
const SIN_TOCAR = /^(contratos|dni|vouchers|comprobantes|legal|anexos|rh)\//i
const ES_IMAGEN = /^image\/(jpeg|jpg|png|webp)$/i

// Reduce una imagen manteniendo buena nitidez (máx 2560 px, JPEG 88).
// 2560 px es más de lo que WhatsApp entrega (~1600) y se ve bien en cualquier
// pantalla: una foto de celular de 8 MB baja a menos de 1 MB.
async function comprimirImagen(file, maxLado = 2560, calidad = 0.88) {
  if (!ES_IMAGEN.test(file.type)) return file
  if (file.size < 400 * 1024) return file                       // ya es liviana
  try {
    const bitmap = await createImageBitmap(file)
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * escala), h = Math.round(bitmap.height * escala)
    const lienzo = document.createElement('canvas')
    lienzo.width = w; lienzo.height = h
    lienzo.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    const blob = await new Promise(r => lienzo.toBlob(r, 'image/jpeg', calidad))
    bitmap.close?.()
    if (!blob || blob.size >= file.size) return file             // no empeorar nunca
    return new File([blob], file.name.replace(/\.(png|webp|jpeg)$/i, '.jpg'), { type: 'image/jpeg' })
  } catch { return file }                                        // navegador viejo: tal cual
}

// Sube a una ruta EXACTA dentro del bucket y devuelve la URL pública.
export async function subirRuta(ruta, file, opciones = {}) {
  const limpia = String(ruta).replace(/^\/+/, '')
  const comprimible = !SIN_TOCAR.test(limpia) && opciones.comprimir !== false
  let archivo = comprimible ? await comprimirImagen(file) : file
  // si se comprimió, la extensión final es .jpg
  const destino = archivo === file ? limpia : limpia.replace(/\.(png|webp|jpeg|jpg)$/i, '.jpg')

  if (WORKER) {
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      if (token) {
        const fd = new FormData()
        fd.append('file', archivo)
        fd.append('ruta', destino)
        const r = await fetch(WORKER.replace(/\/$/, '') + '/subir', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd })
        if (r.ok) return (await r.json()).url
        console.warn('R2 respondió ' + r.status + ': se sube a Supabase como respaldo')
      }
    } catch (e) { console.warn('R2 no disponible (' + e.message + '): se sube a Supabase como respaldo') }
  }

  const { error } = await supabase.storage.from('urbis-files').upload(destino, archivo, { contentType: archivo.type || undefined, upsert: true })
  if (error) throw new Error(error.message)
  return supabase.storage.from('urbis-files').getPublicUrl(destino).data.publicUrl
}

// Compatibilidad con el helper que ya usaban las páginas:
//   upload('bot/foto1', file)  ->  bot/foto1-<fecha>.<ext>
export async function upload(prefijo, file) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
  return subirRuta(`${prefijo}-${Date.now()}.${ext}`, file)
}
