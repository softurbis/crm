// ============================================================================
// EMPAREJADOR DE OPCIONES DEL FLUJO (compartido por los dos motores)
// ----------------------------------------------------------------------------
// Antes se comparaba la clave CRUDA dentro del texto crudo, y eso fallaba en las
// dos puntas:
//   · "sí" con tilde NO contiene "si" → el lead que escribe bien quedaba colgado;
//   · "necesito pensarlo" SÍ contiene "si" → el que dudaba terminaba con un
//     asesor llamándolo, o peor: contestaba "Sí" cuando habia dicho que no.
// De 28 respuestas tipicas de un lead, 19 no se entendian.
//
// Aca se compara normalizado (sin tildes, minusculas) y por PALABRA COMPLETA, y
// ademas se entienden los "si" y "no" de siempre sin que el operador tenga que
// escribirlos en cada pregunta. Sus claves siguen mandando: se miran primero.
// ============================================================================

const sinTildes = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
// deja letras, numeros y espacios; el resto (signos, emojis) se vuelve espacio
const normalizar = t => sinTildes(t).toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim()

const EMOJI_SI = /[\u{1F44D}\u{1F44C}\u{1F64C}\u{2705}\u{1F91D}\u{1F4AA}\u{1F64F}]/u   // 👍 👌 🙌 ✅ 🤝 💪 🙏
const EMOJI_NO = /[\u{1F44E}\u{1F645}\u{274C}]/u                                       // 👎 🙅 ❌

// Como contesta la gente por WhatsApp en la practica (Peru).
const AFIRMA = [
  'si', 'sii', 'siii', 'sip', 'sipi', 'simon', 'claro', 'claro que si', 'como no',
  'ok', 'oka', 'okay', 'okey', 'oki', 'dale', 'dale pues', 'ya', 'yaa', 'ya pues',
  'listo', 'bueno', 'buenas', 'porfa', 'porfavor', 'por favor', 'obvio', 'de una',
  'asi es', 'correcto', 'afirmativo', 'positivo', 'acepto', 'vale', 'va', 'perfecto',
  'excelente', 'genial', 'adelante', 'me interesa', 'interesa', 'quiero', 'deseo',
  'hagalo', 'hazlo', 'comuniqueme', 'comunicame', 'llamenme', 'llamame',
]
const NIEGA = [
  'no', 'nop', 'nel', 'negativo', 'no gracias', 'gracias no', 'no por ahora',
  'por ahora no', 'ahorita no', 'ahora no', 'todavia no', 'aun no', 'todavia',
  'luego', 'despues', 'mas tarde', 'otro dia', 'otro momento', 'paso',
  'no quiero', 'no deseo', 'no me interesa', 'claro que no', 'para nada',
  // "lo voy a pensar" es un no, aunque suene amable
  'pensarlo', 'lo pensare', 'lo voy a pensar', 'necesito pensarlo', 'tengo que pensarlo',
  'lo consulto', 'lo converso', 'aun no decido', 'todavia no decido',
]

// ¿aparece la clave como PALABRA (o frase) completa dentro del texto normalizado?
function contiene(textoNorm, clave) {
  const c = normalizar(clave)
  if (!c) return false
  return new RegExp('(^|\\s)' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|\\s)').test(textoNorm)
}

// De una lista de claves, devuelve la MAS LARGA que aparezca en el texto. La
// longitud desempata sola los casos jodidos: en "claro que no" gana "claro que
// no" (12) sobre "claro" (5), y la respuesta se lee como lo que es: un no.
function mejorClave(textoNorm, claves) {
  let mejor = ''
  for (const k of claves) if (contiene(textoNorm, k) && normalizar(k).length > mejor.length) mejor = normalizar(k)
  return mejor
}

// ¿esta opcion es el "si" o el "no" de una pregunta cerrada? Se mira su etiqueta
// y sus claves: una opcion que se llama "Si" o "No" no necesita configuracion.
function polaridadDeOpcion(op, af, ng) {
  const campos = [op.label, op.claves].map(normalizar).filter(Boolean)
  for (const t of campos) {
    if (af.some(k => contiene(t, k))) return 'si'
    if (ng.some(k => contiene(t, k))) return 'no'
  }
  return null
}

// "si, claro, ya pues" (o un arreglo) -> ['si','claro','ya pues']
const lista = v => (Array.isArray(v) ? v : String(v || '').split(/[,\n]/)).map(x => String(x).trim()).filter(Boolean)

/**
 * Elige la opcion que corresponde a lo que escribio el lead.
 * Orden: numero → claves del operador → si/no de toda la vida.
 * Devuelve la opcion, o null si de verdad no se entiende (ahi el flujo decide:
 * repreguntar y, si insiste, pasar a un humano).
 */
function elegirOpcion(texto, opciones, extra = {}) {
  const ops = opciones || []
  if (!ops.length) return null
  const crudo = String(texto || '')
  const t = normalizar(crudo)
  // las palabras que agrega el operador desde el panel SE SUMAN a las de fabrica:
  // nunca las reemplazan, para que nadie pueda dejar al bot sin entender un "si"
  const AF = AFIRMA.concat(lista(extra.si))
  const NG = NIEGA.concat(lista(extra.no))

  // 1) un numero solo y dentro del rango: eligio de la lista
  if (/^\s*\d+\s*$/.test(crudo)) {
    const n = parseInt(crudo.trim(), 10)
    if (n >= 1 && n <= ops.length) return ops[n - 1]
  }

  // 2) las claves que escribio el operador; si dos opciones matchean, gana la de
  //    la clave mas larga (la mas especifica)
  let porClave = null, largoClave = 0
  for (const o of ops) {
    const k = mejorClave(t, String(o.claves || '').split(','))
    if (k && k.length > largoClave) { porClave = o; largoClave = k.length }
  }

  // 3) si/no de toda la vida, sin que nadie los configure
  const kSi = mejorClave(t, AF)
  const kNo = mejorClave(t, NG)
  let polaridad = null, largoPol = 0
  if (kSi.length > kNo.length) { polaridad = 'si'; largoPol = kSi.length }
  else if (kNo.length > kSi.length) { polaridad = 'no'; largoPol = kNo.length }
  else if (!kSi && !kNo) { polaridad = EMOJI_SI.test(crudo) ? 'si' : (EMOJI_NO.test(crudo) ? 'no' : null); largoPol = polaridad ? 1 : 0 }
  // empate exacto entre un si y un no: no se adivina, se repregunta

  // Un "no" mas explicito que la clave del operador gana SIEMPRE. Si el lead
  // escribio "claro que no", ninguna clave "claro" puede leerlo como un si — y
  // si la pregunta no tiene camino para el no, mejor no entender que entender
  // al reves: el flujo repregunta y termina pasandolo a un humano.
  if (polaridad === 'no' && largoPol > largoClave) {
    return ops.find(o => polaridadDeOpcion(o, AF, NG) === 'no') || null
  }
  if (porClave) return porClave

  if (polaridad) {
    const match = ops.find(o => polaridadDeOpcion(o, AF, NG) === polaridad)
    if (match) return match
    // pregunta de UNA sola opcion (la etiqueta es la pregunta entera): un "si"
    // la elige; un "no" no tiene camino, y eso lo resuelve el flujo pasando a
    // un humano en vez de repreguntar para siempre.
    if (ops.length === 1 && polaridad === 'si') return ops[0]
  }
  return null
}

module.exports = { elegirOpcion, normalizar }
