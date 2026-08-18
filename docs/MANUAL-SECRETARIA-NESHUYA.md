# Guía para completar EL TRIUNFO DE NESHUYA

_Para la secretaria · Actualizado el 18 de agosto de 2026_

---

## Antes de empezar, lo que tienes que saber

La plata **ya está cuadrada**: los 218 pagos por S/ 116,678.02 están todos cargados y
verificados. Lo que falta son **contratos y cronogramas**, no dinero.

Para esta tanda vas a entrar con el **usuario superusuario**, porque algunas correcciones
solo están permitidas con ese permiso.

### Las tres reglas que no se rompen

1. **El contrato manda sobre la lista de precios.** Si el contrato dice S/ 42,500 y la lista
   dice S/ 50,000, se carga **42,500**. Ya está decidido, no hay que consultarlo cada vez.
2. **Nunca inventes un dato.** Si el contrato no se lee, **no adivines**: deja el lote
   pendiente y anótalo. Un dato inventado es peor que un dato faltante, porque nadie lo va a
   volver a revisar.
3. **Todo cambio pide un motivo.** Escríbelo de verdad ("contrato físico MZ A LT 19 firmado
   el 12/05/2026"), no "corrección". Ese texto queda en la bitácora y es lo que te respalda
   si alguien pregunta dentro de seis meses.

### Cómo entrar

1. `softurbis.github.io/crm` → entra con el usuario superusuario.
2. Arriba a la derecha, **elige el proyecto EL TRIUNFO DE NESHUYA**. Todo lo de esta guía se
   hace con ese proyecto seleccionado.

---

## TAREA 1 — La más rápida y la más importante (5 minutos)

Faltan las **constancias de pago** de tres depósitos grandes. Son el **87% de la plata de
Neshuya sin respaldo documental**:

| Lote | Monto |
|---|---|
| B‑18 | S/ 13,900 |
| D‑4 | S/ 9,000 |
| D‑17 | S/ 3,600 |

**Qué hacer:**

1. Menú izquierdo → **ADMINISTRACIÓN → MIGRACIÓN**.
2. Arrastra **la misma carpeta de Neshuya** del Drive (completa, tal cual).
3. El sistema te va a mostrar los archivos que reconoce y **cuáles necesitan tu visto bueno**.
4. Revisa los que aparezcan marcados y acéptalos.

> **No duplica nada.** Lo que ya tiene archivo no se toca; solo engancha lo que quedó suelto.
> Puedes soltar la carpeta las veces que quieras.

---

## TAREA 2 — Diez ventas sin cronograma

Estos lotes están vendidos y el cliente paga, pero **el sistema no sabe qué cuotas le tocan**.
No se les puede cobrar y no aparecen en la lista de morosos.

**A‑11 · A‑14 · A‑19 · C‑2 · D‑9 · E‑9 · E‑10 · E‑13 · G‑2 · H‑10**

### Lo que necesitas del contrato físico

Antes de tocar el sistema, ten a la mano **cuatro datos**:

- Precio total
- Cuota inicial
- En cuántas cuotas (normalmente 48)
- **Fecha de vencimiento de la cuota 1**

### Paso a paso

1. **LOTES** → busca el lote (ej. A‑19) → clic para abrir su ficha.
2. Baja hasta **CRONOGRAMA DE CUOTAS (0)**.
3. Clic en **📅 Generar cronograma**.
4. Te muestra el precio, la inicial y **cuánto queda por financiar**. Verifica que coincida
   con el contrato. **Si no coincide, cancela** y primero corrige el precio (ver Tarea 5).
5. Escribe **en cuántas cuotas** (del contrato).
6. Escribe la **fecha de la cuota 1** en formato `2026-09-30` (año‑mes‑día).
7. Escribe **de dónde sacaste los datos**. Ejemplo: `contrato físico MZ A LT 19 firmado el
   12/05/2026`.
8. Confirma. Te va a decir cuántas cuotas creó y hasta qué fecha llegan.

### Después de crear el cronograma, verifica

- La **cuota 1** coincide en monto y fecha con el contrato.
- La **última cuota** cae en la fecha que dice el contrato.
- El **total** de las cuotas es igual al saldo financiado.

> La última cuota puede salir con unos céntimos de diferencia respecto de las demás. **Es
> correcto**: absorbe el redondeo para que la suma cuadre exacta.

Si el cliente ya pagó cuotas, esos pagos **ya están en caja** y se van a acomodar solos
contra el cronograma nuevo.

---

## TAREA 3 — Nueve lotes vendidos sin venta creada

**A‑17 · A‑20 · B‑5 · C‑6 · C‑8 · E‑6 · E‑8 · E‑15 · F‑13**

El lote figura vendido y **hay plata suya en caja**, pero la venta no existe porque no se
pudo leer el contrato. **No son todos el mismo caso** — primero clasifícalos:

| Lote | Situación | Qué hacer |
|---|---|---|
| **A‑17** | Carpeta del Drive **vacía**. Dice *"COMPRADO X REGULARIZAR (CLIENTA DR. MACEDO)"* | Puede que el contrato **no exista aún**. Averiguar antes de cargar nada |
| **B‑5** | Carpeta vacía, dice *"SEPARACIÓN"* | Probablemente **nunca se firmó contrato**. Confirmar si es solo separación |
| **A‑20** | Contrato escaneado sin texto | Se lee a ojo del papel |
| **C‑6, C‑8** | Contrato existe pero es escaneo | Se lee a ojo del papel |
| **E‑6, E‑8, E‑15, F‑13** | Separaciones o iniciales sueltas | Verificar si llegaron a firmar |

### Si el contrato existe: crear la venta

1. Anota del contrato: **cliente, precio, inicial, plazo y fecha de firma**.
2. Menú → **PAGOS** → tipo **INICIAL**.
3. Elige el lote y el cliente.
4. **Pon la fecha real del contrato**, no la de hoy.
5. Escribe el precio, la inicial y el plazo.
6. Adjunta el voucher de esa inicial.
7. Guardar. Eso crea **la venta y el cronograma completo de una sola vez**.

### ⚠️ Ojo con esto, es lo más delicado de toda la guía

Esos lotes **ya tienen pagos cargados** (la lista está en la Tarea 4). Al registrar la
inicial, esa plata puede quedar **contada dos veces**.

**Después de crear la venta, abre la ficha del lote y mira el desglosado:**

- Si ves **el mismo pago dos veces** (misma fecha, mismo monto), borra el viejo: el que no
  tiene venta asociada. Se borra desde **PAGOS**, buscando ese pago → **ELIMINAR PAGO**.
- Antes de borrar, **fíjate cuál de los dos tiene el voucher**. Si el viejo lo tiene y el
  nuevo no, sube el voucher al nuevo **antes** de borrar el viejo.

> **Si tienes cualquier duda, para y pregunta.** Un pago borrado por error es plata que
> desaparece del estado de cuenta de un cliente. Es preferible dejarlo pendiente un día más.

---

## TAREA 4 — Los 15 pagos sin venta (S/ 4,000)

Estos pagos **ya tienen dueño** pero no aparecen en el estado de cuenta de nadie, porque su
venta no existe. **Se resuelven solos** cuando completes la Tarea 3.

| Fecha | Monto | Lote | Cliente |
|---|---|---|---|
| 24/05 | S/ 100 | C‑14 | Jackeline del Águila Aventura |
| 31/05 | S/ 50 | F‑13 | Julio Fidel Torbisco Cesinario |
| 31/05 | S/ 50 | E‑6 | Osting Renato Román del Águila |
| 05/06 | S/ 50 | E‑15 | Carlos Palomino Huamaní |
| 06/06 | S/ 50 | E‑14 | Alí Ayay Alarcón |
| 14/06 | S/ 50 | B‑5 | David Reátegui Saldaña |
| 14/06 | S/ 50 | A‑20 | Liz Ignacia Albornoz Chamorro |
| **20/06** | **S/ 1,950** | **A‑20** | **Liz Ignacia Albornoz Chamorro** |
| 25/06 | S/ 500 | C‑8 | Luisa Reátegui Sánchez |
| 29/06 | S/ 450 | E‑15 | Carlos Palomino Huamaní |
| 04/07 | S/ 50 | C‑4 | Dalmith Shuna Ishuisa |
| 04/07 | S/ 50 | E‑8 | Dalmith Shuña Ishuisa |
| 04/07 | S/ 500 | C‑6 | Mark Antoni Quinteros Silvano |
| 06/07 | S/ 50 | E‑17 | Nilda López Tuesta |
| 06/07 | S/ 50 | E‑20 | Celene María Torres López |

> **Dalmith Shuna** y **Dalmith Shuña** son **la misma persona**, escrita de dos formas, con
> dos pagos el mismo día (C‑4 y E‑8). Al crear sus ventas, **usa un solo cliente** para los
> dos lotes o te van a quedar dos fichas de la misma persona.

---

## TAREA 5 — Correcciones sueltas

### Corregir el precio de una venta

**LOTES** → ficha del lote → **Ajuste de precio** → escribe el nuevo precio y el motivo.

El sistema reparte el saldo entre las cuotas **pendientes**; las ya pagadas no se tocan.
Antes de confirmar te muestra cuánto queda por cuota: **si ese número no se parece al del
contrato, cancela** y revisa.

### Corregir una fecha (venta o entrega)

En la ficha del lote, al lado de la fecha hay un **✎**. Clic, escribe la fecha correcta.

### Corregir una cuota puntual (monto o fecha)

En el cronograma, cada cuota se edita en su fila. Úsalo cuando **una sola** cuota está mal.

### Falta una cuota en medio (ej. está la 10 y la 12, falta la 11)

Cronograma → **➕ Insertar cuota faltante**. Crea solo esa, no toca las demás.

### Las cuotas no cuadran con lo pagado

Cronograma → **⚖️ Recuadrar cuotas**. Reparte lo ya pagado entre las cuotas en orden, sin
tocar los pagos de caja. Te muestra los cambios **antes** de aplicarlos: léelos.

### Subir el contrato firmado

Ficha del lote → sección de documentos → subir el PDF. Faltan **3 contratos** por subir.

### Un pago que entró y no está registrado

**PAGOS** → tipo **CUADRE** (solo aparece con superusuario). Ahí el voucher es opcional,
porque es para regularizar plata vieja. **Escribe siempre de dónde sale ese pago.**

---

## Orden recomendado de trabajo

1. **Tarea 1** (Migración) — 5 minutos, y es lo que más respalda la plata.
2. **Tarea 2** (los 10 cronogramas) — con los contratos a la mano, uno por uno.
3. **Tarea 3** (las 9 ventas) — primero clasifica, después carga. Lo más delicado.
4. **Tarea 5** — las correcciones que vayan saliendo en el camino.

Ve marcando en esta lista lo que termines. Al final deberían quedar en cero:

- [ ] Constancias de B‑18, D‑4 y D‑17 enganchadas
- [ ] A‑11 · A‑14 · A‑19 · C‑2 · D‑9 · E‑9 · E‑10 · E‑13 · G‑2 · H‑10 con cronograma
- [ ] A‑17 · A‑20 · B‑5 · C‑6 · C‑8 · E‑6 · E‑8 · E‑15 · F‑13 resueltos o justificados
- [ ] Los 15 pagos sueltos enganchados a su venta
- [ ] Los 3 contratos firmados subidos
- [ ] Dalmith Shuna/Shuña unificada en un solo cliente

---

## Cómo saber si vas bien

Le puedes preguntar al bot por **Telegram**, escribiendo:

```
estado de migración
```

Te responde con el conteo por proyecto y **qué falta en cada uno**. Es la misma información
de esta guía, actualizada al momento. Cuando Neshuya diga **"Sin pendientes de carga"**,
terminaste.

---

## Lo que NO debes hacer

- **No borrar un pago** sin estar segura de que está duplicado.
- **No inventar** precios, fechas ni plazos que el contrato no dice.
- **No cambiar** un precio "para que cuadre": si no cuadra, es que falta un dato.
- **No crear un cliente nuevo** si la persona ya existe con el nombre escrito distinto.
- **No dejar el motivo en blanco** ni poner "corrección": escribe de dónde sacaste el dato.
