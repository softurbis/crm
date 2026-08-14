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
//  2. SACA LA FOTO de los .docx que en realidad son una foto pegada en Word
//     (así nadie tiene que convertir a PDF a mano antes de subir).
//  3. Sube a R2 a través del Worker, que valida la sesión del usuario.
//  4. Si el Worker falla, cae de vuelta a Supabase Storage para que nadie se
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

// ============================================================
// WORD QUE EN REALIDAD ES UNA FOTO
// ------------------------------------------------------------
// Al migrar, los vouchers llegan pegados dentro de un Word: la secretaria abre
// Word, pega la captura y guarda. Ese .docx no se puede ver en el panel (no hay
// visor de Word), asi que alguien tenia que convertirlo a PDF a mano, uno por
// uno. Pero un .docx es un ZIP: la foto original esta adentro, en word/media.
//
// Aqui se abre el ZIP y, si el documento es "solo una foto" (una imagen de buen
// tamaño y casi nada de texto), se sube LA FOTO tal como estaba, sin recomprimir
// ni perder un pixel. Si el Word tiene texto de verdad —un contrato, una
// constancia redactada— se deja intacto: convertirlo perderia el documento.
// ============================================================
const FIRMA_ZIP = 0x04034b50, FIRMA_CENTRAL = 0x02014b50, FIRMA_FIN = 0x06054b50

function abrirZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let fin = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (dv.getUint32(i, true) === FIRMA_FIN) { fin = i; break }
  }
  if (fin < 0) return null
  const cuantas = dv.getUint16(fin + 10, true)
  let off = dv.getUint32(fin + 16, true)
  const entradas = []
  for (let k = 0; k < cuantas; k++) {
    if (off + 46 > buf.length || dv.getUint32(off, true) !== FIRMA_CENTRAL) break
    const largoNombre = dv.getUint16(off + 28, true)
    entradas.push({
      nombre: new TextDecoder().decode(buf.subarray(off + 46, off + 46 + largoNombre)),
      metodo: dv.getUint16(off + 10, true),
      comprimido: dv.getUint32(off + 20, true),
      local: dv.getUint32(off + 42, true),
    })
    off += 46 + largoNombre + dv.getUint16(off + 30, true) + dv.getUint16(off + 32, true)
  }
  return { buf, dv, entradas }
}

async function sacarDelZip(zip, entrada) {
  const { buf, dv } = zip
  if (dv.getUint32(entrada.local, true) !== FIRMA_ZIP) return null
  const inicio = entrada.local + 30 + dv.getUint16(entrada.local + 26, true) + dv.getUint16(entrada.local + 28, true)
  const datos = buf.subarray(inicio, inicio + entrada.comprimido)
  if (entrada.metodo === 0) return datos                       // guardado sin comprimir
  if (entrada.metodo !== 8) return null                        // método raro: no se toca
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(flujo).arrayBuffer())
}

export async function fotoDentroDelWord(file) {
  if (!file || !/\.docx$/i.test(file.name || '')) return null
  if (typeof DecompressionStream === 'undefined') return null   // navegador viejo
  try {
    const zip = abrirZip(new Uint8Array(await file.arrayBuffer()))
    if (!zip?.entradas?.length) return null
    const fotos = zip.entradas.filter(e => /^word\/media\/[^/]+\.(jpe?g|png)$/i.test(e.nombre))
    if (!fotos.length) return null

    // ¿tiene texto de verdad? entonces es un documento, no un envoltorio
    const doc = zip.entradas.find(e => e.nombre === 'word/document.xml')
    if (doc) {
      const bytes = await sacarDelZip(zip, doc)
      if (bytes) {
        const texto = new TextDecoder().decode(bytes).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        if (texto.length > 400) return null
      }
    }
    // la foto más grande: las chicas a veces pegan también el logo de la empresa
    let mejor = null
    for (const f of fotos) {
      const bytes = await sacarDelZip(zip, f)
      if (bytes && (!mejor || bytes.length > mejor.bytes.length)) mejor = { nombre: f.nombre, bytes }
    }
    if (!mejor || mejor.bytes.length < 20 * 1024) return null    // un ícono, no un voucher
    const png = /\.png$/i.test(mejor.nombre)
    return new File([mejor.bytes], String(file.name).replace(/\.docx$/i, png ? '.png' : '.jpg'),
      { type: png ? 'image/png' : 'image/jpeg' })
  } catch { return null }                                        // ante la duda, se sube el Word
}

// Sube a una ruta EXACTA dentro del bucket y devuelve la URL pública.
export async function subirRuta(ruta, file, opciones = {}) {
  let limpia = String(ruta).replace(/^\/+/, '')
  // el .docx que es una foto se convierte antes de cualquier otra cosa
  if (opciones.abrirWord !== false) {
    const foto = await fotoDentroDelWord(file)
    if (foto) { file = foto; limpia = limpia.replace(/\.docx$/i, foto.name.match(/\.png$/i) ? '.png' : '.jpg') }
  }
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
