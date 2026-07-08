# 📖 Biblia del bot de Urbis Group

Todo lo que hace el bot, cómo funciona cada cerebro, qué cobra tokens y qué no, y cada comando. Guárdala o compártela con el equipo.

---

## 🧠 Los cerebros — qué hace cada uno

Los "cerebros" se editan en **WhatsApp del bot → CEREBROS** (mapa radial). Si un cerebro está vacío, el bot usa su versión por defecto.

| Cerebro | Para qué sirve | ¿Cobra tokens (IA)? |
|---|---|---|
| **🧠 VENTAS** | La conversación con leads del público | 💲 Sí (cada respuesta ~$0.005) |
| **📌 REGLAS** (instrucciones) | Ajustes que se suman a VENTAS | 💲 Sí (se suma al prompt de ventas) |
| **🚫 PROHIBIDO** | Lo que el bot NUNCA debe decir al público | 💲 Sí (se suma a ventas) |
| **💡 APRENDIDO** | Datos que le enseñas (`aprende:`), se suman a ventas | 💲 Sí (se suma a ventas) |
| **💵 COBRANZA** | Plantillas de los avisos de cuotas | 🆓 No (plantillas, sin IA) |
| **🗓️ SEGUIMIENTO** (secretaria) | Textos del control de actividades del equipo | 🆓 No (plantillas, sin IA) |
| **🔐 GERENCIA** | Notas internas extra para el Q&A del equipo | 💲 Solo si se usa el Q&A con IA |
| **📁 FICHA por proyecto** | Info de cada proyecto (descripción, cómo llegar, material) | 💲 Se usa en ventas (IA) |

> **Regla de oro:** solo **VENTAS y el Q&A libre** cobran tokens. Todo lo automático (cobranza, seguimiento, recordatorios) y **todos los comandos** son gratis.

---

## 🔀 Cómo decide el bot qué hacer (según el número)

El bot mira cómo está clasificado el número en **📇 NÚMEROS** y hace UNA cosa:

| Tipo de número | Qué hace el bot | ¿Tokens? |
|---|---|---|
| **No registrado** (lead) | Flujo de ventas (si VENTAS está encendido) | 💲 Sí |
| **CLIENTE** | Cobranza; si dice "ya pagué" avisa al admin | 🆓 No |
| **SECRETARIA** | Control de actividades (pasar lista, ¿algo extra?) | 🆓 No |
| **GERENCIA** (Victor, Alex) | Comandos gratis + preguntas libres + `tarea`/`aprende` | 🆓 comandos / 💲 preguntas libres |
| **ADMIN** (tú) | Todo lo de gerencia | igual |
| **ADMINISTRATIVO** | No le responde (solo recibe avisos) | — |
| **SILENCIO TOTAL** | Nunca le escribe ni responde | — |

---

## 🆓 Comandos GRATIS (gerencia y admin)

Escribes **una palabra** → el bot lee la base y responde al instante. **Cero IA, $0.**

| Escribe | Qué te responde |
|---|---|
| `resumen` | 📊 Panorama del día: lotes, ventas, vencidas, comisiones, gastos del mes y visitas — **todo en un mensaje** |
| `lotes` | 🏘️ Disponibles y rango de precios, por proyecto |
| `comisiones` | 💼 Total por cobrar + desglose por asesor |
| `gastos` | 💸 Del año por proyecto y mes |
| `gastos agosto` | 💸 Solo agosto (cualquier mes) |
| `visitas` | 📅 Programadas próximas |
| `vencidas` | ⚠️ Cuotas vencidas por proyecto |
| `ayuda` | 📋 La lista de comandos |

> No importan mayúsculas ni tildes.

Cada respuesta cierra recordando: *"¿Algo más específico? Escríbeme la pregunta en palabras normales — uso IA y cuesta ~$0.005 por consulta."*

---

## 🤝 Comandos de GESTIÓN (ADMIN y GERENCIA)

Disponibles para tu número **ADMIN** y para los **GERENCIA** (Victor, Alex). El bot le responde a quien escribió.

| Escribe | Qué hace | ¿Tokens? |
|---|---|---|
| `tarea <nombre> <fecha/hora> <descripción>` | Crea una tarea para una secretaria. Ej: `tarea cami mañana 10am llevar contratos` · `tarea alexander pedir perdón a candy a las 17:38` | 🆓 No |
| `aprende: <dato>` | Le enseña algo al bot (va al cerebro APRENDIDO, lo usa en ventas al instante). Ej: `aprende: no damos título inmediato` | 🆓 No |

---

## 🤖 Preguntas libres (usan IA — ~$0.005 c/u)

Cuando necesitas algo que **no calza en un comando fijo**, escríbelo en palabras normales. Solo gerencia/admin, y solo si hay **saldo en Anthropic**.

**Ejemplos:**
- *"¿Cuál proyecto conviene para alguien con S/20,000 de inicial?"*
- *"Compárame los precios de los 2 proyectos y dónde hay más margen."*
- *"¿Qué asesor tiene más comisiones sin cobrar y de qué lotes?"*

---

## 🔁 Comando de prueba (cualquier chat)

| Escribe | Qué hace |
|---|---|
| `iniciourbis2026` | Reinicia la conversación de **ese chat** (borra el lead y los mensajes, para probar el flujo de ventas desde cero) |

---

## 💲 Cuánto cuesta la IA

- Modelo: **Claude Haiku 4.5** ($1 por millón de tokens de entrada, $5 de salida).
- Cada respuesta de IA ≈ **medio centavo de dólar** (~$0.005).
- **$5 ≈ ~1,000 respuestas de IA.**
- Recarga en console.anthropic.com; activa **auto-reload** para que nunca se quede en cero.

---

*Última actualización: julio 2026. Los comandos gratis se pueden ampliar (ej. `separaciones`, `ingresos del mes`) — pídeselo a tu desarrollador.*
