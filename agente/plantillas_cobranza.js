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
]

// El cuerpo con los valores puestos: asi le llega al cliente. Sin valores, los
// del ejemplo.
function comoSeVe(p, valores = p.ejemplo) {
  return p.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n) => valores[Number(n) - 1] ?? `{{${n}}}`)
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

module.exports = { PLANTILLAS, comoSeVe, paraMeta }
