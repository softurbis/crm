// Propiedades de terceros (corretaje) en la web pública: lo que comparten la lista
// (/propiedades), la página de cada una (/propiedades/<ref>) y la portada.
// Todo sale de la vista pública pub_propiedades (sql/19, rehecha en sql/232): nunca
// de corr_propiedades, que tiene lo privado (propietario, partida, comisión…).

export const TIPO = {
  terreno_urbano: 'Terreno urbano', terreno_rural: 'Terreno rural', lote: 'Lote', casa: 'Casa',
  departamento: 'Departamento', local: 'Local comercial', oficina: 'Oficina', edificio: 'Edificio',
  almacen: 'Almacén', estacionamiento: 'Estacionamiento', aires: 'Aires', otro: 'Otro',
}
export const ESTADO = { disponible: 'Disponible', reservado: 'Reservado', vendido: 'Vendido' }

export const precioTxt = (n, moneda) => n == null || n === '' ? 'Precio a consultar'
  : (moneda === 'PEN' ? 'S/ ' : 'US$ ') + Math.round(Number(n)).toLocaleString('es-PE')

// el link de cada propiedad: el código en minúsculas (TER-00012026 → ter-00012026) o el id
export const refDe = p => String(p.ref || p.codigo || p.id || '').trim().toLowerCase()
export const esUuid = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)

const MINUS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'a', 'con', 'por'])
const gritado = s => s && s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(s)
const m2 = s => s.replace(/(\d)\s*m2\b/gi, '$1 m²')
// en el panel se escribe todo en MAYÚSCULAS: en la web se lee mejor en tipo oración / nombre propio
export const oracion = s => {
  const t = String(s || '').trim()
  if (!gritado(t)) return m2(t)
  const l = t.toLowerCase()
  return m2(l.charAt(0).toUpperCase() + l.slice(1))
}
export const nombrePropio = s => {
  const t = String(s || '').trim()
  if (!gritado(t)) return t
  return t.toLowerCase().split(/(\s+|")/).map((w, i) => (i > 0 && MINUS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('')
}

export const tituloDe = p => oracion(p.titulo) || TIPO[p.tipo] || 'Propiedad'
export const lugarDe = p => [p.zona, p.distrito].filter(Boolean).map(nombrePropio).join(', ')
export const areaTxt = p => p.area != null && p.area !== '' ? Number(p.area).toLocaleString('es-PE') + (p.area_unidad === 'ha' ? ' ha' : ' m²') : null

// las medidas cortas de la tarjeta
export function datosCortos(p) {
  const d = []
  const a = areaTxt(p); if (a) d.push(a)
  if (p.frente && p.fondo) d.push(`${Number(p.frente)} × ${Number(p.fondo)} m`)
  if (p.dormitorios) d.push(p.dormitorios + (p.dormitorios === 1 ? ' dormitorio' : ' dormitorios'))
  if (p.banos) d.push(p.banos + (p.banos === 1 ? ' baño' : ' baños'))
  return d
}

// WhatsApp de la propiedad (el que recibe el lead, sql/232), con el mensaje ya escrito
export function linkWaPropiedad(p) {
  const tel = String(p.whatsapp || '').replace(/\D/g, '')
  if (tel.length < 9) return null
  const n = tel.length === 9 ? '51' + tel : tel
  const cod = p.codigo ? ` (código ${p.codigo})` : ''
  return `https://wa.me/${n}?text=${encodeURIComponent(`Hola, vi en su web la propiedad "${tituloDe(p)}"${cod} y quiero información`)}`
}

// disponibles primero, después las reservadas y al final las vendidas; dentro, la más nueva arriba
const PESO = { disponible: 0, reservado: 1, vendido: 2 }
export const ordenar = lista => [...lista].sort((a, b) =>
  (PESO[a.estado] ?? 3) - (PESO[b.estado] ?? 3) || String(b.publicado_desde || '').localeCompare(String(a.publicado_desde || '')))
