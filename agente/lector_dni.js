// ============================================================================
// LECTOR DE DNI CON IA                                              [30 sep 2026]
// ----------------------------------------------------------------------------
// Al registrar un cliente (ficha del lote o pantalla Clientes) se sube el DNI en
// foto o PDF. El panel pide una lectura (dni_lecturas, sql/112) y este módulo la
// hace con Claude: documento, nombres y apellidos, estado civil, dirección,
// distrito, provincia y departamento. El panel pone esos datos en el formulario
// para que la secretaria los revise antes de guardar: aquí no se escribe nada en
// la ficha del cliente. Corre dentro de agente-urbis (index.js).
// ============================================================================
const { Anthropic } = require('@anthropic-ai/sdk')

const MODELO = 'claude-opus-5-5'

const SISTEMA = `Lees documentos de identidad de Perú: el DNI (el electrónico azul y el antiguo) y el carné de extranjería. Puede llegar una foto con las dos caras, dos fotos (frente y reverso) o un PDF escaneado.

Extrae SOLO lo que está impreso. Si un dato no se ve o no se lee con seguridad, devuélvelo como null: nunca lo completes ni lo adivines.
- numero_documento: en el DNI, los 8 dígitos. Sin el dígito verificador que a veces va después de un guion (12345678 - 9 → "12345678").
- apellido_paterno ("Primer Apellido"), apellido_materno ("Segundo Apellido") y nombres ("Pre Nombres"), en MAYÚSCULAS y con la Ñ tal como están impresos. La zona de letras y signos < del reverso (MRZ) sirve para confirmar, pero no trae tildes ni Ñ: manda lo impreso.
- estado_civil: el DNI lo pone con una letra o con la palabra. S = SOLTERO, C = CASADO, V = VIUDO, D = DIVORCIADO.
- sexo: M o F.
- fechas en formato AAAA-MM-DD (en el documento van día/mes/año). fecha_caducidad null si dice "NO CADUCA".
- direccion: la dirección del reverso tal como está (JR., AV., AA.HH., MZ., LT., número). distrito, provincia y departamento: los del reverso, sin la palabra "distrito" ni "provincia".
- nacionalidad: la del documento (en el DNI, PERUANA).
- se_ve_frente / se_ve_reverso: qué caras aparecen en lo que llegó.
- es_documento: false si no es un DNI ni un carné de extranjería (otra foto, un voucher, un contrato).
- legible: false si está borroso, cortado o con reflejos que no dejan leer lo principal.
- observaciones: una línea en español con lo dudoso (datos cortados, tachados, reflejos, algo que no cuadra entre la MRZ y lo impreso). Cadena vacía si no hay nada que observar.`

const nulo = t => ({ anyOf: [{ type: t }, { type: 'null' }] })
const fecha = { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] }
const ESQUEMA = {
  type: 'object',
  properties: {
    es_documento: { type: 'boolean' },
    tipo_documento: { type: 'string', enum: ['DNI', 'CE', 'otro'] },
    legible: { type: 'boolean' },
    se_ve_frente: { type: 'boolean' },
    se_ve_reverso: { type: 'boolean' },
    numero_documento: nulo('string'),
    apellido_paterno: nulo('string'),
    apellido_materno: nulo('string'),
    nombres: nulo('string'),
    sexo: { anyOf: [{ type: 'string', enum: ['M', 'F'] }, { type: 'null' }] },
    estado_civil: { anyOf: [{ type: 'string', enum: ['SOLTERO', 'CASADO', 'VIUDO', 'DIVORCIADO'] }, { type: 'null' }] },
    fecha_nacimiento: fecha,
    fecha_caducidad: fecha,
    nacionalidad: nulo('string'),
    direccion: nulo('string'),
    distrito: nulo('string'),
    provincia: nulo('string'),
    departamento: nulo('string'),
    observaciones: { type: 'string' },
  },
  required: ['es_documento', 'tipo_documento', 'legible', 'se_ve_frente', 'se_ve_reverso', 'numero_documento',
    'apellido_paterno', 'apellido_materno', 'nombres', 'sexo', 'estado_civil', 'fecha_nacimiento', 'fecha_caducidad',
    'nacionalidad', 'direccion', 'distrito', 'provincia', 'departamento', 'observaciones'],
  additionalProperties: false,
}

// lo que devuelve la IA, en limpio: mayúsculas, espacios simples, fechas válidas y
// el número de DNI solo si son 8 dígitos
function limpiar(L) {
  const s = x => { const t = x == null ? '' : String(x).replace(/\s+/g, ' ').trim().toUpperCase(); return t || null }
  // fecha real (un 30 de febrero no pasa: Date lo correría al 2 de marzo)
  const f = x => {
    const t = s(x)
    if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
    const d = new Date(t + 'T12:00:00Z')
    return !isNaN(d) && d.toISOString().slice(0, 10) === t ? t : null
  }
  const tipo = L.tipo_documento || 'otro'
  let num = s(L.numero_documento)
  if (num) {
    num = num.replace(/[^0-9A-Z]/g, '')
    if (tipo === 'DNI') num = /^\d{8}/.test(num) ? num.slice(0, 8) : null
  }
  return {
    es_documento: !!L.es_documento, tipo_documento: tipo, legible: !!L.legible,
    se_ve_frente: !!L.se_ve_frente, se_ve_reverso: !!L.se_ve_reverso,
    numero_documento: num,
    apellido_paterno: s(L.apellido_paterno), apellido_materno: s(L.apellido_materno), nombres: s(L.nombres),
    sexo: L.sexo === 'M' || L.sexo === 'F' ? L.sexo : null,
    estado_civil: ['SOLTERO', 'CASADO', 'VIUDO', 'DIVORCIADO'].includes(L.estado_civil) ? L.estado_civil : null,
    fecha_nacimiento: f(L.fecha_nacimiento), fecha_caducidad: f(L.fecha_caducidad),
    nacionalidad: s(L.nacionalidad),
    direccion: s(L.direccion), distrito: s(L.distrito), provincia: s(L.provincia), departamento: s(L.departamento),
    observaciones: String(L.observaciones || '').trim(),
  }
}

module.exports = function crearLectorDni({ supabase, log }) {
  const CLAVE = process.env.ANTHROPIC_API_KEY || ''
  const ia = CLAVE ? new Anthropic({ apiKey: CLAVE, maxRetries: 2, timeout: 120000 }) : null
  let ocupado = false, avisoSinTabla = false, ultimoRescate = 0

  // una foto va por su dirección pública de R2 (el panel ya la achicó); un PDF se
  // manda entero en base64
  async function bloque(url) {
    if (!/\.pdf(\?|#|$)/i.test(url)) return { type: 'image', source: { type: 'url', url } }
    const r = await fetch(url)
    if (!r.ok) throw new Error('no se pudo abrir el PDF (' + r.status + ')')
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 10 * 1024 * 1024) throw new Error('el PDF pesa más de 10 MB')
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
  }

  async function leer(urls) {
    if (!ia) throw new Error('el servidor no tiene la clave de Claude (ANTHROPIC_API_KEY)')
    const archivos = []
    for (const u of urls) archivos.push(await bloque(u))
    const pedido = urls.length > 1 ? 'Lee este documento de identidad (van las dos caras por separado).' : 'Lee este documento de identidad.'
    const r = await ia.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      system: SISTEMA,
      // si los filtros de seguridad declinan, Anthropic reintenta con el modelo recomendado
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // transcribir un documento no pide pensar mucho: esfuerzo bajo = más rápido
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
      messages: [{ role: 'user', content: [...archivos, { type: 'text', text: pedido }] }],
    })
    if (r.stop_reason === 'refusal') throw new Error('la IA no pudo leer este archivo')
    if (r.stop_reason === 'max_tokens') throw new Error('la lectura quedó incompleta')
    const texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('')
    return limpiar(JSON.parse(texto))
  }

  function explicar(e) {
    if (e instanceof Anthropic.AuthenticationError) return 'la clave de Claude no es válida'
    if (e instanceof Anthropic.RateLimitError) return 'se llegó al límite de uso de Claude: intenta en un rato'
    if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(String(e.message))) return 'la cuenta de Claude no tiene crédito'
    if (e instanceof Anthropic.BadRequestError) return 'Claude no pudo abrir el archivo (¿formato raro o foto muy pesada?)'
    if (e instanceof SyntaxError) return 'la lectura vino en un formato inesperado'
    return String(e?.message || e).slice(0, 200)
  }

  async function procesar() {
    if (ocupado) return
    ocupado = true
    try {
      // lo que quedó "leyendo" por un reinicio vuelve a la cola (se mira una vez por minuto)
      if (Date.now() - ultimoRescate > 60000) {
        ultimoRescate = Date.now()
        await supabase.from('dni_lecturas').update({ estado: 'pendiente' })
          .eq('estado', 'leyendo').lt('tomado_at', new Date(Date.now() - 3 * 60000).toISOString()).lt('intentos', 3)
      }
      const { data: pend, error } = await supabase.from('dni_lecturas')
        .select('id, urls, intentos').eq('estado', 'pendiente').order('creado_at').limit(3)
      if (error) { if (!avisoSinTabla) log('LECTOR DNI:', error.message, '(¿falta correr sql/112?)'); avisoSinTabla = true; return }
      avisoSinTabla = false
      for (const p of (pend || [])) {
        const { data: tomada } = await supabase.from('dni_lecturas')
          .update({ estado: 'leyendo', tomado_at: new Date().toISOString(), intentos: (p.intentos || 0) + 1 })
          .eq('id', p.id).eq('estado', 'pendiente').select('id')
        if (!tomada || !tomada.length) continue
        try {
          const L = await leer(p.urls || [])
          await supabase.from('dni_lecturas').update({ estado: 'listo', lectura: L, error: null, listo_at: new Date().toISOString() }).eq('id', p.id)
          log('DNI IA ✔', L.numero_documento || '(sin número)', L.es_documento ? '' : '→ no parece un documento')
        } catch (e) {
          const motivo = explicar(e)
          await supabase.from('dni_lecturas').update({ estado: 'error', error: motivo, listo_at: new Date().toISOString() }).eq('id', p.id)
          log('DNI IA ✗', p.id, motivo)
        }
      }
    } finally { ocupado = false }
  }

  return { procesar }
}
module.exports.limpiar = limpiar
