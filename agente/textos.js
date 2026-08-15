// ============================================================================
// TEXTOS DEL FLUJO DE LEADS (compartidos por los dos motores)
// ----------------------------------------------------------------------------
// El mismo flujo (projects.bot_flow) lo corren index.js (Baileys) y leads_api.js
// (Cloud API). Si un texto se escribe dos veces, tarde o temprano uno de los dos
// queda distinto y el cliente ve algo raro solo en un numero. Por eso viven aca.
// ============================================================================

// Lista de opciones de una pregunta.
// Con UNA sola opcion no se numera ni se pide "el numero": un "1." solitario no
// es una lista, es ruido — y el cliente se queda pensando que le faltan opciones.
// Va la pregunta sola y se le pide que conteste con sus palabras.
function bloqueOpciones(opciones) {
  const ops = opciones || []
  if (ops.length === 1) return ops[0].label + '\n\n_(respóndeme con tus palabras)_'
  return ops.map((o, i) => (i + 1) + '. ' + o.label).join('\n') + '\n\n_(responde con el número o en tus palabras)_'
}

// Cuando no se entendio la respuesta y hay que volver a preguntar.
function bloqueNoEntendi(opciones) {
  const ops = opciones || []
  if (ops.length === 1) return 'No te entendí bien 😅\n' + bloqueOpciones(ops)
  return 'No te entendí bien 😅 Elige una opción:\n' + bloqueOpciones(ops)
}

module.exports = { bloqueOpciones, bloqueNoEntendi }
