# -*- coding: utf-8 -*-
"""
EL XML — UBL 2.1 como lo quiere SUNAT.

Factura y boleta son el MISMO documento `Invoice`; cambia el código de tipo
(01 / 03) y cómo se identifica al cliente. Por eso hay una sola plantilla y no
dos: dos plantillas casi iguales se desincronizan al tercer cambio.

TRES COSAS QUE COSTARON Y ESTÁN ACÁ POR ESO
===========================================
1. **El orden de los elementos no es libre.** UBL 2.1 lo fija y SUNAT valida
   contra el esquema. `cac:PaymentTerms` puesto antes del emisor devolvió un
   0306 "no se puede parsear"; el mismo bloque después del cliente pasó. Si hay
   que agregar algo, va en su lugar del esquema, no donde quede cómodo.

2. **`cac:PaymentTerms` es obligatorio.** Sin él, SUNAT contesta 3244 "debe
   consignar la información del tipo de transacción". Es la forma de pago, y es
   obligatoria desde la RS 193-2020.

3. **Exonerado no es "IGV cero".** El negocio está en Pucallpa y vende bajo la
   exoneración de la Amazonía (Ley 27037). SUNAT quiere eso declarado como
   operación EXONERADA —afectación 20, tributo 9997 EXO— y el total exonerado
   va en su propio `cac:TaxSubtotal`, aparte del gravado. Un comprobante
   exonerado mandado como gravado con importe cero está mal declarado.

El hueco `<ext:ExtensionContent/>` va vacío a propósito: es donde entra la
firma, y tiene que existir ya al momento de firmar. Ver `firma.py`.
"""
from .dinero import EXONERADO, GRAVADO, INAFECTO, dos

# Catálogo 06 de SUNAT — tipo de documento de identidad del cliente.
DOC_RUC = "6"
DOC_DNI = "1"
DOC_SIN = "0"

# Catálogo 01 — tipo de comprobante.
TIPO_FACTURA = "01"
TIPO_BOLETA = "03"

# Los tributos como los nombra SUNAT en el total del comprobante.
TRIBUTO_TOTAL = {
    GRAVADO:   ("1000", "IGV", "VAT"),
    EXONERADO: ("9997", "EXO", "VAT"),
    INAFECTO:  ("9998", "INA", "FRE"),
}


def _cdata(texto):
    """SUNAT recibe nombres con ñ, tildes y & — que romperían el XML crudo."""
    limpio = ("" if texto is None else str(texto)).replace("]]>", "]]&gt;")
    return "<![CDATA[" + limpio + "]]>"


def _linea_xml(n, linea, moneda):
    """
    Una línea del comprobante.

    `PricingReference` lleva el precio de carta —el que paga el cliente— con
    el código 01 del catálogo 16; `cac:Price` lleva el valor unitario sin
    impuesto. Los dos tienen que estar: SUNAT compara.

    Con exoneración los dos números coinciden, y está bien que coincidan: no
    hay impuesto que separar.
    """
    a = linea.datos_afectacion
    return f"""  <cac:InvoiceLine>
    <cbc:ID>{n}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="{linea.unidad}">{linea.cantidad}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="{moneda}">{dos(linea.valor_venta)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount currencyID="{moneda}">{dos(linea.precio_con_igv)}</cbc:PriceAmount>
        <cbc:PriceTypeCode>01</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="{moneda}">{dos(linea.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="{moneda}">{dos(linea.valor_venta)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="{moneda}">{dos(linea.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>{dos(linea.porcentaje)}</cbc:Percent>
          <cbc:TaxExemptionReasonCode>{a['codigo']}</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme>
            <cbc:ID>{a['tributo']}</cbc:ID>
            <cbc:Name>{a['nombre']}</cbc:Name>
            <cbc:TaxTypeCode>{a['tipo']}</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description>{_cdata(linea.descripcion)}</cbc:Description>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="{moneda}">{dos(linea.valor_unitario)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>"""


def _subtotal(afectacion, base, impuesto, moneda):
    tributo, nombre, tipo = TRIBUTO_TOTAL[afectacion]
    return f"""    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="{moneda}">{dos(base)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="{moneda}">{dos(impuesto)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:ID>{tributo}</cbc:ID>
          <cbc:Name>{nombre}</cbc:Name>
          <cbc:TaxTypeCode>{tipo}</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>"""


def _totales_impuestos(totales, moneda):
    """
    El bloque de impuestos del comprobante.

    Va un `TaxSubtotal` por cada tipo que exista, y SOLO por los que existan:
    declarar una base gravada de cero cuando no hubo ninguna operación gravada
    es decir algo que no pasó.
    """
    partes = []
    if totales.hay_gravadas:
        partes.append(_subtotal(GRAVADO, totales.gravadas, totales.igv, moneda))
    if totales.hay_exoneradas:
        partes.append(_subtotal(EXONERADO, totales.exoneradas, 0, moneda))
    if totales.hay_inafectas:
        partes.append(_subtotal(INAFECTO, totales.inafectas, 0, moneda))
    if not partes:
        # Un comprobante sin ninguna base es imposible, pero si llegara acá sin
        # este resguardo el XML saldría sin TaxTotal y el error de SUNAT sería
        # incomprensible.
        partes.append(_subtotal(EXONERADO, 0, 0, moneda))
    return "\n".join(partes)


def armar_comprobante(cfg, doc, lineas, totales):
    """
    `doc` trae lo del comprobante: tipo, serie, numero, fecha, hora, moneda,
    cliente y forma de pago. `lineas` y `totales` vienen ya calculados por
    `dinero.py` — acá no se hace ni una cuenta, solo se escribe.
    """
    tipo = doc["tipo_codigo"]
    moneda = doc.get("moneda", "PEN")
    cliente = doc["cliente"]
    lineas_xml = "\n".join(_linea_xml(i + 1, l, moneda) for i, l in enumerate(lineas))

    # La boleta a consumidor final puede ir sin documento; la factura, nunca.
    doc_tipo = cliente.get("tipo_doc") or (DOC_RUC if tipo == TIPO_FACTURA else DOC_SIN)
    doc_num = cliente.get("numero") or ""

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>{doc['serie']}-{doc['numero']}</cbc:ID>
  <cbc:IssueDate>{doc['fecha']}</cbc:IssueDate>
  <cbc:IssueTime>{doc['hora']}</cbc:IssueTime>
  <cbc:InvoiceTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01" listID="0101" name="Tipo de Operacion" listSchemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo51">{tipo}</cbc:InvoiceTypeCode>
  <cbc:Note languageLocaleID="1000">{_cdata(doc['monto_en_letras'])}</cbc:Note>
  <cbc:DocumentCurrencyCode>{moneda}</cbc:DocumentCurrencyCode>
  <cac:Signature>
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
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="6">{cfg.ruc}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>{_cdata(cfg.nombre_comercial or cfg.razon_social)}</cbc:Name>
      </cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>{_cdata(cfg.razon_social)}</cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:AddressTypeCode>{doc.get('establecimiento', '0000')}</cbc:AddressTypeCode>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="{doc_tipo}">{doc_num}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>{_cdata(cliente.get('nombre') or 'CLIENTE VARIOS')}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentTerms>
    <cbc:ID>FormaPago</cbc:ID>
    <cbc:PaymentMeansID>{doc.get('forma_pago', 'Contado')}</cbc:PaymentMeansID>
  </cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="{moneda}">{dos(totales.igv)}</cbc:TaxAmount>
{_totales_impuestos(totales, moneda)}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="{moneda}">{dos(totales.valor_venta)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="{moneda}">{dos(totales.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="{moneda}">{dos(totales.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
{lineas_xml}
</Invoice>
"""
