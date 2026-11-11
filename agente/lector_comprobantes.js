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

// ---------------------------------------------------------------- REGISTRO DIRECTO (sql/200)
// En los proyectos que registran el gasto directo con el voucher (Las Praderas de
// Pucallpa), un mismo voucher cubre VARIOS gastos, y a veces es una captura con varias
// operaciones. Aquí todavía no hay solicitud con qué comparar: la IA lee cada operación
// y el panel reparte el total en los gastos.
const SISTEMA_DIRECTO = SISTEMA + `

Este comprobante puede mostrar UNA operación de pago o VARIAS (por ejemplo una captura del historial del banco o de Yape con varias transferencias, o una hoja con varios depósitos). En "pagos" devuelve una entrada por CADA operación de pago que se vea, en el orden en que aparecen, con su monto, fecha, hora, número de operación y destinatario. Si es un voucher de una sola operación, "pagos" lleva un solo elemento. No sumes ni dividas importes: cada operación tal como está escrita. No cuentes como pago una comisión o un ITF que acompaña a una transferencia.`

const PAGO = {
  type: 'object',
  properties: {
    monto: nulo('number'),
    fecha: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    hora: nulo('string'),
    numero_operacion: nulo('string'),
    destinatario_nombre: nulo('string'),
    destinatario_cuenta: nulo('string'),
  },
  required: ['monto', 'fecha', 'hora', 'numero_operacion', 'destinatario_nombre', 'destinatario_cuenta'],
  additionalProperties: false,
}
const ESQUEMA_DIRECTO = {
  type: 'object',
  properties: {
    es_comprobante: { type: 'boolean' },
    legible: { type: 'boolean' },
    tipo: { type: 'string', enum: ['transferencia', 'yape', 'plin', 'deposito', 'efectivo', 'otro'] },
    moneda: { anyOf: [{ type: 'string', enum: ['PEN', 'USD'] }, { type: 'null' }] },
    banco_o_app: nulo('string'),
    ordenante_nombre: nulo('string'),
    pagos: { type: 'array', items: PAGO },
    observaciones: { type: 'string' },
  },
  required: ['es_comprobante', 'legible', 'tipo', 'moneda', 'banco_o_app', 'ordenante_nombre', 'pagos', 'observaciones'],
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

// el voucher del registro directo, en limpio: cada operación con su monto, y arriba el
// total (la suma) más los datos de la primera, para que se vea igual que una lectura simple
function limpiarDirecto(L) {
  const s = x => (x == null ? null : String(x).trim() || null)
  const fechaOk = f => f && /^\d{4}-\d{2}-\d{2}$/.test(f) && !isNaN(new Date(f + 'T12:00:00Z')) ? f : null
  const pagos = (Array.isArray(L.pagos) ? L.pagos : []).slice(0, 30).map(p => ({
    monto: p.monto == null || isNaN(Number(p.monto)) ? null : Math.round(Number(p.monto) * 100) / 100,
    fecha: fechaOk(s(p.fecha)), hora: s(p.hora), numero_operacion: s(p.numero_operacion),
    destinatario_nombre: s(p.destinatario_nombre), destinatario_cuenta: s(p.destinatario_cuenta),
  }))
  const conMonto = pagos.filter(p => p.monto != null)
  const total = conMonto.length ? Math.round(conMonto.reduce((t, p) => t + p.monto, 0) * 100) / 100 : null
  const uno = pagos[0] || {}
  return {
    es_comprobante: !!L.es_comprobante, legible: !!L.legible, tipo: L.tipo || 'otro', moneda: L.moneda || null,
    banco_o_app: s(L.banco_o_app), ordenante_nombre: s(L.ordenante_nombre),
    pagos, monto: total, fecha: uno.fecha || null, hora: uno.hora || null,
    numero_operacion: uno.numero_operacion || null, destinatario_nombre: uno.destinatario_nombre || null,
    destinatario_cuenta: uno.destinatario_cuenta || null, observaciones: String(L.observaciones || '').trim(),
  }
}

// sin solicitud con qué comparar: que sea un comprobante legible, en soles, con fecha
// razonable y con operaciones que no se hayan registrado ya en otro gasto.
// usados = { 'OP123': [request_number, …] }
function validarDirecto(L, usados = {}, hoy = hoyLima()) {
  const v = []
  const ok = (campo, texto) => v.push({ nivel: 'ok', campo, texto })
  const duda = (campo, texto) => v.push({ nivel: 'duda', campo, texto })
  const mal = (campo, texto) => v.push({ nivel: 'mal', campo, texto })

  if (!L.es_comprobante) mal('archivo', 'No parece un comprobante de pago')
  if (!L.legible) mal('archivo', 'No se lee bien: puede estar borroso o cortado')
  if (L.moneda === 'USD') mal('monto', 'El comprobante está en DÓLARES: los gastos van en soles')

  const pagos = L.pagos || []
  if (!pagos.length) mal('monto', 'No se ve ninguna operación de pago')
  pagos.forEach((p, i) => {
    const q = pagos.length > 1 ? 'Operación ' + (i + 1) + ': ' : ''
    if (p.monto == null) mal('monto', q + 'no se ve el monto')
    if (!p.fecha) duda('fecha', q + 'no se ve la fecha')
    else if (p.fecha > hoy) mal('fecha', q + 'la fecha ' + dmy(p.fecha) + ' es posterior a hoy')
    else if (p.fecha < sumarDias(hoy, -60)) duda('fecha', q + 'el pago es del ' + dmy(p.fecha) + ': tiene más de 60 días, ¿es el voucher correcto?')
    if (!p.numero_operacion) duda('operacion', q + 'no se ve el número de operación')
    else if ((usados[p.numero_operacion] || []).length) mal('operacion', q + 'la operación ' + p.numero_operacion + ' YA se registró en ' + usados[p.numero_operacion].map(sol).join(', '))
  })
  if (L.monto != null && pagos.length && pagos.every(p => p.monto != null)) {
    ok('monto', pagos.length > 1
      ? pagos.length + ' operaciones por un total de ' + soles(L.monto)
      : 'Monto ' + soles(L.monto) + (L.fecha ? ' · pagado el ' + dmy(L.fecha) + (L.hora ? ' a las ' + L.hora : '') : '')
        + (L.numero_operacion && !(usados[L.numero_operacion] || []).length ? ' · operación ' + L.numero_operacion + ', no usada antes' : ''))
  }
  if (String(L.observaciones || '').trim()) duda('observaciones', String(L.observaciones).trim())
  return v
}

module.exports = function crearLector({ supabase, log }) {
  const CLAVE = process.env.ANTHROPIC_API_KEY || ''
  const ia = CLAVE ? new Anthropic({ apiKey: CLAVE, maxRetries: 2, timeout: 120000 }) : null
  let ocupado = false, avisoSinTabla = false, ultimoRescate = 0

  async function leer(url, directo = false) {
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
      system: directo ? SISTEMA_DIRECTO : SISTEMA,
      // si los filtros de seguridad declinan, Anthropic reintenta con el modelo recomendado
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: { type: 'json_schema', schema: directo ? ESQUEMA_DIRECTO : ESQUEMA } },
      messages: [{ role: 'user', content: [archivo, { type: 'text', text: directo ? 'Lee este comprobante de pago y cada operación que tenga.' : 'Lee este comprobante de pago.' }] }],
    })
    if (r.stop_reason === 'refusal') throw new Error('la IA no pudo leer este archivo')
    if (r.stop_reason === 'max_tokens') throw new Error('la lectura quedó incompleta')
    const texto = r.content.filter(b => b.type === 'text').map(b => b.text).join('')
    return directo ? limpiarDirecto(JSON.parse(texto)) : limpiar(JSON.parse(texto))
  }

  // registro directo (sql/200): todavía no hay gasto; se valida el voucher solo
  async function procesarDirecto(p) {
    const L = await leer(p.url, true)
    const ops = [...new Set(L.pagos.map(x => x.numero_operacion).filter(Boolean))]
    const usados = {}
    if (ops.length) {
      const { data: otros } = await supabase.from('expenses').select('request_number, voucher_operacion').in('voucher_operacion', ops).limit(50)
      for (const o of (otros || [])) (usados[o.voucher_operacion] = usados[o.voucher_operacion] || []).push(o.request_number)
    }
    const validacion = validarDirecto(L, usados)
    const alertas = validacion.filter(x => x.nivel === 'mal').length
    await supabase.from('comprobante_lecturas').update({ estado: 'listo', lectura: L, validacion, alertas, error: null, listo_at: new Date().toISOString() }).eq('id', p.id)
    log('VOUCHER DE GASTOS IA ✔', L.pagos.length + ' operación(es)', soles(L.monto), alertas ? '→ ' + alertas + ' cosa(s) no cuadran' : '→ todo cuadra')
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
      // '*' y no la lista de columnas: así este código corre igual antes y después de sql/200 (modo)
      const { data: pend, error } = await supabase.from('comprobante_lecturas')
        .select('*').eq('estado', 'pendiente').order('creado_at').limit(3)
      if (error) { if (!avisoSinTabla) log('LECTOR COMPROBANTES:', error.message, '(¿falta correr sql/103?)'); avisoSinTabla = true; return }
      avisoSinTabla = false
      for (const p of (pend || [])) {
        const { data: tomada } = await supabase.from('comprobante_lecturas')
          .update({ estado: 'leyendo', tomado_at: new Date().toISOString(), intentos: (p.intentos || 0) + 1 })
          .eq('id', p.id).eq('estado', 'pendiente').select('id')
        if (!tomada || !tomada.length) continue
        try {
          if (p.modo === 'directo' || !p.expense_id) { await procesarDirecto(p); continue }
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
module.exports.validarDirecto = validarDirecto
module.exports.limpiarDirecto = limpiarDirecto
