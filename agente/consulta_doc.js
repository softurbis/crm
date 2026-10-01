// ============================================================================
// EL NOMBRE DETRÁS DE UN DNI O UN RUC                                 [1 oct 2026]
// ----------------------------------------------------------------------------
// Al emitir una boleta o una factura la secretaria escribe el DNI o el RUC y el
// panel pide la consulta (consultas_doc, sql/119). Este módulo la hace y deja el
// nombre —o la razón social y el domicilio fiscal— para que el formulario se
// llene solo. Es el mismo servicio que usa el POS de El Cholao: decolecta.com
// (100 consultas gratis al mes). Cada documento se consulta una sola vez: la
// tabla es la cola y la memoria.
//
// .env del agente:
//   CONSULTA_DOC_TOKEN   el token de decolecta (se carga con migracion/13)
//   CONSULTA_DNI_TOKEN   opcional, si el DNI va con otro token
//   CONSULTA_DOC_URL     opcional; por defecto https://api.decolecta.com
// Sin token no se cae nada: la consulta queda en "error" y el nombre se escribe
// a mano, como antes. Corre dentro de agente-urbis (index.js).
// ============================================================================
const limpio = x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().toUpperCase()

// Lo que contesta el servicio, en limpio. El DNI: nombres y después apellidos,
// como se escribe en el panel. El RUC: razón social, domicilio fiscal y si está
// activo y habido (una factura a un RUC de baja la rechaza SUNAT).
function leerRespuesta(tipo, datos) {
  if (tipo === 'dni') {
    let nombre = [datos.first_name || datos.nombres, datos.first_last_name || datos.apellidoPaterno, datos.second_last_name || datos.apellidoMaterno]
      .map(limpio).filter(Boolean).join(' ')
    if (!nombre) nombre = limpio(datos.full_name || datos.nombreCompleto)
    return { nombre, direccion: null, situacion: null }
  }
  const nombre = limpio(datos.razon_social || datos.razonSocial || datos.nombre)
  const calle = limpio(datos.direccion)
  // el lugar solo se agrega si la dirección no lo trae ya escrito
  const lugar = [datos.distrito, datos.provincia, datos.departamento].map(limpio).filter(Boolean)
  const direccion = calle && calle !== '-'
    ? (lugar.length && !lugar.every(l => calle.includes(l)) ? calle + ' - ' + lugar.join(' - ') : calle)
    : (lugar.join(' - ') || null)
  const situacion = [limpio(datos.estado), limpio(datos.condicion)].filter(Boolean).join(' / ') || null
  return { nombre, direccion, situacion }
}

module.exports = function crearConsultaDoc({ supabase, log }) {
  const BASE = (process.env.CONSULTA_DOC_URL || 'https://api.decolecta.com').replace(/\/+$/, '')
  const tokenDe = tipo => (tipo === 'dni' && process.env.CONSULTA_DNI_TOKEN) || process.env.CONSULTA_DOC_TOKEN || ''
  let ocupado = false, avisoSinTabla = false, avisoSinToken = false, ultimoRescate = 0

  async function consultar(tipo, doc) {
    const token = tokenDe(tipo)
    if (!token) {
      if (!avisoSinToken) log('CONSULTA DOC: falta CONSULTA_DOC_TOKEN en el .env (migracion/13). El nombre se escribe a mano.')
      avisoSinToken = true
      throw new Error('La consulta automática todavía no está configurada en el servidor.')
    }
    const url = BASE + (tipo === 'dni' ? '/v1/reniec/dni?numero=' : '/v1/sunat/ruc?numero=') + doc
    let r
    try {
      r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
    } catch { throw new Error('El servicio de consulta no contestó. Escribe el nombre a mano.') }
    if (r.status === 401 || r.status === 403) throw new Error('El servicio de consulta rechazó el token del servidor.')
    if (r.status === 429) throw new Error('Se acabó el cupo de consultas del mes. Escribe el nombre a mano.')
    if (r.status === 404 || r.status === 422) throw new Error(tipo === 'dni' ? 'Ese DNI no figura en RENIEC.' : 'Ese RUC no figura en SUNAT.')
    if (!r.ok) throw new Error('El servicio de consulta falló (' + r.status + '). Escribe el nombre a mano.')
    const datos = await r.json().catch(() => ({}))
    const L = leerRespuesta(tipo, datos || {})
    if (!L.nombre) throw new Error('El servicio no devolvió un nombre para ese documento.')
    return L
  }

  async function procesar() {
    if (ocupado) return
    ocupado = true
    try {
      // lo que quedó "consultando" por un reinicio vuelve a la cola
      if (Date.now() - ultimoRescate > 60000) {
        ultimoRescate = Date.now()
        await supabase.from('consultas_doc').update({ estado: 'pendiente' })
          .eq('estado', 'consultando').lt('tomado_at', new Date(Date.now() - 60000).toISOString()).lt('intentos', 3)
      }
      const { data: pend, error } = await supabase.from('consultas_doc')
        .select('doc, tipo, intentos').eq('estado', 'pendiente').order('pedido_at').limit(3)
      if (error) { if (!avisoSinTabla) log('CONSULTA DOC:', error.message, '(¿falta correr sql/119?)'); avisoSinTabla = true; return }
      avisoSinTabla = false
      for (const p of (pend || [])) {
        const { data: tomada } = await supabase.from('consultas_doc')
          .update({ estado: 'consultando', tomado_at: new Date().toISOString(), intentos: (p.intentos || 0) + 1 })
          .eq('doc', p.doc).eq('estado', 'pendiente').select('doc')
        if (!tomada || !tomada.length) continue
        try {
          const L = await consultar(p.tipo, p.doc)
          await supabase.from('consultas_doc').update({ estado: 'listo', ...L, error: null, listo_at: new Date().toISOString() }).eq('doc', p.doc)
          log('CONSULTA DOC ✔', p.tipo.toUpperCase(), p.doc, '→', L.nombre)
        } catch (e) {
          const motivo = String(e?.message || e).slice(0, 200)
          await supabase.from('consultas_doc').update({ estado: 'error', error: motivo, listo_at: new Date().toISOString() }).eq('doc', p.doc)
          log('CONSULTA DOC ✗', p.doc, motivo)
        }
      }
    } finally { ocupado = false }
  }

  return { procesar }
}
module.exports.leerRespuesta = leerRespuesta
