# Los avisos de cobranza — para aprobar

> Esto es lo ÚNICO que el sistema le manda solo a un cliente. Todo lo demás es
> respuesta a algo que el cliente escribió primero.
>
> Nada sale hasta que alguien prenda **📨 Avisos** en el panel. Los textos ya
> están en el sistema (`plantillas_cobranza.js`): si se cambia una palabra hay
> que volver a pedirle permiso a Meta, y eso tarda hasta 24 h.

## La escalera

Un cliente recibe **un solo mensaje por vuelta**, nunca dos el mismo día.

| Cuándo | Qué recibe | Tono |
|---|---|---|
| 3 días antes de vencer | `urbis_cuota_recordatorio` | recordatorio amable |
| el día que vence | `urbis_cuota_vence_hoy` | recordatorio amable |
| 2 y 5 días después | `urbis_cuota_vencida` | "si ya pagó, mándenos el voucher" |
| después, cada 7 días | `urbis_cuota_vencida` | el mismo |
| **desde 4 cuotas vencidas** | **`urbis_cuotas_atrasadas`** | **menciona la resolución del contrato** |
| quedó en pagar una fecha | `urbis_promesa_pago` | recordatorio de lo acordado |

Los días y el número de cuotas se cambian en el panel (Cobranza IA →
Configuración) sin tocar los textos ni volver a pedirle permiso a Meta.

**Quien queda fuera de la lista ese día:** el que ya prometió una fecha, el que
ya mandó su voucher y espera validación, y el lote con la cobranza automática
pausada.

> ⚠️ **Lo que hay que decidir: desde cuántas cuotas.** El sistema viene en **4**.
> El contrato (cláusula 5.1) considera incumplimiento grave **2 cuotas seguidas
> o 3 acumuladas**, así que en 4 el aviso llega *después* de que el
> incumplimiento ya existe. Se puede bajar a 3 en el panel, en un segundo.

## Los cinco textos

Lo que está entre `{{ }}` lo llena el sistema con los datos reales del cliente.

### 1 · `urbis_cuota_recordatorio` — faltan días

Hola **{{1}}**, le saludamos de Urbis Group. Le recordamos que su cuota N° **{{2}}**
del lote **{{3}}** del proyecto **{{4}}** vence el **{{5}}** por S/ **{{6}}**. Si ya
realizó el pago, envíe la foto de su voucher por este chat para registrarlo.
Gracias.

> Hola Juan, le saludamos de Urbis Group. Le recordamos que su cuota N° 12 del
> lote Mz B Lt 7 del proyecto Las Praderas de Cashibo vence el 30/09/2026 por
> S/ 350.00. Si ya realizó el pago, envíe la foto de su voucher por este chat
> para registrarlo. Gracias.

### 2 · `urbis_cuota_vence_hoy` — vence hoy

Hola **{{1}}**, le saludamos de Urbis Group. Hoy vence su cuota N° **{{2}}** del lote
**{{3}}** del proyecto **{{4}}** por S/ **{{5}}**. Cuando realice el pago, envíe la foto
de su voucher por este chat y lo registraremos. Gracias.

> Hola Juan, le saludamos de Urbis Group. Hoy vence su cuota N° 12 del lote
> Mz B Lt 7 del proyecto Las Praderas de Cashibo por S/ 350.00. Cuando realice
> el pago, envíe la foto de su voucher por este chat y lo registraremos. Gracias.

### 3 · `urbis_cuota_vencida` — ya venció

Hola **{{1}}**, le saludamos de Urbis Group. Su cuota N° **{{2}}** del lote **{{3}}** del
proyecto **{{4}}** venció el **{{5}}** y tiene un saldo pendiente de S/ **{{6}}**. Si ya
pagó, envíenos el voucher por este chat; si necesita coordinar una fecha,
escríbanos por aquí. Gracias.

> Hola Juan, le saludamos de Urbis Group. Su cuota N° 12 del lote Mz B Lt 7 del
> proyecto Las Praderas de Cashibo venció el 30/08/2026 y tiene un saldo
> pendiente de S/ 350.00. Si ya pagó, envíenos el voucher por este chat; si
> necesita coordinar una fecha, escríbanos por aquí. Gracias.

### 4 · `urbis_cuotas_atrasadas` — varias cuotas acumuladas

Hola **{{1}}**, le saludamos de Urbis Group. Su contrato registra **{{2}}** cuotas
vencidas del lote **{{3}}** del proyecto **{{4}}**, con un saldo total de S/ **{{5}}**. La
acumulación de cuotas impagas es causal de resolución del contrato. Antes de
llegar a eso queremos coordinar con usted: responda por este chat para acordar
una fecha de pago o enviarnos su voucher. Gracias.

> Hola Juan, le saludamos de Urbis Group. Su contrato registra 4 cuotas vencidas
> del lote Mz B Lt 7 del proyecto Las Praderas de Cashibo, con un saldo total de
> S/ 1,400.00. La acumulación de cuotas impagas es causal de resolución del
> contrato. Antes de llegar a eso queremos coordinar con usted: responda por
> este chat para acordar una fecha de pago o enviarnos su voucher. Gracias.

**Por qué está escrito así:** avisa sin amenazar y sin dar por resuelto nada. No
anuncia expropiación, no pone plazo perentorio y no habla de penalidades: para
eso está la carta notarial, que es otra cosa y la firma una persona. Este
mensaje solo dice dónde está parado el cliente e invita a conversar.

### 5 · `urbis_promesa_pago` — lo que el cliente prometió

Hola **{{1}}**, le saludamos de Urbis Group. Le recordamos que para el **{{2}}** quedó
en realizar su pago de S/ **{{3}}** del lote **{{4}}** del proyecto **{{5}}**. Cuando lo
realice, envíe la foto de su voucher por este chat. Gracias.

> Hola Juan, le saludamos de Urbis Group. Le recordamos que para el 15/10/2026
> quedó en realizar su pago de S/ 350.00 del lote Mz B Lt 7 del proyecto Las
> Praderas de Cashibo. Cuando lo realice, envíe la foto de su voucher por este
> chat. Gracias.

## Lo que cuesta

Meta cobra por mensaje de estos (categoría *Utilidad*, centavos de dólar). Lo
que el cliente conteste y lo que el agente le responda dentro de las 24 h
siguientes **no se cobra**. Por eso conviene que el mensaje invite a responder:
la conversación que abre el cliente sale gratis.

---
*Los textos se cambian en `crm/agente/plantillas_cobranza.js`, y se vuelven a
crear en Meta con `node cobranza_meta.js crear_plantillas`.*
