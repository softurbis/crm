// CIERRE DEL DÍA CON IA (28 nov 2026 — pedido de gerencia "Seguimiento y reportes", A4).
// La persona responde su pase de lista como habla ("4 hecho, quedó en venir el 15", "6 pausa
// por lluvia hasta el viernes", "12 mañana", "anota llamar al notario el lunes") y Claude
// Haiku 5.5 lo convierte en acciones. La IA NO toca la base: devuelve un JSON con forma fija
// y este módulo lo REVISA (la tarea es de esa persona, la fecha no es pasada, el motivo
// existe...) antes de aplicar nada. Lo nuevo que menciona queda como PROPUESTA hasta que la
// persona lo confirma con un botón (regla de gerencia: "el filtro final es una persona").
// Si la IA falla, no hay clave o se llegó al tope de gasto, index.js sigue con la lectura
// por números de siempre (leerChecklist): nunca se queda sin entender un "1 y 3 listo".
// Costo: ~USD 0.0006 por respuesta con Haiku 5.5 (queda en ia_uso, origen 'seguimiento').
const { Anthropic } = require('@anthropic-ai/sdk')

const MODELO = process.env.SEGUIMIENTO_IA_MODEL || 'claude-haiku-5-5'
const MOTIVOS_DEF = ['Lluvia', 'Espera de un tercero', 'Falta de dinero', 'Salud', 'Reprogramada', 'Descartada']
const ESTADOS = ['hecha', 'en_proceso', 'pausada', 'mover', 'aun_no', 'no_hecha', 'sin_cambio']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

const SISTEMA = `Eres el asistente de seguimiento de tareas del equipo de Urbis, una inmobiliaria de lotes en Pucallpa (Perú). Lees lo que una persona del equipo responde sobre SUS tareas de hoy y lo conviertes en acciones exactas. No conversas de otros temas.

REGLAS
1. Solo actúas sobre las tareas de la lista, por su número (n). Si la persona nombra una tarea por lo que dice ("lo de la imprenta"), usa el n de esa tarea. Si no estás seguro de cuál es, no la toques y pregunta.
2. estado de cada acción:
   - hecha: la terminó.
   - en_proceso: avanzó pero no terminó. Si da cantidades ("se colocaron 4 de 6"), avance_hecho=4 y avance_total=6.
   - pausada: no se puede hacer por ahora por una causa (lluvia, espera de un tercero, falta de dinero, salud, reprogramada, descartada…). motivo = el de la lista MOTIVOS que mejor calce; si ninguno calza, "Otro: <causa breve>". fecha = cuándo retomarla si la dice ("viernes", "el lunes", "el 15" se calculan desde HOY); null si no la dice.
   - mover: solo la pasa a otro día u hora, sin otra causa ("la 12 mañana", "pásala al lunes a las 10"). Lleva fecha (y hora si la dice).
   - aun_no: todavía no la hace pero sigue para hoy ("aún no", "más tarde", "en eso estoy" sin avance).
   - no_hecha: no se hizo y no se hará hoy, sin una causa de pausa.
   - sin_cambio: solo cuenta algo de la tarea (nota o resultado) sin cambiar su estado.
   Un "no" a secas sobre una tarea ("1 no") es aun_no si la HORA es antes de las 17:00, y no_hecha desde las 17:00.
3. nota: solo lo que la persona CONTÓ de esa tarea además de su estado, breve y en sus palabras (máximo 200 caracteres). Si solo dijo que está hecha o que no, nota = null. Nunca repitas el título de la tarea en la nota. resultado: solo si dice cómo terminó ("quedó en venir el 15 a separar", "el notario pidió la copia literal"), o null.
4. nuevas: tareas NUEVAS que la persona pide anotar ("anota llamar al notario el lunes", "hay que recoger los planos el jueves") o compromisos que nacen de una tarea ("vendrá a comprar el 15 de diciembre" → nueva "LLAMAR AL CLIENTE POR SU COMPRA" para esa fecha, sigue_de = el n de la tarea de origen). Texto corto, en mayúsculas, empezando con un verbo. No crees nuevas por cosas ya hechas. Nunca inventes.
5. Fechas en formato AAAA-MM-DD y nunca antes de HOY. Tómalas del CALENDARIO que viene con el mensaje ("mañana" es la fila MAÑANA, "el viernes" es el próximo viernes de la lista): no cuentes días por tu cuenta. hora en HH:MM de 24 horas, o null.
6. Si el mensaje no se entiende, es contradictorio o no habla de las tareas, no pongas acciones ni nuevas y escribe en "pregunta" una sola pregunta corta.
7. respuesta: confirma en 1 o 2 frases cortas, en español peruano, tuteando, cálido y directo, nombrando los números de las tareas que tocaste y qué hiciste con cada una. Sin listas ni menús, máximo un emoji, sin mencionar la hora. No hagas otras preguntas ni ofrezcas cosas: lo único que puedes preguntar es si anotas las nuevas. Las nuevas todavía NO están anotadas (la persona las confirma con un botón): nunca digas que las anotaste; di que te confirme si las anotas. Si no hiciste nada, respuesta = la misma pregunta.
8. No inventes datos, montos, nombres ni fechas que no estén en el mensaje o en la lista.`

const nulo = t => ({ anyOf: [{ type: t }, { type: 'null' }] })
const ESQUEMA = {
  type: 'object', additionalProperties: false,
  required: ['acciones', 'nuevas', 'pregunta', 'respuesta'],
  properties: {
    acciones: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['n', 'estado', 'nota', 'resultado', 'motivo', 'fecha', 'hora', 'avance_hecho', 'avance_total'],
        properties: {
          n: { type: 'integer' },
          estado: { type: 'string', enum: ESTADOS },
          nota: nulo('string'), resultado: nulo('string'), motivo: nulo('string'),
          fecha: nulo('string'), hora: nulo('string'),
          avance_hecho: nulo('number'), avance_total: nulo('number'),
        },
      },
    },
    nuevas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['texto', 'fecha', 'hora', 'sigue_de'],
        properties: { texto: { type: 'string' }, fecha: nulo('string'), hora: nulo('string'), sigue_de: nulo('integer') },
      },
    },
    pregunta: nulo('string'),
    respuesta: { type: 'string' },
  },
}

const corta = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t ? t.slice(0, n) : null }
const fechaOk = (f, hoy) => typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && !isNaN(new Date(f + 'T12:00:00')) && f >= hoy ? f : null
const horaOk = h => typeof h === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h) ? h : null
const numOk = x => typeof x === 'number' && isFinite(x) && x >= 0 ? x : null
const ddmm = f => f ? f.slice(8, 10) + '/' + f.slice(5, 7) : ''

function motivoCanonico(m, motivos) {
  const t = corta(m, 80)
  if (!t) return 'Otro'
  const sin = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const hit = motivos.find(x => sin(t).startsWith(sin(x)) || sin(x).startsWith(sin(t)))
  if (hit) return hit
  return /^otro/i.test(t) ? t : 'Otro: ' + t
}

// Revisa lo que devolvió la IA. Lo que no cumple se DESCARTA (y se cuenta): nunca se aplica
// una acción sobre una tarea que no es de la persona ni con una fecha inventada o pasada.
function validar(out, porN, hoy, motivos) {
  const r = { acciones: [], nuevas: [], pregunta: null, respuesta: null, descartadas: 0 }
  if (!out || typeof out !== 'object') return null
  const vistas = new Map()
  for (const a of Array.isArray(out.acciones) ? out.acciones : []) {
    if (!a || !Number.isInteger(a.n) || !porN.has(a.n) || !ESTADOS.includes(a.estado)) { r.descartadas++; continue }
    const x = {
      n: a.n, estado: a.estado, nota: corta(a.nota, 300), resultado: corta(a.resultado, 300),
      motivo: null, fecha: fechaOk(a.fecha, hoy), hora: horaOk(a.hora), avance_hecho: null, avance_total: null,
    }
    if (x.estado === 'pausada') x.motivo = motivoCanonico(a.motivo, motivos)
    if (x.estado === 'mover') {
      if (!x.fecha && x.hora) x.fecha = hoy
      if (!x.fecha) { r.descartadas++; continue }
    }
    if (x.estado === 'en_proceso') {
      x.avance_hecho = numOk(a.avance_hecho); x.avance_total = numOk(a.avance_total)
      if (x.avance_total !== null && x.avance_hecho !== null && x.avance_hecho > x.avance_total) x.avance_hecho = x.avance_total
      if (x.avance_total === null) x.avance_hecho = null
    }
    if (x.estado === 'sin_cambio' && !x.nota && !x.resultado) { r.descartadas++; continue }
    vistas.set(x.n, x)   // si nombró dos veces la misma tarea, vale la última
  }
  r.acciones = [...vistas.values()]
  for (const nv of (Array.isArray(out.nuevas) ? out.nuevas : []).slice(0, 5)) {
    const texto = corta(nv && nv.texto, 200)
    if (!texto || texto.length < 3) { r.descartadas++; continue }
    r.nuevas.push({ texto: texto.toUpperCase(), fecha: fechaOk(nv.fecha, hoy), hora: horaOk(nv.hora), sigue_de: Number.isInteger(nv.sigue_de) && porN.has(nv.sigue_de) ? nv.sigue_de : null })
  }
  r.pregunta = corta(out.pregunta, 300)
  r.respuesta = corta(out.respuesta, 600)
  return r
}

module.exports = function crearSeguimientoIA({ supabase, log, clave }) {
  const ia = clave ? require('./uso_ia').envolver(new Anthropic({ apiKey: clave, maxRetries: 1, timeout: 45000 }), { supabase, log, origen: 'seguimiento' }) : null

  async function motivos() {
    try {
      const { data } = await supabase.from('bot_settings').select('value').eq('key', 'tarea_motivos').maybeSingle()
      const m = JSON.parse(data?.value || '[]')
      if (Array.isArray(m) && m.length) return m.map(String)
    } catch {}
    return MOTIVOS_DEF
  }

  // tareas = [{ n, id, title, status, time, slot, note, avance_hecho, avance_total }]
  async function interpretar({ nombre, hoy, hora, tareas, texto }) {
    if (!ia) return null
    const porN = new Map(tareas.map(t => [t.n, t]))
    const mot = await motivos()
    const d = new Date(hoy + 'T12:00:00')
    // el calendario ya calculado: Haiku se equivocaba contando ("mañana" = hoy)
    const cal = Array.from({ length: 15 }, (_, i) => {
      const x = new Date(d); x.setDate(x.getDate() + i)
      const iso = x.toLocaleDateString('en-CA')
      return (i === 0 ? 'HOY' : i === 1 ? 'MAÑANA' : '-') + ': ' + DIAS[x.getDay()] + ' ' + ddmm(iso) + ' = ' + iso
    }).join('\n')
    const lista = tareas.map(t => `${t.n}. [${t.status}] ${t.title}`
      + (t.time ? ` (${String(t.time).slice(0, 5)})` : t.slot === 'tarde' ? ' (tarde)' : ' (mañana)')
      + (t.status === 'en_proceso' && t.avance_total ? ` · va ${t.avance_hecho ?? 0} de ${t.avance_total}` : '')
      + (t.note ? ` · última nota: ${String(t.note).slice(0, 120)}` : '')).join('\n')
    const contenido = `HOY: ${DIAS[d.getDay()]} ${ddmm(hoy)}/${hoy.slice(0, 4)} (${hoy}) · HORA: ${hora || '12:00'}\nPERSONA: ${nombre}\nMOTIVOS: ${mot.join('; ')}\n\nCALENDARIO:\n${cal}\n\nTAREAS DE HOY:\n${lista}\n\nMENSAJE DE LA PERSONA:\n"""${String(texto).slice(0, 1500)}"""`
    try {
      const resp = await ia.messages.create({
        model: MODELO, max_tokens: 4000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
        system: SISTEMA,
        messages: [{ role: 'user', content: contenido }],
      })
      if (resp.stop_reason === 'refusal' || resp.stop_reason === 'max_tokens') { log('SEGUIMIENTO IA: se cortó (' + resp.stop_reason + ')'); return null }
      const txt = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      const r = validar(JSON.parse(txt), porN, hoy, mot)
      if (r) log('SEGUIMIENTO IA: ' + nombre + ' → ' + r.acciones.length + ' accion(es), ' + r.nuevas.length + ' nueva(s)' + (r.descartadas ? ', ' + r.descartadas + ' descartada(s)' : '') + (r.pregunta && !r.acciones.length ? ', pregunta' : ''))
      return r
    } catch (e) {
      log('SEGUIMIENTO IA: falló (' + String(e.message || e).slice(0, 160) + '); sigue la lectura por números')
      return null
    }
  }

  // Aplica lo validado. sec = la persona (secretaries); porN = n -> tarea. Devuelve el
  // resumen de lo hecho para armar la respuesta si hace falta.
  async function aplicar({ sec, porN, r, texto, hoy, horaAhora, slotDeHora, AUN_NO }) {
    const ahora = new Date().toISOString()
    const resp = String(texto).slice(0, 300)
    const hechas = []
    const nota = async (taskId, tipo, txt) => {
      if (!txt) return
      const { error } = await supabase.from('tarea_notas').insert({ task_id: taskId, tipo, texto: txt, autor_nombre: sec.full_name, via: 'ia' })
      if (error) log('SEGUIMIENTO IA nota:', error.message)
    }
    for (const a of r.acciones) {
      const t = porN.get(a.n)
      let cambio = null
      if (a.estado === 'hecha') cambio = { status: 'hecha', answered_at: ahora, answer: resp, motivo: null, reanudar_el: null }
      else if (a.estado === 'en_proceso') cambio = { status: 'en_proceso', answered_at: ahora, answer: resp, motivo: null, reanudar_el: null, avance_hecho: a.avance_hecho, avance_total: a.avance_total }
      else if (a.estado === 'pausada') cambio = { status: 'pausada', answered_at: ahora, answer: resp, motivo: a.motivo, reanudar_el: a.fecha }
      else if (a.estado === 'no_hecha') cambio = { status: 'no_hecha', answered_at: ahora, answer: resp, motivo: null }
      else if (a.estado === 'aun_no') cambio = { reminded_at: ahora, answer: (AUN_NO + ' · ' + horaAhora + ' · ' + resp).slice(0, 300) }
      else if (a.estado === 'mover') cambio = {
        date: a.fecha, time: a.hora || t.time || null, slot: a.hora ? slotDeHora(a.hora) : t.slot, status: 'pendiente',
        ask_index: null, asked_at: null, reminded_at: null, answered_at: null, notified_at: null, answer: 'MOVIDA POR CHAT: ' + resp,
      }
      if (a.resultado) cambio = { ...(cambio || {}), resultado: a.resultado }
      if (cambio) {
        const { error } = await supabase.from('secretary_tasks').update(cambio).eq('id', t.id).eq('secretary_id', sec.id)
        if (error) { log('SEGUIMIENTO IA aplicar:', error.message); continue }
      }
      if (a.estado === 'mover') await nota(t.id, 'sistema', 'Movida al ' + ddmm(a.fecha) + (a.hora ? ' a las ' + a.hora : '') + ' por chat')
      await nota(t.id, 'nota', a.nota)
      await nota(t.id, 'resultado', a.resultado)
      hechas.push({ ...a, title: t.title })
    }
    // lo nuevo queda propuesto: se anota recién cuando la persona toca "Anotar"
    const propuestas = []
    for (const nv of r.nuevas) {
      const { data, error } = await supabase.from('tarea_propuestas').insert({
        secretary_id: sec.id, texto: nv.texto, fecha: nv.fecha, hora: nv.hora,
        sigue_de: nv.sigue_de ? porN.get(nv.sigue_de)?.id || null : null, origen: String(texto).slice(0, 500),
      }).select('id, texto, fecha, hora').single()
      if (error) { log('SEGUIMIENTO IA propuesta:', error.message); continue }
      propuestas.push(data)
    }
    return { hechas, propuestas }
  }

  // la confirmación que arma el código (si la IA descartó algo, no se usa su texto)
  function resumenCodigo(nombre, hechas) {
    const verbo = { hecha: 'cerrada ✅', en_proceso: 'en proceso', pausada: 'pausada', mover: 'movida', aun_no: 'sigue pendiente', no_hecha: 'no hecha', sin_cambio: 'con tu nota' }
    if (!hechas.length) return null
    return 'Listo, ' + nombre + ': ' + hechas.map(h => h.n + ' ' + verbo[h.estado]
      + (h.estado === 'pausada' ? ' (' + h.motivo + (h.fecha ? ', hasta el ' + ddmm(h.fecha) : ', sin fecha') + ')' : '')
      + (h.estado === 'mover' ? ' al ' + ddmm(h.fecha) + (h.hora ? ' ' + h.hora : '') : '')
      + (h.estado === 'en_proceso' && h.avance_total ? ' (' + (h.avance_hecho ?? 0) + ' de ' + h.avance_total + ')' : '')).join(', ') + '.'
  }

  return { activa: () => !!ia, interpretar, aplicar, resumenCodigo, validar: (out, porN, hoy, mot) => validar(out, porN, hoy, mot || MOTIVOS_DEF) }
}
module.exports.validar = validar
module.exports.ESQUEMA = ESQUEMA
module.exports.SISTEMA = SISTEMA
