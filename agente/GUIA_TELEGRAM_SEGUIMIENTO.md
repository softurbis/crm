# Agente de seguimiento por Telegram — puesta en marcha

> El canal interno (pases de lista a secretarias, consultas de gerencia,
> recordatorios de visitas al asesor y avisos al admin) sale de WhatsApp y pasa a
> un bot de Telegram: **gratis, ilimitado, sin chip y sin riesgo de baneo**.
> Los mensajes a **clientes y leads siguen por WhatsApp** — ellos no notan nada.

## 1. Crear el bot (2 minutos, lo haces tú)

1. En Telegram, busca **@BotFather** y ábrelo.
2. Envía `/newbot`.
3. Nombre visible: `Urbis Asistente` (el que verá el equipo).
4. Usuario del bot: algo terminado en `bot`, por ejemplo `urbis_asistente_bot`.
5. BotFather responde con un **token** (`123456789:AAE...`).
   ⚠️ Ese token es una llave: **no lo pegues en chats**, va directo al droplet.

Opcional, para que se vea bien: `/setdescription`, `/setuserpic`.

## 2. Ponerlo en el droplet

En la consola del droplet:

```bash
cd /root/crm && git pull
nano agente/.env
```

Agrega al final (pegando tu token de BotFather):

```
TELEGRAM_BOT_TOKEN=123456789:AAE...
```

Guarda (Ctrl+O, Enter, Ctrl+X) y reinicia:

```bash
pm2 restart agente-urbis --update-env && sleep 8 && pm2 logs agente-urbis --lines 15 --nostream
```

Debe aparecer: `TELEGRAM: canal interno escuchando`.

## 3. Correr el SQL

En Supabase → SQL Editor, ejecuta **`sql/48_telegram_seguimiento.sql`**
(crea la tabla `telegram_links` y deja `seguimiento_canal = telegram`).

## 4. Que cada persona se vincule (30 segundos c/u)

Pásale a tu equipo el enlace del bot: `https://t.me/urbis_asistente_bot`
(con el usuario que elegiste). Cada uno:

1. Abre el bot y toca **Iniciar / Start**.
2. Escribe: `/soy 51999888777` — **su número tal como está en el sistema**
   (el que figura en Seguimiento).
3. El bot responde `✅ ¡Listo, <nombre>!` y desde ahí recibe todo por Telegram.

Quien **no** se vincule sigue recibiendo por WhatsApp (si hay sesión conectada).
Es un cambio gradual: no rompe nada mientras el equipo se pasa.

Personas a vincular hoy: Victor Mera, César O'Higgins (gerencia), Alexander Pulgar,
Cami García, José Portocarrero y Dionne.

## Qué puede hacer cada uno desde el bot

| Escribe | Qué pasa |
|---|---|
| `LISTO` | Marca como hechas todas sus actividades del pase de lista |
| `1 3` (números) | Marca solo esas actividades |
| Consultas del sistema | Comandos directos (gratis). Las preguntas libres con IA requieren crédito de OpenAI |
| `/desvincular` | Deja de recibir avisos por Telegram (vuelve a WhatsApp) |
| `/ayuda` | Recuerda estas opciones |

## Detalles que conviene saber

- **No necesita dominio ni webhook**: el bot consulta a Telegram por *long polling*,
  así que funciona aunque el droplet no tenga puertos abiertos.
- Todo lo enviado queda registrado igual en `scheduled_messages` (se ve en el panel),
  con su estado enviado/fallido.
- Si el token falta o es inválido, el agente lo dice en el log y **sigue usando
  WhatsApp** para lo interno: no se cae nada.
- Los recordatorios de visita **al cliente** siguen saliendo por el WhatsApp del
  proyecto (son pocos: 4–5 por semana).
