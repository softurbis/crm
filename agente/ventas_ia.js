// ============================================================================
// AGENTE DE VENTAS IA                                               [sep 2026]
// ----------------------------------------------------------------------------
// Vive DENTRO del bot de leads (index.js, Baileys): el lead sigue en el mismo
// chat del mismo número y no nota ningún cambio de canal. Llega por dos caminos:
//
//  · SIN BOT (sql/94): en los proyectos prendidos en el panel (Las Praderas y Las
//    Brisas de Cashibo) atiende desde el primer mensaje.
//  · EXPERIMENTO (sql/91): en los demás, cuando el flujo iba a pasar al lead con
//    un asesor, de cada 10 N van al agente y el resto sigue con el supervisor.
//
//  · Precios, iniciales y cuotas salen SOLO de la base, por herramientas. La
//    cuota la calcula este archivo con la regla del manual (cuotasDe).
//  · Lee los manuales de ventas (sql/94, se editan en el panel): el manual manda,
//    salvo las cifras, que salen de la base.
//  · Cuando el lead entendió las cinco cosas del manual (decisión del dueño, 16 sep):
//      - VISITA: la agenda el agente mismo. Queda en Visitas (con los recordatorios
//        de siempre), avisa al asesor y el agente sigue con el chat.
//      - LLAMADA o SEPARACIÓN: avisa al asesor y el chat pasa a él; el agente se calla.
//    Los avisos al asesor van SOLO por Telegram; si no lo tiene vinculado, al dueño.
//  · Si le preguntan en serio si es un bot, no lo niega.
//
// Este archivo no toca WhatsApp: index.js le pasa `decir`, `mandarMaterial`,
// `avisar`, `avisarA`, `notaPrueba` y `pasarAHumano`, que tienen la sesión y los tiempos.
// ============================================================================
const { Anthropic } = require('@anthropic-ai/sdk')
const VOZ = require('./transcribir')

const TZ = 'America/Lima'
const MODELO_POR_DEFECTO = 'claude-opus-5'
const PANEL = (process.env.PANEL_URL || 'https://panel.urbisgroupinmobiliaria.com')
const WEB = (process.env.WEB_URL || 'https://urbisgroupinmobiliaria.com')

const hoyLima = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
const horaLima = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const fechaCorta = iso => iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) + '/' + String(iso).slice(0, 4) : ''
const diaSemana = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('es-PE', { weekday: 'long', timeZone: 'UTC' })
const soles = n => 'S/' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dig = t => String(t || '').replace(/\D/g, '')
const sumarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const limpiar = t => String(t || '').replace(/\{nombre\}/g, 'el cliente').replace(/\{proyecto\}/g, 'el proyecto').trim()

// "Mz C Lt 10", "C-10", "c10", "MZ. C LT. 010" → "C-10" (así se guardan los lotes que no se ofrecen)
function normLote(t) {
  const s = String(t || '').toUpperCase().replace(/MANZANA|MZ|LOTE|LT|\./g, ' ').replace(/\s+/g, ' ').trim()
  const m = s.match(/^([A-Z]+)\s*-?\s*0*(\d+)$/)
  return m ? m[1] + '-' + m[2] : s
}

// La regla del MANUAL DE VENTA v5: la cuota es (precio − inicial) / N redondeada HACIA
// ARRIBA al paso del proyecto (Praderas S/0.10, Brisas S/1) y la diferencia se descuenta
// de la última, que sale menor. Así inicial + cuotas suma el precio exacto, al céntimo.
// Semanal = cuota / 4 y diaria = cuota / 30, como dice el manual. Todo en céntimos para
// que no se cuele un error de coma flotante.
// La MISMA función está en src/pages/VentasIA.jsx: el panel muestra lo que dirá el agente.
function cuotasDe(precio, inicial, n, paso) {
  const saldo = Math.round(Number(precio) * 100) - Math.round(Number(inicial || 0) * 100)
  const N = Math.max(1, Math.round(Number(n) || 48))
  const p = Math.max(1, Math.round(Number(paso || 0.1) * 100))
  if (!(saldo > 0)) return null
  let cuota = Math.ceil(saldo / N / p - 1e-9) * p
  let ultima = saldo - cuota * (N - 1)
  if (ultima <= 0) { cuota = Math.ceil(saldo / N); ultima = saldo - cuota * (N - 1) }
  return { cuota: cuota / 100, ultima: ultima / 100, semanal: Math.round(cuota / 4) / 100, diaria: Math.round(cuota / 30) / 100, ingreso_25: Math.round(cuota * 4 / 100) }
}

// Tipos de mensaje que NO son parte de la conversación con el cliente
const NO_CONVERSACION = new Set(['aviso_admin', 'reporte', 'interno', 'secretaria', 'label_panel', 'vcard_panel', 'edit_panel', 'redirige_cobranza', 'test'])

const PROMPT_BASE = `Eres asesor(a) de ventas de Urbis Group, una empresa que vende lotes de terreno en Ucayali, Perú. Atiendes por WhatsApp a personas interesadas en comprar un lote. A veces eres el primer contacto de la persona; otras, llegas a una conversación que ya empezó con el bot automático del mismo número.

Tu trabajo es resolver las dudas de la persona hasta que entienda bien lo que compraría, y entonces llevarla al siguiente paso: agendarle tú la visita al proyecto, o pasarla al asesor para una llamada o una separación. Si el proyecto tiene manual de ventas, el manual te dice cómo hacerlo: síguelo.

CÓMO TRABAJAS
- Primero entiende a la persona, después recomienda. Averigua, de a una pregunta por mensaje y sin que parezca un formulario: para qué quiere el lote, a qué se dedica, para cuándo y quién más decide. Pregúntale su nombre con naturalidad al comienzo.
- Recomienda uno a tres lotes concretos que le calcen, con precio, inicial y cuota juntos, y dile por qué le convienen a esa persona.
- Cada vez que la persona te dé un dato nuevo (nombre, a qué se dedica, presupuesto, para qué lo quiere, cuándo compraría), guárdalo con guardar_datos_cliente sin mencionárselo.
- Antes de agendar una visita o pasarla al asesor, confirma que entendió cinco cosas: qué está comprando, dónde está, cuánto y cómo paga, desde cuándo usa el lote y qué sigue después.
- Si quiere ver el proyecto, la visita la agendas tú con agendar_visita: acuerda el día y la hora, y confírmasela con el punto de encuentro. Tú sigues atendiéndola: si después la quiere cambiar, vuelve a usar agendar_visita; si ya no va, cancelar_visita.
- Si quiere una llamada, o ya eligió y quiere separar, usa pasar_a_asesor con lo que acordaron. Desde ahí la atiende el asesor y tú ya no contestas: dile en un mensaje corto lo que sigue.
- Si no sabes algo, no improvises ni te quedes callado: dile que se lo confirmas y anótalo con guardar_datos_cliente (nota que empiece con "DUDA:"). Si la persona necesita esa respuesta para seguir, usa pasar_a_persona.
- Si todavía no quiere avanzar, no insistas: ofrécele fotos o el video del proyecto, resuelve lo que le falte y cierra con un siguiente paso concreto.

REGLAS QUE NO SE ROMPEN
1. Precios, áreas, iniciales, cuotas y lotes salen SOLO de lotes_disponibles, consultada en esta conversación. Nunca calcules, estimes ni redondees una cifra de dinero de memoria: si necesitas otra cuenta, vuelve a consultar.
2. Financiamiento, intereses, títulos, habilitación, plazos y condiciones: solo lo que digan el manual o la ficha del proyecto. Si no lo dicen, dile que se lo confirmas.
3. No das descuentos, no congelas precios, no recibes pagos, no pides fotos de DNI ni datos bancarios. La separación la hace el asesor: tú la propones y pasas a la persona con pasar_a_asesor.
4. Nunca uses como argumento cuántos lotes hay o quedan, ni urgencias que no están en el manual ("últimos lotes", "sube mañana").
5. Reclamos, dudas legales o del contrato que no estén en el manual ni en la ficha, o una persona que ya es cliente y pregunta por sus cuotas: pasar_a_persona.
6. Si la persona pide hablar con una persona, usa pasar_a_persona sin insistir.
7. Si la persona pregunta en serio si está hablando con un robot, un bot o una inteligencia artificial, no lo niegues: dile con naturalidad que eres el asistente virtual del equipo de ventas de Urbis y que, si lo prefiere, una persona del equipo le escribe. Si no lo pregunta, no hace falta mencionarlo. Tampoco hables como si tú fueras a llamarla o a recibirla en persona: la llama el asesor y en la visita la recibe el equipo.
8. Nunca prometas tiempos ("en 5 minutos", "ahorita lo llaman"): el asesor la contacta a la hora acordada.
9. Nunca menciones herramientas, sistemas, bases de datos ni "consultar". Como mucho: "déjame revisar".

CÓMO ESCRIBES
- Como una persona de ventas por WhatsApp, en español peruano, cálido y claro. Trata a la persona de usted.
- Mensajes cortos. Si tu respuesta tiene más de una idea, sepárala con una línea en blanco: cada parte sale como un mensaje aparte. Máximo tres mensajes por respuesta, cada uno de una a tres líneas.
- Nada de listas con viñetas, títulos ni formato de documento. *Negrita* muy de vez en cuando. Emojis con moderación: uno de vez en cuando, nunca varios seguidos.
- No repitas lo que ya se dijo en la conversación. No te despidas en cada mensaje. No empieces todos los mensajes con el nombre de la persona.
- Montos como S/20,100 o S/408.40, y fechas como "el sábado 20".
- Los mensajes marcados [bot] los mandó el bot automático antes de que llegaras; los marcados [equipo] los escribió una persona de Urbis. Para la persona todo es la misma conversación: no te contradigas con eso.
- Una nota entre corchetes que empieza con "Nota interna" es del sistema, no de la persona: síguela sin mencionarla.

<tone_preference>
Mantén las respuestas breves y enfocadas.
</tone_preference>`

const CINCO = {
  que_compra: 'qué está comprando',
  donde_esta: 'dónde está',
  cuanto_y_como_paga: 'cuánto y cómo paga',
  desde_cuando_lo_usa: 'desde cuándo usa el lote',
  que_sigue_despues: 'qué sigue después',
}

const HERRAMIENTAS = [
  {
    name: 'lotes_disponibles',
    description: 'Lotes que se pueden ofrecer HOY de un proyecto, cada uno con área, precio por m², precio, inicial, cuota de contrato, última cuota (sale menor porque ahí se descuenta el redondeo), cuota semanal y diaria, y el ingreso mensual al que la cuota le pesa una cuarta parte. Trae también el número de cuotas y la separación. Úsala antes de dar cualquier cifra. Si la persona dice cuánto puede pagar al mes, filtra con cuota_max.',
    input_schema: {
      type: 'object',
      properties: {
        proyecto: { type: 'string', description: 'Nombre del proyecto. Vacío = el proyecto por el que escribió la persona.' },
        lote: { type: 'string', description: 'Un lote concreto, por ejemplo "Mz C Lt 10".' },
        presupuesto_max: { type: 'number', description: 'Precio total máximo en soles.' },
        cuota_max: { type: 'number', description: 'Cuota mensual máxima en soles.' },
        area_min: { type: 'number', description: 'Área mínima en m².' },
        manzana: { type: 'string', description: 'Letra de manzana, por ejemplo "B".' },
        orden: { type: 'string', enum: ['precio', 'area', 'cuota'], description: 'precio o cuota = más económicos primero; area = más grandes primero.' },
      },
    },
  },
  {
    name: 'otros_proyectos',
    description: 'Los otros proyectos que puedes ofrecer en esta misma conversación, con ubicación, precio y cuota desde. Úsala solo si la persona pregunta por otras opciones o su proyecto no le calza.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'escalonamiento',
    description: 'Cuánto sube el precio con la siguiente meta del proyecto y qué significa en precio, cuota mensual y al día. Úsala SOLO si la persona pregunta si el precio va a subir o pide una razón para decidir hoy.',
    input_schema: {
      type: 'object',
      properties: {
        proyecto: { type: 'string', description: 'Vacío = el proyecto de la persona.' },
        area_m2: { type: 'number', description: 'Área del lote que está mirando. Vacío = 300, 400 y 500 m².' },
      },
    },
  },
  {
    name: 'guardar_datos_cliente',
    description: 'Guarda en la ficha del lead lo que vas sabiendo. Llámala apenas la persona te dé un dato nuevo, sin mencionárselo.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre como la persona se presentó.' },
        a_que_se_dedica: { type: 'string', description: 'Su oficio o trabajo, por ejemplo "mototaxista", "docente".' },
        presupuesto_soles: { type: 'number' },
        para_que: { type: 'string', enum: ['vivir', 'casa_de_campo', 'construir_y_alquilar', 'hospedaje_o_negocio', 'inversion', 'otro'] },
        cuando_compra: { type: 'string', description: 'Por ejemplo "este mes", "después de su gratificación".' },
        interes: { type: 'string', enum: ['frio', 'tibio', 'caliente'] },
        nota: { type: 'string', description: 'Un dato útil para quien la atienda después, en una línea. Si es algo que no supiste responder, empieza con "DUDA:".' },
      },
    },
  },
  {
    name: 'agendar_visita',
    description: 'Agenda la visita de la persona al proyecto: queda en el calendario de Visitas y se le avisa al asesor. Úsala SOLO cuando confirmaste las cinco cosas y la persona aceptó un día y una hora. Si ya tenía una visita, la cambia al nuevo día y hora. Después sigues atendiéndola.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'YYYY-MM-DD.' },
        hora: { type: 'string', description: 'HH:MM en 24 horas, hora de Lima.' },
        proyecto: { type: 'string', description: 'Proyecto que va a visitar. Vacío = el proyecto por el que escribió la persona.' },
        lote_interes: { type: 'string', description: 'Lote o lotes que quiere ver, por ejemplo "Mz B Lt 7".' },
        nota: { type: 'string', description: 'Resumen para el asesor: qué busca, a qué se dedica, qué cuota le acomoda, con quién viene, dudas pendientes.' },
        entendio: {
          type: 'object',
          description: 'Pon true solo lo que confirmaste en la conversación.',
          properties: Object.fromEntries(Object.keys(CINCO).map(k => [k, { type: 'boolean' }])),
          required: Object.keys(CINCO),
        },
      },
      required: ['fecha', 'hora', 'nota', 'entendio'],
    },
  },
  {
    name: 'cancelar_visita',
    description: 'Cancela la visita agendada cuando la persona dice que ya no va. Si solo quiere cambiar el día o la hora, usa agendar_visita.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'Por qué no va, en una línea.' } },
      required: ['motivo'],
    },
  },
  {
    name: 'pasar_a_asesor',
    description: 'Pasa a la persona al asesor del proyecto para una llamada o una separación, y le avisa. Desde ahí la atiende el asesor: tú ya no contestas. Úsala SOLO cuando confirmaste las cinco cosas y la persona aceptó. Para una visita usa agendar_visita.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['llamada', 'separacion'] },
        fecha: { type: 'string', description: 'YYYY-MM-DD, si la llamada quedó para otro día.' },
        hora: { type: 'string', description: 'HH:MM en 24 horas, hora de Lima, si la acordaron.' },
        cuando: { type: 'string', description: 'Lo acordado en palabras si no hay hora exacta: "ahora", "después de las 6".' },
        lote_interes: { type: 'string', description: 'Lote o lotes que le interesan, por ejemplo "Mz B Lt 7".' },
        nota: { type: 'string', description: 'Resumen para el asesor: qué busca, a qué se dedica, qué cuota le acomoda, dudas pendientes.' },
        entendio: {
          type: 'object',
          description: 'Pon true solo lo que confirmaste en la conversación.',
          properties: Object.fromEntries(Object.keys(CINCO).map(k => [k, { type: 'boolean' }])),
          required: Object.keys(CINCO),
        },
      },
      required: ['tipo', 'nota', 'entendio'],
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
    description: 'Deja la conversación en manos de una persona del equipo y le avisa; desde ahí ya no contestas. Para cuando la persona pide hablar con alguien, un reclamo o algo que no puedes resolver. Después de usarla, dile en un mensaje corto que en breve le escriben.',
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
    return ahora >= String(c?.hora_inicio || '08:00').slice(0, 5) && ahora < String(c?.hora_fin || '21:00').slice(0, 5)
  }

  // ---------------------------------------------------------------- cada proyecto (sql/94)
  // Sin sql/94 todo proyecto queda en 'bot': index.js sigue exactamente como antes.
  const PCFG = new Map()
  let avisoSinProyectos = false
  async function proyectoCfg(pid) {
    if (!pid) return null
    const hit = PCFG.get(pid)
    if (hit && Date.now() - hit.t < 60000) return hit.c
    const { data, error } = await supabase.from('ventas_ia_proyectos').select('*').eq('project_id', pid).maybeSingle()
    if (error && !avisoSinProyectos) { log('VENTAS IA proyectos:', error.message, '(¿falta correr sql/94?)'); avisoSinProyectos = true }
    const c = error ? (hit?.c || null) : (data || null)
    PCFG.set(pid, { t: Date.now(), c })
    return c
  }
  async function modoProyecto(pid) { return (await proyectoCfg(pid))?.modo || 'bot' }

  // ---------------------------------------------------------------- reparto
  // directo = proyecto sin bot: el agente atiende desde el primer mensaje, sin sorteo.
  // Experimento: bloques de 10 con exactamente N al agente, en posiciones al azar.
  // Con pocos leads una moneda puede dar 0 de 10 o 6 de 10, y no mediría nada.
  async function asignar(lead, { phone, motivo, esPrueba, directo }) {
    if (!lead?.id) return null
    const { data: ya } = await supabase.from('ventas_ia_leads').select('grupo').eq('lead_id', lead.id).maybeSingle()
    if (ya) return ya.grupo
    const cfg = await config(true)
    if (!cfg) return null                                    // sql/91 sin correr: todo sigue como antes
    let grupo
    if (esPrueba || directo) grupo = 'ia'                    // desde Probar Bot siempre se prueba el agente
    else {
      if (!cfg.activo || motivo === 'sin_proyectos_bot') return null
      // los de proyectos sin bot no son del experimento (ojo: neq solo dejaría fuera los NULL)
      const DEL_EXPERIMENTO = 'motivo.is.null,motivo.neq.primer_mensaje'
      const { count } = await supabase.from('ventas_ia_leads').select('lead_id', { count: 'exact', head: true }).eq('es_prueba', false).or(DEL_EXPERIMENTO)
      const pos = (count || 0) % 10
      let iaEnBloque = 0
      if (pos > 0) {
        const { data: ult } = await supabase.from('ventas_ia_leads').select('grupo').eq('es_prueba', false).or(DEL_EXPERIMENTO).order('asignado_at', { ascending: false }).limit(pos)
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
    log('VENTAS IA: lead', dig(phone), '→ grupo', grupo.toUpperCase(), directo ? '(sin bot)' : '', esPrueba ? '[PRUEBA]' : '')
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

  // conBot = false en los proyectos sin bot: los textos del flujo viejo (con su tuteo y
  // sus ofertas de entonces) ya no son información oficial; el manual los reemplaza.
  function fichaTexto(p, conBot) {
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
    if (conBot) {
      const pasos = (flow.steps || []).map(s => {
        const partes = [limpiar(s.texto)]
        for (const o of (s.opciones || [])) if (o.respuesta) partes.push('(si elige "' + o.label + '") ' + limpiar(o.respuesta))
        return partes.filter(Boolean).join(' ')
      }).filter(Boolean)
      if (pasos.length) l.push('LO QUE DICE EL BOT DE ESTE PROYECTO (es información oficial; no la repitas si ya se envió):\n' + pasos.map(t => '- ' + t.replace(/\s+/g, ' ').slice(0, 600)).join('\n'))
    }
    const mat = (flow.media_lib || []).filter(m => m && m.url)
    if (mat.length) l.push('MATERIAL QUE PUEDES ENVIAR con enviar_material (id · tipo · qué es):\n' + mat.map(m => '- ' + m.id + ' · ' + (m.tipo || 'imagen') + ' · ' + limpiar(m.desc || 'sin descripción')).join('\n'))
    return l.join('\n')
  }

  // ---------------------------------------------------------------- manuales (sql/94)
  // TODOS los manuales van en cada conversación, para vender cruzado. Es el mismo
  // texto para todos los leads y va en un bloque propio con caché: se paga completo
  // al escribirlo y después se lee a un décimo del precio.
  // Orden fijo (título, id): si cambia el orden, cambia el texto y se pierde la caché.
  let MAN = { t: 0, lista: [], error: null }
  async function manuales() {
    if (Date.now() - MAN.t < 60000) return MAN.lista
    const { data, error } = await supabase.from('ventas_ia_manuales').select('id, titulo, proyectos, texto')
    if (error) {
      if (!MAN.error) log('VENTAS IA manuales:', error.message, '(¿falta correr sql/94?)')
      MAN = { t: Date.now(), lista: MAN.lista, error: error.message }
      return MAN.lista
    }
    const conTexto = (data || []).filter(m => String(m.texto || '').trim())
    const ids = [...new Set(conTexto.flatMap(m => m.proyectos || []))]
    const { data: ps } = ids.length ? await supabase.from('projects').select('id, name').in('id', ids) : { data: [] }
    const nombre = new Map((ps || []).map(p => [p.id, p.name]))
    const lista = conTexto
      .map(m => ({ id: m.id, titulo: String(m.titulo || 'Manual de ventas').trim(), proyectos: (m.proyectos || []).filter(id => nombre.has(id)), texto: String(m.texto).trim() }))
      .map(m => ({ ...m, nombres: m.proyectos.map(id => nombre.get(id)).sort() }))
      .sort((a, b) => a.titulo < b.titulo ? -1 : a.titulo > b.titulo ? 1 : a.id < b.id ? -1 : 1)
    MAN = { t: Date.now(), lista, error: null }
    return lista
  }
  const manualDe = (lista, pid) => pid ? lista.find(m => m.proyectos.includes(pid)) : null
  function manualesTexto(lista) {
    return 'MANUALES DE VENTAS (los escribió el equipo de Urbis)\n' +
      'El manual de un proyecto manda sobre su ficha y sobre lo que dice el bot, con tres excepciones: precios, áreas, iniciales, cuotas y lotes salen siempre de lotes_disponibles aunque el manual diga otra cosa (las cifras de un manual se desactualizan); las INDICACIONES DEL NEGOCIO mandan sobre los manuales; y las REGLAS QUE NO SE ROMPEN valen siempre. ' +
      'Los guiones y respuestas del manual te dicen qué decir: dilo con tus palabras, al ritmo del chat y como indica CÓMO ESCRIBES. ' +
      'Usa el manual del proyecto de la persona; los demás, solo si pregunta por un proyecto de ese manual.\n\n' +
      lista.map(m => '<manual titulo="' + m.titulo + '" proyectos="' + m.nombres.join(', ') + '">\n' + m.texto + '\n</manual>').join('\n\n')
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
  // Lo que se puede ofrecer: disponibles menos los que el panel marcó "no se ofrecen"
  async function ofrecibles(pid) {
    const pc = (await proyectoCfg(pid)) || {}
    const fuera = new Set((pc.lotes_no_ofrecer || []).map(normLote))
    const N = pc.cuotas || 48, paso = pc.redondeo_cuota ?? 0.1
    const lotes = (await lotesDe(pid))
      .filter(l => !fuera.has(normLote(l.mz + '-' + l.lt)))
      .map(l => ({ l, q: cuotasDe(l.total_price, l.initial_payment_default, N, paso) }))
      .filter(x => x.q)
    return { pc, N, lotes, fuera }
  }
  async function proyectosALaVenta() {
    const { data } = await supabase.from('projects').select('id, name, ubicacion_txt, bot_enabled').order('name')
    return (data || []).filter(p => p.bot_enabled !== false)
  }
  // Por cantidad de palabras que coinciden: "brisas de cashibo" no puede caer en
  // "Las Praderas de Cashibo" por la palabra "cashibo". En empate gana un proyecto
  // del mismo manual que el de la persona (Praderas de Cashibo antes que la de Pucallpa).
  async function proyectoPorNombre(nombre, leadPid) {
    const t = String(nombre || '').toLowerCase()
    const lista = await proyectosALaVenta()
    const exacto = lista.find(p => p.name.toLowerCase() === t)
    if (exacto) return exacto
    const hermanos = manualDe(await manuales(), leadPid)?.proyectos || [leadPid]
    const puntaje = p => p.name.toLowerCase().split(/\s+/).filter(w => w.length > 3 && t.includes(w)).length * 2 + (hermanos.includes(p.id) ? 1 : 0)
    const mejor = lista.map(p => ({ p, s: puntaje(p) })).filter(x => x.s >= 2).sort((a, b) => b.s - a.s)[0]
    return mejor ? mejor.p : null
  }
  async function proyectoPedido(ctx, input) {
    if (input.proyecto) {
      const p = await proyectoPorNombre(input.proyecto, ctx.lead.project_id)
      if (!p) return { error: 'No encontré ese proyecto. Usa otros_proyectos para ver los nombres.' }
      return { pid: p.id, nombre: p.name }
    }
    if (!ctx.lead.project_id) return { error: 'La persona todavía no eligió proyecto: pregúntale cuál le interesa o usa otros_proyectos.' }
    return { pid: ctx.lead.project_id, nombre: (await proyecto(ctx.lead.project_id))?.name || '' }
  }

  async function lotesDisponibles(ctx, input) {
    const pp = await proyectoPedido(ctx, input)
    if (pp.error) return pp
    const { pc, N, lotes, fuera } = await ofrecibles(pp.pid)
    if (!lotes.length) return { proyecto: pp.nombre, nota: 'Hoy no hay lotes para ofrecer en este proyecto. Ofrece otros_proyectos.' }
    const buscado = input.lote ? normLote(input.lote) : ''
    const mz = String(input.manzana || '').trim().toUpperCase()
    const lista = lotes.filter(({ l, q }) =>
      (!buscado || normLote(l.mz + '-' + l.lt) === buscado) &&
      (!input.presupuesto_max || Number(l.total_price) <= Number(input.presupuesto_max)) &&
      (!input.cuota_max || q.cuota <= Number(input.cuota_max)) &&
      (!input.area_min || Number(l.area_m2) >= Number(input.area_min)) &&
      (!mz || String(l.mz).trim().toUpperCase() === mz))
    lista.sort(input.orden === 'area' ? (a, b) => b.l.area_m2 - a.l.area_m2
      : input.orden === 'cuota' ? (a, b) => a.q.cuota - b.q.cuota
      : (a, b) => a.l.total_price - b.l.total_price)
    const out = {
      proyecto: pp.nombre,
      numero_de_cuotas: N,
      ...(pc.project_id ? { separacion: soles(pc.separacion) } : {}),
      precio_desde: soles(Math.min(...lotes.map(x => x.l.total_price))), precio_hasta: soles(Math.max(...lotes.map(x => x.l.total_price))),
      cuota_desde: soles(Math.min(...lotes.map(x => x.q.cuota))),
      area_desde_m2: Math.min(...lotes.map(x => Number(x.l.area_m2))), area_hasta_m2: Math.max(...lotes.map(x => Number(x.l.area_m2))),
      lotes: lista.slice(0, 8).map(({ l, q }) => ({
        lote: 'Mz ' + l.mz + ' Lt ' + l.lt, area_m2: Number(l.area_m2), precio_m2: soles(l.price_per_m2),
        precio: soles(l.total_price), inicial: soles(l.initial_payment_default),
        cuota_mensual: soles(q.cuota), ultima_cuota: soles(q.ultima), cuota_semanal: soles(q.semanal), cuota_diaria: soles(q.diaria),
        ingreso_al_que_pesa_25: soles(q.ingreso_25),
      })),
      hay_mas_opciones: lista.length > 8,
      para_ti: 'Precio, inicial y cuota se dicen juntos. No digas cuántos lotes hay o quedan.',
    }
    if (buscado && !lista.length) out.para_ti = fuera.has(buscado)
      ? 'Ese lote no se ofrece por ahora: sin dar explicaciones, ofrécele uno parecido.'
      : 'Ese lote no está disponible: ofrécele uno parecido.'
    else if (!lista.length) out.para_ti = 'Ningún lote cumple lo que pidió: ofrécele lo más cercano (el precio o la cuota más baja) sin decir cuántos hay.'
    return out
  }

  // Los otros proyectos que comparten manual con el de la persona ("dos agentes, un solo
  // entorno"). Si su proyecto no tiene manual, todos los que están a la venta.
  async function otrosProyectos(ctx) {
    const mans = await manuales()
    const m = manualDe(mans, ctx.lead.project_id)
    const todos = await proyectosALaVenta()
    const candidatos = todos.filter(p => p.id !== ctx.lead.project_id && (!m || m.proyectos.includes(p.id)))
    const out = []
    for (const p of candidatos) {
      const { lotes } = await ofrecibles(p.id)
      if (!lotes.length) continue
      out.push({
        proyecto: p.name, ubicacion: p.ubicacion_txt || null,
        precio_desde: soles(Math.min(...lotes.map(x => x.l.total_price))), cuota_desde: soles(Math.min(...lotes.map(x => x.q.cuota))),
      })
    }
    return { proyectos: out, para_ti: out.length ? 'Ofrécelo en este mismo chat, con las cifras de ese proyecto: nunca lo derives a otro número.' : 'No hay otro proyecto que ofrecer.' }
  }

  async function escalonamiento(ctx, input) {
    const pp = await proyectoPedido(ctx, input)
    if (pp.error) return pp
    const pc = await proyectoCfg(pp.pid)
    if (!pc || !(Number(pc.subida_m2) > 0)) return { error: 'Este proyecto no tiene escalonamiento cargado: si pregunta, dile que se lo confirmas.' }
    const N = pc.cuotas || 48, sube = Number(pc.subida_m2)
    const areas = Number(input.area_m2) > 0 ? [Number(input.area_m2)] : [300, 400, 500]
    return {
      proyecto: pp.nombre, sube_por_m2_con_cada_meta: soles(sube), siguiente_meta: pc.siguiente_meta || null,
      impacto: areas.map(a => ({ area_m2: a, sube_el_precio: soles(a * sube), sube_la_cuota_al_mes: soles(a * sube / N), sube_al_dia: soles(a * sube / N / 30) })),
      para_ti: 'Sin fecha: depende del avance de la obra. Explícalo, no lo uses como amenaza.',
    }
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
      input.a_que_se_dedica && 'OFICIO: ' + input.a_que_se_dedica,
      input.para_que && 'PARA: ' + input.para_que.replace(/_/g, ' '),
      upd.budget_estimate && 'PRESUPUESTO: ' + soles(upd.budget_estimate),
      input.cuando_compra && 'COMPRA: ' + input.cuando_compra,
      input.nota,
    ].filter(Boolean)
    if (partes.length) await supabase.from('lead_activities').insert({ lead_id: ctx.lead.id, note: ('AGENTE IA · ' + partes.join(' · ')).toUpperCase().slice(0, 500) })
    return { ok: true }
  }

  // ---------------------------------------------------------------- pases y visitas
  const cuandoDe = (fecha, hora, cuando) => [fecha && diaSemana(fecha) + ' ' + fechaCorta(fecha), hora && String(hora).slice(0, 5), cuando].filter(Boolean).join(' · ')
  const YA_ENTENDIO = '\n\n✅ Ya entendió qué compra, dónde está, cuánto paga, desde cuándo lo usa y qué sigue.'

  function faltaEntender(input) {
    const falta = Object.keys(CINCO).filter(k => input.entendio?.[k] !== true)
    return falta.length ? 'Todavía no confirmaste que entendió: ' + falta.map(k => CINCO[k]).join(', ') + '. Explícaselo y confírmalo antes. Si la persona quiere hablar con alguien ya, usa pasar_a_persona.' : null
  }
  function errorFechaHora(fecha, hora) {
    const hoy = hoyLima()
    if (fecha) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(new Date(fecha + 'T12:00:00Z'))) return 'Fecha inválida: usa YYYY-MM-DD.'
      if (fecha < hoy) return 'Esa fecha ya pasó. Hoy es ' + hoy + '.'
      if (fecha > sumarDias(hoy, 45)) return 'Es muy lejos: acuerda una fecha dentro de las próximas seis semanas.'
    }
    if (hora && !/^\d{2}:\d{2}$/.test(hora)) return 'Hora inválida: usa HH:MM en 24 horas.'
    if (fecha === hoy && hora && hora <= horaLima()) return 'Esa hora de hoy ya pasó. Son las ' + horaLima() + '.'
    return null
  }
  // la hora de Lima dentro de una hora, "HH:MM" (pasada la medianoche da "24:xx", que igual compara bien)
  function enUnaHora() {
    const [h, m] = horaLima().split(':').map(Number)
    const t = h * 60 + m + 60
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')
  }
  async function asesorDe(pid) {
    const [pc, p, cfg] = await Promise.all([proyectoCfg(pid), pid ? proyecto(pid) : null, config()])
    return { pc, p, cfg, tel: dig(pc?.asesor_phone) || dig(p?.lead_notify_phone) || dig(cfg?.aviso_phone) }
  }
  // Al asesor SOLO por Telegram (el dueño, 16 sep): el WhatsApp del proyecto es para
  // los clientes. Si no tiene Telegram vinculado, el aviso le llega al dueño para que no se pierda.
  async function avisarAsesor(ctx, tel, texto) {
    const llego = tel && ctx.avisarA ? await ctx.avisarA(tel, texto) : false
    if (!llego) await ctx.avisar(texto + '\n\n⚠️ *Este aviso no le llegó al asesor*' + (tel ? ' (+' + tel + '): no tiene Telegram vinculado.' : ': el proyecto no tiene asesor cargado.') + ' Pásaselo tú.')
    return llego
  }
  // un solo pase abierto por lead: si cambia lo acordado, se actualiza el mismo
  async function guardarPase(ctx, fila) {
    const { data: abierto, error } = await supabase.from('ventas_ia_pases').select('id').eq('lead_id', ctx.lead.id).eq('estado', 'pendiente').maybeSingle()
    if (error) return { error: error.message }
    const r = abierto
      ? await supabase.from('ventas_ia_pases').update(fila).eq('id', abierto.id)
      : await supabase.from('ventas_ia_pases').insert(fila)
    return r.error ? { error: r.error.message } : { abierto }
  }
  // La visita que tiene programada (la agendó el agente o una persona): una por cliente
  async function visitaProgramada(ctx) {
    const { data, error } = await supabase.from('visits').select('id, project_id, date, time')
      .like('client_phone', '%' + dig(ctx.phone).slice(-9)).eq('tipo', 'visita').eq('status', 'programada')
      .gte('date', hoyLima()).order('date').limit(1)
    if (error) throw new Error(error.message)
    return data?.[0] || null
  }

  // VISITA: la agenda el agente y sigue con el chat. En Visitas le llegan al cliente y al
  // asesor los recordatorios de siempre (index.js, visitasTick).
  async function agendarVisita(ctx, input) {
    const falta = faltaEntender(input)
    if (falta) return { error: falta }
    const fecha = String(input.fecha || '').trim()
    const hora = String(input.hora || '').trim().slice(0, 5)
    if (!fecha || !hora) return { error: 'Para agendar la visita acuerda el día y la hora.' }
    const eFH = errorFechaHora(fecha, hora)
    if (eFH) return { error: eFH }
    if (hora < '07:00' || hora > '18:30') return { error: 'Las visitas son de día: acuerda una hora entre 07:00 y 18:30.' }
    const hoy = hoyLima()
    if (fecha === hoy && hora < enUnaHora()) return { error: 'Para hoy acuerda una hora con al menos una hora de margen, para que el asesor llegue. Son las ' + horaLima() + '.' }
    const nombre = String(ctx.lead.full_name || '').trim()
    if (!nombre || nombre === 'POR CONFIRMAR') return { error: 'Antes de agendar la visita pregúntale su nombre y guárdalo con guardar_datos_cliente.' }
    const pp = await proyectoPedido(ctx, input)          // puede ir a ver el otro proyecto del manual
    if (pp.error) return pp
    const { pc, p, cfg, tel } = await asesorDe(pp.pid)
    if (!tel) return { error: 'Este proyecto no tiene asesor para recibir la visita: usa pasar_a_persona.' }
    const punto = String(cfg?.punto_encuentro || '').trim() || (p?.office_address ? 'Oficina: ' + String(p.office_address).trim() : '')
    const lote = String(input.lote_interes || '').trim().slice(0, 120) || null
    const nota = String(input.nota || '').trim().slice(0, 1000) || null

    let cambio = false
    if (!ctx.esPrueba) {                                  // una prueba no va al calendario: le llegarían recordatorios de verdad
      let ya
      try { ya = await visitaProgramada(ctx) } catch (e) { return { error: e.message } }
      const fila = {
        project_id: pp.pid, client_name: nombre.toUpperCase(), client_phone: dig(ctx.phone),
        encargado_name: String(pc?.asesor_nombre || cfg?.encargado_nombre || '').trim().toUpperCase() || null, encargado_phone: tel,
        date: fecha, time: hora, meeting_point: (punto || 'POR COORDINAR CON EL ASESOR').toUpperCase(),
        notes: ('AGENDADA POR EL AGENTE DE VENTAS IA' + (lote ? ' · LOTE ' + lote : '') + (nota ? ' · ' + nota : '')).toUpperCase().slice(0, 1000),
      }
      // El recordatorio de "mañana" sale apenas se abre su ventana: a quien agenda para hoy o
      // mañana le llegaría un minuto después de confirmarle. Esos se dan por mandados.
      const ahora = new Date().toISOString()
      const recordatorios = { reminded_at: null, reminded_dia_at: fecha <= sumarDias(hoy, 1) ? ahora : null, reminded_hora_at: fecha === hoy ? ahora : null }
      if (ya) {
        cambio = ya.date !== fecha || String(ya.time).slice(0, 5) !== hora
        const { error } = await supabase.from('visits').update({ ...fila, ...(cambio ? recordatorios : {}) }).eq('id', ya.id)
        if (error) return { error: error.message }
      } else {
        const { error } = await supabase.from('visits').insert({ ...fila, ...recordatorios, tipo: 'visita', status: 'programada' })
        if (error) return { error: error.message }
      }
    }
    const g = await guardarPase(ctx, {
      lead_id: ctx.lead.id, project_id: pp.pid, tipo: 'visita', fecha, hora, cuando: null, lote_interes: lote, nota,
      entendio: input.entendio, asesor_phone: tel, es_prueba: !!ctx.esPrueba, updated_at: new Date().toISOString(),
    })
    if (g.error) return g
    if (g.abierto && ctx.esPrueba) cambio = true

    await supabase.from('leads').update({ status: 'visita_agendada', temperature: 'caliente' }).eq('id', ctx.lead.id).then(() => {}, () => {})
    const cuandoTxt = cuandoDe(fecha, hora)
    await supabase.from('lead_activities').insert({ lead_id: ctx.lead.id, note: ('AGENTE IA ' + (cambio ? 'CAMBIÓ LA VISITA' : 'AGENDÓ VISITA') + ': ' + cuandoTxt + ' · ' + pp.nombre + (lote ? ' · ' + lote : '')).toUpperCase().slice(0, 500) })
    const texto = '🤖 *📍 VISITA AGENDADA*' + (cambio ? ' (cambió de día u hora)' : '') + ' — la agendó el agente de ventas' +
      '\nCliente: ' + nombre + '\nTel: +' + dig(ctx.phone) + '\nProyecto: ' + pp.nombre + '\nCuándo: ' + cuandoTxt +
      '\nPunto de encuentro: ' + (punto || '⚠️ sin cargar: coordínalo con el cliente') + (lote ? '\nLote: ' + lote : '') +
      (nota ? '\n\n📝 ' + nota : '') + YA_ENTENDIO +
      '\n📅 Quedó en Visitas. El agente sigue con el chat: si no puedes ese día, escríbele tú al cliente y el agente se calla.' +
      '\n👉 ' + PANEL + '/visitas'
    await avisarAsesor(ctx, tel, texto)
    if (ctx.esPrueba && ctx.notaPrueba) await ctx.notaPrueba('Con un cliente real esta visita quedaría en Visitas (' + cuandoTxt + '), con los recordatorios al cliente y al asesor.')
    return {
      ok: true,
      para_ti: 'La visita quedó agendada' + (cambio ? ' con el nuevo día y hora' : '') + '. Confírmasela con el día y la hora' +
        (punto ? ' y el punto de encuentro (' + punto + ')' : ', y dile que el punto de encuentro se lo confirma el asesor') +
        '. En la visita la recibe el equipo, no tú. Si sigue escribiendo, sigue atendiéndola.',
    }
  }

  async function cancelarVisita(ctx, input) {
    const motivo = String(input.motivo || '').trim().slice(0, 300) || 'sin motivo'
    const { data: pase } = await supabase.from('ventas_ia_pases').select('id, project_id, fecha, hora, asesor_phone')
      .eq('lead_id', ctx.lead.id).eq('estado', 'pendiente').eq('tipo', 'visita').maybeSingle()
    let visita = null
    if (!ctx.esPrueba) { try { visita = await visitaProgramada(ctx) } catch (e) { return { error: e.message } } }
    if (!pase && !visita) return { error: 'No tiene ninguna visita agendada.' }
    if (visita) {
      const { error } = await supabase.from('visits').update({ status: 'cancelada' }).eq('id', visita.id)
      if (error) return { error: error.message }
    }
    const ahora = new Date().toISOString()
    if (pase) await supabase.from('ventas_ia_pases').update({ estado: 'cancelado', resuelto_at: ahora, updated_at: ahora }).eq('id', pase.id)
    await supabase.from('leads').update({ status: 'contactado', temperature: 'tibio' }).eq('id', ctx.lead.id).then(() => {}, () => {})
    await supabase.from('lead_activities').insert({ lead_id: ctx.lead.id, note: ('AGENTE IA CANCELÓ LA VISITA: ' + motivo).toUpperCase().slice(0, 500) })
    const pid = visita?.project_id || pase?.project_id || ctx.lead.project_id || null
    const { p, tel } = await asesorDe(pid)
    await avisarAsesor(ctx, dig(pase?.asesor_phone) || tel,
      '🤖 *❌ VISITA CANCELADA* — el cliente le avisó al agente de ventas' +
      '\nCliente: ' + (ctx.lead.full_name || '-') + '\nTel: +' + dig(ctx.phone) + '\nProyecto: ' + (p?.name || '-') +
      '\nEra: ' + cuandoDe(visita?.date || pase?.fecha, visita?.time || pase?.hora) + '\nMotivo: ' + motivo +
      '\n\nEl agente sigue con el chat. 👉 ' + PANEL + '/visitas')
    return { ok: true, para_ti: 'Quedó cancelada. No insistas: pregúntale con naturalidad si prefiere otro día o si le quedó alguna duda.' }
  }

  // LLAMADA o SEPARACIÓN: el chat pasa al asesor y el agente se calla (el dueño, 16 sep)
  async function pasarAAsesor(ctx, input) {
    const tipo = String(input.tipo || '')
    if (tipo === 'visita') return { error: 'La visita la agendas tú con agendar_visita.' }
    if (!['llamada', 'separacion'].includes(tipo)) return { error: 'tipo tiene que ser llamada o separacion.' }
    const falta = faltaEntender(input)
    if (falta) return { error: falta }
    const fecha = String(input.fecha || '').trim() || null
    const hora = String(input.hora || '').trim().slice(0, 5) || null
    const cuando = String(input.cuando || '').trim().slice(0, 120) || null
    const eFH = errorFechaHora(fecha, hora)
    if (eFH) return { error: eFH }
    if (tipo === 'llamada' && !hora && !cuando) return { error: 'Para una llamada acuerda cuándo: ahora, o a qué hora.' }

    const pid = ctx.lead.project_id || null
    const { pc, p, tel } = await asesorDe(pid)
    const fila = {
      lead_id: ctx.lead.id, project_id: pid, tipo, fecha, hora, cuando,
      lote_interes: input.lote_interes || null, nota: String(input.nota || '').slice(0, 1000) || null,
      entendio: input.entendio, asesor_phone: tel || null, es_prueba: !!ctx.esPrueba, updated_at: new Date().toISOString(),
    }
    const g = await guardarPase(ctx, fila)
    if (g.error) return g

    // primero se calla: si la persona escribe mientras sale el aviso, ya no le contesta el agente
    await ctx.pasarAHumano()
    ctx.derivado = true
    await supabase.from('ventas_ia_leads').update({ derivado_at: new Date().toISOString(), derivado_motivo: 'pase al asesor: ' + tipo }).eq('lead_id', ctx.lead.id)
    await supabase.from('leads').update({ status: 'negociacion', temperature: 'caliente' }).eq('id', ctx.lead.id).then(() => {}, () => {})
    const cuandoTxt = cuandoDe(fecha, hora, cuando)
    const TITULO = { llamada: '📞 LLAMAR AL CLIENTE', separacion: '💰 QUIERE SEPARAR' }[tipo]
    await supabase.from('lead_activities').insert({ lead_id: ctx.lead.id, note: ('AGENTE IA PASÓ AL ASESOR: ' + TITULO + (cuandoTxt ? ' · ' + cuandoTxt : '') + (fila.lote_interes ? ' · ' + fila.lote_interes : '')).toUpperCase().slice(0, 500) })
    await avisarAsesor(ctx, tel, '🤖 *' + TITULO + '* — pase del agente de ventas' + (g.abierto ? ' (cambió el anterior)' : '') +
      '\nCliente: ' + (ctx.lead.full_name || '-') + '\nTel: +' + dig(ctx.phone) + '\nProyecto: ' + (p?.name || '-') +
      (cuandoTxt ? '\nCuándo: ' + cuandoTxt : '') + (fila.lote_interes ? '\nLote: ' + fila.lote_interes : '') +
      (fila.nota ? '\n\n📝 ' + fila.nota : '') + YA_ENTENDIO +
      '\n🙋 *Desde ahora el chat es tuyo:* el agente ya no le contesta.' +
      '\n👉 El chat: ' + PANEL + '/whatsapp')
    const quien = pc?.asesor_nombre ? pc.asesor_nombre + ', asesor del proyecto,' : 'un asesor del proyecto'
    return {
      ok: true,
      para_ti: {
        llamada: 'Dile que ' + quien + ' la llama ' + (hora || cuando ? 'a la hora acordada' : 'para afinar los detalles') + '. No prometas minutos.',
        separacion: 'Dile que ' + quien + ' le escribe para hacer la separación. Tú no recibes el pago ni pides datos bancarios.',
      }[tipo] + ' Desde aquí la atiende el asesor y tú ya no contestas: despídete en un mensaje corto.',
    }
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
    const pc = await proyectoCfg(ctx.lead.project_id)
    const texto = '🙋 *EL AGENTE TE PASA UN LEAD*\nCliente: ' + (ctx.lead.full_name || '-') + '\nTel: +' + dig(ctx.phone) + '\nProyecto: ' + (p?.name || '-') +
      '\nMotivo: ' + motivo + '\n\nEl agente ya no le contesta: escríbele tú. 👉 ' + PANEL + '/whatsapp'
    // en un proyecto sin bot el lead es del asesor; en el experimento, del dueño
    const asesorTel = pc && pc.modo !== 'bot' ? (dig(pc.asesor_phone) || dig(p?.lead_notify_phone)) : ''
    if (asesorTel) await avisarAsesor(ctx, asesorTel, texto)
    else await ctx.avisar(texto)
    ctx.derivado = true
    return { ok: true, para_ti: 'Ya avisé al equipo. Dile en un mensaje corto que en breve le escribe una persona.' }
  }

  // Lo que el agente tiene que saber del pase abierto. Los recordatorios de Visitas no
  // salen en su historial (son mensajes del sistema): por eso se le cuenta aquí.
  function notaPase(pase, hoy) {
    const cuando = cuandoDe(pase.fecha, pase.hora, pase.cuando)
    if (pase.tipo === 'visita') return pase.fecha && pase.fecha < hoy
      ? 'Tenía una visita agendada para el ' + cuando + ', que ya pasó: no sabes si fue, no lo des por hecho.'
      : 'Ya le agendaste una visita para el ' + cuando + '. Antes de la visita el sistema le manda un recordatorio que no ves en la conversación: si escribe por eso, confírmale la visita, cámbiala con agendar_visita o cancélala con cancelar_visita si ya no va.'
    return 'Ya la pasaste al asesor para ' + ({ llamada: 'una llamada', separacion: 'una separación' }[pase.tipo] || pase.tipo) + (cuando ? ' (' + cuando + ')' : '') +
      ': no la vuelvas a pasar salvo que cambie lo acordado; resuelve lo que pregunte.'
  }

  async function ejecutar(nombre, input, ctx) {
    if (nombre === 'lotes_disponibles') return lotesDisponibles(ctx, input)
    if (nombre === 'otros_proyectos') return otrosProyectos(ctx)
    if (nombre === 'escalonamiento') return escalonamiento(ctx, input)
    if (nombre === 'guardar_datos_cliente') return guardarDatos(ctx, input)
    if (nombre === 'agendar_visita') return agendarVisita(ctx, input)
    if (nombre === 'cancelar_visita') return cancelarVisita(ctx, input)
    if (nombre === 'pasar_a_asesor') return pasarAAsesor(ctx, input)
    if (nombre === 'enviar_material') return enviarMaterial(ctx, input)
    if (nombre === 'pasar_a_persona') return pasarAPersona(ctx, input)
    return { error: 'Herramienta desconocida: ' + nombre }
  }

  // ---------------------------------------------------------------- historial
  // Lo mismo que muestra la bandeja del panel: entrantes y lo escrito desde el
  // celular (whatsapp_messages) + lo que mandó el bot o el panel (scheduled_messages).
  let conColumnaVoz = true   // false si todavía no se corrió sql/93
  async function mensajesDelChat(convId) {
    const q = cols => supabase.from('whatsapp_messages').select(cols).eq('conversation_id', convId).order('created_at', { ascending: false }).limit(60)
    if (conColumnaVoz) {
      const r = await q('id, body, created_at, direction, media_url, media_type, delivery_status, transcripcion')
      if (!r.error) return r
      if (!/transcripcion/.test(r.error.message)) return r
      conColumnaVoz = false
      log('VENTAS IA: falta correr sql/93 (las notas de voz se transcriben pero no se guardan)')
    }
    return q('id, body, created_at, direction, media_url, media_type, delivery_status')
  }

  // Notas de voz del cliente → texto (Groq). Se guarda para no volver a pagarla y
  // para que el panel muestre lo que dijo. Máximo 5 por turno: un cliente que
  // mandó 20 audios no deja al agente pensando un minuto.
  async function oirNotasDeVoz(filas) {
    if (!VOZ.disponible()) return
    let hechas = 0
    for (const f of filas) {
      if (f.dir !== 'in' || f.media_type !== 'audio' || !f.media_url || f.transcripcion != null || hechas >= 5) continue
      hechas++
      try {
        f.transcripcion = await VOZ.transcribir(f.media_url)
        if (conColumnaVoz && f.id) await supabase.from('whatsapp_messages').update({ transcripcion: f.transcripcion }).eq('id', f.id).then(() => {}, () => {})
      } catch (e) { log('VENTAS IA nota de voz:', String(e.message || e)) }
    }
  }

  async function historial(ctx) {
    const { conv, phone } = ctx
    const tel = dig(phone)
    const [ins, outs] = await Promise.all([
      mensajesDelChat(conv.id),
      supabase.from('scheduled_messages').select('body, sent_at, scheduled_for, tipo, status')
        .eq('recipient_phone', tel).eq('status', 'enviado').order('scheduled_for', { ascending: false }).limit(60),
    ])
    const filas = []
    for (const m of (ins.data || [])) filas.push({ id: m.id, at: m.created_at, dir: m.direction === 'out' ? 'out' : 'in', autor: m.direction === 'out' ? 'equipo' : 'cliente', texto: m.body, media_url: m.media_url, media_type: m.media_type, transcripcion: m.transcripcion ?? null })
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
    await oirNotasDeVoz(ult)
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
          else if (f.media_type === 'audio' && f.transcripcion) b.push({ type: 'text', text: '[nota de voz] ' + f.transcripcion })
          else if (f.media_type === 'audio' && f.transcripcion === '') b.push({ type: 'text', text: '[nota de voz en la que no se entienden palabras: si hace falta, pídele que la repita o te la escriba]' })
          else if (f.media_type === 'audio') b.push({ type: 'text', text: nuevo
            ? '[Nota interna: la persona mandó un audio y no puedes escucharlo. Pídele con amabilidad que te lo escriba, como si no pudieras escuchar audios en este momento.]'
            : '[la persona mandó una nota de voz, ya atendida]' })
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
  // ctx: { conv, lead, phone, esPrueba, nota?, decir(texto), mandarMaterial(ids), avisar(texto),
  //        avisarA(tel, texto) → true si llegó por Telegram, notaPrueba(texto), pasarAHumano() }
  async function responder(ctx) {
    if (!ia) throw new Error('no hay clave de Claude (VENTAS_ANTHROPIC_API_KEY o ANTHROPIC_API_KEY)')
    const cfg = (await config()) || {}
    const inicio = new Date().toISOString()
    const { mensajes, agenteHablo: enElHistorial } = await historial(ctx)
    // el historial trae los últimos 40 mensajes: en una conversación larga la
    // presentación ya no aparece, pero el registro del agente sí lo sabe
    const { data: reg } = await supabase.from('ventas_ia_leads').select('primer_mensaje_at, motivo').eq('lead_id', ctx.lead.id).maybeSingle()
    const agenteHablo = enElHistorial || !!reg?.primer_mensaje_at
    const pid = ctx.lead.project_id || null
    const [p, pc, mans] = await Promise.all([pid ? proyecto(pid) : null, proyectoCfg(pid), manuales()])
    const sinBot = !!pc && pc.modo !== 'bot'

    const notas = []
    if (!agenteHablo) notas.push(reg?.motivo === 'primer_mensaje' || (sinBot && !reg)
      ? 'Nota interna: es tu primer mensaje y nadie le ha respondido todavía. Salúdala, preséntate en una línea' + (cfg.nombre_agente ? ' con tu nombre' : '') + ' y responde lo que escribió.'
      : 'Nota interna: es tu primer mensaje. La persona pidió hablar con un asesor y ahora la atiendes tú. Preséntate en una línea' + (cfg.nombre_agente ? ' con tu nombre' : '') + ' y sigue desde donde quedó la conversación, sin repetir lo que ya le mandó el bot.')
    if (ctx.nota) notas.push('Nota interna: ' + ctx.nota)
    if (notas.length) {
      const bloque = { type: 'text', text: '[' + notas.join(' ') + ']' }
      const u = mensajes[mensajes.length - 1]
      if (u && u.role === 'user') u.content.push(bloque)
      else mensajes.push({ role: 'user', content: [bloque] })
    }
    if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') return { enviados: 0 }

    const [{ data: acts }, { data: pase }] = await Promise.all([
      supabase.from('lead_activities').select('note').eq('lead_id', ctx.lead.id).order('created_at').limit(40),
      supabase.from('ventas_ia_pases').select('tipo, fecha, hora, cuando, created_at').eq('lead_id', ctx.lead.id).eq('estado', 'pendiente').maybeSingle(),
    ])
    const respuestasFlujo = (acts || []).filter(a => /^P: /.test(a.note)).map(a => '- ' + a.note.replace(/^P:\s*/, '').replace(/\s*→\s*R:\s*/, ' → '))
    const hoy = hoyLima()
    const proximos = [0, 1, 2, 3, 4, 5, 6].map(n => { const d = sumarDias(hoy, n); return diaSemana(d) + ' ' + fechaCorta(d) + ' = ' + d }).join('; ')
    const manual = manualDe(mans, pid)

    const persona = cfg.nombre_agente ? 'Te llamas ' + cfg.nombre_agente + '.' : 'No uses un nombre propio: preséntate como del equipo de ventas de Urbis.'
    const system = [
      { type: 'text', text: PROMPT_BASE, cache_control: { type: 'ephemeral' } },
      ...(mans.length ? [{ type: 'text', text: manualesTexto(mans), cache_control: { type: 'ephemeral' } }] : []),
      {
        type: 'text',
        text: persona + '\n\n' + fichaTexto(p, !sinBot) +
          (manual ? '\n\nEl manual que manda en esta conversación es «' + manual.titulo + '».' : '') +
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
          (pase ? '\n' + notaPase(pase, hoy) : '') +
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
        await ctx.decir('Déjeme consultarlo con mi compañero y le escribimos en breve 🙌')
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
      if (!enviados) { await ctx.decir('Deme un momento y le escribo 🙌'); enviados++ }
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
  // (visitas del experimento, sql/91; los proyectos sin bot pasan al asesor)
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
    const mans = await manuales()
    await supabase.from('ventas_ia_config').update({
      latido: new Date().toISOString(),
      // manuales: cuántos lee el bot (null = no encuentra la tabla); si falta, el bot tiene el código viejo
      latido_info: { ia: !!ia, clave_propia: CLAVE_PROPIA, modelo: (CFG && CFG.modelo) || MODELO_POR_DEFECTO, manuales: MAN.error ? null : mans.length, version: 2 },
    }).eq('id', 1).then(() => {}, () => {})
  }

  return { config, esperaLectura, enHorario, modoProyecto, asignar, responder, notaDeCita, explicarError, latido, activo: () => !!ia, cuotasDe, normLote }
}
module.exports.cuotasDe = cuotasDe
module.exports.normLote = normLote
