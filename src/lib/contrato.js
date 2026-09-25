// El contrato: datos y reglas que usan la pantalla de Contratos y la ficha del
// lote (components/ContratoModal.jsx). Cada proyecto tiene su plantilla en
// projects.contract_template; sin plantilla se usa DEFAULT_TEMPLATE.
import { supabase } from './supabase'
import { subirRuta } from './archivos'
import { soles } from './pagos'

// "setiembre": asi se escribe en Peru y asi viene en los contratos modelo
export const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','setiembre','octubre','noviembre','diciembre']
export const fechaPe = f => f ? String(f).slice(0, 10).split('-').reverse().join('/') : '-'

export function letras(num) {
  const U = ['','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE','DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISEIS','DIECISIETE','DIECIOCHO','DIECINUEVE','VEINTE']
  const D = ['','','VEINTI','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA']
  const C = ['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS']
  function tres(n) {
    if (n === 0) return ''
    if (n === 100) return 'CIEN'
    let s = C[Math.floor(n / 100)]
    const r = n % 100
    if (r === 0) return s
    if (s) s += ' '
    if (r <= 20) return s + U[r]
    const d = Math.floor(r / 10), u = r % 10
    if (d === 2) return s + 'VEINTI' + (u ? U[u] : '')
    return s + D[d] + (u ? ' Y ' + U[u] : '')
  }
  const entero = Math.floor(num)
  const cent = Math.round((num - entero) * 100)
  let out = ''
  const millones = Math.floor(entero / 1000000)
  const miles = Math.floor((entero % 1000000) / 1000)
  const resto = entero % 1000
  if (millones) out += (millones === 1 ? 'UN MILLON' : tres(millones) + ' MILLONES') + ' '
  if (miles) out += (miles === 1 ? 'MIL' : tres(miles) + ' MIL') + ' '
  out += tres(resto)
  if (!out.trim()) out = 'CERO'
  return out.trim() + ' CON ' + String(cent).padStart(2, '0') + '/100'
}

export const VARIABLES = ['PROYECTO','VENDEDOR','VENDEDOR_DNI','VENDEDOR_DOMICILIO','COMPRADORES','COMPRADOR_DOMICILIO','MZ','LT','AREA','PRECIO','PRECIO_LETRAS','SEPARACION','SEPARACION_LETRAS','SEPARACION_FECHA','INICIAL','INICIAL_LETRAS','FECHA_VENTA','SALDO','SALDO_LETRAS','NUM_CUOTAS','CUOTA','CUOTAS_DETALLE','PRIMERA_CUOTA','PAGADO_FIRMA','ASESOR','MORA','PARTIDA','DIA','MES','ANIO']
export const BLOQUES = ['TABLA_LOTE','TABLA_CUENTA','TABLA_CRONOGRAMA','FIRMAS','ANEXO_CRONOGRAMA','ANEXO_FICHA','SALTO_PAGINA']

// "47 cuotas mensuales de S/ 482.00 y 1 cuota de S/ 446.00", sacado del
// cronograma REAL de la venta (no de una formula): si se corrigio una cuota,
// el contrato dice lo mismo que el sistema.
export function detalleCuotas(inst) {
  const grupos = []
  for (const i of inst) {
    const a = Math.round(Number(i.amount) * 100) / 100
    const g = grupos[grupos.length - 1]
    if (g && Math.abs(g.a - a) < 0.005) g.n++
    else grupos.push({ a, n: 1 })
  }
  const partes = grupos.map((g, k) => `${g.n} ${g.n === 1 ? 'cuota' : 'cuotas'}${k === 0 && g.n > 1 ? ' mensuales' : ''} de ${soles(g.a)}`)
  return partes.length > 1 ? partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1] : (partes[0] || '-')
}

// lo que hace falta de una venta para armar su contrato
export const COLS_VENTA_CONTRATO = 'id, total_sale_price, initial_amount_paid, financed_amount, installments_count, monthly_amount, sale_date, status, signed_contract_url, contract_note, extra_docs, separation_id, client:clients!sales_client_id_fkey(*), co_client:clients!sales_co_client_id_fkey(*), advisor:advisors(code, full_name), lot:lots!inner(id, mz, lt, area_m2, boundaries, project_id)'

// Sube el contrato FIRMADO de una venta, con su nota. Si ya habia uno, lo
// reemplaza. Devuelve el aviso, o null si se cancelo la nota (no se sube nada).
export async function subirContratoFirmado(venta, file) {
  const reemplaza = !!venta.signed_contract_url
  const nota = prompt(
    (reemplaza ? '⚠ REEMPLAZANDO el contrato firmado actual por este archivo nuevo.\n\n' : '') +
    'Comentario / nota de este contrato (opcional, Enter para saltar):\n\nEj: firmado con poder · falta legalizar · copia escaneada que mando el cliente',
    venta.contract_note || '')
  if (nota === null) return null
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
  const url = await subirRuta(`contratos/${venta.lot?.mz}-${venta.lot?.lt}-${Date.now()}.${ext}`, file)
  const { error } = await supabase.from('sales').update({ signed_contract_url: url, contract_note: nota.trim() || null }).eq('id', venta.id)
  if (error) throw new Error(error.message)
  return reemplaza ? 'CONTRATO FIRMADO REEMPLAZADO' : 'CONTRATO FIRMADO SUBIDO'
}

export const DEFAULT_TEMPLATE = `CONTRATO PRIVADO DE COMPROMISO DE COMPRAVENTA DE LOTE EN HABILITACION URBANA PROGRESIVA CON RESERVA DE PROPIEDAD

Conste por el presente instrumento privado el Contrato de Compromiso de Compraventa de Lote en Habilitacion Urbana Progresiva, con Reserva de Propiedad, que celebran de una parte:
EL VENDEDOR: {{VENDEDOR}}, identificada con DNI N. {{VENDEDOR_DNI}}, con domicilio en {{VENDEDOR_DOMICILIO}}, a quien en adelante se denominara EL VENDEDOR; y de la otra parte:
EL COMPRADOR: {{COMPRADORES}}, con domicilio en {{COMPRADOR_DOMICILIO}}, a quien en adelante se denominara EL COMPRADOR.
Las partes celebran el presente contrato bajo los terminos y condiciones siguientes:

CLAUSULA PRIMERA: ANTECEDENTES DEL PREDIO Y DEL PROYECTO
1.1. EL VENDEDOR declara tener derechos suficientes sobre el predio matriz inscrito en la Partida N. {{PARTIDA}} del Registro de Predios, sobre el cual se desarrolla la Habilitacion Urbana Progresiva denominada "{{PROYECTO}}" (en adelante, EL PROYECTO).
1.2. Las partes reconocen que el presente contrato no constituye, por si solo, licencia de habilitacion urbana, titulo individual independizado ni transferencia definitiva inscrita. Su finalidad es reservar y comprometer la futura transferencia del lote descrito en este contrato.

CLAUSULA SEGUNDA: OBJETO DEL CONTRATO Y DESCRIPCION DEL LOTE
2.1. Por el presente contrato, EL VENDEDOR otorga a favor de EL COMPRADOR la separacion, reserva y compromiso de futura transferencia del lote identificado como:
{{TABLA_LOTE}}
2.2. Las medidas y linderos indicados son referenciales y estan sujetos a los ajustes tecnicos, municipales y registrales que resulten del expediente aprobado y de la independizacion definitiva.

CLAUSULA TERCERA: PRECIO Y FORMA DE PAGO
3.1. El precio total del lote se fija en la suma de {{PRECIO}} ({{PRECIO_LETRAS}} SOLES), que EL COMPRADOR pagara asi: Separacion: {{SEPARACION}}, pagada en fecha {{SEPARACION_FECHA}}. Inicial: {{INICIAL}}, pagada en fecha {{FECHA_VENTA}}. Saldo financiado: {{SALDO}}, en {{NUM_CUOTAS}} cuotas mensuales de {{CUOTA}}, conforme al cronograma del Anexo 1.
3.2. Los pagos se realizaran mediante deposito o transferencia a la cuenta designada por EL VENDEDOR:
{{TABLA_CUENTA}}
3.3. EL COMPRADOR se obliga a remitir el comprobante de pago dentro de los tres (3) dias habiles siguientes al deposito, por el canal oficial.

CLAUSULA CUARTA: MORA, COBRANZA Y REPROGRAMACION
4.1. Las cuotas se pagan en las fechas del Anexo 1, con plazo de gracia de cinco (5) dias habiles. Vencido dicho plazo, se devengara una penalidad moratoria de S/ {{MORA}} por cada dia calendario de atraso, hasta la fecha efectiva de pago.

CLAUSULA QUINTA: INCUMPLIMIENTO Y RESOLUCION
5.1. Constituyen causales de incumplimiento grave: no pagar dos (2) cuotas consecutivas o tres (3) acumuladas; negarse a regularizar documentos; realizar construcciones u ocupaciones no autorizadas; ceder o revender derechos sin autorizacion escrita; usar el lote para fines incompatibles. El procedimiento de notificaciones formales y resolucion se rige por el modelo integral del proyecto.

CLAUSULA SEXTA: RESERVA DE PROPIEDAD
6.1. Al amparo del articulo 1583 del Codigo Civil, las partes pactan reserva de propiedad a favor de EL VENDEDOR hasta que EL COMPRADOR haya pagado la totalidad del precio y conceptos pendientes, y se encuentre habilitada la documentacion legal y registral para la transferencia definitiva.

— El presente documento incorpora por referencia las demas clausulas del modelo integral de contrato del proyecto, que las partes declaran conocer. —

CLAUSULA FINAL: ACEPTACION
Leido el presente contrato por las partes y encontrandolo conforme a su voluntad, lo suscriben por duplicado en la ciudad de Pucallpa, a los {{DIA}} dias del mes de {{MES}} de {{ANIO}}.
{{FIRMAS}}

{{ANEXO_CRONOGRAMA}}
{{ANEXO_FICHA}}`
