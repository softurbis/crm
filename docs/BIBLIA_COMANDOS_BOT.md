# 📖 Biblia de comandos del bot — Urbis Group

Guía de todo lo que puedes escribirle al bot por WhatsApp. Guárdala o compártela con el equipo.

---

## 🆓 Comandos GRATIS (gerencia y admin)

Escribes **una palabra** y el bot lee la base de datos y responde al instante. **No usan IA → cuesta $0.**
Solo funcionan desde números clasificados como **GERENCIA** o el número **ADMIN**.

| Escribe | Qué te responde |
|---|---|
| `resumen` | 📊 Panorama del día: lotes disponibles, ventas, cuotas vencidas, comisiones por cobrar, gastos del mes y próximas visitas — **todo en un mensaje** |
| `lotes` | 🏘️ Lotes disponibles y rango de precios, por proyecto |
| `comisiones` | 💼 Total de comisiones por cobrar + desglose por asesor |
| `gastos` | 💸 Gastos del año por proyecto y mes |
| `gastos agosto` | 💸 Gastos solo de agosto (puedes poner cualquier mes) |
| `visitas` | 📅 Visitas programadas próximas (fecha, hora, cliente, proyecto) |
| `vencidas` | ⚠️ Cuotas vencidas por proyecto (cantidad y monto) |
| `ayuda` | 📋 La lista de comandos disponibles |

> No importan mayúsculas ni tildes: `Gastos`, `gastos`, `GASTOS AGOSTO` funcionan igual.

**Ejemplo — escribes `resumen`, recibes:**
```
📊 RESUMEN — 07/07/2026

🏘️ Lotes: 104 disponibles · 124 vendidos
💰 Ventas: 173 en proceso · 43 pagadas
⚠️ Vencidas: 38 cuotas · S/ 45,200
💼 Comisiones por cobrar: S/ 12,800
💸 Gastos del mes: S/ 3,450
📅 Próximas visitas: 2 (sig: 08/07 10:00 Juan Pérez)
```

---

## 🤖 Preguntas libres (usan IA — cuesta ~$0.005 c/u)

Cuando necesitas algo que **no calza en un comando fijo**, escríbelo en palabras normales. El bot usa la IA (Claude) para entender y responder con los datos reales. Cada pregunta cuesta **medio centavo de dólar** (~$0.005). Solo gerencia/admin.

**Ejemplos de preguntas libres:**
- *"¿Cuál proyecto conviene para alguien con S/ 20,000 de inicial?"*
- *"Compárame los precios de los 2 proyectos y dime dónde hay más margen."*
- *"¿Qué asesor tiene más comisiones sin cobrar y de qué lotes?"*
- *"¿Cuánto gastamos en desarrollo vs administrativo este año?"*

> El bot solo puede responder con IA si hay **saldo en la cuenta de Anthropic**. Los comandos gratis funcionan siempre.

---

## 🧠 Comandos del ADMIN (solo tu número)

| Escribe | Qué hace |
|---|---|
| `aprende: <dato>` | Le enseña algo al bot (se guarda en el cerebro APRENDIDO y lo usa en ventas al instante). Ej: `aprende: no damos título inmediato` |
| `tarea <nombre> <fecha/hora> <descripción>` | Crea una tarea para una secretaria. Ej: `tarea cami mañana 10am llevar contratos` |

---

## 🔁 Comandos de prueba (cualquier chat)

| Escribe | Qué hace |
|---|---|
| `iniciourbis2026` | Reinicia la conversación de **ese chat** (borra el lead y los mensajes, para probar el flujo de ventas desde cero) |

---

## 👥 Cómo se comporta el bot según el número

El bot mira cómo está clasificado cada número (en 📇 NÚMEROS del panel) y hace UNA cosa:

| Tipo de número | Qué hace el bot |
|---|---|
| **No registrado** (lead) | Flujo de ventas con IA (si VENTAS está encendido) |
| **CLIENTE** | Cobranza automática; si dice "ya pagué" avisa al admin |
| **SECRETARIA** | Control de actividades (pasar lista, ¿algo extra?) |
| **GERENCIA** | Comandos gratis + preguntas libres con IA |
| **ADMIN** (tú) | Todo lo de gerencia + `aprende:` + `tarea` |
| **ADMINISTRATIVO** | El bot no le responde (solo recibe avisos) |
| **SILENCIO TOTAL** | El bot nunca le escribe ni responde |

---

*Última actualización: julio 2026. Los comandos gratis se pueden ampliar — pídele a tu desarrollador agregar `separaciones`, `ingresos del mes`, etc.*
