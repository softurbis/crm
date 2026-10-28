# Manual · Clientes y avisos (Cobranza IA)

> **Desde el 28 oct 2026** esta pantalla es la **primera pestaña de Cobranza IA** ("👥 Clientes y avisos").
> El enlace viejo `/avisos-clientes` lleva ahí. Lo nuevo (sql/161) está en la sección **"28 oct: seguimiento,
> agente por cliente y mensaje propio"**, al final.
>
> Pantalla del panel: menú **Cobranza → Cobranza IA → Clientes y avisos** (antes `/avisos-clientes`).
> La ve el superusuario, el administrador (solo mirar) y quien tenga el permiso
> **cobranza** en Usuarios. Base: `sql/159_avisos_por_cliente.sql` (27 oct 2026).

## Para qué sirve

El dueño lo pidió así: *"un panel con todos los clientes por proyecto y su mensaje
programado para cobranza, recordatorio o cosas así, para poder seleccionar
clientes o leads o a quienes ya no se les escriba"*.

En una sola lista, por proyecto, se ve **quién es cliente y quién es lead**, qué
aviso de cobranza le toca a cada cliente y cuándo, y se marca a quién **sí** y a
quién **no** se le escribe. **Desde aquí no se manda nada**: los avisos los envía el
agente de cobranza a su hora.

## Qué muestra cada fila

| Columna | Cliente (venta vigente) | Lead (kanban) |
|---|---|---|
| Tipo | 🟩 Cliente | 🟦 Lead |
| Proyecto · lote | el lote (abre su ficha) y, si debe, cuántas cuotas vencidas y cuánto | el proyecto |
| Nombre | titular, DNI o co-titular | nombre y estado del kanban (nuevo, contactado…) |
| Celular | los de la ficha; **⚠** = no validado o no habilitado para el bot (no recibe) | el del lead |
| Próximo aviso | qué aviso le toca y qué día (tocarlo muestra el mensaje tal cual le llegaría); si no recibe, el motivo | quién lo atiende: bot de ventas o una persona |
| Último aviso | el último que salió (fecha, estado de entrega) | último mensaje de la conversación |
| ¿Se le escribe? | ✅ Sí / 🚫 No | ✅ Sí / 🚫 No |

Un lead cuyo celular ya está en la ficha de algún cliente aparece con
"⚠ celular de un cliente": el sistema lo trata como cliente (regla de
`agente/quien_escribe.js`).

## El "próximo aviso"

Lo calcula el **agente de cobranza** (`agente/cobranza.js`) con la misma escalera
que usa para enviar, sin copiarla en el panel:

- al día → **recordatorio** 3 días antes del vencimiento y **vence hoy** el mismo día;
- 1 a 3 cuotas vencidas → **pago vencido** a los 2 y 5 días de la más antigua, luego cada 7;
- desde 4 cuotas vencidas → **aviso por contrato**, una vez por semana;
- promesa de pago → **recordatorio de la promesa** la víspera.

Respeta sábados, domingos y feriados (Ley 29571): el aviso que cae en esos días
sale el siguiente día hábil. El agente recalcula cada 30 minutos, después de cada
envío y cuando se toca **↻ Recalcular**. Arriba se ve hace cuánto fue el último cálculo.

Cuando un cliente **no** recibe, la columna lo dice:

| Estado | Qué significa | Dónde se arregla |
|---|---|---|
| ⏸ Pausado | la casilla está en "No" | aquí o en la ficha del lote (pausar/reactivar) |
| 📅 Con promesa | tiene promesa de pago vigente: solo recibe el recordatorio de la promesa | Cobranza IA → Promesas |
| 🧾 Voucher en revisión | mandó un voucher que nadie validó todavía | Cobranza IA → Por validar |
| 📵 Sin celular validado | ningún celular de la ficha está validado y habilitado para el bot | ficha del cliente |
| ⚠ Falta plantilla | le toca un aviso pero falta el nombre de la plantilla | Cobranza IA → Configuración |
| ✅ Al día | no tiene cuotas pendientes | — |

Si la pantalla dice que el agente **todavía no calculó** nada, falta actualizar el
agente en el servidor (`migracion/07_actualizar_agente.sh`) después de correr sql/159.

## Marcar a quién se le escribe

- **Una fila**: el botón ✅ Sí / 🚫 No de la derecha.
- **Varias**: marca las casillas (o la de arriba para todo lo que se ve) y usa
  **✅ Sí escribirles** o **🚫 No escribirles**. Antes de dejar de escribirle a
  alguien el sistema pide confirmar.

Qué cambia por detrás:

- **Cliente** → `sales.auto_cobranza`, la misma casilla que "pausar / reactivar la
  cobranza automática" en la ficha del lote. En "No" el agente no le manda ningún
  aviso programado (sí le contesta si él escribe).
- **Lead** → el **silencio total** del directorio del bot (`whatsapp_numbers`,
  tipo `silencio`, el mismo que se ve en WhatsApp → Directorio): el bot **ni le
  responde ni le escribe**. Volver a "Sí" lo saca del directorio. Un número marcado
  como *administrativo* no se toca desde aquí.

El cambio se ve al instante; el "próximo aviso" se vuelve a calcular en menos de un minuto.

## Filtros

- **Todos / Clientes / Leads** y **Sí se les escribe / No se les escribe**.
- **Proyecto** (sigue al proyecto elegido arriba en el menú).
- **Buscador**: nombre, lote (A1, G-7), celular.

## Lo que esta pantalla NO hace

- No envía mensajes ni cambia la hora o los textos de los avisos (eso es Cobranza IA → Configuración).
- No valida celulares (ficha del cliente) ni cambia el estado de un lead en el kanban.
- No apaga el agente: si los avisos están APAGADOS en Cobranza IA, lo programado no sale y la pantalla lo avisa.

## 28 oct: seguimiento, agente por cliente y mensaje propio (sql/161)

Pedido del dueño: unir esta lista con Cobranza IA, ver si cada cliente **respondió o no** al aviso,
llevar **notas de seguimiento**, que la secretaria **suba y apruebe comprobantes**, **cambiar el mensaje**
solo para algunos clientes y **prender el agente** para algunos clientes.

### Columnas nuevas

| Columna | Qué dice |
|---|---|
| Último aviso · ¿respondió? | **✅ respondió** si el cliente escribió al 960 después del último aviso; **⏳ sin respuesta** si no. ✍️ = salió con texto propio. |
| Seguimiento | El último resultado anotado, la nota, quién y cuándo. El botón **📝 Seguimiento** abre la ficha de cobranza del cliente. |
| Agente | **🤖 ON**: el agente de cobranza le contesta. **⏸ OFF**: lo atiende la secretaria. |
| ¿Avisos? | La casilla de siempre: si recibe avisos automáticos. |

Filtros nuevos: **🤖 Con agente**, **✅ Respondió**, **⏳ Sin respuesta** (la lista para llamar).
Con varias filas marcadas: **🤖 Agente ON / ⏸ Agente OFF** en bloque.

### El agente, solo para los clientes marcados

- El agente general quedó **prendido** (sql/161), pero cada cliente arranca en **⏸ OFF**: no le contesta a nadie hasta que se le prenda.
- Un cliente en OFF que escribe: su mensaje queda en **Conversaciones** para la secretaria y llega el aviso por Telegram ("el agente está apagado para este cliente").
- Al prenderlo, ese chat vuelve solo al agente.
- Los **avisos automáticos** siguen apagados: las 5 plantillas están en revisión de Meta. Cuando Meta las apruebe se prenden en **Configuración**.

### Ficha de seguimiento (📝)

- **Historial** de todo lo anotado, con quién y cuándo.
- **Anotar**: elegir el resultado y escribir la nota.
  - **📝 Nota**: lo que se habló.
  - **📅 Prometió pagar**: fecha (y monto si lo dijo). Crea la promesa en **Promesas**; desde ahí ese cliente recibe solo el recordatorio de la promesa.
  - **📵 No contesta** y **❌ Número equivocado**: quedan anotados para la próxima llamada o para corregir la ficha del cliente.
  - **💵 Pagó / mandó voucher**: con fecha y monto se puede **subir el voucher** (foto o PDF). Queda en **Por validar**, igual que si lo hubiera mandado el cliente: se aprueba ahí y recién suma en Cuotas.
- **✍️ Mensaje propio**:
  - **Instrucciones para el agente**: las lee antes de contestarle a ese cliente ("tiene acuerdo de pagar los 30", "no mencionar el contrato"). No se las muestra al cliente.
  - **Texto del próximo aviso**: sale tal cual **solo si el cliente escribió en las últimas 24 h** (Meta no deja texto libre fuera de esa ventana). Si no, sale la plantilla. Se usa una sola vez.
  - Para que **no reciba ningún aviso automático**: ¿Avisos? en 🚫 No.

Técnico: `cobranza_clientes_cfg` (agente, instrucciones, aviso_texto por cliente), `cobranza_seguimiento`
+ `cobranza_seguimiento_agregar()` / `cobranza_seguimiento_de()`, y `avisos_por_cliente()` devuelve además
`agente`, `instrucciones`, `aviso_texto`, `respondio_at` y el último `seguimiento`. El agente
(`agente/cobranza.js`) mira `cobranza_clientes_cfg` antes de contestar y antes de cada aviso.
