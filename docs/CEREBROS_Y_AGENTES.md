# Cerebros del bot y agentes — cómo quedó (jul 2026)

Resumen de la reestructuración del módulo **WhatsApp del bot** y qué tienes que hacer tú.

## 1. Los 3 agentes (bajo el BOT maestro)

El bot es **un solo proceso**, pero sus funciones son **independientes** y se prenden/apagan por separado:

| Interruptor | Qué controla | Cerebro que usa | Flag en BD (`bot_settings`) |
|---|---|---|---|
| **🤖 BOT** (maestro) | Prende/apaga TODO | — | `bot_activo` |
| **🧠 VENTAS** | La conversación con leads (IA) | `ventas` + `instrucciones` + `aprendido` + `prohibiciones` | `ia_activa` |
| **💵 COBRANZA** | Avisos automáticos de cuotas | `cobranza` | `cobranza_activa` |
| **🗓️ SEGUIMIENTO** | Chequeo a secretarias/gerencia | `secretaria` | `seguimiento_activo` |

> **Importante:** el interruptor **VENTAS** es el que antes se llamaba **"IA"**. Solo se renombró en la pantalla; el flag en la base de datos **sigue siendo `ia_activa`** (por eso el agente actual ya lo respeta sin tocar nada). Apágalo cuando quieras pausar solo la venta mientras pules el MD de VENTAS — cobranza y seguimiento siguen corriendo.

## 2. El mapa del cerebro (vista pro)

En **CEREBROS** ahora hay un mapa radial: el núcleo **URBIS** con una rama por cada cerebro
(VENTAS, REGLAS, PROHIBIDO, APRENDIDO, COBRANZA, SEGUIMIENTO) más una rama por cada **ficha de proyecto**.
- El **% listo** y el tamaño/relleno de cada nodo indican cuánto contenido tiene ese cerebro.
- **Toca un nodo** para abrir su editor a la derecha (o usa el desplegable de siempre).

## 3. Cerebro APRENDIDO (nuevo) — que el bot aprenda

Un cerebro nuevo, `aprendido`, que se **suma al de VENTAS** como "información real y actualizada".
Se le enseña de **dos formas**:

1. **Desde el panel:** toca el nodo **APRENDIDO** → aparece la caja *"Enséñale algo"* → escribe un dato y **ENSEÑAR**. Se agrega a la lista.
2. **Por WhatsApp:** desde el **número ADMIN**, escríbele al bot:
   ```
   aprende: la oficina abre de 9am a 6pm
   ```
   El bot responde "✅ Aprendido…" y lo usa **al toque** (invalida su cache).

Todo lo aprendido queda como una lista editable en el cerebro APRENDIDO (puedes borrar/ordenar a mano).

## 4. Qué tienes que hacer TÚ (desplegar el agente)

El **frontend** (esta pantalla) se despliega solo con el push a GitHub Pages — ya está.
El **agente** corre en el droplet de DigitalOcean con **pm2** y NO se actualiza solo. Para que
funcionen el cerebro APRENDIDO y el comando `aprende:` hay que subir el nuevo `index.js`:

```bash
# en tu PC, desde la carpeta del proyecto:
cd "C:\Users\ingce\Claude\Projects\Sistema CRM\crm"
git pull                    # trae los cambios (ya están en GitHub)

# en el droplet (SSH):
cd ~/urbis-agente           # o donde esté el agente
git pull                    # si el droplet clona el repo; si no, copia el archivo agente/index.js
pm2 restart urbis-agente    # reinicia el proceso
pm2 logs urbis-agente       # verifica que arrancó sin errores
```

> Si en el droplet NO tienes el repo (subes el archivo a mano), reemplaza solo
> `agente/index.js` por la versión nueva y haz `pm2 restart`.

Mientras no despliegues el agente: en el panel **ya puedes escribir y guardar** lo aprendido
(no se pierde), pero el bot en vivo no lo usará hasta el `pm2 restart`.

## 5. Archivos tocados
- `crm/src/components/BrainMap.jsx` — el mapa radial (nuevo).
- `crm/src/pages/Whatsapp.jsx` — header reestructurado, mapa, cerebro APRENDIDO, caja de enseñar.
- `crm/agente/index.js` — el cerebro `aprendido` entra al prompt de ventas + comando `aprende:` por WhatsApp.
