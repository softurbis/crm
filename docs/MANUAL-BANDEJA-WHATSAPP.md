# 💬 Manual: la bandeja de WhatsApp sobre el número oficial

_Actualizado: 27 oct 2026 · Panel: menú **WhatsApp** · Número: **+51 960 487 000** (API oficial de Meta)_

---

## Qué cambió el 27 de octubre

Hasta ese día el panel hablaba con un **celular** (Baileys, un WhatsApp "vinculado" con QR).
Desde el 27 de octubre todo sale por el **número oficial +51 960 487 000**, conectado a la
**API oficial de Meta** (Cloud API) a través del conector de C-Soft. Ya no hay celular que
vincular, ni QR, ni "re-vincular": el número vive en la nube de Meta.

Lo que eso significa para la bandeja:

| Antes (celular) | Ahora (API oficial) |
|---|---|
| Varios números, uno por proyecto, cada uno con su QR | **Un solo número** para leads, clientes y lo que escribes desde el panel. Los otros números quedaron **apagados**; sus chats siguen aquí como historial. |
| Etiquetas del WhatsApp Business del celular | **Etiquetas propias del panel** (se crean aquí, con color, varias por chat). No viajan a WhatsApp. |
| Editar un mensaje ya enviado (hasta 15 min) | **No existe** en la API. Si te equivocaste, manda otro mensaje. |
| "Guardar en el celular" (tarjeta de contacto) | **No existe**. El nombre se edita en la ficha del lead o del cliente. |
| Se podía escribir cuando sea | **Ventana de 24 h**: texto libre solo hasta 24 h después del último mensaje de la persona. Después, solo plantilla aprobada. |
| No sabías si llegó | **Palomitas**: enviado ✓, entregado ✓✓, leído ✓✓ azul, o ⚠️ con el motivo si no se entregó. |

Lo que **sigue igual**: responder desde el panel (el bot se calla y el chat pasa a 👤 EN HUMANO),
adjuntar imagen / video / audio / PDF, respuestas rápidas ⚡, reenviar ↪, asignar el chat a un
asesor ⭐, el proyecto del chat 📁, el directorio 📇 y los interruptores del bot.

---

## El chip de estado (arriba a la derecha)

- 🟢 **EN LÍNEA · ☁️ API OFICIAL +51 960 487 000** → el agente del servidor está vivo y la API responde.
- 🔴 **SIN LATIDO** → el agente lleva más de 2 minutos sin reportarse. Primero **🔁 REINICIAR**;
  si sigue rojo, revisar el droplet (`pm2 ls`). El número **no se desconecta** por esto: lo que
  la gente escriba queda guardado en Meta y entra cuando el agente vuelva.
- ⚪ **SIN DATOS** → el agente nunca reportó (¿no está corriendo en modo API?).

No hay botón de vincular ni QR: no hacen falta.

**En la ficha de cada proyecto** (menú Proyectos) tampoco hay ya QR, "vincular otro celular", reiniciar ni
quitar número. Cada proyecto dice que sale por el **+51 960 487 000**. En el proyecto del 960 (Praderas) queda
el interruptor **🤖 LEADS ON/OFF** del bot de ventas; los números anteriores de los demás proyectos figuran
como **apagados**, con sus chats como historial.

---

## Cliente o lead

La regla es una sola, la misma que usa el agente del servidor:

> **Si el teléfono está en la ficha de algún cliente (celular principal o secundario), es CLIENTE. Si no, es LEAD.**

En la lista cada chat de cliente lleva el chip **CLIENTE**. Los filtros **💵 CLIENTES** y
**🆕 LEADS** separan la bandeja por esa regla. A los clientes les contesta el agente de cobranza
(menú **Cobranza IA**); a los leads, el bot de ventas con el flujo del proyecto. Cuando tú
escribes en un chat, los dos se callan ahí.

Si un cliente aparece como lead, es que su celular **no está en su ficha**: corrígelo en
**Clientes** y en máximo 5 minutos la bandeja lo refleja.

---

## Etiquetas (🏷️)

Son **del panel**: sirven para ordenar la bandeja, no se ven en WhatsApp ni en el celular.

- **Poner una**: en la cabecera del chat, selector **🏷️ + ETIQUETA**. Un chat puede tener varias.
- **Quitar una**: ✕ sobre la etiqueta en la cabecera del chat.
- **Crear una**: en el selector, **➕ CREAR ETIQUETA…** (administrador u operador), o en **🏷️ EDITAR**
  junto al filtro de etiquetas, donde también se **cambia el color** y se **elimina** una etiqueta
  (se quita de todos los chats que la tenían).
- **Filtrar**: el selector **🏷️ TODAS** encima de la lista, o el **📊 CONTEO** (clic en una etiqueta = filtrar).

El bot sigue poniendo **CALIFICADO** solo cuando un lead termina el flujo; esa etiqueta se suma a las
que ya tenga el chat.

---

## La ventana de 24 h (🕒 / 🔒)

Meta deja escribir **texto libre y archivos solo durante las 24 h siguientes al último mensaje
de la persona**. Pasadas, el único camino es una **plantilla aprobada por Meta**.

- En la cabecera del chat: **🕒 VENTANA ABIERTA · quedan 5 h 20 min** (verde) o
  **🔒 VENTANA CERRADA · solo plantilla** (naranja). En la lista, un 🔒 chiquito junto a la hora.
- Con la ventana cerrada la caja de texto y el clip quedan **bloqueados** y un aviso lo explica.
  No es una falla del panel: es la regla de Meta.
- Qué hacer:
  - **Cliente** → el agente de cobranza le manda una plantilla desde **Cobranza IA** (recordatorio,
    vencida, etc.). Cuando la persona responde, la ventana se abre otra vez y puedes escribirle normal.
  - **Lead** → esperar a que vuelva a escribir, o llamarlo. (Las plantillas para leads no existen todavía.)
- Filtro **🕒 VENTANA ABIERTA**: solo los chats a los que se les puede escribir ahora mismo.

Si un envío salió "a tiempo" pero Meta igual lo rechaza, llega como ⚠️ con el motivo
(por ejemplo *131047: pasaron más de 24 h*).

---

## Las palomitas (estado de entrega)

Lo avisa Meta por el webhook, igual que en el celular, para los mensajes que salen **desde el panel**:

| Marca | Significa |
|---|---|
| ✓ gris tenue | salió hacia Meta, todavía no avisa |
| ✓ | **enviado** (una palomita) |
| ✓✓ | **entregado** al celular de la persona |
| ✓✓ azul | **leído** |
| ⚠️ + motivo | **no se entregó** (número sin WhatsApp, ventana cerrada, bloqueado…) |

Los mensajes del **bot** (flujo de leads) no llevan palomitas: el agente no guarda su id de Meta.
Los que la secretaria escribe **desde la app del celular** (coexistencia) aparecen como 📲 CELULAR.

---

## 29 oct: una sola bandeja — también los chats de COBRANZA (sql/165)

Hasta el 28 de octubre la bandeja mostraba solo los chats del **bot de ventas** (leads e historial).
Los chats de los **clientes** (los que atiende el agente de cobranza por el mismo 960) vivían aparte, en
Cobranza IA → Conversaciones. Por eso el día del primer envío masivo "no se veía el chat".

Ahora entran a la misma lista, con el distintivo **💵 COBRANZA**:

- **Lo que se ve en el hilo**: el aviso que salió (**📨 AVISO (PLANTILLA)**, con el texto tal cual le llegó
  y sus palomitas), lo que contestó el cliente, lo que respondió el **🤖 AGENTE IA**, lo que escribió la
  secretaria desde el panel (**👩**) o desde la app del celular (**📲 CELULAR**). Si ese celular ya tenía un
  chat viejo con el bot (antes del 27 oct), ese historial aparece debajo marcado con 🗄️.
- **Filtro 📨 COBRANZA** (arriba de la lista): solo los chats de clientes de cobranza. El filtro
  **💵 CLIENTES** los incluye; **🆕 LEADS** los excluye.
- **No leídos**: el número verde viene de la base (lo que el cliente escribió y nadie abrió). Se limpia al
  abrir el chat.
- **Quién atiende**: el botón **🤖 AGENTE DE COBRANZA ATIENDE · tomar yo** deja el chat con la secretaria
  (el agente se calla ahí); **👩 SECRETARIA · devolver al agente** lo regresa. Si el agente está apagado para
  ese cliente o para su proyecto (Cobranza IA → Clientes y avisos), el chat ya viene con la secretaria y dice por qué.
- **Escribirle**: solo texto, y solo con la **ventana de 24 h abierta**. Sale por el 960 en segundos y el
  agente se calla en ese chat. Con la ventana cerrada, el aviso con plantilla lo manda el agente a su hora.
  Escribir a un cliente de cobranza requiere el permiso **cobranza** (Usuarios); los demás solo leen.
- Un chat de cobranza **no** lleva etiquetas, asignación ni clasificación del directorio: su proyecto es el
  del lote de la ficha. El enlace **↗ COBRANZA IA** abre la pantalla de cobranza (vouchers, promesas, seguimiento).
- **📨 ENVÍOS DEL DÍA** (arriba): el resumen de lo que salió ese día, por proyecto; desde ahí "💬 chat" vuelve aquí.

---

## Preguntas frecuentes

**¿Por qué veo chats de "BRISAS" u otro número apagado?** Son historial. Con el filtro de números
(arriba de la lista) los separas. El ⏸ indica que ese número ya no atiende.

**¿Puedo escribirle a alguien que nunca escribió al 960?** No con texto libre: Meta exige
plantilla para iniciar. Si es cliente, Cobranza IA. Si es lead, la landing o el link de WhatsApp
del proyecto hacen que **él** escriba primero.

**¿Y los mensajes que mando desde la app del celular del 960?** Sí llegan a la bandeja
(📲 CELULAR) y el bot se calla en ese chat.

**¿Qué pasó con las etiquetas que ya tenía?** Se migraron tal cual, con su color (sql/158).

---

_Técnico: etiquetas en `wa_etiquetas` + `whatsapp_conversations.etiquetas`; ventana en
`whatsapp_conversations.ultimo_entrante_at` (trigger); entrega en `scheduled_messages.entrega`
vía `wa_marcar_entrega()` que llama `agente/cobranza.js` con cada status del webhook; regla
cliente/lead en `wa_telefonos_clientes()` = `agente/quien_escribe.js`. Todo en `sql/158_bandeja_cloud_api.sql`._
