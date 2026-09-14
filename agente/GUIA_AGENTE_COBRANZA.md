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

---

## Paso 0 · Arrancar el agente en MODO PRUEBA (juntos, hoy mismo)

No necesita nada de Meta: sirve para probar el agente con datos reales desde el
panel, sin que salga ningún mensaje.

1. Las tablas del agente y el arreglo de permisos, **en ese orden**. Son una
   sola vez:

```bash
scp "C:\Claude\Projects\Sistema CRM\sql\76_agente_cobranza.sql" "C:\Claude\Projects\Sistema CRM\sql\77_rol_real.sql" root@157.245.8.78:/root/ ; ssh root@157.245.8.78 '. /root/urbis-supabase-claves.txt; PGPASSWORD=$POSTGRES_PASSWORD psql -X -1 -h 127.0.0.1 -U postgres -d postgres -f /root/76_agente_cobranza.sql && PGPASSWORD=$POSTGRES_PASSWORD psql -X -1 -h 127.0.0.1 -U postgres -d postgres -f /root/77_rol_real.sql'
```

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

## Paso 2 (tú) · Crear la app de Meta

1. developers.facebook.com → **Mis apps** → **Crear app**.
2. Si pregunta el caso de uso: **Otro** → tipo **Negocio**. Si aparece "Conectar con
   clientes a través de WhatsApp", también sirve.
3. Nombre: `urbis-cobranza-agente`. Portafolio comercial: **Urbis Group**. Crear.
4. En el panel de la app, busca **WhatsApp** → **Configurar**.
5. Cuando pida la cuenta de WhatsApp Business, elige la **existente de Urbis Group**
   (la del 986 598 614). **No** crees una cuenta nueva y **no** agregues número.
6. Si te muestra un "número de prueba", ignóralo.

📸 Mándame una captura de WhatsApp → **Configuración de la API**. Si ahí aparece un
"token de acceso temporal", **tápalo**.

> Los nombres de los botones de Meta cambian seguido. Si algo no coincide, manda
> captura y lo vemos.

## Paso 3 (tú) · Usuario del sistema (el "robot" dueño del token)

1. business.facebook.com → ⚙ **Configuración** → **Usuarios** → **Usuarios del
   sistema** → **Agregar**.
2. Nombre `agente-cobranza`, rol **Administrador** → Crear.
3. Con ese usuario seleccionado → **Asignar activos**:
   - **Apps** → `urbis-cobranza-agente` → **Control total**.
   - **Cuentas de WhatsApp** → Urbis Group → **Control total**.
4. **Todavía no generes el token.** Lo generamos en el paso 6, en el momento de
   pegarlo en el servidor, porque Meta lo muestra una sola vez.

## Paso 4 (tú) · Crear las 4 plantillas

Administrador de WhatsApp → **Plantillas de mensajes** → **Crear plantilla**. En
cada una:

- Categoría **Utilidad**.
- Nombre **exacto**, en minúsculas y con guiones bajos.
- Idioma **Español**. Si ofrece variantes, elige "Español" a secas.
- Sin encabezado, sin pie y sin botones.
- Pega el cuerpo **tal cual** y llena los ejemplos de variables.

### 1) `urbis_cuota_recordatorio`

> Hola {{1}}, le saludamos de Urbis Group. Le recordamos que su cuota N° {{2}} del
> lote {{3}} del proyecto {{4}} vence el {{5}} por S/ {{6}}. Si ya realizó el pago,
> envíe la foto de su voucher por este chat para registrarlo. Gracias.

Ejemplos: {{1}} Juan · {{2}} 12 · {{3}} Mz B Lt 7 · {{4}} Las Praderas de Cashibo ·
{{5}} 30/09/2026 · {{6}} 350.00

### 2) `urbis_cuota_vence_hoy`

> Hola {{1}}, le saludamos de Urbis Group. Hoy vence su cuota N° {{2}} del lote {{3}}
> del proyecto {{4}} por S/ {{5}}. Cuando realice el pago, envíe la foto de su
> voucher por este chat y lo registraremos. Gracias.

Ejemplos: {{1}} Juan · {{2}} 12 · {{3}} Mz B Lt 7 · {{4}} Las Praderas de Cashibo ·
{{5}} 350.00

### 3) `urbis_cuota_vencida`

> Hola {{1}}, le saludamos de Urbis Group. Su cuota N° {{2}} del lote {{3}} del
> proyecto {{4}} venció el {{5}} y tiene un saldo pendiente de S/ {{6}}. Si ya pagó,
> envíenos el voucher por este chat; si necesita coordinar una fecha, escríbanos por
> aquí. Gracias.

Ejemplos: {{1}} Juan · {{2}} 12 · {{3}} Mz B Lt 7 · {{4}} Las Praderas de Cashibo ·
{{5}} 30/08/2026 · {{6}} 350.00

### 4) `urbis_promesa_pago`

> Hola {{1}}, le saludamos de Urbis Group. Le recordamos que para el {{2}} quedó en
> realizar su pago de S/ {{3}} del lote {{4}} del proyecto {{5}}. Cuando lo realice,
> envíe la foto de su voucher por este chat. Gracias.

Ejemplos: {{1}} Juan · {{2}} 15/10/2026 · {{3}} 350.00 · {{4}} Mz B Lt 7 ·
{{5}} Las Praderas de Cashibo

**El orden de las variables importa:** el agente las llena exactamente en ese
orden. Meta tarda de minutos a 24 h en aprobarlas. Si alguna la rechaza o la pasa a
"Marketing", manda captura y ajustamos el texto.

## Paso 5 (tú) · Espacio de Claude para cobranza

1. console.anthropic.com → entra con la cuenta de la empresa.
2. **Settings → Workspaces → Create workspace** → nombre `Cobranza`.
3. Dentro del workspace, en **Limits**, pon un límite mensual bajo para empezar
   (por ejemplo US$ 10).
4. **Todavía no crees la clave.** La creamos en el paso 6.

> Si la consola no te muestra límites por workspace, igual crea el workspace y
> avísame.

## Paso 6 (juntos) · Poner el token y la clave en el servidor

Hazlo con la terminal del servidor abierta en otra ventana.

1. Abre el archivo de claves:

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
4. Al final del `.env` escribe `WA_TOKEN=` y pega el token pegado, sin espacios.
5. **Genera la clave de Claude:** console.anthropic.com → workspace **Cobranza** →
   **API keys → Create key** → nombre `agente-cobranza` → **Copiar**.
6. En otra línea escribe `COBRANZA_ANTHROPIC_API_KEY=` y pega la clave.
7. Guarda con **Ctrl+O**, **Enter**, **Ctrl+X**. Si ya había una línea `WA_TOKEN=`,
   deja una sola.
8. Reinicia y verifica (no muestra ningún secreto):

```bash
ssh root@157.245.8.78 "cd /root/crm/agente && pm2 restart cobranza-agente --update-env && node cobranza_meta.js verificar && node cobranza_meta.js ia"
```

   Tiene que decir ✅ **El token funciona**, ✅ **La clave de Claude funciona**, y si
   el número está en coexistencia, ✅ **COEXISTENCIA**. Mándame esa salida.

## Paso 7 (tú) · Conectar el webhook

1. Mira el token de verificación que ya está en el servidor:

```bash
ssh root@157.245.8.78 "grep WA_VERIFY_TOKEN /root/crm/agente/.env"
```

2. En la app de Meta → WhatsApp → **Configuración** → Webhook → **Editar**:
   - URL de devolución de llamada: `https://urbis-hook.duckdns.org/webhook`
   - Token de verificación: el valor que salió arriba (lo que va después del `=`)
   - **Verificar y guardar**. Con el agente corriendo, Meta lo acepta al instante.
3. En "Campos del webhook", **Suscribirse** a `messages` y, si aparece,
   `smb_message_echoes`.
4. Busca el **identificador de la cuenta de WhatsApp** (WABA): Administrador de
   WhatsApp → Configuración de la cuenta, o en la URL como `asset_id=...`. Con ese
   número:

```bash
ssh root@157.245.8.78 "cd /root/crm/agente && node cobranza_meta.js suscribir ID_DE_LA_CUENTA && node cobranza_meta.js plantillas ID_DE_LA_CUENTA"
```

## Paso 8 · Prender, en este orden

1. **Probar de nuevo** en Cobranza IA → 🧪 Probar agente, ya con la clave propia.
2. **Prender el agente** (Configuración → 🤖 Agente) en horario de oficina, con la
   secretaria mirando **Conversaciones**. Si un chat se complica, lo toma con
   **"Tomar yo"**.
3. Escribir en Configuración los **nombres de las 4 plantillas** apenas Meta las
   apruebe, poner un **tope diario bajo** para el primer día (por ejemplo 20) y
   recién ahí prender **📨 Avisos**.

---

## Qué me pasas en cada paso

| Paso | Me pasas | Nunca |
|---|---|---|
| 0 | La salida de los comandos | — |
| 2 | Captura de Configuración de la API, con el token tapado | El token |
| 4 | Captura de la lista de plantillas con su estado | — |
| 6 | La salida de `verificar` e `ia` | Token de Meta, clave de Claude |
| 7 | La salida de `suscribir` y `plantillas` | — |
