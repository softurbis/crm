// ============================================================================
// AGENTE DE VENTAS IA — el experimento contra el supervisor        [sep 2026]
// ----------------------------------------------------------------------------
// Vive DENTRO del bot de leads (index.js, Baileys): el lead sigue en el mismo
// chat del mismo número y no nota ningún cambio de canal.
//
//  · Cuando el flujo iba a pasar al lead con un asesor, el reparto decide: de
//    cada 10, N van al agente (ventas_ia_config.ia_por_cada_10) y el resto sigue
//    con el supervisor como siempre. Queda registrado en ventas_ia_leads (sql/91).
//  · Precios y lotes salen SOLO de la base, por herramientas. No da descuentos
//    ni inventa financiamiento.
//  · Propone la visita y avisa al dueño; el dueño la confirma en el panel
//    (Agente de ventas) y recién ahí el agente se la confirma al cliente.
//  · Si le preguntan en serio si es un bot, no lo niega.
//
// Este archivo no toca WhatsApp: index.js le pasa `decir`, `mandarMaterial`,
// `avisar` y `pasarAHumano`, que son los que tienen la sesión y los tiempos.
// ============================================================================
const { Anthropic } = require('@anthropic-ai/sdk')

const TZ = 'America/Lima'
const MODELO_POR_DEFECTO = 'claude-opus-5'
const PANEL = (process.env.PANEL_URL || 'https://panel.urbisgroupinmobiliaria.com')
const WEB = (process.env.WEB_URL || 'https://urbisgroupinmobiliaria.com')

const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const horaLima = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const fechaCorta = iso => iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : ''
const diaSemana = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('es-PE', { weekday: 'long', timeZone: 'UTC' })
const soles = n => 'S/ ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dig = t => String(t || '').replace(/\D/g, '')
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const limpiar = t => String(t || '').replace(/\{nombre\}/g, 'el cliente').replace(/\{proyecto\}/g, 'el proyecto').trim()

// Tipos de mensaje que NO son parte de la conversación con el cliente
const NO_CONVERSACION = new Set(['aviso_admin', 'reporte', 'interno', 'secretaria', 'label_panel', 'vcard_panel', 'edit_panel', 'redirige_cobranza', 'test'])

const PROMPT_BASE = `Eres asesor(a) de ventas de Urbis Group, una empresa que vende lotes de terreno en Ucayali, Perú. Atiendes por WhatsApp a una persona interesada en comprar un lote, que pidió hablar con un asesor. Llegaste a una conversación que ya empezó: antes que tú le escribió el bot automático del mismo número.

Tu objetivo es que la persona visite el proyecto. Una visita agendada es el resultado que importa; venderle en el chat no.

CÓMO VENDES
- Primero entiende a la persona, después recomienda. Averigua, de a una pregunta por mensaje y sin que parezca un formulario: para qué quiere el lote (vivir, construir y alquilar, invertir, negocio), cuánto piensa invertir o qué cuota mensual le acomoda, para cuándo, y quién más decide la compra.
- Cuando ya sabes lo que busca, recomienda uno a tres lotes concretos que le calcen, con su precio real, y dile por qué le convienen a él o ella en particular.
- Las dudas y objeciones se atienden con empatía y con datos de la ficha. Nada de presión ni de urgencia falsa: solo di que quedan pocos lotes si la herramienta lo muestra así.
- Para agendar, ofrece dos opciones concretas ("¿te acomoda más el sábado en la mañana o el domingo?"). Cuando la persona acepte un día y una hora, regístralo con proponer_visita y dile que en un momento se la confirmas. La visita NO está confirmada hasta que te avisen.
- Si todavía no quiere visitar, no insistas: ofrécele fotos o el video del proyecto, resuelve lo que le falte y pregúntale cuándo le vendría bien retomar.
- Cada vez que la persona te dé un dato nuevo (su nombre, presupuesto, para qué lo quiere, cuándo compraría), guárdalo con guardar_datos_cliente sin mencionárselo.

REGLAS QUE NO SE ROMPEN
1. Precios, áreas y lotes disponibles salen SOLO de lotes_disponibles, consultada en esta conversación. Nunca estimes ni redondees un precio de memoria.
2. Inicial, cuotas, financiamiento, intereses, títulos y habilitación: solo lo que diga la ficha del proyecto. Si la ficha no lo dice, dilo con naturalidad ("eso te lo confirmo") y anótalo en la nota de la visita; si la persona necesita la respuesta para seguir, usa pasar_a_persona.
3. No das descuentos, no congelas precios, no separas lotes, no recibes pagos, no pides fotos de DNI ni datos bancarios. Si quiere separar, pagar o negociar el precio, usa pasar_a_persona.
4. Reclamos, dudas legales o del contrato que no estén en la ficha, o una persona que ya es cliente y pregunta por sus cuotas: pasar_a_persona.
5. Si la persona pide hablar con otra persona, usa pasar_a_persona sin insistir.
6. Si la persona pregunta en serio si está hablando con un robot, un bot o una inteligencia artificial, no lo niegues: dile con naturalidad que eres el asistente virtual del equipo de ventas de Urbis y que, si lo prefiere, una persona del equipo le escribe. Si no lo pregunta, no hace falta mencionarlo.
7. Nunca menciones herramientas, sistemas, bases de datos ni "consultar". Como mucho: "déjame revisar".

CÓMO ESCRIBES
- Como una persona de ventas por WhatsApp, en español peruano, cálido y claro. Tutea, como el bot; si la persona trata de usted, pasa a usted.
- Mensajes cortos. Si tu respuesta tiene más de una idea, sepárala con una línea en blanco: cada parte sale como un mensaje aparte. Máximo tres mensajes por respuesta, cada uno de una a tres líneas.
- Nada de listas con viñetas, títulos ni formato de documento. *Negrita* muy de vez en cuando. Emojis con moderación: uno de vez en cuando, nunca varios seguidos.
- No repitas lo que el bot o tú ya dijeron. No te despidas en cada mensaje. No empieces todos los mensajes con el nombre de la persona.
- Montos como S/ 25,000 y fechas como "el sábado 20".
- Los mensajes marcados [bot] los mandó el bot automático antes de que llegaras; los marcados [equipo] los escribió una persona de Urbis. Para la persona todo es la misma conversación: no te contradigas con eso.
- Una nota entre corchetes que empieza con "Nota interna" es del sistema, no de la persona: síguela sin mencionarla.

<tone_preference>
Mantén las respuestas breves y enfocadas.
</tone_preference>`

const HERRAMIENTAS = [
  {
    name: 'lotes_disponibles',
    description: 'Lotes DISPONIBLES de un proyecto con área, precio total, precio por m² e inicial, tal como están hoy en el sistema, más un resumen (cuántos quedan, rango de precios y áreas). Úsala antes de dar cualquier precio o de decir qué lotes hay.',
    input_schema: {
      type: 'object',
      properties: {
        proyecto: { type: 'string', description: 'Nombre del proyecto. Vacío = el proyecto por el que escribió la persona.' },
        presupuesto_max: { type: 'number', description: 'Precio total máximo en soles.' },
        area_min: { type: 'number', description: 'Área mínima en m².' },
        manzana: { type: 'string', description: 'Letra o código de manzana, por ejemplo "B".' },
        orden: { type: 'string', enum: ['precio', 'area'], description: 'precio = más económicos primero; area = más grandes primero.' },
      },
    },
  },
  {
    name: 'otros_proyectos',
    description: 'Los demás proyectos de Urbis con lotes a la venta: nombre, ubicación, cuántos lotes quedan y rango de precios. Úsala solo si la persona pregunta por otras opciones o el proyecto no le calza.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'guardar_datos_cliente',
    description: 'Guarda en la ficha del lead lo que vas sabiendo. Llámala apenas la persona te dé un dato nuevo, sin mencionárselo.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre como la persona se presentó.' },
        presupuesto_soles: { type: 'number' },
        para_que: { type: 'string', enum: ['vivir', 'construir_y_alquilar', 'inversion', 'negocio', 'otro'] },
        cuando_compra: { type: 'string', description: 'Por ejemplo "este mes", "después de su gratificación".' },
        interes: { type: 'string', enum: ['frio', 'tibio', 'caliente'] },
        nota: { type: 'string', description: 'Un dato útil para quien la atienda después, en una línea.' },
      },
    },
  },
  {
    name: 'proponer_visita',
    description: 'Registra la visita que acordaste con la persona y avisa al encargado para que la confirme. NO queda confirmada: dile que en un momento se la confirmas. Si ya había una propuesta abierta, la reemplaza.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'YYYY-MM-DD, según la fecha de hoy que tienes.' },
        hora: { type: 'string', description: 'HH:MM en 24 horas, hora de Lima.' },
        personas: { type: 'integer', description: 'Cuántas personas vienen, si lo dijo.' },
        lote_interes: { type: 'string', description: 'Lote o lotes que quiere ver, por ejemplo "Mz B Lt 7".' },
        nota: { type: 'string', description: 'Resumen para quien la recibe: qué busca, presupuesto, dudas pendientes, cómo llega.' },
      },
      required: ['fecha', 'hora', 'nota'],
    },
  },
  {
    name: 'enviar_material',
    description: 'Envía a la persona fotos, videos, planos o enlaces del catálogo del proyecto (los ids están en la ficha). Máximo 3 por vez, salen en el orden dado.',
    input_schema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, maxItems: 3 } },
      required: ['ids'],
    },
  },
  {
    name: 'pasar_a_persona',
    description: 'Deja la conversación en manos de una persona del equipo y le avisa. Después de usarla, dile a la persona en un mensaje corto que en breve le escriben.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'Por qué, en una línea: qué pidió o qué no pudiste resolver.' } },
      required: ['motivo'],
    },
  },
]

module.exports = function crearVentasIA({ supabase, log }) {
  const CLAVE = process.env.VENTAS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || ''
  const CLAVE_PROPIA = !!process.env.VENTAS_ANTHROPIC_API_KEY
  const ia = CLAVE ? new Anthropic({ apiKey: CLAVE, maxRetries: 2, timeout: 180000 }) : null

  // ---------------------------------------------------------------- config
  let CFG = null, cfgAt = 0
  async function config(fresca = false) {
    if (!fresca && CFG && Date.now() - cfgAt < 20000) return CFG
    const { data, error } = await supabase.from('ventas_ia_config').select('*').eq('id', 1).maybeSingle()
    if (error) { if (!CFG) log('VENTAS IA config:', error.message, '(¿falta correr sql/91?)'); return CFG }
    CFG = data || null
    cfgAt = Date.now()
    return CFG
  }
  // ms de "lectura" antes de contestar, al azar entre lo configurado
  function esperaLectura(esPrueba) {
    const c = CFG || {}
    const min = Number(c.lectura_min_seg ?? 8), max = Math.max(min, Number(c.lectura_max_seg ?? 25))
    const ms = (min + Math.random() * (max - min)) * 1000
    return esPrueba ? Math.min(2000, ms / 10) : ms
  }
  function enHorario(c) {
    const ahora = horaLima()
    return ahora >= String(c?.hora_inicio || '07:30').slice(0, 5) && ahora < String(c?.hora_fin || '21:30').slice(0, 5)
  }

  // ---------------------------------------------------------------- reparto
  // Bloques de 10: en cada bloque salen exactamente N al agente, en posiciones al
  // azar. Con pocos leads una moneda puede dar 0 de 10 o 6 de 10, y el
  // experimento no mediría nada.
  async function asignar(lead, { phone, motivo, esPrueba }) {
    if (!lead?.id) return null
    const { data: ya } = await supabase.from('ventas_ia_leads').select('grupo').eq('lead_id', lead.id).maybeSingle()
    if (ya) return ya.grupo
    const cfg = await config(true)
    if (!cfg) return null                                    // sql/91 sin correr: todo sigue como antes
    let grupo
    if (esPrueba) grupo = 'ia'                               // desde Probar Bot siempre se prueba el agente
    else {
      if (!cfg.activo || motivo === 'sin_proyectos_bot') return null
      const { count } = await supabase.from('ventas_ia_leads').select('lead_id', { count: 'exact', head: true }).eq('es_prueba', false)
      const pos = (count || 0) % 10
      let iaEnBloque = 0
      if (pos > 0) {
        const { data: ult } = await supabase.from('ventas_ia_leads').select('grupo').eq('es_prueba', false).order('asignado_at', { ascending: false }).limit(pos)
        iaEnBloque = (ult || []).filter(x => x.grupo === 'ia').length
      }
      const cupo = Math.max(0, Number(cfg.ia_por_cada_10 ?? 3) - iaEnBloque)
      grupo = Math.random() < cupo / (10 - pos) ? 'ia' : 'humano'
    }
    const { error } = await supabase.from('ventas_ia_leads').insert({
      lead_id: lead.id, grupo, es_prueba: !!esPrueba, motivo: motivo || null, project_id: lead.project_id || null, phone: dig(phone),
    })
    if (error) {
      const { data: otra } = await supabase.from('ventas_ia_leads').select('grupo').eq('lead_id', lead.id).maybeSingle()
      return otra ? otra.grupo : null
    }
    log('VENTAS IA: lead', dig(phone), '→ grupo', grupo.toUpperCase(), esPrueba ? '[PRUEBA]' : '')
    return grupo
  }

  // ---------------------------------------------------------------- ficha
  const fichas = new Map()
  async function proyecto(pid) {
    const hit = fichas.get(pid)
    if (hit && Date.now() - hit.t < 300000) return hit.p
    const { data: p } = await supabase.from('projects').select('*').eq('id', pid).maybeSingle()
    fichas.set(pid, { t: Date.now(), p })
    return p
  }
  function flujoDe(p) { try { const f = p?.bot_flow; return (typeof f === 'string' ? JSON.parse(f) : f) || {} } catch { return {} } }

  function fichaTexto(p) {
    if (!p) return 'FICHA DEL PROYECTO: la persona todavía no eligió proyecto. Pregúntale cuál le interesa o usa otros_proyectos.'
    const l = ['FICHA DEL PROYECTO: ' + p.name]
    const ubic = [p.ubicacion_txt, p.maps_url || (p.latitude && p.longitude ? `https://maps.google.com/?q=${p.latitude},${p.longitude}` : '')].filter(Boolean)
    if (ubic.length) l.push('Ubicación: ' + ubic.join(' · '))
    if (p.office_address) l.push('Oficina: ' + p.office_address)
    if (p.landing_activa && p.slug) l.push('Página del proyecto (se puede compartir): ' + WEB + '/p/' + p.slug)
    else if (p.info_url) l.push('Más información (se puede compartir): ' + p.info_url)
    if (p.video_url) l.push('Video (se puede compartir): ' + p.video_url)
    for (const [k, t] of [['titular', 'Frase principal'], ['subtitulo', 'Subtítulo'], ['descripcion', 'Descripción'], ['precio_desde_txt', 'Precio desde (publicado)'], ['inicial_desde', 'Inicial desde (publicado)'], ['cuotas_txt', 'Cuotas (publicado)'], ['legal_txt', 'Situación legal (publicada)']])
      if (p[k] && String(p[k]).trim()) l.push(t + ': ' + String(p[k]).trim())
    const ben = Array.isArray(p.beneficios) ? p.beneficios : []
    if (ben.length) l.push('Beneficios:\n' + ben.map(b => '- ' + [b.titulo, b.texto].filter(Boolean).join(': ')).join('\n'))
    const flow = flujoDe(p)
    const pasos = (flow.steps || []).map(s => {
      const partes = [limpiar(s.texto)]
      for (const o of (s.opciones || [])) if (o.respuesta) partes.push('(si elige "' + o.label + '") ' + limpiar(o.respuesta))
      return partes.filter(Boolean).join(' ')
    }).filter(Boolean)
    if (pasos.length) l.push('LO QUE DICE EL BOT DE ESTE PROYECTO (es información oficial; no la repitas si ya se envió):\n' + pasos.map(t => '- ' + t.replace(/\s+/g, ' ').slice(0, 600)).join('\n'))
    const mat = (flow.media_lib || []).filter(m => m && m.url)
    if (mat.length) l.push('MATERIAL QUE PUEDES ENVIAR con enviar_material (id · tipo · qué es):\n' + mat.map(m => '- ' + m.id + ' · ' + (m.tipo || 'imagen') + ' · ' + limpiar(m.desc || 'sin descripción')).join('\n'))
    return l.join('\n')
  }

  // ---------------------------------------------------------------- herramientas
  async function lotesDe(pid) {
    const out = []
    for (let desde = 0; ; desde += 1000) {    // Supabase corta en silencio a las 1000 filas
      const { data, error } = await supabase.from('lots').select('id, mz, lt, area_m2, price_per_m2, total_price, initial_payment_default')
        .eq('project_id', pid).eq('status', 'disponible').order('id').range(desde, desde + 999)
      if (error) throw new Error(error.message)
      out.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    return out
  }
  async function proyectosALaVenta() {
    const { data } = await supabase.from('projects').select('id, name, ubicacion_txt, bot_enabled').order('name')
    return (data || []).filter(p => p.bot_enabled !== false)
  }
  async function proyectoPorNombre(nombre) {
    const t = String(nombre || '').toLowerCase()
    const lista = await proyectosALaVenta()
    return lista.find(p => p.name.toLowerCase() === t) ||
      lista.find(p => p.name.toLowerCase().split(/\s+/).filter(w => w.length > 3).some(w => t.includes(w))) || null
  }

  async function lotesDisponibles(ctx, input) {
    let pid = ctx.lead.project_id, nombre = null
    if (input.proyecto) {
      const p = await proyectoPorNombre(input.proyecto)
      if (!p) return { error: 'No encontré ese proyecto. Usa otros_proyectos para ver los nombres.' }
      pid = p.id; nombre = p.name
    }
    if (!pid) return { error: 'La persona todavía no eligió proyecto: pregúntale cuál le interesa o usa otros_proyectos.' }
    if (!nombre) nombre = (await proyecto(pid))?.name || ''
    const todos = await lotesDe(pid)
    if (!todos.length) return { proyecto: nombre, disponibles: 0, nota: 'No quedan lotes disponibles en este proyecto. Ofrece otros_proyectos.' }
    const precios = todos.map(l => Number(l.total_price)), areas = todos.map(l => Number(l.area_m2))
    const iniciales = todos.map(l => Number(l.initial_payment_default)).filter(n => n > 0)
    const mz = String(input.manzana || '').trim().toUpperCase()
    let lista = todos.filter(l =>
      (!input.presupuesto_max || Number(l.total_price) <= Number(input.presupuesto_max)) &&
      (!input.area_min || Number(l.area_m2) >= Number(input.area_min)) &&
      (!mz || String(l.mz).toUpperCase() === mz))
    lista.sort(input.orden === 'area' ? (a, b) => b.area_m2 - a.area_m2 : (a, b) => a.total_price - b.total_price)
    return {
      proyecto: nombre,
      disponibles: todos.length,
      precio_desde: soles(Math.min(...precios)), precio_hasta: soles(Math.max(...precios)),
      area_desde_m2: Math.min(...areas), area_hasta_m2: Math.max(...areas),
      inicial_mas_comun: iniciales.length ? soles(moda(iniciales)) : null,
      cumplen_el_filtro: lista.length,
      lotes: lista.slice(0, 8).map(l => ({
        lote: 'Mz ' + l.mz + ' Lt ' + l.lt, area_m2: Number(l.area_m2),
        precio_total: soles(l.total_price), precio_m2: soles(l.price_per_m2), inicial: soles(l.initial_payment_default),
      })),
    }
  }
  function moda(arr) { const c = new Map(); for (const x of arr) c.set(x, (c.get(x) || 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0] }

  async function otrosProyectos() {
    const out = []
    for (const p of await proyectosALaVenta()) {
      const ls = await lotesDe(p.id)
      if (!ls.length) continue
      const pr = ls.map(l => Number(l.total_price))
      out.push({ proyecto: p.name, ubicacion: p.ubicacion_txt || null, disponibles: ls.length, precio_desde: soles(Math.min(...pr)), precio_hasta: soles(Math.max(...pr)) })
    }
    return { proyectos: out }
  }

  async function guardarDatos(ctx, input) {
    const upd = {}
    const nombre = String(input.nombre || '').replace(/[^\p{L}\s'.-]/gu, ' ').replace(/\s+/g, ' ').trim()
    if (nombre.length >= 2 && nombre.length <= 60) upd.full_name = nombre.toUpperCase()
    if (Number(input.presupuesto_soles) > 0) upd.budget_estimate = Number(input.presupuesto_soles)
    if (['frio', 'tibio', 'caliente'].includes(input.interes)) upd.temperature = input.interes
    if (Object.keys(upd).length) {
      const { error } = await supabase.from('leads').update(upd).eq('id', ctx.lead.id)
      if (error) return { error: error.message }
      Object.assign(ctx.lead, upd)
    }
    const partes = [
      input.para_que && 'PARA: ' + input.para_que.replace(/_/g, ' '),
      upd.budget_estimate && 'PRESUPUESTO: ' + soles(upd.budget_estimate),
      input.cuando_compra && 'COMPRA: ' + input.cuando_compra,
      input.nota,
    ].filter(Boolean)
    if (partes.length) await supabase.from('lead_activities').insert({ lead_id: ctx.lead.id, note: ('AGENTE IA · ' + partes.join(' · ')).toUpperCase().slice(0, 500) })
    return { ok: true }
  }

  async function proponerVisita(ctx, input) {
    const fecha = String(input.fecha || '').trim(), hora = String(input.hora || '').trim().slice(0, 5)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(new Date(fecha + 'T12:00:00Z'))) return { error: 'Fecha inválida: usa YYYY-MM-DD.' }
    if (!/^\d{2}:\d{2}$/.test(hora)) return { error: 'Hora inválida: usa HH:MM en 24 horas.' }
    const hoy = hoyLima()
    if (fecha < hoy) return { error: 'Esa fecha ya pasó. Hoy es ' + hoy + '.' }
    if (fecha > sumarDias(hoy, 45)) return { error: 'Es muy lejos: propón una fecha dentro de las próximas seis semanas.' }
    if (fecha === hoy && hora <= horaLima()) return { error: 'Esa hora de hoy ya pasó. Son las ' + horaLima() + '.' }
    if (hora < '07:00' || hora > '18:30') return { error: 'Las visitas son de día: propón una hora entre 07:00 y 18:30.' }
    const fila = {
      lead_id: ctx.lead.id, project_id: ctx.lead.project_id || null, fecha, hora,
      personas: Number(input.personas) > 0 ? Math.round(Number(input.personas)) : null,
      lote_interes: input.lote_interes || null, nota: String(input.nota || '').slice(0, 1000) || null,
      es_prueba: !!ctx.esPrueba, updated_at: new Date().toISOString(),
    }
    const { data: abierta } = await supabase.from('ventas_ia_citas').select('id').eq('lead_id', ctx.lead.id).eq('estado', 'por_confirmar').maybeSingle()
    const r = abierta
      ? await supabase.from('ventas_ia_citas').update(fila).eq('id', abierta.id)
      : await supabase.from('ventas_ia_citas').insert(fila)
    if (r.error) return { error: r.error.message }
    await supabase.from('leads').update({ temperature: 'caliente' }).eq('id', ctx.lead.id).then(() => {}, () => {})
    const cuando = diaSemana(fecha) + ' ' + fechaCorta(fecha) + ' · ' + hora
    await supabase.from('lead_activities').insert({ lead_id: ctx.lead.id, note: ('AGENTE IA PROPUSO VISITA: ' + cuando + (fila.lote_interes ? ' · ' + fila.lote_interes : '')).toUpperCase() })
    const p = ctx.lead.project_id ? await proyecto(ctx.lead.project_id) : null
    await ctx.avisar(
      '🤖📅 *VISITA PROPUESTA POR EL AGENTE*' + (abierta ? ' (cambió la anterior)' : '') +
      '\nCliente: ' + (ctx.lead.full_name || '-') + '\nTel: +' + dig(ctx.phone) + '\nProyecto: ' + (p?.name || '-') +
      '\nCuándo: ' + cuando + (fila.personas ? '\nPersonas: ' + fila.personas : '') + (fila.lote_interes ? '\nQuiere ver: ' + fila.lote_interes : '') +
      (fila.nota ? '\n\n📝 ' + fila.nota : '') +
      '\n\n👉 Confírmala o cámbiale la hora: ' + PANEL + '/ventas-ia')
    return { ok: true, estado: 'por confirmar', cuando, para_ti: 'Dile que en un momento le confirmas la visita. No la des por confirmada.' }
  }

  async function enviarMaterial(ctx, input) {
    const p = ctx.lead.project_id ? await proyecto(ctx.lead.project_id) : null
    const lib = flujoDe(p).media_lib || []
    const ids = (input.ids || []).map(String).filter(id => lib.some(m => String(m.id) === id)).slice(0, 3)
    if (!ids.length) return { error: 'Esos ids no están en el material del proyecto.' }
    await ctx.mandarMaterial(ids)
    await supabase.from('lead_activities').insert({ lead_id: ctx.lead.id, note: 'AGENTE IA ENVIÓ MATERIAL: ' + ids.join(', ') })
    return { ok: true, enviados: ids.length }
  }

  async function pasarAPersona(ctx, input) {
    const motivo = String(input.motivo || 'sin motivo').slice(0, 300)
    await ctx.pasarAHumano()
    await supabase.from('ventas_ia_leads').update({ derivado_at: new Date().toISOString(), derivado_motivo: motivo }).eq('lead_id', ctx.lead.id)
    await supabase.from('lead_activities').insert({ lead_id: ctx.lead.id, note: ('AGENTE IA PASÓ A UNA PERSONA: ' + motivo).toUpperCase().slice(0, 500) })
    const p = ctx.lead.project_id ? await proyecto(ctx.lead.project_id) : null
    await ctx.avisar('🙋 *EL AGENTE TE PASA UN LEAD*\nCliente: ' + (ctx.lead.full_name || '-') + '\nTel: +' + dig(ctx.phone) + '\nProyecto: ' + (p?.name || '-') +
      '\nMotivo: ' + motivo + '\n\nEl agente ya no le contesta: escríbele tú. 👉 ' + PANEL + '/whatsapp')
    ctx.derivado = true
    return { ok: true, para_ti: 'Ya avisé al equipo. Dile en un mensaje corto que en breve le escribe una persona.' }
  }

  async function ejecutar(nombre, input, ctx) {
    if (nombre === 'lotes_disponibles') return lotesDisponibles(ctx, input)
    if (nombre === 'otros_proyectos') return otrosProyectos()
    if (nombre === 'guardar_datos_cliente') return guardarDatos(ctx, input)
    if (nombre === 'proponer_visita') return proponerVisita(ctx, input)
    if (nombre === 'enviar_material') return enviarMaterial(ctx, input)
    if (nombre === 'pasar_a_persona') return pasarAPersona(ctx, input)
    return { error: 'Herramienta desconocida: ' + nombre }
  }

  // ---------------------------------------------------------------- historial
  // Lo mismo que muestra la bandeja del panel: entrantes y lo escrito desde el
  // celular (whatsapp_messages) + lo que mandó el bot o el panel (scheduled_messages).
  async function historial(ctx) {
    const { conv, phone } = ctx
    const tel = dig(phone)
    const [ins, outs] = await Promise.all([
      supabase.from('whatsapp_messages').select('body, created_at, direction, media_url, media_type, delivery_status')
        .eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(60),
      supabase.from('scheduled_messages').select('body, sent_at, scheduled_for, tipo, status')
        .eq('recipient_phone', tel).eq('status', 'enviado').order('scheduled_for', { ascending: false }).limit(60),
    ])
    const filas = []
    for (const m of (ins.data || [])) filas.push({ at: m.created_at, dir: m.direction === 'out' ? 'out' : 'in', autor: m.direction === 'out' ? 'equipo' : 'cliente', texto: m.body, media_url: m.media_url, media_type: m.media_type })
    for (const m of (outs.data || [])) {
      const tipo = String(m.tipo || '').replace(/^test_/, '')
      const body = String(m.body || '')
      if (NO_CONVERSACION.has(tipo) || body.startsWith('📨 (aviso interno') || body.startsWith('(prueba)') || body.startsWith('🔄 BOT REINICIADO')) continue
      // 'ia' = la foto o el video que mandó el bot (enviarArchivo); 'media' = lo mismo en una prueba
      const autor = tipo === 'ia_ventas' ? 'agente' : ['ia', 'media'].includes(tipo) ? 'material' : ['lead_flujo', 'auto_cliente'].includes(tipo) ? 'bot' : 'equipo'
      filas.push({ at: m.sent_at || m.scheduled_for, dir: 'out', autor, texto: autor === 'material' ? '[se le envió material: ' + body + ']' : body })
    }
    filas.sort((a, b) => new Date(a.at) - new Date(b.at))
    const ult = filas.slice(-40)
    let ultimaRespuesta = -1
    ult.forEach((f, i) => { if (f.dir === 'out' && f.autor === 'agente') ultimaRespuesta = i })

    const mensajes = []
    const poner = (role, bloques) => {
      const u = mensajes[mensajes.length - 1]
      if (u && u.role === role) u.content.push(...bloques)
      else mensajes.push({ role, content: [...bloques] })
    }
    ult.forEach((f, i) => {
      if (f.dir === 'in') {
        const b = []
        if (f.media_url || f.media_type) {
          const nuevo = i > ultimaRespuesta
          if (nuevo && f.media_type === 'image' && f.media_url) b.push({ type: 'image', source: { type: 'url', url: f.media_url } })
          else if (f.media_type === 'audio') b.push({ type: 'text', text: '[Nota interna: la persona mandó un audio y no puedes escucharlo. Pídele con amabilidad que te lo escriba, como si no pudieras escuchar audios en este momento.]' })
          else b.push({ type: 'text', text: '[la persona envió un archivo (' + (f.media_type || 'adjunto') + ')' + (nuevo ? '' : ', ya visto') + ']' })
        }
        if (f.texto) b.push({ type: 'text', text: f.texto })
        if (b.length) poner('user', b)
      } else if (f.texto) {
        const pre = { agente: '', bot: '[bot] ', material: '[bot] ', equipo: '[equipo] ' }[f.autor] ?? ''
        poner('assistant', [{ type: 'text', text: pre + f.texto }])
      }
    })
    if (mensajes.length && mensajes[0].role !== 'user') mensajes.unshift({ role: 'user', content: [{ type: 'text', text: '[inicio de la conversación]' }] })
    return { mensajes, agenteHablo: ultimaRespuesta >= 0 }
  }

  // ---------------------------------------------------------------- el turno
  // ctx: { conv, lead, phone, esPrueba, nota?, decir(texto), mandarMaterial(ids), avisar(texto), pasarAHumano() }
  async function responder(ctx) {
    if (!ia) throw new Error('no hay clave de Claude (VENTAS_ANTHROPIC_API_KEY o ANTHROPIC_API_KEY)')
    const cfg = (await config()) || {}
    const inicio = new Date().toISOString()
    const { mensajes, agenteHablo: enElHistorial } = await historial(ctx)
    // el historial trae los últimos 40 mensajes: en una conversación larga la
    // presentación ya no aparece, pero el registro del experimento sí lo sabe
    const { data: yaHablo } = await supabase.from('ventas_ia_leads').select('primer_mensaje_at').eq('lead_id', ctx.lead.id).maybeSingle()
    const agenteHablo = enElHistorial || !!yaHablo?.primer_mensaje_at

    const notas = []
    if (!agenteHablo) notas.push('Nota interna: es tu primer mensaje. La persona pidió hablar con un asesor y ahora la atiendes tú. Preséntate en una línea' + (cfg.nombre_agente ? ' con tu nombre' : '') + ' y sigue desde donde quedó la conversación, sin repetir lo que ya le mandó el bot.')
    if (ctx.nota) notas.push('Nota interna: ' + ctx.nota)
    if (notas.length) {
      const bloque = { type: 'text', text: '[' + notas.join(' ') + ']' }
      const u = mensajes[mensajes.length - 1]
      if (u && u.role === 'user') u.content.push(bloque)
      else mensajes.push({ role: 'user', content: [bloque] })
    }
    if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') return { enviados: 0 }

    const p = ctx.lead.project_id ? await proyecto(ctx.lead.project_id) : null
    const { data: acts } = await supabase.from('lead_activities').select('note').eq('lead_id', ctx.lead.id).order('created_at').limit(40)
    const respuestasFlujo = (acts || []).filter(a => /^P: /.test(a.note)).map(a => '- ' + a.note.replace(/^P:\s*/, '').replace(/\s*→\s*R:\s*/, ' → '))
    const hoy = hoyLima()
    const proximos = [0, 1, 2, 3, 4, 5, 6].map(n => { const d = sumarDias(hoy, n); return diaSemana(d) + ' ' + fechaCorta(d) + ' = ' + d }).join('; ')

    const persona = cfg.nombre_agente ? 'Te llamas ' + cfg.nombre_agente + '.' : 'No uses un nombre propio: preséntate como del equipo de ventas de Urbis.'
    const system = [
      { type: 'text', text: PROMPT_BASE, cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: persona + '\n\n' + fichaTexto(p) +
          (cfg.punto_encuentro ? '\n\nPunto de encuentro para las visitas: ' + cfg.punto_encuentro : '') +
          (cfg.notas ? '\n\nINDICACIONES DEL NEGOCIO (mandan sobre lo demás):\n' + cfg.notas : ''),
        cache_control: { type: 'ephemeral' },
      },
      {
        type: 'text',
        text: 'Hoy es ' + diaSemana(hoy) + ' ' + fechaCorta(hoy) + ' (' + hoy + '), son las ' + horaLima() + ' en Lima. Próximos días: ' + proximos + '.' +
          '\nPersona: ' + (ctx.lead.full_name && ctx.lead.full_name !== 'POR CONFIRMAR' ? ctx.lead.full_name : 'todavía no dio su nombre') +
          (ctx.lead.budget_estimate ? ' · presupuesto anotado ' + soles(ctx.lead.budget_estimate) : '') +
          (String(ctx.lead.source || '').startsWith('campaña') ? ' · llegó por un anuncio' : '') +
          (respuestasFlujo.length ? '\nLo que respondió al bot:\n' + respuestasFlujo.join('\n') : ''),
      },
    ]

    const modelo = cfg.modelo || MODELO_POR_DEFECTO
    const params = { model: modelo, max_tokens: 16000, system, tools: HERRAMIENTAS }
    if (!/haiku|sonnet-4-5/.test(modelo) && cfg.esfuerzo) params.output_config = { effort: cfg.esfuerzo }
    // si los filtros de seguridad de Opus 5 declinan, Anthropic reintenta con el modelo recomendado
    const conRespaldo = /^claude-(opus-5|fable-5-1)$/.test(modelo)
    if (conRespaldo) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default' }

    const uso = { in: 0, out: 0, cache: 0 }
    let enviados = 0, terminado = false, conImagenes = true
    let msgs = mensajes
    for (let vuelta = 0; vuelta < 8; vuelta++) {
      let r
      try {
        r = conRespaldo ? await ia.beta.messages.create({ ...params, messages: msgs }) : await ia.messages.create({ ...params, messages: msgs })
      } catch (e) {
        // una imagen que no se pudo abrir tumba el turno: se reintenta sin imágenes
        if (e instanceof Anthropic.BadRequestError && conImagenes && vuelta === 0) {
          conImagenes = false
          msgs = msgs.map(m => ({ ...m, content: m.content.map(b => b.type === 'image' ? { type: 'text', text: '[la persona envió una imagen que no se pudo abrir]' } : b) }))
          vuelta = -1
          continue
        }
        throw e
      }
      uso.in += (r.usage?.input_tokens || 0) + (r.usage?.cache_creation_input_tokens || 0)
      uso.out += r.usage?.output_tokens || 0
      uso.cache += r.usage?.cache_read_input_tokens || 0
      if (r.stop_reason === 'refusal') {
        await pasarAPersona(ctx, { motivo: 'el agente no pudo responder este mensaje' })
        await ctx.decir('Déjame consultarlo con mi compañero y te escribimos en breve 🙌')
        enviados++
        terminado = true
        break
      }
      for (const b of r.content) if (b.type === 'text' && b.text.trim()) { await ctx.decir(b.text.trim()); enviados++ }
      if (r.stop_reason !== 'tool_use') { terminado = true; break }
      msgs.push({ role: 'assistant', content: r.content })
      const resultados = []
      for (const b of r.content) {
        if (b.type !== 'tool_use') continue
        let res
        try { res = await ejecutar(b.name, b.input || {}, ctx) } catch (e) { res = { error: String(e.message || e) } }
        log('  VENTAS IA herramienta', b.name, res && res.error ? '→ error: ' + res.error : '→ ok')
        resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(res), ...(res && res.error ? { is_error: true } : {}) })
      }
      msgs.push({ role: 'user', content: resultados })
    }
    if (!terminado && !ctx.derivado) {
      await pasarAPersona(ctx, { motivo: 'el agente no llegó a una respuesta' })
      if (!enviados) { await ctx.decir('Dame un momento y te escribo 🙌'); enviados++ }
    }

    const { data: fila } = await supabase.from('ventas_ia_leads').select('turnos, tokens_in, tokens_out, tokens_cache, primer_mensaje_at').eq('lead_id', ctx.lead.id).maybeSingle()
    if (fila) await supabase.from('ventas_ia_leads').update({
      ultimo_turno_at: inicio,
      primer_mensaje_at: fila.primer_mensaje_at || (enviados ? new Date().toISOString() : null),
      turnos: (fila.turnos || 0) + 1,
      tokens_in: Number(fila.tokens_in || 0) + uso.in, tokens_out: Number(fila.tokens_out || 0) + uso.out, tokens_cache: Number(fila.tokens_cache || 0) + uso.cache,
    }).eq('lead_id', ctx.lead.id)
    log('VENTAS IA →', dig(ctx.phone), ctx.esPrueba ? '[PRUEBA]' : '', enviados + ' mensaje(s)', `(${uso.in}+${uso.cache} cache / ${uso.out} tokens, ${modelo})`)
    return { enviados, uso }
  }

  // Nota para el agente cuando el dueño confirma o cancela una visita en el panel
  function notaDeCita(c) {
    const cuando = diaSemana(c.fecha) + ' ' + fechaCorta(c.fecha) + ' a las ' + String(c.hora).slice(0, 5)
    if (c.estado === 'confirmada') return 'el encargado CONFIRMÓ la visita para el ' + cuando + (c.cambio_hora ? ' (es un día u hora distinto al que habían acordado: pregúntale si le queda bien)' : '') + '. Díselo de forma natural y recuérdale el punto de encuentro si lo tienes.'
    return 'el encargado NO puede atender la visita que propusiste. Discúlpate con naturalidad, sin dar explicaciones inventadas, y propón otro día y hora.'
  }

  // Por qué no pudo responder, en palabras del dueño (para la consola y la alarma)
  function explicarError(e) {
    const t = String(e?.message || e || '')
    if (e instanceof Anthropic.AuthenticationError) return 'la clave de Claude no es válida o fue anulada'
    if (e instanceof Anthropic.PermissionDeniedError) return 'la clave de Claude no tiene permiso para este modelo'
    if (e instanceof Anthropic.RateLimitError) return 'se llegó al límite de uso de la cuenta de Claude'
    // el saldo agotado llega como un 400 común: solo se distingue por el texto
    if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(t)) return 'la cuenta de Claude no tiene crédito: cárgalo en platform.claude.com → Facturación'
    if (e instanceof Anthropic.NotFoundError) return 'el modelo configurado no existe: revisa Agente de ventas → Configuración'
    return t.slice(0, 200)
  }

  async function latido() {
    await supabase.from('ventas_ia_config').update({
      latido: new Date().toISOString(),
      latido_info: { ia: !!ia, clave_propia: CLAVE_PROPIA, modelo: (CFG && CFG.modelo) || MODELO_POR_DEFECTO },
    }).eq('id', 1).then(() => {}, () => {})
  }

  return { config, esperaLectura, enHorario, asignar, responder, notaDeCita, explicarError, latido, activo: () => !!ia }
}
