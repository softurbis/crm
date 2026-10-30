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
| 🚦 Por revisar | la cuenta de la venta no cuadra (semáforo): no le sale ningún aviso hasta arreglarla; debajo dice el motivo | ficha del lote → pestaña Cuotas |
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

### 🚦 El semáforo (29 oct)

Pedido de la secretaria: "que el sistema cuadre bien los montos antes de enviar una
cobranza incorrecta". Antes de cada aviso el agente revisa la cuenta de la venta:

1. inicial + separación + todas las cuotas = precio (la misma cuenta de la ficha:
   "✓ EL CRONOGRAMA CUADRA");
2. lo pagado de cada cuota = lo que hay en caja para esa cuota;
3. ninguna cuota con más pagado que su monto;
4. ningún pago de la venta (fuera de inicial y separación) sin cuota asignada.

Si algo falla, ese día **no sale ningún aviso** a esa venta (tampoco el texto
propio), la fila queda en **🚦 Por revisar** con el motivo y la lista llega en el
resumen de Telegram del envío. Al arreglarla en la ficha, el aviso sale en el
siguiente envío. Al 29 oct: 20 de 225 ventas en proceso no cuadraban, todas por el
cronograma (4 de Neshuya, 10 de Praderas de Cashibo, 6 de Pucallpa).

## Filtros

- **Todos / Clientes / Leads** y **Sí se les escribe / No se les escribe**.
- **🚦 Por revisar**: solo las ventas que el semáforo frenó.
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

## 28 oct: clientes con nombre de usuario (sin número) · sql/164

WhatsApp deja usar un **nombre de usuario** y ocultar el número. A quien escribe así, Meta lo manda con un
código propio y **sin su celular**: el sistema no puede saber de qué ficha es.

- Ese chat entra a **Cobranza IA → Conversaciones** marcado **👤 sin número**, para la secretaria (le llega
  el aviso por Telegram). El filtro **"Sin número, por vincular"** los junta.
- La secretaria le pregunta su nombre o DNI, lo busca en el recuadro del chat y toca **Vincular**.
- Desde ahí el sistema lo reconoce siempre: le contesta el **agente de cobranza** (si ese cliente tiene 🤖 ON)
  y lo que se le escribe sale al **celular de su ficha**. La ficha tiene que tener celular.
- **Cambiar** o **Desvincular** corrigen un vínculo equivocado.
- **Si no es cliente sino un interesado (lead)**: en el mismo recuadro, elige el proyecto y toca
  **🆕 Es un lead → pasar a ventas**. Sale de cobranza y al **asesor del proyecto** le llega por Telegram el
  nombre y lo que escribió (si el proyecto no tiene asesor, al responsable de cobranza). Como no dejó su
  celular, el asesor le contesta desde el **WhatsApp Business del celular del 960** y le pide su número.
  Si al final era cliente: **Era cliente: vincular**.
- Los **avisos automáticos** no cambian: siempre salen al celular de la ficha, use o no nombre de usuario.

## 29 oct: apagar por PROYECTO y el resumen de envíos · sql/165

**Dos interruptores por proyecto.** Elige un proyecto en el selector de la pantalla y aparecen:

- **📨 avisos del proyecto ON/OFF**: en OFF, ningún cliente de ese proyecto recibe avisos automáticos
  (ni el recordatorio de promesa), aunque su casilla diga ✅ Sí. En la tabla salen como **🏗️ Proyecto apagado**.
- **🤖 agente del proyecto ON/OFF**: en OFF, a los clientes de ese proyecto les contesta solo la secretaria,
  aunque tengan 🤖 ON. Si uno escribe, el chat pasa a la secretaria con el motivo "el agente está apagado para
  su proyecto" y le llega el aviso por Telegram.

Mandan sobre las casillas de cada cliente (sirven para "no mandar nada a Praderas de Pucallpa" de un golpe)
y no las borran: al prender el proyecto, cada cliente vuelve a quedar como estaba. Un cliente con lotes en dos
proyectos recibe del que esté prendido. Con "Todos los proyectos" elegido, arriba se listan los que están apagados.

**📨 Envíos del día** (pestaña nueva de Cobranza IA): qué salió un día, por proyecto: cuántos avisos, a cuántos
clientes, cuántos **llegaron** y se **leyeron** (palomitas de Meta), cuántos **fallaron** y cuántos
**respondieron** después del aviso. Debajo, la lista aviso por aviso (hora, lote, cliente, plantilla, estado,
hora de la respuesta); tocar una fila muestra el mensaje tal cual le llegó, y **💬 chat** abre la conversación
completa en la bandeja de WhatsApp (que desde el 29 oct también muestra los chats de cobranza).

**Voucher de un pago que ya estaba registrado (29 oct).** Si un cliente manda el voucher de un pago que
ya figura en Cuotas (mismo número de operación, o mismo monto y fecha en su venta), el agente **no lo registra
como pago nuevo**: le dice al cliente que ese pago ya está registrado y que la secretaria se comunicará con él,
el chat pasa a la secretaria (motivo "mandó el voucher de un pago que ya está registrado…") y a los responsables
de cobranza les llega el aviso por **WhatsApp** (y por Telegram). Un voucher con fecha de hace más de 45 días sí
queda en Por validar, pero con la alerta "VOUCHER ANTIGUO" y el mismo aviso, para que una persona lo revise.
El WhatsApp a la secretaria sale como texto si ella le escribió al 960 en las últimas 24 h; si no, con la
plantilla interna `urbis_aviso_interno` (hay que crearla en Meta: `node cobranza_meta.js crear_plantillas`).

## 29 oct: un número y una marca por proyecto (Century) · sql/166

**Pedido:** "todo lo que es Century con otro número, y que diga Century Proyectos Inmobiliarios, ya no Urbis".
El número de Century se conecta en la **misma cuenta de WhatsApp de Meta** que el 960 (mismo token, misma
tarjeta), y en Clientes y avisos → elegir el proyecto → **📱 número** se guardan: el identificador del número en
Meta, el número visible, la **marca** y el **prefijo de sus plantillas**. Desde ahí:

- los **avisos** de ese proyecto salen por ese número con sus propias plantillas (`century_cobranza_*`, copia
  de las de Urbis con la marca cambiada; se crean una vez con `node cobranza_meta.js crear_plantillas century`
  y Meta las aprueba);
- el **agente** se presenta como esa marca en los chats que entraron por ese número y nunca menciona a Urbis;
- cada chat recuerda por qué número entró y se le contesta **siempre por el mismo**; el bot de leads también.

Un cliente que tiene lotes en dos proyectos recibe cada aviso por el número del proyecto de ese lote.

**💲 Consumo** (pestaña nueva): plantillas enviadas / llegaron / fallidas, textos del agente y de la secretaria
(gratis dentro de las 24 h), mensajes de clientes y el **estimado del mes** por proyecto y número: plantillas ×
tarifa + IA por tokens. La tarifa es de referencia (se edita ahí); la factura real está en Meta → WhatsApp
Manager → Facturación.

_Técnico: `cobranza_proyectos_cfg` (sin fila = todo prendido), `cobranza_proyecto_set()`, `cobranza_envios_dia(p_dia)`,
`cobranza_envios_dias()`, `wa_chats_cobranza()`; el agente lo aplica en `barridoAvisos`, `proyectarAvisos`
(estado `proyecto_pausado`) y `turno` (motivo `PROYECTO_APAGADO`)._
