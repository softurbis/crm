// ============================================================================
// EL VOUCHER DEL COBRO, CON IA  +  LA APROBACIÓN DEL VOUCHER REPETIDO   [16 oct 2026]
// ----------------------------------------------------------------------------
// 1. LECTURA (voucher_lecturas, sql/154): al elegir el voucher en "Cobrar", el panel
//    sube una copia y la pide. Aquí se lee con Claude, a ciegas: monto, fecha, hora,
//    N° de operación, banco y app (con qué pagó el cliente: eso va en "Banco /
//    cuenta", decisión del dueño), a quién y quién pagó. Y se mira si ese N° de
//    operación con ese monto ya está registrado, en cualquier proyecto.
// 2. APROBACIÓN (voucher_aprobaciones): si la secretaria pide aprobar un voucher
//    repetido, al superusuario le llega un Telegram con ✅ Aprobar / ❌ Rechazar.
//    El botón vuelve por manejarBotonTg (index.js) → boton().
// Corre dentro de agente-urbis. Mismo molde que lector_comprobantes.js.
// ============================================================================
const { Anthropic } = require('@anthropic-ai/sdk')

const MODELO = 'claude-opus-5'

const SISTEMA = `Lees comprobantes de pago de Perú que un cliente manda para pagar una cuota: capturas de Yape o Plin, vouchers de transferencia o de app bancaria (BCP, Interbank, BBVA, Scotiabank, Banco de la Nación, BanBif, Pichincha, cajas municipales), depósitos en ventanilla o agente.

Extrae SOLO lo que está escrito. Si un dato no se ve o no se lee con seguridad, devuélvelo como null: nunca lo completes ni lo adivines.
- monto: el importe pagado, como número (S/ 1,230.50 → 1230.5; "S/ 40" → 40). Si hay comisión o ITF, el monto que se transfirió, no el total con comisiones.
- moneda: PEN para soles (S/), USD para dólares.
- fecha: AAAA-MM-DD. En Perú las fechas se escriben día/mes/año ("16 oct. 2026" → 2026-10-16).
- hora: HH:MM en 24 horas, si aparece.
- numero_operacion: el número de operación, de transacción, de constancia o "código de operación" tal como está escrito (solo el número; NO el "código de seguridad" de Yape de 3 dígitos).
- app: "YAPE", "PLIN" u otra billetera si el comprobante es de una billetera; si no, null.
- banco: el BANCO del comprobante, con su nombre corto: BCP, INTERBANK, BBVA, SCOTIABANK, BANCO DE LA NACION, BANBIF, PICHINCHA, MIBANCO, o la caja (CAJA HUANCAYO…). Yape es del BCP. En un Plin, el banco desde el que se pagó si se ve. null si no se ve.
- tipo: "transferencia", "billetera" (Yape, Plin…), "deposito" (ventanilla o agente) o "efectivo".
- destinatario_nombre y destinatario_cuenta: a quién se pagó y su cuenta, CCI o celular (puede estar con asteriscos).
- ordenante_nombre: quién pagó, si aparece.
- es_comprobante: false si no es un comprobante de pago (una foto cualquiera, un DNI, un chat, una boleta de venta).
- legible: false si está borroso, cortado o no se lee lo principal.
- observaciones: una línea en español con lo dudoso (montos tachados o superpuestos, datos cortados, signos de edición o de captura armada). Cadena vacía si no hay nada.`

const nulo = t => ({ anyOf: [{ type: t }, { type: 'null' }] })
const ESQUEMA = {
  type: 'object',
  properties: {
    es_comprobante: { type: 'boolean' },
    legible: { type: 'boolean' },
    tipo: { type: 'string', enum: ['transferencia', 'billetera', 'deposito', 'efectivo', 'otro'] },
    monto: nulo('number'),
    moneda: { anyOf: [{ type: 'string', enum: ['PEN', 'USD'] }, { type: 'null' }] },
    fecha: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    hora: nulo('string'),
    numero_operacion: nulo('string'),
    app: nulo('string'),
    banco: nulo('string'),
    destinatario_nombre: nulo('string'),
    destinatario_cuenta: nulo('string'),
    ordenante_nombre: nulo('string'),
    observaciones: { type: 'string' },
  },
  required: ['es_comprobante', 'legible', 'tipo', 'monto', 'moneda', 'fecha', 'hora', 'numero_operacion', 'app', 'banco',
    'destinatario_nombre', 'destinatario_cuenta', 'ordenante_nombre', 'observaciones'],
  additionalProperties: false,
}

function limpiar(L) {
  const s = x => (x == null ? null : String(x).trim() || null)
  const fecha = s(L.fecha)
  const op = s(L.numero_operacion)
  return {
    es_comprobante: !!L.es_comprobante, legible: !!L.legible, tipo: L.tipo || 'otro',
    monto: L.monto == null || isNaN(Number(L.monto)) ? null : Math.round(Number(L.monto) * 100) / 100,
    moneda: L.moneda || null,
    fecha: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !isNaN(new Date(fecha + 'T12:00:00Z')) ? fecha : null,
    hora: s(L.hora),
    numero_operacion: op ? op.replace(/\s+/g, '') : null,
    app: s(L.app)?.toUpperCase() || null, banco: s(L.banco)?.toUpperCase() || null,
    destinatario_nombre: s(L.destinatario_nombre), destinatario_cuenta: s(L.destinatario_cuenta),
    ordenante_nombre: s(L.ordenante_nombre), observaciones: String(L.observaciones || '').trim(),
  }
}

const NAVEGADOR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmy = iso => iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : ''

// tg = { enviarBotones(phone, texto, botones) → {chat, msg} | null, editar(chat, msg, texto) }
module.exports = function crearLectorVouchers({ supabase, log, tg }) {
  const CLAVE = process.env.ANTHROPIC_API_KEY || ''
  const ia = CLAVE ? new Anthropic({ apiKey: CLAVE, maxRetries: 2, timeout: 90000 }) : null
  let ocupado = false, avisoSinTabla = false, ultimoRescate = 0, enviando = false

  async function leer(url) {
    if (!ia) throw new Error('el servidor no tiene la clave de Claude (ANTHROPIC_API_KEY)')
    const r = await fetch(url, { headers: NAVEGADOR })
    if (!r.ok) throw new Error('no se pudo abrir el voucher (' + r.status + ')')
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 8 * 1024 * 1024) throw new Error('el archivo pesa más de 8 MB')
    const tipo = String(r.headers.get('content-type') || '').toLowerCase()
    const pdf = /\.pdf(\?|#|$)/i.test(url) || tipo.includes('pdf')
    const img = (tipo.match(/image\/(jpeg|png|webp|gif)/) || [])[0] || (/\.png(\?|$)/i.test(url) ? 'image/png' : /\.webp(\?|$)/i.test(url) ? 'image/webp' : 'image/jpeg')
    const archivo = pdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: img, data: buf.toString('base64') } }
    const res = await ia.beta.messages.create({
      model: MODELO, max_tokens: 16000, system: SISTEMA,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { format: { type: 'json_schema', schema: ESQUEMA } },
      messages: [{ role: 'user', content: [archivo, { type: 'text', text: 'Lee este comprobante de pago.' }] }],
    })
    if (res.stop_reason === 'refusal') throw new Error('la IA no pudo leer este archivo')
    if (res.stop_reason === 'max_tokens') throw new Error('la lectura quedó incompleta')
    return limpiar(JSON.parse(res.content.filter(b => b.type === 'text').map(b => b.text).join('')))
  }

  function explicar(e) {
    if (e instanceof Anthropic.AuthenticationError) return 'la clave de Claude no es válida'
    if (e instanceof Anthropic.RateLimitError) return 'se llegó al límite de uso de Claude'
    if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(String(e.message))) return 'la cuenta de Claude no tiene crédito'
    if (e instanceof Anthropic.BadRequestError) return 'Claude no pudo abrir el archivo (¿formato raro?)'
    if (e instanceof SyntaxError) return 'la lectura vino en un formato inesperado'
    return String(e?.message || e).slice(0, 200)
  }

  // ---------------------------------------------------------------- 1. lecturas
  async function procesar() {
    if (ocupado) return
    ocupado = true
    try {
      if (Date.now() - ultimoRescate > 60000) {
        ultimoRescate = Date.now()
        await supabase.from('voucher_lecturas').update({ estado: 'pendiente' })
          .eq('estado', 'leyendo').lt('tomado_at', new Date(Date.now() - 2 * 60000).toISOString())
      }
      const { data: pend, error } = await supabase.from('voucher_lecturas')
        .select('id, url, intentos').eq('estado', 'pendiente').order('creado_at').limit(4)
      if (error) { if (!avisoSinTabla) log('LECTOR VOUCHERS:', error.message, '(¿falta correr sql/154?)'); avisoSinTabla = true; return }
      avisoSinTabla = false
      // de a varios a la vez: la secretaria está esperando con el cliente al frente
      await Promise.all((pend || []).map(async p => {
        const { data: tomada } = await supabase.from('voucher_lecturas')
          .update({ estado: 'leyendo', tomado_at: new Date().toISOString(), intentos: (p.intentos || 0) + 1 })
          .eq('id', p.id).eq('estado', 'pendiente').select('id')
        if (!tomada || !tomada.length) return
        try {
          const L = await leer(p.url)
          let repetidos = []
          if (L.numero_operacion && L.monto != null) {
            const { data } = await supabase.rpc('voucher_repetidos_de', { p_op: L.numero_operacion, p_monto: L.monto })
            repetidos = Array.isArray(data) ? data : []
          }
          await supabase.from('voucher_lecturas').update({ estado: 'listo', lectura: L, repetidos, error: null, listo_at: new Date().toISOString() }).eq('id', p.id)
          log('VOUCHER IA ✔', (L.app || L.banco || '?') + ' ' + (L.monto != null ? soles(L.monto) : 'sin monto') + ' op ' + (L.numero_operacion || '—') + (repetidos.length ? ' → ⚠ REPETIDO' : ''))
        } catch (e) {
          const motivo = explicar(e)
          await supabase.from('voucher_lecturas').update({ estado: 'error', error: motivo, listo_at: new Date().toISOString() }).eq('id', p.id)
          log('VOUCHER IA ✗', p.id, motivo)
        }
      }))
    } finally { ocupado = false }
  }

  // ---------------------------------------------------------------- 2. aprobaciones
  async function superusuarios() {
    const { data } = await supabase.from('profiles').select('full_name, phone, firma_phone, active').eq('role', 'superuser')
    return (data || []).filter(p => p.active !== false)
      .map(p => ({ nombre: p.full_name, tel: [p.phone, p.firma_phone].map(t => String(t || '').replace(/\D/g, '')).find(t => t.length >= 9) || null }))
      .filter(p => p.tel)
  }
  const textoAprob = (a, quien, proy, lote) =>
    '⚠️ *VOUCHER REPETIDO — ¿lo apruebas?*\n\n' +
    '*' + (proy || 'Proyecto') + '*' + (lote ? ' · lote ' + lote : '') + '\n' +
    'Lo quiere registrar: ' + (quien || '—') + '\n' +
    'N° de operación *' + a.op + '* · ' + soles(a.monto) + (a.fecha ? ' · ' + dmy(a.fecha) : '') + '\n\n' +
    '*Ya está registrado en:*\n' + (a.repetidos || []).map(r => '• ' + (r.proyecto || '') + ' · lote ' + (r.lote || '—') + ' · ' + (r.concepto || '') + ' · ' + soles(r.monto) + ' · ' + dmy(r.fecha)).join('\n') +
    (a.nota ? '\n\nNota: ' + a.nota : '') +
    (a.voucher_url ? '\n\n🧾 Voucher: ' + a.voucher_url : '')

  async function enviarAprobaciones() {
    if (enviando || !tg) return
    enviando = true
    try {
      const { data: pend, error } = await supabase.from('voucher_aprobaciones')
        .select('id, project_id, lot_id, op, monto, fecha, voucher_url, repetidos, nota, pedido_por')
        .is('tg_enviado_at', null).eq('estado', 'pedida').order('creado_at').limit(5)
      if (error || !pend?.length) return
      const sus = await superusuarios()
      for (const a of pend) {
        const [{ data: pr }, { data: lo }, { data: pe }] = await Promise.all([
          supabase.from('projects').select('name').eq('id', a.project_id).maybeSingle(),
          a.lot_id ? supabase.from('lots').select('mz, lt').eq('id', a.lot_id).maybeSingle() : Promise.resolve({ data: null }),
          supabase.from('profiles').select('full_name').eq('id', a.pedido_por).maybeSingle(),
        ])
        const texto = textoAprob(a, pe?.full_name, pr?.name, lo ? lo.mz + '-' + lo.lt : null)
        const mensajes = []
        for (const s of sus) {
          const r = await tg.enviarBotones(s.tel, texto, [[{ t: '✅ Aprobar', d: 'vap:' + a.id + ':si' }, { t: '❌ Rechazar', d: 'vap:' + a.id + ':no' }]]).catch(() => null)
          if (r) mensajes.push(r)
        }
        await supabase.from('voucher_aprobaciones').update({ tg_enviado_at: new Date().toISOString(), tg_mensajes: mensajes }).eq('id', a.id)
        log('VOUCHER REPETIDO → aprobación pedida por Telegram a', mensajes.length, 'superusuario(s)', a.op)
      }
    } finally { enviando = false }
  }

  // el botón de Telegram: dato = "vap:<id>:si|no". phone = el celular de quien lo tocó
  async function boton(chatId, dato, msgId, phone) {
    const m = String(dato).match(/^vap:([0-9a-f-]{36}):(si|no)$/)
    if (!m) return false
    const sus = await superusuarios()
    const yo = sus.find(s => s.tel.slice(-9) === String(phone || '').replace(/\D/g, '').slice(-9))
    if (!yo) { await tg.editar(chatId, msgId, '🔒 Solo el superusuario aprueba vouchers repetidos.'); return true }
    const { data: perfil } = await supabase.from('profiles').select('id').eq('role', 'superuser')
      .or('phone.ilike.%' + yo.tel.slice(-9) + ',firma_phone.ilike.%' + yo.tel.slice(-9)).limit(1)
    const aprobar = m[2] === 'si'
    const { data: hecho } = await supabase.from('voucher_aprobaciones')
      .update({ estado: aprobar ? 'aprobada' : 'rechazada', resuelto_por: perfil?.[0]?.id || null, resuelto_at: new Date().toISOString() })
      .eq('id', m[1]).eq('estado', 'pedida').select('id, op, monto, tg_mensajes')
    const a = hecho?.[0]
    if (!a) { await tg.editar(chatId, msgId, 'Esta aprobación ya estaba resuelta.'); return true }
    const fin = (aprobar ? '✅ *APROBADO*' : '❌ *RECHAZADO*') + ' por ' + yo.nombre + ' · op ' + a.op + ' · ' + soles(a.monto) +
      (aprobar ? '\nYa se puede registrar en el panel.' : '\nNo se registra.')
    for (const t of (a.tg_mensajes || [])) await tg.editar(t.chat, t.msg, fin).catch(() => {})
    log('VOUCHER REPETIDO', aprobar ? 'APROBADO' : 'RECHAZADO', 'por', yo.nombre, a.op)
    return true
  }

  return { procesar, enviarAprobaciones, boton }
}
module.exports.limpiar = limpiar
