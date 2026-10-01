# -*- coding: utf-8 -*-
"""
LOS DOCUMENTOS QUE NO SON UNA VENTA: EL RESUMEN Y LA BAJA.

=============================================================================
POR QUÉ EXISTE ESTE ARCHIVO
=============================================================================
Una factura viaja sola: se manda, SUNAT contesta al toque con su CDR y listo.

Las BOLETAS no. En producción no se mandan de a una: van todas juntas en un
**resumen diario** (documento RC), un envío por día con todas las boletas de esa
jornada adentro. Con ~100 boletas diarias eso es un envío en vez de cien.

Y anular tampoco es borrar. Un comprobante que SUNAT ya aceptó existe: para
deshacerlo hay que decírselo.

  · una BOLETA se anula dentro del resumen, marcándola con condición 3;
  · una FACTURA necesita su propia **comunicación de baja** (documento RA).

=============================================================================
LA DIFERENCIA QUE CAMBIA EL DISEÑO: ESTO ES ASINCRÓNICO
=============================================================================
`sendBill` (facturas) contesta el CDR en el mismo viaje. `sendSummary` (resumen
y baja) contesta **un ticket** — un número de trámite— y el CDR hay que ir a
buscarlo después con `getStatus`.

Eso obliga a que el comprobante tenga un estado más: *mandado, esperando
respuesta*. No es un detalle de implementación; es la razón por la que la cola
del POS necesita un segundo pase que pregunte por los tickets.

=============================================================================
ESTADO — LO QUE ESTÁ PROBADO Y LO QUE NO (7-set-2026)
=============================================================================
El documento pasa el esquema de SUNAT y pasa la verificación de firma. Eso no
es una suposición: se llegó ahí corrigiendo DOS rechazos de contenido que SUNAT
solo puede dar después de abrir, validar y verificar el archivo —

  · 2346  el identificador lleva la fecha de GENERACIÓN, no la de las boletas
  · 2278  el bloque de IGV va SIEMPRE, aunque el negocio venda todo exonerado

Lo que todavía NO pasa es el último paso: SUNAT devuelve
`0135 / Encolar archivo Error (2059)` — no pudo poner el archivo en su cola.

Ese error se comporta como del AMBIENTE y no del documento:
  · le pasa igual al resumen (RC) y a la baja (RA), que son dos documentos
    distintos con el mismo mecanismo de envío;
  · en la MISMA sesión, con las mismas credenciales y el mismo certificado, una
    factura por `sendBill` se acepta con código 0;
  · no cambia al cambiar el correlativo, así que no es un identificador repetido.

La hipótesis con la que se sigue: el RUC de pruebas 20000000001 lo comparte todo
el que integra en Perú, y la cola de resúmenes es por RUC. Se despeja el día que
se pruebe en beta CON EL RUC Y EL CERTIFICADO DEL NEGOCIO — y por eso ese es el
próximo paso, antes de construir el lado del POS encima.

=============================================================================
LA NUMERACIÓN DEL RESUMEN NO ES LA DE LAS BOLETAS
=============================================================================
El resumen tiene su propio correlativo por día: RC-20260907-1 es el primer
resumen del 7 de setiembre. Si un día hay que mandar un segundo (llegaron
boletas tarde), es el -2. Repetir el mismo identificador es un envío duplicado.
"""
import datetime as dt

from .dinero import EXONERADO, GRAVADO, INAFECTO, dos

# Catálogo 51 / instrucción del resumen: cómo se declara cada importe.
INSTRUCCION = {
    GRAVADO: "01",
    EXONERADO: "02",
    INAFECTO: "03",
}

TRIBUTO = {
    GRAVADO: ("1000", "IGV", "VAT"),
    EXONERADO: ("9997", "EXO", "VAT"),
    INAFECTO: ("9998", "INA", "FRE"),
}

# Estado de cada documento dentro del resumen (catálogo 19).
ADICIONAR = "1"   # boleta nueva
MODIFICAR = "2"   # corrección de una ya informada
ANULAR = "3"      # se da de baja


def _cdata(texto):
    limpio = ("" if texto is None else str(texto)).replace("]]>", "]]&gt;")
    return "<![CDATA[" + limpio + "]]>"


def _cabecera_firma(cfg):
    """El bloque de firma del UBL, igual en los tres tipos de documento."""
    return f"""  <cac:Signature>
    <cbc:ID>SignatureSP</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification>
        <cbc:ID>{cfg.ruc}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>{_cdata(cfg.razon_social)}</cbc:Name>
      </cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference>
        <cbc:URI>#SignatureSP</cbc:URI>
      </cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:AccountingSupplierParty>
    <cbc:CustomerAssignedAccountID>{cfg.ruc}</cbc:CustomerAssignedAccountID>
    <cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>{_cdata(cfg.razon_social)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>"""


def _linea_resumen(n, b, moneda):
    """
    Una boleta dentro del resumen.

    `b` es {serie, numero, total, gravadas, exoneradas, inafectas, igv,
    condicion, cliente_tipo_doc, cliente_numero}.

    Solo se declara la base que existe: informar S/ 0.00 de gravadas cuando el
    negocio vende todo exonerado es decir algo que no pasó.
    """
    pagos = []
    for clave in (GRAVADO, EXONERADO, INAFECTO):
        monto = b.get(clave, 0)
        if float(monto) > 0:
            pagos.append(f"""    <sac:BillingPayment>
      <cbc:PaidAmount currencyID="{moneda}">{dos(monto)}</cbc:PaidAmount>
      <cbc:InstructionID>{INSTRUCCION[clave]}</cbc:InstructionID>
    </sac:BillingPayment>""")

    # EL BLOQUE DE IGV VA SIEMPRE, AUNQUE SEA CERO.
    #
    # En el comprobante solo se declaran las bases que existen —informar S/ 0
    # de gravadas cuando no hubo ninguna es decir algo que no pasó—. En el
    # RESUMEN es al revés: SUNAT (error 2278) exige "información acerca del
    # importe total de IGV/IVAP" en cada línea, exista o no. Vendiendo todo
    # exonerado ese importe es 0.00, y hay que decirlo igual.
    #
    # Son dos reglas opuestas para el mismo dato y no es un descuido: el
    # comprobante describe una venta, el resumen llena un formulario.
    impuestos = []
    for clave in (GRAVADO, EXONERADO, INAFECTO):
        if clave != GRAVADO and float(b.get(clave, 0)) <= 0:
            continue
        tid, tnombre, ttipo = TRIBUTO[clave]
        monto = b.get("igv", 0) if clave == GRAVADO else 0
        impuestos.append(f"""      <cac:TaxSubtotal>
        <cbc:TaxAmount currencyID="{moneda}">{dos(monto)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:ID>{tid}</cbc:ID>
            <cbc:Name>{tnombre}</cbc:Name>
            <cbc:TaxTypeCode>{ttipo}</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>""")

    doc = "%s-%s" % (b["serie"], b["numero"])
    # El cliente de cada boleta (formato 1.1). Sin documento —consumidor
    # final— va tipo "0" y "-", que es como SUNAT nombra "sin documento".
    cli_tipo = str(b.get("cliente_tipo_doc") or "0")
    cli_num = str(b.get("cliente_numero") or "-")
    return f"""  <sac:SummaryDocumentsLine>
    <cbc:LineID>{n}</cbc:LineID>
    <cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>
    <cbc:ID>{doc}</cbc:ID>
    <cac:AccountingCustomerParty>
      <cbc:CustomerAssignedAccountID>{cli_num}</cbc:CustomerAssignedAccountID>
      <cbc:AdditionalAccountID>{cli_tipo}</cbc:AdditionalAccountID>
    </cac:AccountingCustomerParty>
    <cac:Status>
      <cbc:ConditionCode>{b.get('condicion', ADICIONAR)}</cbc:ConditionCode>
    </cac:Status>
    <sac:TotalAmount currencyID="{moneda}">{dos(b['total'])}</sac:TotalAmount>
{chr(10).join(pagos)}
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="{moneda}">{dos(b.get('igv', 0))}</cbc:TaxAmount>
{chr(10).join(impuestos)}
    </cac:TaxTotal>
  </sac:SummaryDocumentsLine>"""


def armar_resumen(cfg, fecha_boletas, correlativo, boletas, moneda="PEN"):
    """
    El resumen diario de boletas (RC).

    `fecha_boletas` es el día al que corresponden; el resumen se manda al día
    siguiente o el mismo día, y las dos fechas van en el documento porque SUNAT
    las distingue.
    """
    hoy = dt.date.today().isoformat()
    # EL IDENTIFICADOR LLEVA LA FECHA DE HOY, NO LA DE LAS BOLETAS.
    # SUNAT (error 2346): "la fecha de generación del resumen debe ser igual a
    # la fecha consignada en el nombre del archivo". O sea que RC-20260907-1 es
    # el primer resumen GENERADO el 7 — las boletas que lleva adentro pueden
    # ser del 6, y eso se dice en `cbc:ReferenceDate`.
    identificador = "RC-%s-%s" % (hoy.replace("-", ""), correlativo)
    lineas = "\n".join(
        _linea_resumen(i + 1, b, moneda) for i, b in enumerate(boletas)
    )

    return identificador, f"""<?xml version="1.0" encoding="UTF-8"?>
<SummaryDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1"
                  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
                  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
                  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
                  xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.1</cbc:CustomizationID>
  <cbc:ID>{identificador}</cbc:ID>
  <cbc:ReferenceDate>{fecha_boletas}</cbc:ReferenceDate>
  <cbc:IssueDate>{hoy}</cbc:IssueDate>
{_cabecera_firma(cfg)}
{lineas}
</SummaryDocuments>
"""


def armar_baja(cfg, fecha_documentos, correlativo, documentos, motivo):
    """
    La comunicación de baja (RA) — para dar de baja facturas ya aceptadas.

    `documentos` es [{tipo_codigo, serie, numero}]. El motivo es obligatorio y
    lo lee una persona en SUNAT: "error en el RUC del cliente" sirve, "anulado"
    no dice nada.
    """
    hoy = dt.date.today().isoformat()
    # Misma regla que el resumen: la fecha del identificador es la de HOY.
    identificador = "RA-%s-%s" % (hoy.replace("-", ""), correlativo)

    lineas = []
    for i, d in enumerate(documentos, 1):
        lineas.append(f"""  <sac:VoidedDocumentsLine>
    <cbc:LineID>{i}</cbc:LineID>
    <cbc:DocumentTypeCode>{d['tipo_codigo']}</cbc:DocumentTypeCode>
    <sac:DocumentSerialID>{d['serie']}</sac:DocumentSerialID>
    <sac:DocumentNumberID>{d['numero']}</sac:DocumentNumberID>
    <sac:VoidReasonDescription>{_cdata(motivo)}</sac:VoidReasonDescription>
  </sac:VoidedDocumentsLine>""")

    return identificador, f"""<?xml version="1.0" encoding="UTF-8"?>
<VoidedDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1"
                 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
                 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
                 xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
                 xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.0</cbc:CustomizationID>
  <cbc:ID>{identificador}</cbc:ID>
  <cbc:ReferenceDate>{fecha_documentos}</cbc:ReferenceDate>
  <cbc:IssueDate>{hoy}</cbc:IssueDate>
{_cabecera_firma(cfg)}
{chr(10).join(lineas)}
</VoidedDocuments>
"""
