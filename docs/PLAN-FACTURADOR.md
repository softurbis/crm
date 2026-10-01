# Facturador de boletas y facturas — el plan

> Escrito el **1 oct 2026**. Decisión del dueño: **directo a SUNAT** (emisor propio,
> sin proveedor), "como en El Cholao". Cada proyecto factura con el RUC de SU dueño.

> **Estado al 1 oct 2026 (noche):** fases 1, 2 y 3 **construidas y probadas** contra el
> ambiente de pruebas de SUNAT (boleta y factura aceptadas, resumen diario, bajas,
> PDF con la marca de quien factura). Falta la fase 4: instalar en el servidor y
> cargar el RUC de Century. Los pasos están en `GUIA-FACTURADOR-PUESTA-EN-MARCHA.md`.
> Lo decidido por el dueño: **exonerado** (Amazonía), series nuevas B001/F001,
> interruptor por proyecto y la marca de cada dueño en su comprobante.

## 1. De dónde partimos

- **El facturador ya existe.** Se construyó en septiembre para el POS de El Cholao
  (`C:\Claude\Projects\POS Cholao\facturador`): arma el XML, lo firma, lo manda a
  SUNAT, lee la constancia (CDR) y guarda todo. Está en producción desde el 7 de
  setiembre con el **Certificado Digital Tributario gratuito de SUNAT** y se escribió
  para reusarse: no sabe qué negocio es, recibe un documento y lo emite.
- **En el CRM** cada cobro (separación, inicial, cuota) guarda su voucher y una
  boleta que hoy se sube a mano, hecha en otro sistema.
- **Cada proyecto** tiene el nombre y el DNI del titular, pero no su RUC, su
  dirección fiscal ni sus series.

## 2. Lo que cambia respecto de El Cholao

| | El Cholao | Urbis |
|---|---|---|
| Quién emite | un solo RUC | **uno por proyecto** (Praderas de Pucallpa, Praderas de Cashibo, Brisas, El Triunfo…): el facturador pasa a llevar varios emisores, cada uno con su certificado, su usuario SOL y sus series |
| Qué se vende | comida, exonerada (Amazonía) | **lotes: operación INAFECTA de IGV** (terreno sin construir). Lo confirma el contador por cada RUC |
| Volumen | ~100 comprobantes al día | decenas al mes por proyecto |
| Papel | ticket de 80 mm | **hoja A4 en PDF**, con QR y código de verificación |
| Dónde corre | servidor del POS | el servidor del CRM (el mismo de la base y los agentes) |

## 3. Cómo va a funcionar

1. La secretaria registra el cobro como hoy y, con el pago validado, presiona
   **Emitir boleta** (con el DNI del cliente) o **Emitir factura** (si pide con RUC).
2. El detalle sale solo: "Cuota 5 de 48 — Lote C-12 — El Triunfo de Neshuya".
3. El servidor firma y envía a SUNAT con el RUC del proyecto de ese lote. El panel
   muestra el estado: aceptada, en proceso o rechazada (con el motivo en castellano).
4. El PDF, el XML firmado y la constancia de SUNAT quedan guardados en el pago:
   reemplaza el "subir la boleta" a mano.
5. Las facturas viajan una por una. **Las boletas viajan en un resumen diario** (al día
   siguiente), automático. Así lo exige SUNAT.
6. Anular: la factura con comunicación de baja o nota de crédito; la boleta en el
   resumen del día. La numeración nunca salta.

## 4. Las fases

### Fase 0 — Trámites (el dueño y el contador). Arranca ya.

Por **cada proyecto / RUC**:

1. **Datos exactos de la ficha RUC:** RUC, nombre o razón social, domicilio fiscal y
   régimen tributario.
2. **Con el contador:** que la venta de lotes va como **inafecta de IGV**; cómo va la
   mora; y si ese dueño puede emitir facturas (en el Nuevo RUS solo boletas).
3. **En SUNAT, con la Clave SOL de ese dueño:**
   - crear un **usuario secundario** para facturación con el perfil
     **"SEE – Del Contribuyente y Envío de Documentos"**. La clave: **máximo 12
     caracteres** (con 13 el portal deja entrar igual, pero el envío falla);
   - generar el **Certificado Digital Tributario** gratuito y bajarlo como archivo
     `.pfx` / `.p12` con su contraseña.
4. **Series:** nuevas para el sistema, B001 (boletas) y F001 (facturas) por cada RUC.
   Las series que empiezan con E son del portal de SUNAT y no se pueden usar aquí.

> El certificado, su contraseña y la Clave SOL **nunca van por el chat**. Se cargan
> en el servidor con un asistente que los pide ahí mismo (no se ven al escribir).

### Fase 1 — El facturador en el servidor del CRM (Claude). No necesita nada del dueño.

- Traer el facturador y convertirlo a **varios emisores** (una carpeta por RUC).
- Agregar la venta de lotes: operación inafecta, con el detalle de la cuota.
- Probar contra el **ambiente de pruebas de SUNAT** (RUC y certificado de juguete):
  una boleta y una factura de una cuota, aceptadas.

### Fase 2 — Emitir desde el cobro (Claude)

- Proyectos → Editar: RUC, razón social, dirección fiscal y series.
- Cola de comprobantes en la base + botón en la ficha del lote + estados de SUNAT.
- El PDF en A4 con QR y código de verificación, guardado en el pago.

### Fase 3 — Boletas del día y anulaciones (Claude)

- Resumen diario automático, con reintentos y aviso por Telegram si algo se rechaza.
- Anulación y nota de crédito. Un cobro anulado avisa si ya tiene comprobante.

### Fase 4 — Producción, de a un proyecto (los dos)

- Primero **un** proyecto, con su certificado y su usuario SOL reales. Una semana
  mirando la bandeja todos los días. Después, los demás.
- Vuelta atrás lista: si algo falla se sigue cobrando igual y se emite después.

### Fase 5 — Contador y cliente (Claude)

- Registro de ventas por proyecto y mes, en Excel.
- Envío del comprobante al cliente por WhatsApp o correo.
- Emisión en lote de los cobros que quedaron sin boleta.

## 5. Lo que puede salir mal

| Riesgo | Cómo se cubre |
|---|---|
| El trato del IGV mal declarado | No se emite en real hasta que el contador lo confirme por cada RUC |
| El certificado gratuito no se puede sacar para algún dueño | Se compra uno a una entidad acreditada (S/ 100 a 300 al año) |
| Clave SOL o perfil mal puestos (pasó en El Cholao) | El asistente prueba la clave contra SUNAT sin emitir nada |
| SUNAT caído o sin internet | El cobro nunca espera: el comprobante queda en cola y sale después |
| Vence un certificado | Aviso por Telegram 30 días antes, por cada RUC |
| SUNAT cambia una regla | Es el costo de ser emisor propio: se corrige en el facturador, una vez, para todos |
| Una boleta rechazada pasa desapercibida | Bandeja de rechazados en el panel y aviso por Telegram |

## 6. Lo que no entra

Guías de remisión, notas de débito, retenciones y percepciones.
