# Guía: poner en marcha el agente de cobranza

> Para el dueño. Sigue los pasos en orden. **(tú)** = lo haces tú; **(juntos)** = con
> Claude en el chat al lado.
>
> ⚠️ **Regla de oro:** el token de Meta, la clave de Claude y los datos de la tarjeta
> **nunca** van por el chat. Van directo al servidor o a Meta.

## Qué vamos a conectar

- **Número de cobranza:** +51 986 598 614. Ya figura **Conectado** en Meta, dentro del
  portafolio **Urbis Group**. Identificador del número: `1316329454896872`.
- **El agente** corre en el servidor como un proceso **aparte** del bot de leads. El
  bot de leads no se toca.
- **Todo nace apagado.** A ningún cliente le llega nada hasta que lo prendas desde
  el panel (Cobranza IA → Configuración).

## Lo que NO se toca

- En el Administrador de WhatsApp: **ni** "Agregar número de teléfono" **ni** el 🗑
  del número.
- La secretaria **no** desinstala WhatsApp Business, **no** cambia de celular y
  **abre la app al menos una vez cada 13 días**. Si no, Meta desconecta el número de
  la API.
- La app "n8n" de tu Facebook es de El Cholao: no se usa para Urbis.

## El orden, de un vistazo

| # | Qué | Quién | Sin esto… |
|---|---|---|---|
| 0 | Tablas y modo prueba | juntos | — |
| 1 | Método de pago en Meta | tú | no sale ni un mensaje |
| 2 | App `urbis-cobranza-agente` | tú ✅ hecho | no hay dónde generar el token |
| 3 | Usuario del sistema | tú ✅ hecho | el token caduca en horas |
| 4 | Workspace de Claude | tú | el agente usa la clave general |
| 5 | Token y clave en el servidor | juntos | el agente no habla con Meta |
| 6 | Las 5 plantillas (un comando) | juntos | los avisos no salen |
| 7 | Webhook | tú + un comando | los clientes escriben y nadie contesta |
| 8 | Prender, en orden | tú | — |

---

## Paso 0 · Arrancar el agente en MODO PRUEBA (juntos, hoy mismo)

No necesita nada de Meta: sirve para probar el agente con datos reales desde el
panel, sin que salga ningún mensaje.

1. Las tablas del agente, el arreglo de permisos y el escalón de cuotas
   acumuladas, **en ese orden**. Son una sola vez:

```bash
scp "C:\Claude\Projects\Sistema CRM\sql\76_agente_cobranza.sql" "C:\Claude\Projects\Sistema CRM\sql\77_rol_real.sql" "C:\Claude\Projects\Sistema CRM\sql\90_cobranza_escalon.sql" root@157.245.8.78:/root/ ; ssh root@157.245.8.78 '. /root/urbis-supabase-claves.txt; for f in 76_agente_cobranza 77_rol_real 90_cobranza_escalon; do echo "== $f =="; PGPASSWORD=$POSTGRES_PASSWORD psql -X -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -f /root/$f.sql || break; done'
```

   > `ON_ERROR_STOP=1` es importante: sin eso, `psql` responde "todo bien" aunque
   > el SQL falle, y lo que viene después corre igual.

2. Instalar o actualizar los dos procesos del servidor. **Este es el comando de
   siempre** cada vez que Claude publique cambios:

```bash
scp "C:\Claude\Projects\Sistema CRM\migracion\07_actualizar_agente.sh" root@157.245.8.78:/root/ ; ssh root@157.245.8.78 'bash /root/07_actualizar_agente.sh'
```

   Al final tiene que decir `AGENTE DE COBRANZA corriendo`, con WhatsApp "SIN TOKEN
   (solo pruebas)". Mientras no exista la clave propia usa la clave GENERAL de
   Claude: para probar está bien.

3. Panel → **Usuarios** → en tu fila o en la de la secretaria, marca
   **🤝 Responsable de cobranza**. Esa persona tiene que cerrar sesión y volver a entrar.

4. Panel → **Cobranza IA → 🧪 Probar agente**: busca un cliente real y escríbele
   como si fueras él. Por ejemplo "cuánto debo", "no podré pagar el 30, pago el 15"
   o la foto de un voucher. No se le envía nada al cliente.

---

## Paso 1 (tú) · Método de pago en Meta

1. business.facebook.com → elige el portafolio **Urbis Group**.
2. Administrador de WhatsApp → **Información general** → en la alerta "Falta un
   método de pago válido" → **Agregar método de pago**.
3. Registra la tarjeta tú mismo y guarda.

Sin esto Meta no deja enviar ni un mensaje. Las plantillas (los avisos que manda la
empresa) se cobran por mensaje, del orden de centavos. Las respuestas dentro de las
24 h desde que el cliente escribe no se cobran.

## Paso 2 (tú) · La app de Meta — ✅ hecha

Ya existe `urbis-cobranza-agente` en el portafolio **Urbis Group**, con WhatsApp
agregado y la cuenta existente del 986 598 614. Si alguna vez hay que rehacerla:
developers.facebook.com → Mis apps → Crear app → **Otro** / **Negocio**, y en
WhatsApp elegir la cuenta **existente** (nunca crear una nueva ni agregar número).

## Paso 3 (tú) · Usuario del sistema — ✅ hecho

Ya existe `agente-cobranza` (Employee) con la app y la cuenta de WhatsApp en
**control total**. Es el dueño del token: por eso el token no caduca aunque cambies
tu contraseña de Facebook.

## Paso 4 (tú) · Espacio de Claude para cobranza

1. console.anthropic.com → entra con la cuenta de la empresa.
2. **Settings → Workspaces → Create workspace** → nombre `Cobranza`.
3. Dentro del workspace, en **Limits**, pon un límite mensual bajo para empezar
   (por ejemplo US$ 10).
4. **Todavía no crees la clave.** La creamos en el paso 5.

> Sirve para ver el gasto del agente aparte y poder anular esa clave sola, sin
> tocar el asistente interno del bot.

## Paso 5 (juntos) · Poner el token y la clave en el servidor

Hazlo con la terminal del servidor abierta en otra ventana.

1. Entra y abre el archivo de claves:

```bash
ssh root@157.245.8.78
```

   y adentro:

```bash
cd /root/crm/agente && nano .env
```

2. Busca la línea `WA_PHONE_NUMBER_ID=1270870216103126` (es el número de **prueba**
   de julio) y cámbiala por:

```
WA_PHONE_NUMBER_ID=1316329454896872
```

3. **Genera el token de Meta:** business.facebook.com → Usuarios del sistema →
   `agente-cobranza` → **Generar token** → app `urbis-cobranza-agente` → caducidad
   **Nunca** → permisos `whatsapp_business_messaging` y
   `whatsapp_business_management` → Generar → **Copiar**.
4. Al final del `.env` escribe `WA_TOKEN=` y pega el token, sin espacios.
5. **Genera la clave de Claude:** console.anthropic.com → workspace **Cobranza** →
   **API keys → Create key** → nombre `agente-cobranza` → **Copiar**.
6. En otra línea escribe `COBRANZA_ANTHROPIC_API_KEY=` y pega la clave.
7. Guarda con **Ctrl+O**, **Enter**, **Ctrl+X**. Si ya había una línea `WA_TOKEN=`,
   deja una sola.
8. Reinicia y revisa TODO de una (no muestra ningún secreto):

```bash
ssh root@157.245.8.78 "cd /root/crm/agente && pm2 restart cobranza-agente --update-env && node cobranza_meta.js listo"
```

   Eso imprime, en una sola pasada: el número y si está en coexistencia, el id de la
   cuenta de WhatsApp, si el webhook está suscrito, cómo van las plantillas y si la
   clave de Claude responde. **Mándame esa salida entera.**

   > Los dos permisos del token importan: con `whatsapp_business_messaging` solo se
   > envían mensajes; el que deja **crear las plantillas** y suscribir el webhook es
   > `whatsapp_business_management`.

## Paso 6 (juntos) · Las 5 plantillas, de un comando

Los textos ya están escritos y aprobados en `PLANTILLAS_COBRANZA.md`. En vez de
copiarlos a mano en la web de Meta (cinco veces, y cualquier tilde de más los
rechaza), los crea el servidor:

```bash
ssh root@157.245.8.78 "cd /root/crm/agente && node cobranza_meta.js crear_plantillas"
```

- Busca solo el id de la cuenta de WhatsApp: no hay que ir a buscarlo a Meta.
- La que ya exista **no se toca** (se puede correr las veces que haga falta).
- Meta las revisa sola: de minutos a 24 h.

Para ver cómo van:

```bash
ssh root@157.245.8.78 "cd /root/crm/agente && node cobranza_meta.js plantillas"
```

✅ = aprobada · ⏳ = en revisión · ❌ = rechazada (manda la salida y ajustamos el
texto). Si alguna sale como **MARKETING** en vez de *Utilidad*, avísame: se cobra
distinto y conviene reescribirla.

> Para verlas antes de crearlas: `node cobranza_meta.js textos`.
> Para cambiar un texto: se edita `plantillas_cobranza.js`, se publica, y se vuelve
> a correr `crear_plantillas` con **otro nombre** (Meta no deja reescribir el texto
> de una plantilla ya aprobada sin volver a revisarla).

## Paso 7 (tú) · Conectar el webhook

1. Mira el token de verificación que ya está en el servidor:

```bash
ssh root@157.245.8.78 "grep WA_VERIFY_TOKEN /root/crm/agente/.env"
```

2. En la app de Meta → WhatsApp → **Configuración** → Webhook → **Editar**:
   - URL de devolución de llamada: `https://hook.urbisgroupinmobiliaria.com/webhook`
   - Token de verificación: el valor que salió arriba (lo que va después del `=`)
   - **Verificar y guardar**. Con el agente corriendo, Meta lo acepta al instante.
3. En "Campos del webhook", **Suscribirse** a `messages` y, si aparece,
   `smb_message_echoes` (es lo que la secretaria escribe desde su celular).
4. Suscribir la app a la cuenta, para que Meta empiece a mandar los mensajes:

```bash
ssh root@157.245.8.78 "cd /root/crm/agente && node cobranza_meta.js suscribir"
```

## Paso 8 · Prender, en este orden

1. **Probar de nuevo** en Cobranza IA → 🧪 Probar agente, ya con la clave propia.
2. **Prender el agente** (Configuración → 🤖 Agente) en horario de oficina, con la
   secretaria mirando **Conversaciones**. Si un chat se complica, lo toma con
   **"Tomar yo"**.
3. Escribir en Configuración los **nombres de las 5 plantillas** apenas Meta las
   apruebe, revisar **desde cuántas cuotas** sale el aviso de resolución (viene en
   4; el contrato considera grave 2 seguidas o 3 acumuladas), dejar marcado
   **📅 Solo días hábiles**, poner un **tope diario bajo** el primer día (por
   ejemplo 20) y recién ahí prender **📨 Avisos**.

   > **Solo días hábiles** no es una preferencia: el art. 62 de la Ley 29571
   > considera cobranza abusiva escribirle al deudor sábados, domingos, feriados
   > o entre las 8 p.m. y las 7 a.m. Los feriados están cargados hasta 2027 y se
   > actualizan en el mismo panel.

---

## Qué me pasas en cada paso

| Paso | Me pasas | Nunca |
|---|---|---|
| 0 | La salida de los comandos | — |
| 5 | La salida completa de `listo` | Token de Meta, clave de Claude |
| 6 | La salida de `crear_plantillas` y de `plantillas` | — |
| 7 | La salida de `suscribir` | El token de verificación |

## Si algo falla

| Lo que ves | Qué pasa |
|---|---|
| `Faltan WA_PHONE_NUMBER_ID o WA_TOKEN` | el `.env` no se guardó, o falta reiniciar con `--update-env` |
| `(#200) requires whatsapp_business_management` | el token se generó sin ese permiso: hay que generarlo de nuevo |
| `No pude averiguar el id de la cuenta` | pásalo a mano: `node cobranza_meta.js plantillas EL_ID` |
| `Ninguna app suscrita` | falta el paso 7.4 |
| El cliente escribe y no llega nada | webhook mal puesto, o falta suscribirse a `messages` |
| `Pasaron más de 24 h…` al responder | fuera de la ventana de Meta: solo sale una plantilla |
