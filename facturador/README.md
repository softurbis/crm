# El facturador de Urbis

La pieza que convierte un cobro en una boleta o factura electrónica ante SUNAT,
como **emisor propio** (sin proveedor). Nació en el POS de El Cholao
(`C:\Claude\Projects\POS Cholao\facturador`, en producción desde el 7-set-2026) y
se trajo aquí el 1-oct-2026. El plan completo: `docs/PLAN-FACTURADOR.md`.

## Lo que cambió respecto de El Cholao

- **Varios emisores.** Cada proyecto factura con el RUC de su dueño. Cada pedido
  dice con qué `ruc` se emite; el servicio usa el certificado, el usuario SOL y
  la carpeta de ese RUC. Un emisor mal configurado no tumba a los demás, y
  agregar o corregir uno no pide reiniciar.
- **Lotes, sin IGV.** Cada emisor declara cómo vende (`afectacion_por_defecto`):
  `exonerado` (Amazonía, Ley 27037), `inafecto` o `gravado`.

## Dónde vive cada cosa en el servidor

| | |
|---|---|
| `/opt/facturador` | el código y su entorno de Python |
| `/etc/facturador/servicio.json` | el token (lo lee el agente del CRM) y la carpeta de archivo |
| `/etc/facturador/emisores/<RUC>.json` | los datos de un emisor: razón social, usuario y clave SOL, ambiente |
| `/etc/facturador/emisores/<RUC>.p12` | su certificado digital |
| `/var/lib/facturador/<RUC>/comprobantes/AAAA/MM` | XML firmados y CDR: el respaldo legal |
| `facturador.service` | el servicio, solo en `localhost:8097` |

Nada de eso está en el repositorio: las claves y los certificados se cargan en
el servidor y no salen de ahí.

## Los comandos (en el servidor, como root)

    bash /root/crm/facturador/instalar.sh              # instalar o actualizar
    bash /opt/facturador/agregar-emisor.sh             # cargar o corregir el RUC de un proyecto
    bash /opt/facturador/probar-clave.sh EL_RUC        # probar la Clave SOL sin emitir nada
    bash /opt/facturador/pasar-a-produccion.sh EL_RUC  # de pruebas a producción (a propósito, aparte)
    curl -s http://127.0.0.1:8097/salud                # qué emisores hay y cuándo vence cada certificado

## Probarlo sin nada configurado

    python facturador/probar.py

Usa el RUC de juguete de SUNAT y un certificado autofirmado: emite la boleta y
la factura de una cuota de lote, exoneradas e inafectas, contra el ambiente de
pruebas.

## La API (solo localhost, con `Authorization: Bearer <token>`)

Todos los pedidos llevan `ruc`. `POST /emitir`, `/firmar`, `/enviar`,
`/resumen`, `/anular`, `/ticket`; `GET /salud`. El detalle de cada uno está en
`facturador/emisor.py`.

## Estado

**1-oct-2026.** Varios emisores funcionando; SUNAT (pruebas) acepta boleta y
factura de una cuota de lote, exoneradas e inafectas, con RUC 20 y con RUC 10.
Falta: instalarlo en el servidor, la cola del CRM y el botón en la ficha del
lote, el PDF, el resumen diario de boletas y las anulaciones.
