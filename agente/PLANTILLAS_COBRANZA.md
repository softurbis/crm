# Los avisos de cobranza — APROBADOS (26 sep 2026)

> Propuesta aprobada por el dueño. Número oficial de cobranzas: **+51 986 598 614**.
>
> Esto es lo ÚNICO que el sistema le manda solo a un cliente. Todo lo demás es
> respuesta a algo que el cliente escribió primero. Nada sale hasta que alguien
> prenda **📨 Avisos** en el panel. Los textos viven en `plantillas_cobranza.js`:
> si se cambia una palabra hay que volver a pedirle permiso a Meta (hasta 24 h) y
> crear la plantilla con **otro nombre**.

## La escalera

Los mensajes suben de tono según cuántas cuotas debe el cliente. **Un solo
mensaje por día**, y entre dos avisos de deuda vencida pasan al menos 2 días.

| # | Plantilla | Cuándo |
|---|---|---|
| 1 | `urbis_cobranza_recordatorio` | 3 días antes del vencimiento |
| 2 | `urbis_cobranza_vence_hoy` | el día del vencimiento |
| 3 | `urbis_cobranza_pago_vencido` | 1 a 3 cuotas vencidas: a los 2 y 5 días de la más antigua, luego cada 7 días |
| 4 | `urbis_cobranza_aviso_contrato` | 4 o más cuotas vencidas: una vez por semana (reemplaza al 3) |
| 5 | `urbis_cobranza_promesa` | 1 día antes de la fecha que el cliente prometió |

**Días hábiles, 9:00 a.m.** Nunca sábados, domingos ni feriados, ni después de
las 8 p.m. (Ley 29571, art. 62). Lo que caía en uno de esos días **no se pierde**:
- el pago vencido y el aviso por contrato salen el siguiente día hábil;
- el recordatorio y el de promesa salen el día hábil **anterior**;
- si vence un día no hábil, no sale "vence hoy" (ya salió el recordatorio).

**Quien queda fuera ese día:** el que tiene una promesa de pago vigente, el que
mandó su voucher y espera validación, y el lote con la cobranza automática
**pausada** en su ficha (Ficha del lote → Cobranza automática → pausar), por
ejemplo mientras dure un acuerdo de pago. Si ese cliente escribe, el agente igual
le responde.

**Plazo para comunicarse: 7 días.** Quien recibió el aviso por contrato y no
escribe en 7 días aparece en el resumen diario por Telegram de la secretaria,
para evaluar la carta notarial. Sigue apareciendo cada semana mientras no conteste.

Días, cuotas y plazos se cambian en el panel (Cobranza IA → Configuración) sin
tocar los textos ni volver a pedirle permiso a Meta.

## Los cinco textos

Lo que está entre `{{ }}` lo llena el sistema con los datos reales. La primera
línea va en cursiva.

### 1 · `urbis_cobranza_recordatorio`

> _Urbis Group · Cobranzas_
> Estimado(a) Juan: le recordamos que su cuota N° 12 del lote Mz B Lt 7 del
> proyecto Las Praderas de Cashibo vence el 30/09/2026, por S/ 350.00. Le pedimos
> por favor, realizar su pago a tiempo. Si ya pagó, envíe la foto de su voucher
> por este chat para registrarlo, gracias.

Variables: nombre · N° de cuota · lote · proyecto · vencimiento · monto

### 2 · `urbis_cobranza_vence_hoy`

> _Urbis Group · Cobranzas_
> Estimado(a) Juan: hoy vence su cuota N° 12 del lote Mz B Lt 7 del proyecto Las
> Praderas de Cashibo, por S/ 350.00. Por favor realizar su pago hoy para mantener
> su cuenta al día. Si ya pagó, envíe la foto de su voucher por este chat, gracias.

Variables: nombre · N° de cuota · lote · proyecto · monto

### 3 · `urbis_cobranza_pago_vencido`

> _Urbis Group · Pago vencido_
> Estimado(a) Juan: su lote Mz B Lt 7 del proyecto Las Praderas de Cashibo tiene
> un saldo vencido de S/ 700.00, pendiente desde el 30/08/2026. Le solicitamos
> por favor, regularizar su pago a la brevedad. Si ya pagó, envíe su voucher por
> este chat. Si tiene algún inconveniente, escríbanos por aquí para coordinar una
> fecha de pago, gracias.

Variables: nombre · lote · proyecto · saldo vencido (todas las cuotas vencidas) ·
desde (la cuota vencida más antigua)

### 4 · `urbis_cobranza_aviso_contrato`

> _Aviso importante sobre su contrato_
> Estimado(a) Juan: su lote Mz B Lt 7 del proyecto Las Praderas de Cashibo
> registra 5 cuotas vencidas, con un saldo vencido de S/ 1,750.00. Según lo
> establecido en su contrato, la falta de pago de las cuotas es causal de
> resolución del contrato.
> Para regularizar su situación o acordar un plan de pago, comuníquese por favor
> con nosotros por este chat el día de hoy. Si ya realizó pagos que no figuran,
> envíenos sus vouchers, gracias.

Variables: nombre · lote · proyecto · cuántas cuotas vencidas · saldo vencido

### 5 · `urbis_cobranza_promesa`

> _Urbis Group · Cobranzas_
> Estimado(a) Juan: le recordamos que para el 15/10/2026 se comprometió a pagar
> S/ 350.00 del lote Mz B Lt 7 del proyecto Las Praderas de Cashibo. Cuando
> realice el pago, envíe la foto de su voucher por este chat, gracias.
> Si el pago no se registra en la fecha acordada, su cuenta seguirá el proceso de
> cobranza.

Variables: nombre · fecha prometida · monto · lote · proyecto

## Cuando el cliente responde

El agente con IA le dice cuánto debe, recibe vouchers y anota promesas de pago.
Descuentos, refinanciamiento, planes de pago en partes, dudas del contrato o
temas legales pasan directo a la secretaria. **El agente no negocia** y nunca
habla de demandas, abogados, embargos, centrales de riesgo ni de perder lo pagado.

## Límites

- **Meta revisa cada plantilla** y rechaza las que amenazan con acciones legales.
  El aviso 4 solo informa lo que dice el contrato y pide comunicarse. Si Meta lo
  rechaza igual, se sube una versión más neutra con otro nombre.
- **Si muchos clientes bloquean o reportan el número, Meta lo limita.** Es el mismo
  número que usa la secretaria en su celular.
- **Tope de 250 conversaciones iniciadas por día** mientras el negocio no esté
  verificado en Meta: el tope diario del panel va por debajo.
- **El WhatsApp no reemplaza la carta notarial:** la resolución formal se notifica
  según el procedimiento del contrato. El modelo de contrato considera
  incumplimiento grave 2 cuotas consecutivas o 3 acumuladas.

## Lo que cuesta

Meta cobra cada aviso (categoría *Utilidad*, centavos de dólar). Lo que el
cliente conteste y lo que el agente le responda dentro de las 24 h siguientes
**no se cobra**: por eso todos los avisos invitan a responder por el chat.

---
*Los textos se cambian en `crm/agente/plantillas_cobranza.js` y se crean en Meta
con `node cobranza_meta.js crear_plantillas`. Los nombres y los días los carga
`sql/107_cobranza_propuesta_aprobada.sql`.*
