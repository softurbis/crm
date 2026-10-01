# Facturador — puesta en marcha, paso a paso

> 1 oct 2026. Todo lo de abajo se hace **fuera del horario de atención**. Se empieza
> por **Las Praderas de Pucallpa** (factura **Century Proyectos Inmobiliarios**) y en
> el **ambiente de pruebas** de SUNAT: nada de lo que se emita ahí tiene valor.
> Los demás proyectos (Cashibo, Brisas, El Triunfo) repiten solo los pasos 4 a 8,
> cada uno con el RUC, el certificado y la marca de su dueño.

## Lo que ya está hecho

- El facturador (firma, envío a SUNAT, resumen diario de boletas, bajas) y su cola.
- El panel: botón **🧾 Emitir** en cada pago (ficha del lote y Pagos), pantalla
  **Comprobantes**, y la sección **Boletas y facturas electrónicas** en cada proyecto.
- La hoja A4 con el logo y el color de quien factura, QR y código de verificación.
- Probado contra SUNAT de pruebas: boleta y factura **aceptadas**.

## Los pasos (en este orden)

### 1. La base — tres archivos SQL

```bash
scp "C:\Claude\Projects\Sistema CRM\sql\113_facturador.sql" "C:\Claude\Projects\Sistema CRM\sql\114_rol_operador_valor.sql" "C:\Claude\Projects\Sistema CRM\sql\115_rol_operador.sql" root@157.245.8.78:/root/
```

Cada uno por separado (el 114 y el 115 no pueden ir en la misma corrida):

```bash
ssh root@157.245.8.78 '. /root/urbis-supabase-claves.txt; PGPASSWORD=$POSTGRES_PASSWORD psql -X -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -f /root/113_facturador.sql'
```

```bash
ssh root@157.245.8.78 '. /root/urbis-supabase-claves.txt; PGPASSWORD=$POSTGRES_PASSWORD psql -X -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -f /root/114_rol_operador_valor.sql'
```

```bash
ssh root@157.245.8.78 '. /root/urbis-supabase-claves.txt; PGPASSWORD=$POSTGRES_PASSWORD psql -X -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -f /root/115_rol_operador.sql'
```

### 2. El agente (trae la cola de comprobantes)

```bash
scp "C:\Claude\Projects\Sistema CRM\migracion\07_actualizar_agente.sh" root@157.245.8.78:/root/ ; ssh root@157.245.8.78 'bash /root/07_actualizar_agente.sh'
```

### 3. El facturador en el servidor

```bash
scp "C:\Claude\Projects\Sistema CRM\migracion\12_facturador_instalar.sh" root@157.245.8.78:/root/ ; ssh root@157.245.8.78 'bash /root/12_facturador_instalar.sh'
```

Termina con una prueba contra SUNAT (datos de juguete). Tiene que decir **LISTO**.

### 4. Cargar el RUC de Century (certificado y clave SOL)

Primero el certificado al servidor (el archivo `.pfx` / `.p12` que bajaste de SUNAT):

```bash
scp "RUTA\DEL\CERTIFICADO.pfx" root@157.245.8.78:/root/certificado-century.pfx
```

Después el asistente. Pide el RUC (**20608484273**), la razón social, **exonerado**
(confirmado por el dueño el 1 oct: igual que El Cholao), el usuario secundario
(el que creaste con el perfil de facturación), su clave y la contraseña del
certificado. **Lo que escribas no se ve en pantalla y no pasa por el chat.**

```bash
ssh -t root@157.245.8.78 'bash /opt/facturador/agregar-emisor.sh'
```

Recuerda: la clave SOL del usuario secundario, **máximo 12 caracteres**.

### 5. En el panel: decir quién factura

Proyectos → Las Praderas de Pucallpa → **Boletas y facturas electrónicas → Configurar**:
RUC **20608484273**, razón social, domicilio fiscal, series **B001 / F001**, subir el **logo de Century**,
elegir el **color rojo** y marcar **Usar el facturador en este proyecto**.

A los 2 minutos la misma ficha dice **"En pruebas"**: el servidor ya tiene ese RUC.

### 6. Probar (y grabar el video de ejemplo)

En la ficha de un lote → Pagos y documentos → **🧾 Emitir** → boleta. Después otra
como factura. Salen con la marca **PRUEBA — SIN VALOR** y no se ponen como boleta
del pago.

### 7. Borrar las pruebas

```bash
scp "C:\Claude\Projects\Sistema CRM\sql\116_borrar_comprobantes_de_prueba.sql" root@157.245.8.78:/root/ ; ssh root@157.245.8.78 '. /root/urbis-supabase-claves.txt; PGPASSWORD=$POSTGRES_PASSWORD psql -X -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -f /root/116_borrar_comprobantes_de_prueba.sql'
```

### 8. Pasar a real

```bash
ssh -t root@157.245.8.78 'bash /opt/facturador/pasar-a-produccion.sh 20608484273'
```

Desde ahí la numeración empieza en **B001-1 / F001-1** y todo tiene valor.

## Cómo funciona en el día a día

| | |
|---|---|
| **Boleta** | Se firma al instante: el cliente se la lleva (PDF con QR). A SUNAT se le informa sola, en el resumen del **día siguiente**. |
| **Factura** | Viaja sola a SUNAT y contesta en segundos. |
| **Si SUNAT está caído** | El cobro nunca espera: el comprobante queda en cola y sale solo. |
| **Rechazada** | Aviso por Telegram + queda en *Comprobantes → Rechazados*. Se emite otra desde el pago. |
| **Anular** | Desde el comprobante → *Anular* (administrador), con motivo. Hasta 7 días. El pago no se borra. |
| **Pago con boleta** | No se puede borrar ni cambiarle el monto: primero se anula la boleta. |
| **Apagar** | Proyectos → Configurar → desmarcar. Vuelve a subirse la boleta a mano. |

## Emitir al cobrar y enviar por WhatsApp (1 oct 2026)

- Al terminar un cobro en la ficha, la misma ventana ofrece **🧾 Emitir boleta o factura**: no hay que ir a buscar el pago.
- Con el comprobante emitido aparece **📲 Enviar al cliente por WhatsApp**, con el celular de su ficha ya puesto (se puede escribir otro).
  - Si el proyecto tiene **su** WhatsApp conectado en el sistema: botón **Enviar**, sale solo con el PDF adjunto (hace falta `sql/123` y actualizar el agente con el `07`).
  - Si no lo tiene (hoy: Las Praderas de Pucallpa): botón **Abrir WhatsApp**, se abre el WhatsApp de quien cobra con el mensaje y el enlace del PDF ya escritos.
  - Una boleta **nunca** sale por el número de otro proyecto: cada proyecto es independiente.
- **Pagos** y **Boletas y facturas** son una sola entrada del menú con dos pestañas. En cada comprobante se ve su pago.
- **Anular** no borra el pago: lo deja sin comprobante para emitirle otro. Y un pago con comprobante vigente no se puede borrar ni cambiar de monto: primero se anula.

```bash
scp "C:\Claude\Projects\Sistema CRM\sql\123_comprobante_por_whatsapp.sql" root@157.245.8.78:/root/ ; ssh root@157.245.8.78 '. /root/urbis-supabase-claves.txt; PGPASSWORD=$POSTGRES_PASSWORD psql -X -1 -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres -f /root/123_comprobante_por_whatsapp.sql'
```

## El rol Operador (para las secretarias)

Con el 114 y el 115 corridos: Usuarios → cambiarle el rol a **Operador**. Trabaja
como el superusuario (corrige, migra, edita, plantillas, comisiones, dashboard)
pero **no ve** Usuarios, Bitácora, Corretaje, Campañas, la configuración de
WhatsApp ni los agentes IA. Además, desde el 115 **nadie puede cambiarse su
propio rol** ni editar la ficha de otra persona: solo el superusuario.
