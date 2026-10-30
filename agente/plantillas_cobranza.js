// ============================================================================
// LAS PLANTILLAS DE COBRANZA — un solo lugar             [sep 2026]
// ----------------------------------------------------------------------------
// Esta lista es la FUENTE: de aqui salen
//   · las plantillas que se crean en Meta   (node cobranza_meta.js crear_plantillas)
//   · los textos para pegarlas a mano       (node cobranza_meta.js textos)
//   · lo que se le manda a gerencia a aprobar (PLANTILLAS_COBRANZA.md)
//
// EL ORDEN DE LAS VARIABLES MANDA: cobranza.js llena {{1}}, {{2}}... en ese
// orden exacto (decidirAviso). Si cambias el orden aca, cambialo alla.
//
// Reglas de Meta que ya estan respetadas y conviene no romper:
//   · categoria UTILITY (aviso de la cuenta del cliente). Si Meta la pasa a
//     MARKETING, el mensaje se cobra distinto y pide consentimiento.
//   · el cuerpo no empieza ni termina en variable, y no hay dos variables
//     pegadas: con eso Meta rechaza la plantilla.
//   · sin encabezado, sin pie y sin botones: la primera linea en cursiva
//     (_Urbis Group · Cobranzas_) va DENTRO del cuerpo, como en la propuesta.
//
// 26 sep 2026: textos de la PROPUESTA APROBADA por el dueno. Nombres nuevos
// (urbis_cobranza_*): cambiaron el texto y el orden de las variables, y Meta no
// deja reusar el nombre de una plantilla borrada durante semanas.
// ============================================================================

const PLANTILLAS = [
  {
    campo: 'plantilla_recordatorio',
    nombre: 'urbis_cobranza_recordatorio',
    cuando: '3 días antes del vencimiento (si cae en sábado, domingo o feriado, sale el día hábil anterior).',
    variables: ['nombre', 'N° de cuota', 'lote', 'proyecto', 'fecha de vencimiento', 'monto'],
    cuerpo: '_Urbis Group · Cobranzas_\nEstimado(a) {{1}}: le recordamos que su cuota N° {{2}} del lote {{3}} del proyecto {{4}} vence el {{5}}, por S/ {{6}}. Le pedimos por favor, realizar su pago a tiempo. Si ya pagó, envíe la foto de su voucher por este chat para registrarlo, gracias.',
    ejemplo: ['Juan', '12', 'Mz B Lt 7', 'Las Praderas de Cashibo', '30/09/2026', '350.00'],
  },
  {
    campo: 'plantilla_vence_hoy',
    nombre: 'urbis_cobranza_vence_hoy',
    cuando: 'El día del vencimiento (si cae en sábado, domingo o feriado no sale: ya salió el recordatorio).',
    variables: ['nombre', 'N° de cuota', 'lote', 'proyecto', 'monto'],
    cuerpo: '_Urbis Group · Cobranzas_\nEstimado(a) {{1}}: hoy vence su cuota N° {{2}} del lote {{3}} del proyecto {{4}}, por S/ {{5}}. Por favor realizar su pago hoy para mantener su cuenta al día. Si ya pagó, envíe la foto de su voucher por este chat, gracias.',
    ejemplo: ['Juan', '12', 'Mz B Lt 7', 'Las Praderas de Cashibo', '350.00'],
  },
  {
    campo: 'plantilla_vencida',
    nombre: 'urbis_cobranza_pago_vencido',
    cuando: 'De 1 a 3 cuotas vencidas: a los 2 y 5 días de vencida la más antigua, luego cada 7 días.',
    variables: ['nombre', 'lote', 'proyecto', 'saldo vencido', 'pendiente desde'],
    cuerpo: '_Urbis Group · Pago vencido_\nEstimado(a) {{1}}: su lote {{2}} del proyecto {{3}} tiene un saldo vencido de S/ {{4}}, pendiente desde el {{5}}. Le solicitamos por favor, regularizar su pago a la brevedad. Si ya pagó, envíe su voucher por este chat. Si tiene algún inconveniente, escríbanos por aquí para coordinar una fecha de pago, gracias.',
    ejemplo: ['Juan', 'Mz B Lt 7', 'Las Praderas de Cashibo', '700.00', '30/08/2026'],
  },
  {
    campo: 'plantilla_vencida_grave',
    nombre: 'urbis_cobranza_aviso_contrato',
    cuando: 'Desde 4 cuotas vencidas, una vez por semana. Reemplaza al de pago vencido, no se suma.',
    variables: ['nombre', 'lote', 'proyecto', 'cuántas cuotas vencidas', 'saldo vencido'],
    cuerpo: '_Aviso importante sobre su contrato_\nEstimado(a) {{1}}: su lote {{2}} del proyecto {{3}} registra {{4}} cuotas vencidas, con un saldo vencido de S/ {{5}}. Según lo establecido en su contrato, la falta de pago de las cuotas es causal de resolución del contrato.\nPara regularizar su situación o acordar un plan de pago, comuníquese por favor con nosotros por este chat el día de hoy. Si ya realizó pagos que no figuran, envíenos sus vouchers, gracias.',
    ejemplo: ['Juan', 'Mz B Lt 7', 'Las Praderas de Cashibo', '5', '1,750.00'],
  },
  {
    campo: 'plantilla_promesa',
    nombre: 'urbis_cobranza_promesa',
    cuando: '1 día antes de la fecha que el cliente prometió (si cae en sábado, domingo o feriado, el día hábil anterior).',
    variables: ['nombre', 'fecha prometida', 'monto', 'lote', 'proyecto'],
    cuerpo: '_Urbis Group · Cobranzas_\nEstimado(a) {{1}}: le recordamos que para el {{2}} se comprometió a pagar S/ {{3}} del lote {{4}} del proyecto {{5}}. Cuando realice el pago, envíe la foto de su voucher por este chat, gracias.\nSi el pago no se registra en la fecha acordada, su cuenta seguirá el proceso de cobranza.',
    ejemplo: ['Juan', '15/10/2026', '350.00', 'Mz B Lt 7', 'Las Praderas de Cashibo'],
  },
  // 29 oct 2026: aviso INTERNO a la secretaria de cobranza por WhatsApp (no al cliente).
  // Sale cuando el agente necesita que una persona resuelva algo (p. ej. un cliente
  // mandó el voucher de un pago que ya estaba registrado). Como ella casi nunca le
  // escribe al 960, el texto libre no pasa (ventana de 24 h): va por plantilla.
  {
    campo: 'plantilla_aviso_interno',
    interna: true,
    nombre: 'urbis_aviso_interno',
    cuando: 'Cuando el agente de cobranza le pasa un caso a la secretaria (solo a los responsables de cobranza, nunca a clientes).',
    variables: ['detalle del caso'],
    cuerpo: '_Urbis Group · Cobranzas (aviso interno)_\nHay un caso que necesita que lo resuelva una persona: {{1}}. Revise el panel, en Cobranza IA, Conversaciones.',
    ejemplo: ['Juan Pérez (Mz B Lt 7) mandó el voucher de un pago que ya está registrado (op 12345, S/ 350.00 del 15/10/2026)'],
  },
]

// 29 oct 2026: LAS PLANTILLAS CON TÍTULO (observaciones de la secretaria, aprobadas
// por el dueño). Cada aviso dice en la primera línea QUÉ es (recordatorio, cobranza
// del día o alerta), el vencido va cuota por cuota con el monto del cronograma y el
// total solo como referencia, y la cuota que este mes sale MENOS porque tiene plata a
// favor lo dice: "por única vez". Nombres nuevos (_v3): no reemplazan a las de arriba.
// cobranza.js usa cada una apenas Meta la APRUEBA; mientras tanto salen las de
// siempre. Se crean aparte, cuando el dueño lo diga:
//   node cobranza_meta.js crear_plantillas_titulo            → las de Urbis
//   node cobranza_meta.js crear_plantillas_titulo century    → las de Century
// `clave` es lo que usa decidirAviso para elegirla.
const PLANTILLAS_TIPO = [
  {
    clave: 'recordatorio',
    nombre: 'urbis_cobranza_recordatorio_v3',
    cuando: '3 días antes del vencimiento (reemplaza a urbis_cobranza_recordatorio cuando Meta la apruebe).',
    variables: ['nombre', 'N° de cuota', 'lote', 'proyecto', 'fecha de vencimiento', 'monto'],
    cuerpo: '🔔 *RECORDATORIO DE PAGO*\n_Urbis Group · Cobranzas_\nEstimado(a) {{1}}: le recordamos que su cuota N° {{2}} del lote {{3}} del proyecto {{4}} vence el {{5}}, por S/ {{6}}. Le pedimos por favor, realizar su pago a tiempo. Si ya pagó, envíe la foto de su voucher por este chat para registrarlo, gracias.',
    ejemplo: ['Juan', '12', 'Mz B Lt 7', 'Las Praderas de Cashibo', '30/09/2026', '350.00'],
  },
  {
    clave: 'recordatorio_ajuste',
    nombre: 'urbis_cobranza_recordatorio_ajuste_v3',
    cuando: '3 días antes, cuando la cuota ya tiene una parte pagada con plata a favor de un pago anterior: ese mes paga menos, por única vez.',
    variables: ['nombre', 'N° de cuota', 'lote', 'proyecto', 'fecha de vencimiento', 'monto a pagar', 'monto de la cuota', 'a favor', 'N° de la cuota siguiente'],
    cuerpo: '🔔 *RECORDATORIO DE PAGO*\n_Urbis Group · Cobranzas_\nEstimado(a) {{1}}: le recordamos que su cuota N° {{2}} del lote {{3}} del proyecto {{4}} vence el {{5}}. Por única vez, el monto a pagar es S/ {{6}}: su cuota es de S/ {{7}} y ya tiene S/ {{8}} a favor de un pago anterior. Desde la cuota N° {{9}} vuelve a pagar el monto de su cronograma. Si ya pagó, envíe la foto de su voucher por este chat, gracias.',
    ejemplo: ['Juan', '12', 'Mz B Lt 7', 'Las Praderas de Cashibo', '30/10/2026', '174.00', '212.00', '38.00', '13'],
  },
  {
    clave: 'vence_hoy',
    nombre: 'urbis_cobranza_vence_hoy_v3',
    cuando: 'El día del vencimiento (reemplaza a urbis_cobranza_vence_hoy cuando Meta la apruebe).',
    variables: ['nombre', 'N° de cuota', 'lote', 'proyecto', 'monto'],
    cuerpo: '📅 *COBRANZA: SU CUOTA VENCE HOY*\n_Urbis Group · Cobranzas_\nEstimado(a) {{1}}: hoy vence su cuota N° {{2}} del lote {{3}} del proyecto {{4}}, por S/ {{5}}. Por favor realizar su pago hoy para mantener su cuenta al día. Si ya pagó, envíe la foto de su voucher por este chat, gracias.',
    ejemplo: ['Juan', '12', 'Mz B Lt 7', 'Las Praderas de Cashibo', '350.00'],
  },
  {
    clave: 'vence_hoy_ajuste',
    nombre: 'urbis_cobranza_vence_hoy_ajuste_v3',
    cuando: 'El día del vencimiento, cuando la cuota ya tiene una parte pagada con plata a favor: por única vez paga menos.',
    variables: ['nombre', 'N° de cuota', 'lote', 'proyecto', 'monto a pagar', 'monto de la cuota', 'a favor', 'N° de la cuota siguiente'],
    cuerpo: '📅 *COBRANZA: SU CUOTA VENCE HOY*\n_Urbis Group · Cobranzas_\nEstimado(a) {{1}}: hoy vence su cuota N° {{2}} del lote {{3}} del proyecto {{4}}. Por única vez, el monto a pagar es S/ {{5}}: su cuota es de S/ {{6}} y ya tiene S/ {{7}} a favor de un pago anterior. Desde la cuota N° {{8}} vuelve a pagar el monto de su cronograma. Si ya pagó, envíe la foto de su voucher por este chat, gracias.',
    ejemplo: ['Juan', '12', 'Mz B Lt 7', 'Las Praderas de Cashibo', '174.00', '212.00', '38.00', '13'],
  },
  {
    clave: 'pago_vencido',
    nombre: 'urbis_cobranza_pago_vencido_v3',
    cuando: 'De 1 a 3 cuotas vencidas (reemplaza a urbis_cobranza_pago_vencido cuando Meta la apruebe).',
    variables: ['nombre', 'lote', 'proyecto', 'detalle de cada cuota vencida', 'total vencido'],
    cuerpo: '⚠️ *ALERTA: PAGO VENCIDO*\n_Urbis Group · Cobranzas_\nEstimado(a) {{1}}: su lote {{2}} del proyecto {{3}} registra lo siguiente vencido: {{4}}. Total vencido (referencial): S/ {{5}}. Le pedimos pagar cada cuota con el monto de su cronograma de pagos. Si ya pagó, envíe su voucher por este chat. Si tiene algún inconveniente, escríbanos por aquí para coordinar una fecha de pago, gracias.',
    ejemplo: ['Juan', 'Mz B Lt 7', 'Las Praderas de Cashibo', 'Cuota 10: saldo de S/ 64.00 de S/ 264.00 (venció el 30/08/2026) · Cuota 11: S/ 264.00 (venció el 30/09/2026)', '328.00'],
  },
  {
    clave: 'aviso_contrato',
    nombre: 'urbis_cobranza_aviso_contrato_v3',
    cuando: 'Desde 4 cuotas vencidas, una vez por semana (reemplaza a urbis_cobranza_aviso_contrato cuando Meta la apruebe).',
    variables: ['nombre', 'lote', 'proyecto', 'cuántas cuotas vencidas', 'detalle de cada cuota vencida', 'total vencido'],
    cuerpo: '⚠️ *ALERTA: AVISO SOBRE SU CONTRATO*\n_Urbis Group · Cobranzas_\nEstimado(a) {{1}}: su lote {{2}} del proyecto {{3}} registra {{4}} cuotas vencidas: {{5}}. Total vencido (referencial): S/ {{6}}. Según lo establecido en su contrato, la falta de pago de las cuotas es causal de resolución del contrato.\nPara regularizar su situación o acordar un plan de pago, comuníquese por favor con nosotros por este chat el día de hoy. Si ya realizó pagos que no figuran, envíenos sus vouchers, gracias.',
    ejemplo: ['Juan', 'Mz B Lt 7', 'Las Praderas de Cashibo', '5', 'Cuotas 6 a 10: S/ 350.00 cada una (vencieron del 30/05/2026 al 30/09/2026)', '1,750.00'],
  },
  {
    clave: 'promesa',
    nombre: 'urbis_cobranza_promesa_v3',
    cuando: '1 día antes de la fecha que el cliente prometió (reemplaza a urbis_cobranza_promesa cuando Meta la apruebe).',
    variables: ['nombre', 'fecha prometida', 'monto', 'lote', 'proyecto'],
    cuerpo: '🤝 *RECORDATORIO DE SU COMPROMISO DE PAGO*\n_Urbis Group · Cobranzas_\nEstimado(a) {{1}}: le recordamos que para el {{2}} se comprometió a pagar S/ {{3}} del lote {{4}} del proyecto {{5}}. Cuando realice el pago, envíe la foto de su voucher por este chat, gracias.\nSi el pago no se registra en la fecha acordada, su cuenta seguirá el proceso de cobranza.',
    ejemplo: ['Juan', '15/10/2026', '350.00', 'Mz B Lt 7', 'Las Praderas de Cashibo'],
  },
]
const TIPO = Object.fromEntries(PLANTILLAS_TIPO.map(p => [p.clave, p]))
// las de una marca (Century…): mismas, con el nombre y la marca cambiados
function plantillasTipoDe(prefijo, marca) {
  return PLANTILLAS_TIPO.map(p => ({ ...p, nombre: marcarPlantilla(p.nombre, prefijo), cuerpo: cuerpoConMarca(p.cuerpo, marca), marca }))
}

// 29 oct 2026: BOLETA/FACTURA AL CLIENTE. Fuera de las 24 h Meta rechaza el
// documento suelto ("Re-engagement message"), así que la boleta va como ENCABEZADO
// de esta plantilla. Sin marca en el texto: sirve igual para Urbis y Century (el
// comprobante adjunto ya dice de quién es). Va aparte de PLANTILLAS: no es un
// aviso de cobranza ni se copia por marca.
//   node cobranza_meta.js crear_comprobante   → la crea en Meta (sube un PDF de ejemplo)
const PLANTILLA_COMPROBANTE = {
  nombre: 'comprobante_de_pago',
  cuando: 'Cuando facturación o la secretaria envía la boleta/factura desde el panel.',
  variables: ['nombre', 'detalle del pago'],
  cuerpo: '_Comprobante de pago_\nEstimado(a) {{1}}: le enviamos adjunto el comprobante electrónico de su pago ({{2}}). Guárdelo para su control. Muchas gracias.',
  ejemplo: ['Juan Pérez', 'cuota 4'],
}
function paraMetaComprobante(handle, idioma = 'es') {
  const p = PLANTILLA_COMPROBANTE
  return {
    name: p.nombre, language: idioma, category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: [handle] } },
      { type: 'BODY', text: p.cuerpo, example: { body_text: [p.ejemplo.map(String)] } },
    ],
  }
}

// 29 oct 2026: MARCAS. Un proyecto puede salir por su propio número y con su
// propio nombre (pedido del dueño: Las Praderas de Pucallpa es "Century Proyectos
// Inmobiliarios", ya no Urbis, porque hubo confusiones). Las plantillas son las
// MISMAS de arriba con la marca cambiada y otro nombre en Meta
// (prefijo + '_' + lo que sigue a 'urbis_cobranza_'). El aviso interno a la
// secretaria no se duplica: es uno solo.
//   node cobranza_meta.js crear_plantillas century   → crea las 5 de Century
// El panel (Cobranza IA → Clientes y avisos → proyecto) guarda la marca y el
// prefijo en cobranza_proyectos_cfg; cobranza.js arma el nombre con marcarPlantilla().
const MARCAS = {
  urbis: { marca: 'Urbis Group', prefijo: 'urbis_cobranza' },
  century: { marca: 'Century Proyectos Inmobiliarios', prefijo: 'century_cobranza' },
}
const PREFIJO_BASE = 'urbis_cobranza'
// el nombre de la plantilla de una marca a partir del de Urbis (y al revés)
function marcarPlantilla(nombre, prefijo) {
  if (!nombre || !prefijo || prefijo === PREFIJO_BASE) return nombre
  return String(nombre).replace(new RegExp('^' + PREFIJO_BASE + '_'), prefijo + '_')
}
function nombreBase(nombre) {
  return String(nombre || '').replace(/_v2$/, '').replace(/^[a-z0-9]+_cobranza_/, PREFIJO_BASE + '_')
}
function cuerpoConMarca(cuerpo, marca) {
  return !marca || marca === MARCAS.urbis.marca ? cuerpo : String(cuerpo).split('Urbis Group').join(marca)
}
// las plantillas de una marca: copia de las de Urbis con el nombre y la marca cambiados
function plantillasDe(prefijo, marca) {
  return PLANTILLAS.filter(p => !p.interna).map(p => ({ ...p, nombre: marcarPlantilla(p.nombre, prefijo), cuerpo: cuerpoConMarca(p.cuerpo, marca), marca }))
}

// El cuerpo con los valores puestos: asi le llega al cliente. Sin valores, los
// del ejemplo. `marca` cambia "Urbis Group" por la del proyecto (sql/166).
function comoSeVe(p, valores = p.ejemplo, marca = null) {
  return cuerpoConMarca(p.cuerpo, marca).replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n) - 1] ?? `{{${n}}}`)
}

// Lo que Meta espera en POST /{WABA_ID}/message_templates
function paraMeta(p, idioma = 'es') {
  return {
    name: p.nombre,
    language: idioma,
    category: 'UTILITY',
    components: [{ type: 'BODY', text: p.cuerpo, example: { body_text: [p.ejemplo.map(String)] } }],
  }
}

module.exports = { PLANTILLAS, PLANTILLAS_TIPO, TIPO, plantillasTipoDe, PLANTILLA_COMPROBANTE, paraMetaComprobante, MARCAS, PREFIJO_BASE, comoSeVe, paraMeta, plantillasDe, marcarPlantilla, nombreBase, cuerpoConMarca }
