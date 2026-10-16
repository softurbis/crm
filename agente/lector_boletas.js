// ============================================================================
// LECTOR DE BOLETAS Y FACTURAS SUBIDAS POR FACTURACIÓN, CON IA      [16 oct 2026]
// ----------------------------------------------------------------------------
// La secretaria de la socia (rol facturación) emite la boleta en SU sistema y la
// sube al pago. La base la pone en la cola recibo_lecturas (sql/151) y aquí:
//
//   1. se LEE con Claude, a ciegas: no le decimos qué debería decir, para que no
//      "vea" el monto o el cliente que espera. Sale tipo (boleta/factura), serie y
//      número, fecha, total, RUC del emisor, documento y nombre del cliente, y el
//      lote y las cuotas si la descripción los dice.
//   2. se VALIDA en código contra el pago: total, RUC del proyecto, cliente, la
//      misma boleta subida en otro pago, lote y cuota, fecha.
//
// Con alguna "mal" la boleta queda con ⚠ hasta que facturación marque "Lo revisé";
// a Cami se le avisa antes de mandársela al cliente. Corre dentro de agente-urbis.
// Mismo molde que lector_comprobantes.js (los vouchers de gastos).
// ============================================================================
const { Anthropic } = require('@anthropic-ai/sdk')
const { mismoNombre } = require('./lector_comprobantes')

const MODELO = 'claude-opus-5'
const TZ = 'America/Lima'

const SISTEMA = `Lees comprobantes de venta electrónicos de Perú (SUNAT): boletas de venta, facturas, notas de crédito y de débito. Pueden ser PDF, fotos o capturas, emitidos desde SUNAT (SEE-SOL, series EB01 / E001) o desde un sistema propio (series B001, F001…).

Extrae SOLO lo que está escrito. Si un dato no se ve o no se lee con seguridad, devuélvelo como null: nunca lo completes ni lo adivines.
- es_comprobante_venta: false si no es una boleta, factura o nota (un voucher de banco, una captura de Yape, un recibo interno, un contrato, una foto cualquiera).
- legible: false si está borroso, cortado o no se lee lo principal.
- tipo: "boleta", "factura", "nota_credito", "nota_debito" u "otro", según el TÍTULO del documento.
- serie y numero: tal como están (serie "B001", numero "123"; sin ceros de relleno inventados).
- fecha_emision: AAAA-MM-DD. En Perú las fechas se escriben día/mes/año.
- moneda: PEN para soles (S/), USD para dólares.
- total: el IMPORTE TOTAL del comprobante, como número (S/ 1,230.50 → 1230.5).
- ruc_emisor y razon_social_emisor: de quien emite (arriba, en el recuadro del RUC).
- cliente_doc_tipo ("DNI", "RUC", "CE", "PASAPORTE" u "otro"), cliente_doc_numero y cliente_nombre: a quién se le emitió (señor(es), adquiriente, cliente). Si dice "varios" o no hay documento, null.
- descripcion: el texto de los ítems, junto, en una línea.
- manzana y lote: si la descripción nombra un lote ("MZ A LT 12", "Lote A-12", "Mz. A Lote 12"): la manzana ("A") y el número de lote ("12"). Si no, null.
- cuotas: los números de cuota que dice la descripción ("cuota 5", "cuotas 5 y 6" → [5, 6]). Si no dice, lista vacía.
- observaciones: una línea en español con lo dudoso (montos tachados, datos cortados, signos de edición, sello de anulado). Cadena vacía si no hay nada.`

const nulo = t => ({ anyOf: [{ type: t }, { type: 'null' }] })
const ESQUEMA = {
  type: 'object',
  properties: {
    es_comprobante_venta: { type: 'boolean' },
    legible: { type: 'boolean' },
    tipo: { type: 'string', enum: ['boleta', 'factura', 'nota_credito', 'nota_debito', 'otro'] },
    serie: nulo('string'),
    numero: nulo('string'),
    fecha_emision: { anyOf: [{ type: 'string', format: 'date' }, { type: 'null' }] },
    moneda: { anyOf: [{ type: 'string', enum: ['PEN', 'USD'] }, { type: 'null' }] },
    total: nulo('number'),
    ruc_emisor: nulo('string'),
    razon_social_emisor: nulo('string'),
    cliente_doc_tipo: { anyOf: [{ type: 'string', enum: ['DNI', 'RUC', 'CE', 'PASAPORTE', 'otro'] }, { type: 'null' }] },
    cliente_doc_numero: nulo('string'),
    cliente_nombre: nulo('string'),
    descripcion: nulo('string'),
    manzana: nulo('string'),
    lote: nulo('string'),
    cuotas: { type: 'array', items: { type: 'integer' } },
    observaciones: { type: 'string' },
  },
  required: ['es_comprobante_venta', 'legible', 'tipo', 'serie', 'numero', 'fecha_emision', 'moneda', 'total', 'ruc_emisor',
    'razon_social_emisor', 'cliente_doc_tipo', 'cliente_doc_numero', 'cliente_nombre', 'descripcion', 'manzana', 'lote', 'cuotas', 'observaciones'],
  additionalProperties: false,
}

// ---------------------------------------------------------------- validación (sin IA)
const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const digitos = t => String(t || '').replace(/\D/g, '')
// "Mz. A" → "A", "012" → "12"
const parte = t => String(t || '').toUpperCase().replace(/MZ\.?|MANZANA|LT\.?|LOTE|[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '')
const loteDe = r => r?.lot ? r.lot.mz + '-' + r.lot.lt : null

// filas = las del pago (las partes del depósito que comparten la boleta), con lote, cuota y cliente
// otros = { rucs: [RUC de las otras boletas del proyecto], repetida: {lote, fecha} | null }
function validar(L, filas, proyecto, otros, hoy = hoyLima()) {
  const v = []
  const ok = (campo, texto) => v.push({ nivel: 'ok', campo, texto })
  const duda = (campo, texto) => v.push({ nivel: 'duda', campo, texto })
  const mal = (campo, texto) => v.push({ nivel: 'mal', campo, texto })
  const nombreTipo = { boleta: 'Boleta', factura: 'Factura', nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito' }[L.tipo] || 'Comprobante'
  const sn = L.serie && L.numero ? L.serie + '-' + L.numero : null

  if (!L.es_comprobante_venta) mal('archivo', 'No parece una boleta ni una factura')
  if (!L.legible) mal('archivo', 'No se lee bien: puede estar borroso o cortado')
  if (L.tipo === 'nota_credito' || L.tipo === 'nota_debito') mal('tipo', 'Es una ' + nombreTipo.toLowerCase() + ', no la boleta del pago')
  else if (L.es_comprobante_venta) ok('tipo', nombreTipo + (sn ? ' ' + sn : ''))

  // el total contra el pago entero (una cascada: todas sus partes)
  const total = Math.round(filas.reduce((s, x) => s + Number(x.amount || 0), 0) * 100) / 100
  if (L.total == null) mal('total', 'No se ve el total')
  else if (Math.abs(L.total - total) < 0.05) ok('total', 'El total ' + soles(L.total) + ' coincide con el pago')
  else mal('total', 'La boleta dice ' + soles(L.total) + ' y el pago es de ' + soles(total))
  if (L.moneda === 'USD') mal('total', 'La boleta está en DÓLARES, el pago es en soles')

  // el RUC: el del proyecto si está registrado; si no, el de las otras boletas del proyecto
  const rucP = digitos(proyecto?.fact_ruc)
  const ruc = digitos(L.ruc_emisor)
  const usual = (() => {
    const c = {}; for (const r of otros.rucs) c[r] = (c[r] || 0) + 1
    const [r, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0] || []
    return n >= 2 ? r : null
  })()
  if (!ruc) duda('emisor', 'No se ve el RUC de quien emite')
  else if (rucP && ruc !== rucP) mal('emisor', 'La emite el RUC ' + ruc + (L.razon_social_emisor ? ' (' + L.razon_social_emisor + ')' : '') + ', y el del proyecto es ' + rucP)
  else if (!rucP && usual && ruc !== usual) mal('emisor', 'La emite el RUC ' + ruc + ', distinto al de las otras boletas del proyecto (' + usual + ')')
  else ok('emisor', 'Emite ' + (L.razon_social_emisor || 'RUC') + ' · ' + ruc)

  // el cliente: titular o co-comprador
  const personas = []
  for (const f of filas) for (const p of [f.client, f.sale?.client, f.sale?.co_client]) if (p && !personas.some(x => x.full_name === p.full_name)) personas.push(p)
  const docs = personas.map(p => digitos(p.doc_number)).filter(d => d.length >= 8)
  const docL = digitos(L.cliente_doc_numero)
  const nombreOk = L.cliente_nombre && personas.some(p => mismoNombre(L.cliente_nombre, p.full_name))
  const quien = personas.map(p => p.full_name).filter(Boolean).join(' / ') || 'el cliente del lote'
  if (docL && docs.includes(docL)) ok('cliente', 'A nombre de ' + (L.cliente_nombre || 'el cliente') + ' · ' + (L.cliente_doc_tipo || 'doc') + ' ' + docL)
  else if (docL && docL.length === 11 && L.tipo === 'factura') {
    if (nombreOk) ok('cliente', 'Factura a ' + L.cliente_nombre + ' · RUC ' + docL)
    else duda('cliente', 'Factura a ' + (L.cliente_nombre || 'una empresa') + ' (RUC ' + docL + '): confirma que es de ' + quien)
  } else if (docL && nombreOk) mal('cliente', 'El ' + (L.cliente_doc_tipo || 'documento') + ' de la boleta (' + docL + ') no es el de ' + L.cliente_nombre + ' en su ficha (' + (docs.join(' / ') || 'sin documento') + ')')
  else if (docL) mal('cliente', 'Está a nombre de ' + (L.cliente_nombre || '—') + ' (' + (L.cliente_doc_tipo || 'doc') + ' ' + docL + ') y el pago es de ' + quien)
  else if (L.cliente_nombre && !nombreOk) mal('cliente', 'Está a nombre de ' + L.cliente_nombre + ' y el pago es de ' + quien)
  else if (nombreOk) ok('cliente', 'A nombre de ' + L.cliente_nombre + ' (sin documento)')
  else duda('cliente', 'No se ve a nombre de quién está: confirma que es de ' + quien)

  // la misma boleta subida en otro pago
  if (otros.repetida) mal('numero', 'La ' + nombreTipo.toLowerCase() + ' ' + sn + ' YA está subida en otro pago' +
    (otros.repetida.lote ? ' (lote ' + otros.repetida.lote + (otros.repetida.fecha ? ', ' + dmy(otros.repetida.fecha) : '') + ')' : ''))
  else if (sn) ok('numero', sn + ' no está subida en otro pago')

  // lote y cuota, si la descripción los dice
  const lotes = [...new Set(filas.map(loteDe).filter(Boolean))]
  if (L.manzana || L.lote) {
    const leido = parte(L.manzana) + '-' + parte(L.lote)
    if (lotes.some(l => { const [m, n] = l.split('-'); return parte(m) + '-' + parte(n) === leido })) ok('lote', 'Dice el lote ' + leido)
    else mal('lote', 'La boleta dice el lote ' + leido + ' y el pago es del ' + (lotes.join(', ') || '—'))
  }
  const cuotas = [...new Set(filas.filter(x => x.income_type === 'cuota' && x.installment).map(x => x.installment.installment_number))]
  if ((L.cuotas || []).length && cuotas.length) {
    const faltan = L.cuotas.filter(n => !cuotas.includes(n))
    if (faltan.length) duda('cuota', 'La boleta dice cuota ' + L.cuotas.join(' y ') + ' y el pago es de la cuota ' + cuotas.sort((a, b) => a - b).join(' y '))
    else ok('cuota', 'Dice la cuota ' + L.cuotas.join(' y '))
  }

  // la fecha: no del futuro, y no mucho antes del pago
  const pagado = filas.map(x => x.date).filter(Boolean).sort()[0]
  if (!L.fecha_emision) duda('fecha', 'No se ve la fecha de emisión')
  else if (L.fecha_emision > hoy) mal('fecha', 'La fecha ' + dmy(L.fecha_emision) + ' es posterior a hoy')
  else if (pagado && L.fecha_emision < sumarDias(pagado, -5)) duda('fecha', 'Emitida el ' + dmy(L.fecha_emision) + ', antes del pago (' + dmy(pagado) + ')')
  else ok('fecha', 'Emitida el ' + dmy(L.fecha_emision))

  if (String(L.observaciones || '').trim()) duda('observaciones', String(L.observaciones).trim())
  return v
}

function limpiar(L) {
  const s = x => (x == null ? null : String(x).trim() || null)
  const fecha = s(L.fecha_emision)
  return {
    es_comprobante_venta: !!L.es_comprobante_venta, legible: !!L.legible, tipo: L.tipo || 'otro',
    serie: s(L.serie)?.toUpperCase() || null, numero: s(L.numero) ? String(Number(digitos(L.numero)) || s(L.numero)) : null,
    fecha_emision: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !isNaN(new Date(fecha + 'T12:00:00Z')) ? fecha : null,
    moneda: L.moneda || null,
    total: L.total == null || isNaN(Number(L.total)) ? null : Math.round(Number(L.total) * 100) / 100,
    ruc_emisor: digitos(L.ruc_emisor) || null, razon_social_emisor: s(L.razon_social_emisor),
    cliente_doc_tipo: L.cliente_doc_tipo || null, cliente_doc_numero: s(L.cliente_doc_numero), cliente_nombre: s(L.cliente_nombre),
    descripcion: s(L.descripcion), manzana: s(L.manzana), lote: s(L.lote),
    cuotas: Array.isArray(L.cuotas) ? [...new Set(L.cuotas.map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 1000))] : [],
    observaciones: String(L.observaciones || '').trim(),
  }
}

const NAVEGADOR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }

module.exports = function crearLectorBoletas({ supabase, log }) {
  const CLAVE = process.env.ANTHROPIC_API_KEY || ''
  const ia = CLAVE ? new Anthropic({ apiKey: CLAVE, maxRetries: 2, timeout: 120000 }) : null
  let ocupado = false, avisoSinTabla = false, ultimoRescate = 0

  async function leer(url) {
    if (!ia) throw new Error('el servidor no tiene la clave de Claude (ANTHROPIC_API_KEY)')
    // se baja aquí, como navegador (R2 le da 403 a quien no lo parece), y se manda entero
    const r = await fetch(url, { headers: NAVEGADOR })
    if (!r.ok) throw new Error('no se pudo abrir el archivo (' + r.status + ')')
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 8 * 1024 * 1024) throw new Error('el archivo pesa más de 8 MB')
    const tipo = String(r.headers.get('content-type') || '').toLowerCase()
    const pdf = /\.pdf(\?|#|$)/i.test(url) || tipo.includes('pdf')
    const img = (tipo.match(/image\/(jpeg|png|webp|gif)/) || [])[0] || (/\.png(\?|$)/i.test(url) ? 'image/png' : /\.webp(\?|$)/i.test(url) ? 'image/webp' : 'image/jpeg')
    const archivo = pdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: img, data: buf.toString('base64') } }
    const res = await ia.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      system: SISTEMA,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { format: { type: 'json_schema', schema: ESQUEMA } },
      messages: [{ role: 'user', content: [archivo, { type: 'text', text: 'Lee este comprobante.' }] }],
    })
    if (res.stop_reason === 'refusal') throw new Error('la IA no pudo leer este archivo')
    if (res.stop_reason === 'max_tokens') throw new Error('la lectura quedó incompleta')
    return limpiar(JSON.parse(res.content.filter(b => b.type === 'text').map(b => b.text).join('')))
  }

  function explicar(e) {
    if (e instanceof Anthropic.AuthenticationError) return 'la clave de Claude no es válida'
    if (e instanceof Anthropic.RateLimitError) return 'se llegó al límite de uso de Claude: se reintenta solo'
    if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(String(e.message))) return 'la cuenta de Claude no tiene crédito'
    if (e instanceof Anthropic.BadRequestError) return 'Claude no pudo abrir el archivo (¿formato raro?)'
    if (e instanceof SyntaxError) return 'la lectura vino en un formato inesperado'
    return String(e?.message || e).slice(0, 200)
  }

  async function procesar() {
    if (ocupado) return
    ocupado = true
    try {
      if (Date.now() - ultimoRescate > 60000) {
        ultimoRescate = Date.now()
        await supabase.from('recibo_lecturas').update({ estado: 'pendiente' })
          .eq('estado', 'leyendo').lt('tomado_at', new Date(Date.now() - 3 * 60000).toISOString())
      }
      const { data: pend, error } = await supabase.from('recibo_lecturas')
        .select('id, url, project_id, intentos').eq('estado', 'pendiente').order('creado_at').limit(3)
      if (error) { if (!avisoSinTabla) log('LECTOR BOLETAS:', error.message, '(¿falta correr sql/151?)'); avisoSinTabla = true; return }
      avisoSinTabla = false
      for (const p of (pend || [])) {
        const { data: tomada } = await supabase.from('recibo_lecturas')
          .update({ estado: 'leyendo', tomado_at: new Date().toISOString(), intentos: (p.intentos || 0) + 1 })
          .eq('id', p.id).eq('estado', 'pendiente').select('id')
        if (!tomada || !tomada.length) continue
        try {
          const { data: filas } = await supabase.from('daily_income')
            .select('id, date, amount, income_type, lot:lots(mz, lt), installment:installments(installment_number), client:clients(full_name, doc_number), sale:sales(client:clients!sales_client_id_fkey(full_name, doc_number), co_client:clients!sales_co_client_id_fkey(full_name, doc_number))')
            .eq('receipt_url', p.url).eq('approved', true)
          if (!filas || !filas.length) throw new Error('el pago ya no tiene esta boleta')
          const { data: proyecto } = await supabase.from('projects').select('name, fact_ruc').eq('id', p.project_id).maybeSingle()
          const L = await leer(p.url)
          const sn = L.serie && L.numero ? L.serie + '-' + L.numero : null
          const { data: otras } = await supabase.from('recibo_lecturas').select('url, ruc_emisor, serie_numero')
            .eq('project_id', p.project_id).eq('estado', 'listo').neq('id', p.id).limit(500)
          let repetida = null
          const igual = sn && (otras || []).find(o => o.serie_numero === sn && (!L.ruc_emisor || !o.ruc_emisor || o.ruc_emisor === L.ruc_emisor))
          if (igual) {
            const { data: f } = await supabase.from('daily_income').select('date, lot:lots(mz, lt)').eq('receipt_url', igual.url).limit(1)
            repetida = { lote: loteDe(f?.[0]), fecha: f?.[0]?.date || null }
          }
          const validacion = validar(L, filas, proyecto, { rucs: (otras || []).map(o => o.ruc_emisor).filter(Boolean), repetida })
          const alertas = validacion.filter(x => x.nivel === 'mal').length
          await supabase.from('recibo_lecturas').update({
            estado: 'listo', lectura: L, validacion, alertas, error: null, listo_at: new Date().toISOString(),
            tipo: L.es_comprobante_venta ? L.tipo : 'otro', serie_numero: sn, ruc_emisor: L.ruc_emisor,
          }).eq('id', p.id)
          // el N° ya no se le pregunta a facturación: queda como nota del comprobante si no tenía
          if (sn) await supabase.from('daily_income').update({ receipt_note: sn }).eq('receipt_url', p.url).is('receipt_note', null)
          log('BOLETA IA ✔', sn || p.url.split('/').pop(), alertas ? '→ ' + alertas + ' cosa(s) no cuadran' : '→ todo cuadra')
        } catch (e) {
          const motivo = explicar(e)
          // límite de uso: vuelve a la cola sola (hasta 5 veces); lo demás queda en error con su motivo
          const reintenta = e instanceof Anthropic.RateLimitError && (p.intentos || 0) < 5
          await supabase.from('recibo_lecturas').update(reintenta
            ? { estado: 'pendiente', error: motivo }
            : { estado: 'error', error: motivo, listo_at: new Date().toISOString() }).eq('id', p.id)
          log('BOLETA IA ✗', p.id, motivo)
        }
      }
    } finally { ocupado = false }
  }

  return { procesar }
}
module.exports.validar = validar
module.exports.limpiar = limpiar
