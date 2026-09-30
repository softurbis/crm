// ============================================================
// LEER EL DNI CON IA (sql/112, agente/lector_dni.js)
// ------------------------------------------------------------
// Al elegir el DNI (foto o PDF) se sube una COPIA para leer a lecturas/dni/
// (las fotos se achican: Claude no acepta fotos de más de 5 MB) y el servidor la
// lee con Claude. El DNI de verdad, la evidencia, se sigue subiendo tal cual al
// guardar. Lo leído se pone en el formulario y la persona lo revisa: aquí no se
// guarda nada en la ficha del cliente.
// ============================================================
import { supabase } from './supabase'
import { subirRuta } from './archivos'

const espera = ms => new Promise(r => setTimeout(r, ms))
const faltaSql = e => /pedir_lectura_dni|dni_lecturas|schema cache|PGRST202/i.test(e || '')

// La copia que lee la IA. Un DNI ya subido llega como dirección: se baja para
// achicarlo igual que una foto nueva.
async function subirParaLeer(a, i) {
  let file = a
  if (typeof a === 'string') {
    const r = await fetch(a)
    if (!r.ok) throw new Error('No se pudo abrir el DNI subido (' + r.status + ')')
    const blob = await r.blob()
    const nombre = decodeURIComponent(a.split('?')[0].split('/').pop() || 'dni.jpg')
    file = new File([blob], nombre, { type: blob.type })
  }
  const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name || ''))
    throw new Error('La foto está en formato HEIC del iPhone: sube una captura de pantalla de la foto o un PDF')
  if (pdf && file.size > 10 * 1024 * 1024) throw new Error('El PDF pesa más de 10 MB')
  const ext = pdf ? 'pdf' : ((file.name || '').split('.').pop() || 'jpg').toLowerCase()
  return subirRuta(`lecturas/dni/${Date.now()}-${i}.${ext}`, file)
}

// archivos: 1 (las dos caras o PDF) o 2 (frente y reverso), como File o dirección.
// Devuelve lo que leyó la IA o lanza un error con el motivo en español.
export async function leerDni(archivos, alAvanzar) {
  const lista = archivos.filter(Boolean).slice(0, 2)
  if (!lista.length) throw new Error('Falta el DNI')
  alAvanzar?.('subiendo')
  const urls = []
  for (let i = 0; i < lista.length; i++) urls.push(await subirParaLeer(lista[i], i))
  const { data: id, error } = await supabase.rpc('pedir_lectura_dni', { urls })
  if (error) throw new Error(faltaSql(error.message) ? 'Falta correr sql/112 en la base.' : error.message)
  alAvanzar?.('leyendo')
  // el servidor la toma en ~2 s; la IA tarda unos segundos más
  const fin = Date.now() + 120000
  while (Date.now() < fin) {
    await espera(2000)
    const { data: fila } = await supabase.from('dni_lecturas').select('estado, lectura, error').eq('id', id).maybeSingle()
    if (fila?.estado === 'listo') return fila.lectura
    if (fila?.estado === 'error') throw new Error(fila.error || 'No se pudo leer el DNI')
  }
  throw new Error('La lectura está tardando demasiado (¿el servidor está prendido?). Llena los datos a mano o vuelve a intentar.')
}

const CIVIL = { SOLTERO: 'SOLTERO(A)', CASADO: 'CASADO(A)', VIUDO: 'VIUDO(A)', DIVORCIADO: 'DIVORCIADO(A)' }
export const ETIQUETAS_DNI = {
  doc_number: 'N° de documento', full_name: 'Nombre', address: 'Dirección', district: 'Distrito',
  province: 'Provincia', department: 'Departamento', civil_status: 'Estado civil', nationality: 'Nacionalidad',
}

// Lo leído, con los nombres de campo de la ficha del cliente. El nombre va como en
// los contratos: nombres y después los dos apellidos.
export function datosDelDni(L) {
  if (!L || !L.es_documento) return {}
  const d = {}
  if (L.numero_documento) d.doc_number = L.numero_documento
  if (L.nombres && L.apellido_paterno) d.full_name = [L.nombres, L.apellido_paterno, L.apellido_materno].filter(Boolean).join(' ')
  if (L.direccion) d.address = L.direccion
  if (L.distrito) d.district = L.distrito
  if (L.provincia) d.province = L.provincia
  if (L.departamento) d.department = L.departamento
  if (CIVIL[L.estado_civil]) d.civil_status = CIVIL[L.estado_civil]
  if (L.tipo_documento === 'DNI') d.nationality = 'PERUANA'
  else if (L.nacionalidad) d.nationality = L.nacionalidad
  return d
}

// Pone lo leído encima de lo que había. Devuelve la persona nueva, los campos que
// estaban vacíos y se llenaron, y los que tenían otra cosa y se cambiaron (para
// que la secretaria vea qué se reemplazó).
const normal = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase()
// SOLTERA, SOLTERO y SOLTERO(A) son lo mismo: no se cuenta como cambio
const raizCivil = t => normal(t).replace(/\(A\)/g, '').replace(/[AO]$/, '')
const igual = (a, b, k) => k === 'civil_status' ? raizCivil(a) === raizCivil(b) : normal(a) === normal(b)
export function aplicarDni(actual, L, campos = Object.keys(ETIQUETAS_DNI)) {
  const d = datosDelDni(L)
  const nuevo = { ...actual }, puestos = [], cambios = []
  for (const k of campos) {
    const v = d[k]
    if (!v) continue
    const antes = String(actual[k] || '').trim()
    // un documento "pendiente" de la separación no cuenta como dato
    const vacio = !antes || (k === 'doc_number' && /^PEND/i.test(antes))
    if (vacio) { nuevo[k] = v; puestos.push(k) }
    else if (!igual(antes, v, k)) { nuevo[k] = v; cambios.push({ campo: k, antes, ahora: v }) }
  }
  if (d.doc_number && L.tipo_documento !== 'otro' && campos.includes('doc_number')) nuevo.doc_type = L.tipo_documento
  return { nuevo, puestos, cambios }
}

const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''
const hoy = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10)

// Lo que la secretaria tiene que saber de la lectura, en una línea cada cosa.
export function avisosDni(L) {
  if (!L) return []
  if (!L.es_documento) return ['El archivo no parece un DNI ni un carné de extranjería: revisa que sea el documento correcto.']
  const a = []
  if (!L.legible) a.push('El DNI no se lee bien (borroso, cortado o con reflejos): revisa cada dato con el documento en la mano.')
  if (L.se_ve_frente && !L.se_ve_reverso) a.push('Solo se ve el FRENTE: la dirección, el distrito, la provincia y el departamento están en el reverso.')
  if (!L.se_ve_frente && L.se_ve_reverso) a.push('Solo se ve el REVERSO: el nombre, el número y el estado civil están en el frente.')
  if (L.fecha_caducidad && L.fecha_caducidad < hoy()) a.push('El DNI está VENCIDO: caducó el ' + dmy(L.fecha_caducidad) + '.')
  if (L.tipo_documento === 'DNI' && !L.numero_documento) a.push('No se leyó bien el número de DNI: escríbelo a mano.')
  if (L.observaciones) a.push(L.observaciones)
  return a
}
