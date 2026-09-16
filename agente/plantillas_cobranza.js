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
//   · sin encabezado, sin pie y sin botones.
// ============================================================================

const PLANTILLAS = [
  {
    campo: 'plantilla_recordatorio',
    nombre: 'urbis_cuota_recordatorio',
    cuando: 'Faltan dias para que venza la cuota (Configuracion → dias ANTES de vencer).',
    variables: ['nombre', 'N° de cuota', 'lote', 'proyecto', 'fecha de vencimiento', 'monto'],
    cuerpo: 'Hola {{1}}, le saludamos de Urbis Group. Le recordamos que su cuota N° {{2}} del lote {{3}} del proyecto {{4}} vence el {{5}} por S/ {{6}}. Si ya realizó el pago, envíe la foto de su voucher por este chat para registrarlo. Gracias.',
    ejemplo: ['Juan', '12', 'Mz B Lt 7', 'Las Praderas de Cashibo', '30/09/2026', '350.00'],
  },
  {
    campo: 'plantilla_vence_hoy',
    nombre: 'urbis_cuota_vence_hoy',
    cuando: 'El mismo dia del vencimiento (dias ANTES incluye el 0).',
    variables: ['nombre', 'N° de cuota', 'lote', 'proyecto', 'monto'],
    cuerpo: 'Hola {{1}}, le saludamos de Urbis Group. Hoy vence su cuota N° {{2}} del lote {{3}} del proyecto {{4}} por S/ {{5}}. Cuando realice el pago, envíe la foto de su voucher por este chat y lo registraremos. Gracias.',
    ejemplo: ['Juan', '12', 'Mz B Lt 7', 'Las Praderas de Cashibo', '350.00'],
  },
  {
    campo: 'plantilla_vencida',
    nombre: 'urbis_cuota_vencida',
    cuando: 'La cuota ya vencio (dias DESPUES, y luego cada N dias) mientras sean pocas cuotas.',
    variables: ['nombre', 'N° de cuota', 'lote', 'proyecto', 'fecha en que vencio', 'monto pendiente'],
    cuerpo: 'Hola {{1}}, le saludamos de Urbis Group. Su cuota N° {{2}} del lote {{3}} del proyecto {{4}} venció el {{5}} y tiene un saldo pendiente de S/ {{6}}. Si ya pagó, envíenos el voucher por este chat; si necesita coordinar una fecha, escríbanos por aquí. Gracias.',
    ejemplo: ['Juan', '12', 'Mz B Lt 7', 'Las Praderas de Cashibo', '30/08/2026', '350.00'],
  },
  {
    campo: 'plantilla_vencida_grave',
    nombre: 'urbis_cuotas_atrasadas',
    cuando: 'Desde N cuotas vencidas acumuladas (Configuracion → "aviso grave desde"). Reemplaza al anterior, no se suma.',
    variables: ['nombre', 'cuántas cuotas vencidas', 'lote', 'proyecto', 'total vencido'],
    cuerpo: 'Hola {{1}}, le saludamos de Urbis Group. Su contrato registra {{2}} cuotas vencidas del lote {{3}} del proyecto {{4}}, con un saldo total de S/ {{5}}. La acumulación de cuotas impagas es causal de resolución del contrato. Antes de llegar a eso queremos coordinar con usted: responda por este chat para acordar una fecha de pago o enviarnos su voucher. Gracias.',
    ejemplo: ['Juan', '4', 'Mz B Lt 7', 'Las Praderas de Cashibo', '1,400.00'],
  },
  {
    campo: 'plantilla_promesa',
    nombre: 'urbis_promesa_pago',
    cuando: 'El cliente quedo en pagar una fecha y esa fecha se acerca.',
    variables: ['nombre', 'fecha prometida', 'monto', 'lote', 'proyecto'],
    cuerpo: 'Hola {{1}}, le saludamos de Urbis Group. Le recordamos que para el {{2}} quedó en realizar su pago de S/ {{3}} del lote {{4}} del proyecto {{5}}. Cuando lo realice, envíe la foto de su voucher por este chat. Gracias.',
    ejemplo: ['Juan', '15/10/2026', '350.00', 'Mz B Lt 7', 'Las Praderas de Cashibo'],
  },
]

// Cuerpo con los ejemplos puestos: asi se ve el mensaje que le llega al cliente.
function comoSeVe(p) {
  return p.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n) => p.ejemplo[Number(n) - 1] ?? `{{${n}}}`)
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
