# 🤖 Manual: cómo configurar el bot de un proyecto

_Actualizado: 15 ago 2026 · Panel: **WhatsApp → elegir el proyecto → 🧩 FLUJO DEL BOT**_

---

## Lo primero que hay que entender

**El bot no sabe nada que tú no le hayas escrito.** No trae preguntas por defecto, no
inventa respuestas, no improvisa. Corre **exactamente los pasos que armes, en orden**.

Lo único que hace solo, sin que lo configures:

1. **Reconoce de qué proyecto habla el cliente** por lo que escribió. Si no lo
   identifica y hay varios proyectos, le pregunta cuál. Si hay uno solo, lo asume.
2. **Registra el lead** y avisa al asesor/administrador.
3. **Entiende los "sí" y los "no"** de siempre, con tilde o sin tilde, y emojis 👍.

Si dejas el flujo vacío, el bot solo hace eso: registra el lead y avisa. No conversa.

---

## Los dos tipos de paso

Cada paso es una de dos cosas:

| Tipo | Qué hace | Cuándo usarlo |
|---|---|---|
| **Mensaje** | Manda el texto (y su material) y **sigue de largo** al siguiente paso | Bienvenida, información, precios, ubicación |
| **Pregunta** | Manda el texto y **se queda esperando** la respuesta del cliente | Cuando necesitas que el cliente decida algo |

Un flujo típico son 4–6 pasos: 3 o 4 mensajes y 1 o 2 preguntas al final.

> **El paso 1 es tu bienvenida.** Es lo primero que recibe el cliente.

---

## Comodines que puedes usar en cualquier texto

- `{nombre}` → el primer nombre del cliente (si aún no lo sabe, queda vacío)
- `{proyecto}` → el nombre del proyecto

Ejemplo: `¡Hola {nombre}! 👋 Te cuento de {proyecto}...`

---

## Material (fotos, videos, PDF, links)

Se sube **una sola vez** en el recuadro naranja **📎 Material del flujo**, arriba de
los pasos. Después, en cada paso, lo enganchas con los botones `+ 🖼️ …`.

- Sube **imágenes, videos y PDF**, o agrega **links**.
- A cada archivo ponle una **descripción**: es el texto que acompaña la imagen cuando
  el bot la manda.
- El mismo archivo se puede usar en varios pasos. Se sube una vez.

> El material va a Cloudflare R2, no ocupa espacio de la base.

---

## Preguntas: el corazón del flujo

Cuando un paso es de tipo **Pregunta**, abajo aparecen las **opciones**. Cada opción
es una fila con cinco cosas:

| Campo | Para qué sirve | ¿Obligatorio? |
|---|---|---|
| **Opción** | El texto que ve el cliente (ej. `Sí`, `Contado`, `Inversión`) | Sí |
| **Palabras clave** | Cómo puede contestar el cliente con sus palabras | No |
| **Respuesta** | Lo que el bot contesta **si elige esta opción** | No |
| **→ ir a** | A qué paso saltar. Vacío = sigue al siguiente | No |
| **☑ asesor** | Marca esto y el lead pasa a un humano | No |

### El botón `+ Sí / No`

Para el caso más común (`¿Deseas que te comunique con un asesor?`) usa este botón: te
arma las **dos** opciones de una vez, con sus palabras y una respuesta amable ya
escritas, y el **Sí** con el check de asesor marcado. Después las editas a tu gusto.

### ⚠️ Regla de oro: nunca una sola opción

Una pregunta con **una sola opción** deja al cliente sin forma de decir que no. Si
contesta "No", el bot no encuentra a dónde mandarlo, repregunta, y el cliente se
frustra. **Toda pregunta necesita al menos dos caminos.**

### Cómo entiende el bot lo que le contestan

En este orden:

1. **Un número** (`1`, `2`) si contestó con el número de la lista.
2. **Tus palabras clave** de esa opción.
3. **Los sí y no de siempre**, que ya vienen de fábrica: *si, sí, claro, ok, dale, ya,
   listo, de una, porfa, obvio, 👍* · *no, ahorita no, más tarde, después, todavía no,
   lo voy a pensar, 👎*. **No tienes que escribirlos.**

Cuando hay conflicto gana **la frase más larga**: si el cliente escribe *"claro que
no"*, se lee como **no** aunque "claro" esté en las palabras del Sí.

> Las palabras clave son para lo **específico de tu negocio**: `invertir`, `vivienda`,
> `contado`, `crédito`. Los sí/no no hace falta escribirlos.

### Si el bot no entiende

Repregunta una vez. **A la segunda, pasa el lead a un asesor.** No se queda dando
vueltas: si el cliente escribió algo fuera del libreto, casi siempre es una pregunta
de verdad y ahí lo quieres humano.

---

## Si el cliente no contesta nada

Debajo de las opciones de cada pregunta:

```
⏭️ Si no responde en [ 30 ] [minutos] → [ qué hacer ]
```

Las cuatro salidas:

| Opción | Qué pasa |
|---|---|
| 🛑 **DETENER** | El bot se calla y avisa al asesor. El humano decide |
| **Pasar al asesor** | Le manda un mensaje al cliente y lo deriva |
| **Enviar un mensaje y seguir** | Le insiste con un texto tuyo y continúa el flujo |
| **Pasar al siguiente paso** | Sigue de largo sin decir nada |

**Vacío o 0 = espera para siempre** (el lead queda ahí hasta que conteste).

---

## Ajustes generales del flujo (arriba de los pasos)

- **Pausa entre mensajes** (`3 seg` por defecto): el bot espera ese ratito y muestra
  "escribiendo…" antes de cada mensaje. **No lo pongas en 0**: mandar 4 mensajes de
  golpe se ve a kilómetros que es un robot, y WhatsApp castiga eso.
- **Si no responde en / reintentos**: los valores por defecto para todos los pasos.
  Cada paso puede tener el suyo propio.

---

## Ejemplo completo, listo para copiar

**Paso 1 — Mensaje** (bienvenida)
```
¡Hola {nombre}! 👋 Gracias por escribir a URBIS GROUP.
Te cuento de {proyecto} en 3 mensajitos y cualquier duda me dices 🙌
```

**Paso 2 — Mensaje** + engancha 2 o 3 fotos y el plano
```
Nuestros lotes van de 212 m² a 644 m², con títulos en regla y luz y agua en obra.
```

**Paso 3 — Mensaje** (la parte que vende)
```
Puedes adquirir tu lote SOLO CON TU DNI (no revisamos historial crediticio,
crédito directo SIN BANCOS), con inicial de S/ 500 y cuotas SIN INTERESES
hasta por 48 meses.
```

**Paso 4 — Pregunta**
```
¿Te gustaría que un asesor te dé los precios exactos y coordine una visita?
```
Con el botón **`+ Sí / No`**:

| Opción | Palabras clave | Respuesta | ir a | asesor |
|---|---|---|---|---|
| **Sí** | si, claro, ok, dale, ya, listo, por favor | *(vacía)* | — | ☑ |
| **No** | no, ahorita no, más tarde, después, todavía no | `Sin problema 😊 Cualquier duda escríbeme por acá.` | — | ☐ |

Y abajo: *Si no responde en **60 minutos** → **DETENER (avisa al asesor)***.

---

## Cómo probarlo antes de soltarlo

1. **Guarda el flujo** (botón `💾 GUARDAR FLUJO` al final).
2. Escríbele al número del bot **desde otro celular** (con el tuyo, si eres el admin,
   algunos avisos se comportan distinto).
3. Recorre el flujo completo y prueba a propósito:
   - contestar con **número** (`1`)
   - contestar con **palabras** (`dale`, `no gracias`)
   - contestar **cualquier cosa** (`cuánto cuesta`) → debe repreguntar y a la segunda
     pasarte a un asesor
4. Mira la conversación en **WhatsApp → bandeja** del panel: ahí queda todo.

> Si una conversación tuya quedó "tomada por un humano", el bot ya no le responde a
> ese número. Para volver a probar desde cero, usa otro celular.

---

## Errores que cuestan leads

1. **Una sola opción en una pregunta.** El cliente que dice "no" queda sin salida.
2. **Pausa en 0.** Cuatro mensajes de golpe = spam.
3. **Textos larguísimos.** WhatsApp corta a 4,096 caracteres, pero mucho antes de eso
   el cliente dejó de leer. Tres mensajes cortos > un ladrillo.
4. **No poner qué pasa si no contesta.** El lead se queda congelado y nadie se entera.
5. **Prometer precios exactos en el bot.** El precio real sale del contrato y del
   asesor; el bot da rangos.

---

## Dónde queda todo

El flujo se guarda en `projects.bot_flow` (una columna JSON del proyecto). **Cada
proyecto tiene su propio flujo** — configurar Cashibo no toca Neshuya.

Las palabras de sí/no **generales para todos los proyectos** se ponen en el recuadro
verde de arriba; son un respaldo, lo normal es ponerlas en cada opción.
