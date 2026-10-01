// EL NOMBRE DETRÁS DE UN DNI O UN RUC (sql/119)
// Se escribe el documento y el nombre —o la razón social y el domicilio fiscal—
// se llena solo. Primero se mira en casa (un DNI que ya es cliente no gasta una
// consulta); si no está, se le pide al servidor, que consulta RENIEC / SUNAT y
// guarda la respuesta para la próxima vez.
import { supabase } from './supabase'

const espera = ms => new Promise(r => setTimeout(r, ms))

// Devuelve { ok, nombre, direccion, situacion, fuente } o { ok: false, mensaje }.
// Nunca lanza: si no se puede, el nombre se escribe a mano como siempre.
export async function consultarDoc(documento, { vivo = () => true } = {}) {
  const doc = String(documento || '').replace(/\D/g, '')
  if (doc.length !== 8 && doc.length !== 11) return { ok: false, mensaje: '' }

  if (doc.length === 8) {
    const { data } = await supabase.from('clients').select('full_name, address, district').eq('doc_number', doc).limit(1)
    const c = data?.[0]
    if (c?.full_name) return { ok: true, nombre: c.full_name, direccion: [c.address, c.district].filter(Boolean).join(', '), situacion: null, fuente: 'cliente' }
  }

  let { data: fila, error } = await supabase.rpc('pedir_consulta_doc', { p_doc: doc })
  if (error) {
    // sql/119 sin correr: la consulta simplemente no existe todavía
    const m = String(error.message || '')
    return { ok: false, mensaje: /PGRST20[25]|schema cache|Could not find/i.test(m) ? '' : m }
  }
  // el servidor la toma en un par de segundos; se espera hasta 15
  for (let i = 0; i < 20 && fila && ['pendiente', 'consultando'].includes(fila.estado); i++) {
    await espera(750)
    if (!vivo()) return { ok: false, mensaje: '' }
    const r = await supabase.from('consultas_doc').select('*').eq('doc', doc).maybeSingle()
    if (r.data) fila = r.data
  }
  if (fila?.estado === 'listo' && fila.nombre) {
    return { ok: true, nombre: fila.nombre, direccion: fila.direccion || '', situacion: fila.situacion || null, fuente: doc.length === 8 ? 'RENIEC' : 'SUNAT' }
  }
  return { ok: false, mensaje: fila?.error || 'La consulta está tardando. Escribe el nombre a mano.' }
}

// Un RUC que SUNAT no tiene como activo y habido: la factura saldría rechazada
export const rucConProblema = situacion => {
  const s = String(situacion || '').toUpperCase()
  return !!s && !(s.includes('ACTIVO') && s.includes('HABIDO') && !s.includes('NO HABIDO'))
}
