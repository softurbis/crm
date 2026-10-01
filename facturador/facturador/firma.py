# -*- coding: utf-8 -*-
"""
LA FIRMA DIGITAL DEL XML.

Es la pieza que hacía difícil todo esto, y ya está probada: el 6-set-2026 SUNAT
aceptó una factura firmada así (CDR código 0). Lo que sigue son las tres cosas
que costaron llegar y que NO hay que volver a tocar sin una razón.

1. NO SE PASA `reference_uri`
   SUNAT quiere que la referencia sea `URI=""` — el documento entero. Eso es lo
   que sale por defecto. Pedirlo explícitamente con `reference_uri=""` REVIENTA
   la librería ("Unable to resolve reference URI: #"): lo toma como un
   fragmento vacío y lo sale a buscar. Que no esté el parámetro parece un
   olvido y es exactamente lo contrario.

2. CANONICALIZACIÓN 1.0, NO 1.1
   El valor por defecto de la librería es 1.1. Con ese, el resumen se calcula
   sobre otro texto y SUNAT rechaza.

3. SHA256, NO SHA1
   La documentación vieja de SUNAT pide SHA1 y las librerías modernas se niegan
   a firmar con SHA1 — con razón, hace años que no es seguro. Se probaron los
   dos contra el ambiente beta: SHA256 pasa. Así que no hay que pelearse con
   nadie.

EL TRUCO DE MOVER LA FIRMA
==========================
Se firma el documento entero con la transformada `enveloped-signature`, la
firma nace colgada de la raíz, y después se la MUEVE adentro de
`ext:ExtensionContent`, que es donde SUNAT la busca.

Mover el nodo no invalida nada, y conviene entender por qué: `enveloped` quita
el propio nodo de firma ANTES de calcular el resumen, así que "el documento sin
la firma" es el mismo esté la firma donde esté. Lo que sí importa es que el
hueco vacío ya existiera al firmar — por eso `ubl.py` deja el
`<ext:ExtensionContent/>` puesto.
"""
# (hashlib ya no hace falta: el hash del ticket es el DigestValue de la firma)

from lxml import etree
from signxml import XMLSigner
from signxml.algorithms import (
    CanonicalizationMethod,
    DigestAlgorithm,
    SignatureConstructionMethod,
    SignatureMethod,
)

NS_DS = "{http://www.w3.org/2000/09/xmldsig#}"
NS_EXT = "{urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2}"


class ErrorDeFirma(Exception):
    pass


def firmar(xml_texto, certificado):
    """Devuelve (xml_firmado_bytes, resumen_de_la_firma)."""
    if isinstance(xml_texto, str):
        xml_texto = xml_texto.encode("utf-8")

    try:
        raiz = etree.fromstring(xml_texto)
    except Exception as err:
        raise ErrorDeFirma("el XML no se pudo leer antes de firmarlo: %s" % err)

    firmador = XMLSigner(
        method=SignatureConstructionMethod.enveloped,
        c14n_algorithm=CanonicalizationMethod.CANONICAL_XML_1_0,  # (2)
        signature_algorithm=SignatureMethod.RSA_SHA256,           # (3)
        digest_algorithm=DigestAlgorithm.SHA256,
    )
    try:
        # Sin `reference_uri`, a propósito. Ver (1) arriba.
        firmada = firmador.sign(
            raiz,
            key=certificado.pem_clave,
            cert=certificado.pem_cert.decode("utf-8"),
        )
    except Exception as err:
        raise ErrorDeFirma("no se pudo firmar: %s" % err)

    ds_sig = firmada.find(NS_DS + "Signature")
    if ds_sig is None:
        raise ErrorDeFirma("la firma no quedó en el documento")
    # SUNAT relaciona el bloque `cac:Signature` del UBL con la firma real por
    # este Id. Sin él, el comprobante viaja firmado pero "sin firmante".
    ds_sig.set("Id", "SignatureSP")

    contenido = firmada.find(
        NS_EXT + "UBLExtensions/" + NS_EXT + "UBLExtension/" + NS_EXT + "ExtensionContent"
    )
    if contenido is None:
        raise ErrorDeFirma("el XML no traía el hueco ext:ExtensionContent")

    firmada.remove(ds_sig)
    contenido.append(ds_sig)

    # EL "HASH" QUE VA EN EL TICKET ES EL DigestValue, TAL CUAL.
    #
    # SUNAT llama "valor resumen" al DigestValue de la firma (el resumen del
    # documento canonicalizado, en base64). Es lo que se imprime en la
    # representación impresa y lo que va en el último campo del QR; con él
    # cualquiera puede verificar el comprobante en el portal de SUNAT. No es
    # el SignatureValue ni un hash inventado sobre él — la primera versión de
    # esto devolvía un sha256 recortado del SignatureValue, que no le sirve a
    # nadie para verificar nada.
    digest = firmada.find(".//" + NS_DS + "DigestValue")
    resumen = (digest.text or "").strip() if digest is not None else ""
    if resumen == "":
        raise ErrorDeFirma("la firma no trae DigestValue")

    return etree.tostring(firmada, xml_declaration=True, encoding="UTF-8"), resumen


def verificar(xml_firmado, certificado):
    """
    ¿La firma se valida contra sí misma?

    Se corre ANTES de mandar. Una firma rota detectada acá cuesta un reintento;
    detectada por SUNAT, cuesta un comprobante rechazado que hay que rehacer.
    """
    from signxml import XMLVerifier

    try:
        XMLVerifier().verify(
            etree.fromstring(xml_firmado),
            x509_cert=certificado.pem_cert.decode("utf-8"),
            expect_references=1,
        )
        return True
    except Exception as err:
        raise ErrorDeFirma("la firma no se valida contra sí misma: %s" % err)
