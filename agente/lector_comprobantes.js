// ============================================================================
// LECTOR DE COMPROBANTES DE PAGO CON IA                            [17 sep 2026]
// ----------------------------------------------------------------------------
// Cuando la socia sube el comprobante de un gasto aprobado, el panel pide una
// lectura (comprobante_lecturas, sql/103) y este módulo:
//
//   1. lo LEE con Claude, a ciegas: no le decimos qué debería decir, para que no
//      "vea" el monto o el nombre que espera. Sale monto, fecha, banco, número de
//      operación, a quién y quién pagó.
//   2. lo VALIDA en código contra la solicitud: monto exacto, fecha razonable,
//      nombre de quien recibe y si ese número de operación ya se usó en otro gasto.
//
// Con alguna "mal", registrar el pago exige que la persona marque que lo revisó
// (lo hace valer registrar_pago_gasto). Corre dentro de agente-urbis (index.js).
// ============================================================================
const { Anthropic } = require('@anthropic-ai/sdk')

const MODELO = 'claude-opus-5'
const TZ = 'America/Lima'

const SISTEMA = `Lees comprobantes de pago de Perú: vouchers de transferencia bancaria (BCP, Interbank, BBVA, Scotiabank, Banco de la Nación, cajas), capturas de Yape o Plin, depósitos en ventanilla y recibos de pago en efectivo.

Extrae SOLO lo que está escrito en el comprobante. Si un dato no se ve o no se lee con seguridad, devuélvelo como null: nunca lo completes ni lo adivines.
- monto: el importe pagado, como número (S/ 1,230.50 → 1230.5). Si hay varios importes (comisión, ITF), el monto transferido o pagado, no el total con comisiones.
- moneda: PEN para soles (S/), USD para dólares.
- fecha: en formato AAAA-MM-DD. En Perú las fechas se escriben día/mes/año.
- hora: HH:MM en 24 horas, si aparece.
- banco_o_app: el banco o la aplicación (BCP, Yape, Plin, Interbank…).
- numero_operacion: el número o código de operación, de transacción o de constancia, tal como está escrito.
- destinatario_nombre: a quién se pagó, tal como aparece (puede estar abreviado o con asteriscos). destinatario_cuenta: su número de cuenta, CCI o celular, si aparece.
- ordenante_nombre: quién pagó, si aparece.
- es_comprobante: false si la imagen no es un comprobante de pago (una foto cualquiera, un DNI, una constancia de recepción sin pago, una captura de chat).
- legible: false si está borroso, cortado o no se puede leer lo principal.
- observaciones: una línea en español con lo dudoso (montos tachados o superpuestos, datos cortados, signos de edición). Cadena vacía si no hay nada que observar.`

const nulo = t => ({ anyOf: [{ type: t }, { type: 'null' }] })
const ESQUEMA = {
  type: 'object',
  properties: {
    es_comprobante: { type: 'boolean' },
    legible: { type: 'boolean' },
    tipo: { type: 'string', enum: ['transferencia', 'yape', 'plin', 'deposito', 'efectivo', 'otro'] },
    monto: nulo('number'),
    moneda: { anyOf: [{ type: 'string', enum: ['PEN', 'USD'] }, { type: 'null' }] },
    fecha: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    hora: nulo('string'),
    banco_o_app: nulo('string'),
    numero_operacion: nulo('string'),
    destinatario_nombre: nulo('string'),
    destinatario_cuenta: nulo('string'),
    ordenante_nombre: nulo('string'),
    observaciones: { type: 'string' },
  },
  required: ['es_comprobante', 'legible', 'tipo', 'monto', 'moneda', 'fecha', 'hora', 'banco_o_app', 'numero_operacion',
    'destinatario_nombre', 'destinatario_cuenta', 'ordenante_nombre', 'observaciones'],
  additionalProperties: false,
}

// ---------------------------------------------------------------- validación (sin IA)
const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sol = n => n ? 'SOL-' + String(n).padStart(5, '0') : 'otro gasto'

// "Víctor M. Mera V." → ['VICTOR', 'MERA']; "Vict** Mer*" → ['VICT', 'MER'] (prefijos)
const palabras = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/[^A-ZÑ* ]/g, ' ').split(/\s+/).map(w => w.replace(/\*+$/, '')).filter(w => w.length >= 3 && !/\*/.test(w))
// ¿el nombre del comprobante es de la persona de la solicitud? Los comprobantes abrevian
// y tapan con asteriscos: alcanza con que coincidan dos palabras (o todas las legibles, si son menos)
function mismoNombre(delComprobante, deLaSolicitud) {
  const a = palabras(delComprobante), b = palabras(deLaSolicitud)
  if (!a.length || !b.length) return false
  const coinciden = a.filter(w => b.some(x => x === w || (w.length >= 3 && x.startsWith(w)))).length
  return coinciden >= Math.min(2, a.length, b.length)
}

function validar(g, L, usadoEn, hoy = hoyLima()) {
  const v = []
  const ok = (campo, texto) => v.push({ nivel: 'ok', campo, texto })
  const duda = (campo, texto) => v.push({ nivel: 'duda', campo, texto })
  const mal = (campo, texto) => v.push({ nivel: 'mal', campo, texto })

  if (!L.es_comprobante) mal('archivo', 'No parece un comprobante de pago')
  if (!L.legible) mal('archivo', 'No se lee bien: puede estar borroso o cortado')

  if (L.monto == null) mal('monto', 'No se ve el monto')
  else if (Math.abs(Number(L.monto) - Number(g.amount)) < 0.005) ok('monto', 'El monto ' + soles(L.monto) + ' coincide con la solicitud')
  else mal('monto', 'El comprobante dice ' + soles(L.monto) + ' y la solicitud es de ' + soles(g.amount))
  if (L.moneda === 'USD') mal('monto', 'El comprobante está en DÓLARES, la solicitud es en soles')

  if (!L.fecha) mal('fecha', 'No se ve la fecha del pago')
  else if (L.fecha > hoy) mal('fecha', 'La fecha ' + dmy(L.fecha) + ' es posterior a hoy')
  else if (g.issue_date && L.fecha < sumarDias(g.issue_date, -3)) mal('fecha', 'El pago es del ' + dmy(L.fecha) + ', antes de la solicitud (' + dmy(g.issue_date) + ')')
  else if (L.fecha < sumarDias(hoy, -30)) mal('fecha', 'El pago es del ' + dmy(L.fecha) + ': tiene más de 30 días')
  else ok('fecha', 'Pagado el ' + dmy(L.fecha) + (L.hora ? ' a las ' + L.hora : ''))

  if (!L.destinatario_nombre) duda('destinatario', 'No se ve a quién se pagó: confirma que es ' + (g.recipient || 'quien recibe'))
  else if (mismoNombre(L.destinatario_nombre, g.recipient)) ok('destinatario', 'Pagado a ' + L.destinatario_nombre)
  else mal('destinatario', 'El comprobante está a nombre de ' + L.destinatario_nombre + ' y la solicitud es para ' + (g.recipient || '—'))

  if (!L.numero_operacion) duda('operacion', 'No se ve el número de operación')
  else if (usadoEn.length) mal('operacion', 'La operación ' + L.numero_operacion + ' YA se usó en ' + usadoEn.map(sol).join(', '))
  else ok('operacion', 'Operación ' + L.numero_operacion + (L.banco_o_app ? ' · ' + L.banco_o_app : '') + ', no usada antes')

  if (String(L.observaciones || '').trim()) duda('observaciones', String(L.observaciones).trim())
  return v
}

// lo que devuelve la IA, en limpio: cadenas recortadas y la fecha solo si es AAAA-MM-DD
function limpiar(L) {
  const s = x => (x == null ? null : String(x).trim() || null)
  const fecha = s(L.fecha)
  return {
    es_comprobante: !!L.es_comprobante, legible: !!L.legible, tipo: L.tipo || 'otro',
    monto: L.monto == null || isNaN(Number(L.monto)) ? null : Math.round(Number(L.monto) * 100) / 100,
    moneda: L.moneda || null,
    fecha: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !isNaN(new Date(fecha + 'T12:00:00Z')) ? fecha : null,
    hora: s(L.hora), banco_o_app: s(L.banco_o_app), numero_operacion: s(L.numero_operacion),
    destinatario_nombre: s(L.destinatario_nombre), destinatario_cuenta: s(L.destinatario_cuenta),
    ordenante_nombre: s(L.ordenante_nombre), observaciones: String(L.observaciones || '').trim(),
  }
}

module.exports = function crearLector({ supabase, log }) {
  const CLAVE = process.env.ANTHROPIC_API_KEY || ''
  const ia = CLAVE ? new Anthropic({ apiKey: CLAVE, maxRetries: 2, timeout: 120000 }) : null
  let ocupado = false, avisoSinTabla = false, ultimoRescate = 0

  async function leer(url) {
    if (!ia) throw new Error('el servidor no tiene la clave de Claude (ANTHROPIC_API_KEY)')
    let archivo
    if (/\.pdf(\?|#|$)/i.test(url)) {
      // un PDF se manda entero: es chico (un voucher), no un video
      const r = await fetch(url)
      if (!r.ok) throw new Error('no se pudo abrir el PDF (' + r.status + ')')
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 8 * 1024 * 1024) throw new Error('el PDF pesa más de 8 MB')
      archivo = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
    } else {
      // la foto se pasa por su dirección pública de R2: no se carga en la memoria del droplet
      archivo = { type: 'image', source: { type: 'url', url } }
    }
    const r = await ia.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      system: SISTEMA,
      // si los filtros de seguridad declinan, Anthropic reintenta con el modelo recomendado
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: { type: 'json_schema', schema: ESQUEMA } },
      messages: [{ role: 'user', content: [archivo, { type: 'text', text: 'Lee este comprobante de pago.' }] }],
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
    if (e instanceof Anthropic.BadRequestError) return 'Claude no pudo abrir el archivo (¿formato raro?)'
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
        await supabase.from('comprobante_lecturas').update({ estado: 'pendiente' })
          .eq('estado', 'leyendo').lt('tomado_at', new Date(Date.now() - 3 * 60000).toISOString())
      }
      const { data: pend, error } = await supabase.from('comprobante_lecturas')
        .select('id, expense_id, url, intentos').eq('estado', 'pendiente').order('creado_at').limit(3)
      if (error) { if (!avisoSinTabla) log('LECTOR COMPROBANTES:', error.message, '(¿falta correr sql/103?)'); avisoSinTabla = true; return }
      avisoSinTabla = false
      for (const p of (pend || [])) {
        const { data: tomada } = await supabase.from('comprobante_lecturas')
          .update({ estado: 'leyendo', tomado_at: new Date().toISOString(), intentos: (p.intentos || 0) + 1 })
          .eq('id', p.id).eq('estado', 'pendiente').select('id')
        if (!tomada || !tomada.length) continue
        try {
          const { data: g } = await supabase.from('expenses').select('id, request_number, amount, recipient, issue_date').eq('id', p.expense_id).maybeSingle()
          if (!g) throw new Error('la solicitud ya no existe')
          const L = await leer(p.url)
          let usadoEn = []
          if (L.numero_operacion) {
            const { data: otros } = await supabase.from('expenses').select('request_number').eq('voucher_operacion', L.numero_operacion).neq('id', g.id).limit(5)
            usadoEn = (otros || []).map(o => o.request_number)
          }
          const validacion = validar(g, L, usadoEn)
          const alertas = validacion.filter(x => x.nivel === 'mal').length
          await supabase.from('comprobante_lecturas').update({ estado: 'listo', lectura: L, validacion, alertas, error: null, listo_at: new Date().toISOString() }).eq('id', p.id)
          log('COMPROBANTE IA ✔', sol(g.request_number), alertas ? '→ ' + alertas + ' cosa(s) no cuadran' : '→ todo cuadra')
        } catch (e) {
          const motivo = explicar(e)
          await supabase.from('comprobante_lecturas').update({ estado: 'error', error: motivo, listo_at: new Date().toISOString() }).eq('id', p.id)
          log('COMPROBANTE IA ✗', p.id, motivo)
        }
      }
    } finally { ocupado = false }
  }

  return { procesar }
}
module.exports.validar = validar
module.exports.mismoNombre = mismoNombre
module.exports.limpiar = limpiar
