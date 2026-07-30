# Guía: activar la API oficial de WhatsApp (Cloud API) — paso a paso

> Para el operador de Urbis. Tiempo estimado: 30–40 min la primera parte.
> ⚠️ REGLA DE ORO: los **tokens** y contraseñas NUNCA se pegan en el chat con
> Claude ni en ningún chat — van directo al `.env` del droplet. (Ya nos pasó
> una vez con la service_role de Supabase; no repetimos.)

## FASE A — Probar en seco con el número de TEST de Meta (gratis, sin RUC, sin chip)

**Paso 1. Cuenta de Meta Business**
1. Entra a https://business.facebook.com con tu Facebook personal.
2. Crear cuenta → nombre: URBIS GROUP, tu correo del trabajo.
   (Si ya tienes Business Manager de las páginas de Urbis, usa esa misma.)

**Paso 2. App de desarrollador con WhatsApp**
1. Entra a https://developers.facebook.com → "Mis apps" → **Crear app**.
2. Tipo/caso de uso: **Business** (o "Otro" → Business). Nombre: `urbis-cobranza`.
3. Dentro de la app: busca el producto **WhatsApp** → **Configurar** → vincula
   tu portafolio de negocio del paso 1.

**Paso 3. Copiar los 2 datos + el token**
En WhatsApp → **API Setup** (Configuración de la API) verás:
- **Número de prueba** (test number) — gratis, ya aprobado.
- `Phone number ID` → este me lo puedes pasar (no es secreto).
- **Token temporal** (dura 24 h) → botón "Copy". NO me lo pases: va directo al droplet.
- En "To" (destinatario): agrega TU número personal y verifícalo con el código
  que te llega por WhatsApp (Meta deja hasta 5 números de prueba).

**Paso 4. Poner el token en el droplet y probar**
En la consola del droplet (cloud.digitalocean.com → tu droplet → Console):
```bash
cd /root  # o la carpeta donde vive el bot (donde está index.js)
nano .env
```
Agrega estas líneas (pegando el token que copiaste):
```
WA_PHONE_NUMBER_ID=EL_PHONE_NUMBER_ID
WA_TOKEN=EL_TOKEN_TEMPORAL
WA_VERIFY_TOKEN=urbis-2026-webhook
```
Guarda (Ctrl+O, Enter, Ctrl+X) y prueba (con tu número personal como destino):
```bash
curl -sO https://raw.githubusercontent.com/softurbis/crm/main/agente/cloudapi.js && node cloudapi.js --test --to 51TUNUMERO
```
Si te llega el "hello_world" al WhatsApp → **la API oficial ya funciona**. Avísale a Claude.

## FASE B — Número real de cobranza (cuando pase la Fase A)

1. **Chip nuevo** dedicado a cobranza (que NUNCA haya tenido WhatsApp app, o
   que estés dispuesto a borrarle la cuenta de la app).
2. En WhatsApp → API Setup → **Add phone number**: nombre visible "Urbis Group
   Cobranzas", verificación por SMS/llamada al chip.
3. **Token permanente**: Business Settings → Usuarios → **Usuarios del sistema**
   → crear `bot-cobranza` (rol admin) → **Generar token** con permisos
   `whatsapp_business_messaging` + `whatsapp_business_management`, caducidad
   "nunca". Va al `.env` del droplet reemplazando el temporal.
4. **Método de pago**: Business Settings → Facturación → agregar tarjeta
   (las plantillas de cobranza se cobran por mensaje — centavos; sin tarjeta
   no salen mensajes fuera de ventana). ⚠️ La tarjeta la registras TÚ.
5. **Plantillas de cobranza** (WhatsApp Manager → Plantillas → Crear, categoría
   **UTILITY**, idioma Español): crear estas 3 — Claude las cableará al CRM:

   `recordatorio_cuota`
   > Hola {{1}}, le recordamos que la cuota N° {{2}} de su lote {{3}} ({{4}})
   > vence el {{5}} por S/ {{6}}. Si ya pagó, envíe su voucher por este chat
   > y quedará registrado. — URBIS GROUP

   `cuota_vence_hoy`
   > Hola {{1}}, su cuota N° {{2}} del lote {{3}} ({{4}}) vence HOY por
   > S/ {{6}}. Puede pagar en las cuentas de siempre y enviar su voucher por
   > este chat. ¿Alguna consulta? Escríbanos por aquí. — URBIS GROUP

   `cuota_vencida`
   > Hola {{1}}, su cuota N° {{2}} del lote {{3}} ({{4}}) venció el {{5}}
   > (saldo S/ {{6}}). Escríbanos por este chat para regularizar o coordinar
   > una fecha de pago. — URBIS GROUP

6. **Webhook** (para que las respuestas de clientes entren al panel): necesita
   un dominio con HTTPS apuntando al droplet — Claude lo monta con Caddy cuando
   lleguemos aquí. Verificación del negocio (RUC 20 o RUC 10) recién importa en
   esta fase si quieres pasar de 250 conversaciones/día y el check verde.

## Qué le pasas a Claude en cada fase (nada de tokens)

| Fase | Me pasas |
|---|---|
| A | El `Phone number ID` y un "ya puse el token en el droplet" + resultado del --test |
| B | El nuevo `Phone number ID` del chip real y los nombres de las plantillas aprobadas |
