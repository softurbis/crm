# -*- coding: utf-8 -*-
"""
HABLAR CON SUNAT.

Zipear el XML firmado con el nombre exacto, mandarlo por SOAP, y leer el CDR
—que también viene como un ZIP con XML adentro—.

CÓMO SE LEEN LOS RECHAZOS, QUE ES LA PARTE ÚTIL
===============================================
SUNAT contesta de tres formas distintas y hay que distinguirlas, porque piden
cosas distintas:

  · **CDR con código 0** → aceptado. Ese XML es el respaldo legal.
  · **CDR con código 2xxx-3xxx** → rechazado por CONTENIDO. El comprobante está
    mal armado: reintentarlo igual lo va a repetir mal. Hay que corregir y
    emitir de nuevo.
  · **SOAP Fault** → ni siquiera se pudo procesar: credenciales, ZIP mal
    formado, XML que no valida contra el esquema.

Y aparte están las caídas de red o de SUNAT, que NO son rechazos: ahí el
comprobante sigue vivo y hay que reintentar más tarde. Confundir las dos cosas
es lo que hace que un sistema reintente para siempre algo que nunca va a pasar,
o que dé por perdido algo que solo necesitaba esperar.
"""
import base64
import io
import zipfile

import requests
from lxml import etree
from xml.sax.saxutils import escape as _xml

# Las credenciales van adentro del sobre SOAP como texto XML: una clave con
# `&` o `<` rompería el sobre entero y SUNAT contestaría cualquier cosa menos
# lo que pasó. Se escapan siempre; a las que no lo necesitan no les cambia nada.

NS_SOAP = "{http://schemas.xmlsoap.org/soap/envelope/}"

SOBRE = """<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>{usuario}</wsse:Username>
        <wsse:Password>{clave}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:sendBill>
      <fileName>{archivo}.zip</fileName>
      <contentFile>{contenido}</contentFile>
    </ser:sendBill>
  </soapenv:Body>
</soapenv:Envelope>"""


class Respuesta:
    """
    Lo que contestó SUNAT, ya interpretado.

    `reintentable` es la que decide qué hace la cola del POS: un problema de red
    se reintenta, un comprobante mal armado no.
    """

    def __init__(self, estado, codigo="", mensaje="", cdr=None, crudo="", reintentable=False):
        self.estado = estado          # aceptado | rechazado | error
        self.codigo = codigo
        self.mensaje = mensaje
        self.cdr = cdr                # bytes del XML del CDR, si vino
        self.crudo = crudo
        self.reintentable = reintentable
        # Solo lo trae un resumen o una baja: SUNAT los procesa en diferido.
        self.ticket = ""

    @property
    def aceptado(self):
        return self.estado == "aceptado"

    def __repr__(self):
        return "<Respuesta %s %s %s>" % (self.estado, self.codigo, self.mensaje[:60])


def nombre_archivo(ruc, tipo_codigo, serie, numero):
    """El nombre que SUNAT exige, y que tiene que ser el mismo en el ZIP y adentro."""
    return "%s-%s-%s-%s" % (ruc, tipo_codigo, serie, numero)


def zipear(xml_firmado, nombre):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(nombre + ".xml", xml_firmado)
    return buf.getvalue()


def _leer_cdr(cdr_zip):
    with zipfile.ZipFile(io.BytesIO(cdr_zip)) as z:
        nombres = [n for n in z.namelist() if n.lower().endswith(".xml")]
        if not nombres:
            return None, "", ""
        cdr = z.read(nombres[0])
    raiz = etree.fromstring(cdr)
    codigo = descripcion = ""
    for el in raiz.iter():
        nombre = etree.QName(el).localname
        if nombre == "ResponseCode" and not codigo:
            codigo = (el.text or "").strip()
        if nombre == "Description" and not descripcion:
            descripcion = (el.text or "").strip()
    return cdr, codigo, descripcion


SOBRE_RESUMEN = """<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>{usuario}</wsse:Username>
        <wsse:Password>{clave}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:sendSummary>
      <fileName>{archivo}.zip</fileName>
      <contentFile>{contenido}</contentFile>
    </ser:sendSummary>
  </soapenv:Body>
</soapenv:Envelope>"""

SOBRE_ESTADO = """<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>{usuario}</wsse:Username>
        <wsse:Password>{clave}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getStatus>
      <ticket>{ticket}</ticket>
    </ser:getStatus>
  </soapenv:Body>
</soapenv:Envelope>"""


def _postear(config, sobre, timeout):
    """El POST y los dos errores que no son del documento: red y SUNAT caído."""
    try:
        r = requests.post(
            config.endpoint_facturas,
            data=sobre.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": ""},
            timeout=timeout,
        )
    except requests.RequestException as err:
        return None, Respuesta(
            "error", "red", "No se pudo llegar a SUNAT: %s" % err, reintentable=True
        )
    return r, None


def _fault(raiz, crudo):
    """Interpreta un SOAP Fault. Devuelve None si no había ninguno."""
    for fault in raiz.iter(NS_SOAP + "Fault"):
        codigo = (fault.findtext("faultcode") or "").strip()
        detalle = (fault.findtext("faultstring") or "").strip()
        numero = codigo.split(".")[-1] if "." in codigo else codigo
        # 0100-0999 son de infraestructura (autenticación, límites, servicio
        # no disponible) y se reintentan; de 2000 para arriba, del documento.
        # El 0306 es la excepción: "no se puede parsear" es culpa nuestra.
        reintentable = (
            numero.isdigit() and int(numero) < 1000 and int(numero) != 306
        )
        return Respuesta(
            "error" if reintentable else "rechazado",
            codigo, detalle, crudo=crudo[:4000], reintentable=reintentable,
        )
    return None


def enviar_resumen(config, xml_firmado, identificador, timeout=60):
    """
    Manda un resumen (RC) o una comunicación de baja (RA).

    NO devuelve el CDR: devuelve un TICKET. SUNAT procesa estos documentos en
    diferido y el resultado hay que ir a buscarlo con `consultar_ticket`. Esa
    es toda la diferencia con una factura, y es la que obliga a que la cola del
    POS tenga un segundo pase.
    """
    nombre = "%s-%s" % (config.ruc, identificador)
    sobre = SOBRE_RESUMEN.format(
        usuario=_xml(config.usuario_sunat),
        clave=_xml(config.clave_sunat),
        archivo=nombre,
        contenido=base64.b64encode(zipear(xml_firmado, nombre)).decode("ascii"),
    )

    r, error = _postear(config, sobre, timeout)
    if error:
        return error

    try:
        raiz = etree.fromstring(r.content)
    except Exception:
        return Respuesta(
            "error", "http%s" % r.status_code, "SUNAT contestó algo que no es XML",
            crudo=r.text[:2000], reintentable=r.status_code >= 500,
        )

    fallo = _fault(raiz, r.text)
    if fallo:
        return fallo

    for el in raiz.iter():
        if etree.QName(el).localname == "ticket" and el.text:
            resp = Respuesta("esperando", "ticket", "En cola en SUNAT")
            resp.ticket = el.text.strip()
            return resp

    return Respuesta(
        "error", "?", "SUNAT no devolvió ticket", crudo=r.text[:2000], reintentable=True
    )


def consultar_ticket(config, ticket, timeout=45):
    """
    Pregunta por un ticket de resumen o de baja.

    Los estados de SUNAT:
      · 98  todavía en proceso — hay que volver a preguntar
      · 0   procesado y aceptado (viene el CDR)
      · 99  procesado CON ERRORES (también viene el CDR, con el motivo)
    """
    sobre = SOBRE_ESTADO.format(
        usuario=_xml(config.usuario_sunat), clave=_xml(config.clave_sunat), ticket=ticket
    )
    r, error = _postear(config, sobre, timeout)
    if error:
        return error

    try:
        raiz = etree.fromstring(r.content)
    except Exception:
        return Respuesta(
            "error", "http%s" % r.status_code, "SUNAT contestó algo que no es XML",
            crudo=r.text[:2000], reintentable=r.status_code >= 500,
        )

    fallo = _fault(raiz, r.text)
    if fallo:
        return fallo

    estado_sunat = ""
    contenido = None
    for el in raiz.iter():
        nombre = etree.QName(el).localname
        if nombre == "statusCode" and el.text:
            estado_sunat = el.text.strip()
        if nombre == "content" and el.text:
            contenido = base64.b64decode(el.text)

    if estado_sunat == "98":
        # Sigue en la cola de SUNAT. No es un error: hay que volver más tarde.
        return Respuesta("esperando", "98", "SUNAT todavía lo está procesando",
                         reintentable=True)

    if contenido:
        cdr, codigo, descripcion = _leer_cdr(contenido)
        if codigo == "0":
            return Respuesta("aceptado", codigo, descripcion, cdr=cdr)
        return Respuesta("rechazado", codigo or estado_sunat, descripcion, cdr=cdr)

    return Respuesta(
        "error", estado_sunat or "?", "SUNAT contestó sin CDR",
        crudo=r.text[:2000], reintentable=True,
    )


def enviar(config, xml_firmado, tipo_codigo, serie, numero, timeout=45):
    nombre = nombre_archivo(config.ruc, tipo_codigo, serie, numero)
    sobre = SOBRE.format(
        usuario=_xml(config.usuario_sunat),
        clave=_xml(config.clave_sunat),
        archivo=nombre,
        contenido=base64.b64encode(zipear(xml_firmado, nombre)).decode("ascii"),
    )

    try:
        r = requests.post(
            config.endpoint_facturas,
            data=sobre.encode("utf-8"),
            headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": ""},
            timeout=timeout,
        )
    except requests.RequestException as err:
        # No llegamos. El comprobante sigue vivo: esto se reintenta.
        return Respuesta(
            "error", "red", "No se pudo llegar a SUNAT: %s" % err, reintentable=True
        )

    try:
        raiz = etree.fromstring(r.content)
    except Exception:
        return Respuesta(
            "error", "http%s" % r.status_code,
            "SUNAT contestó algo que no es XML", crudo=r.text[:2000],
            # Un 5xx sin XML suele ser SUNAT caído, no un comprobante malo.
            reintentable=r.status_code >= 500,
        )

    for fault in raiz.iter(NS_SOAP + "Fault"):
        codigo = (fault.findtext("faultcode") or "").strip()
        detalle = (fault.findtext("faultstring") or "").strip()
        # Los códigos 0100-0999 son de la infraestructura (autenticación,
        # límites, servicio no disponible); de 2000 para arriba, del documento.
        numero_error = codigo.split(".")[-1] if "." in codigo else codigo
        reintentable = numero_error.isdigit() and int(numero_error) < 1000 and int(numero_error) != 306
        return Respuesta(
            "rechazado" if not reintentable else "error",
            codigo, detalle, crudo=r.text[:4000], reintentable=reintentable,
        )

    for el in raiz.iter():
        if etree.QName(el).localname == "applicationResponse" and el.text:
            cdr, codigo, descripcion = _leer_cdr(base64.b64decode(el.text))
            if codigo == "0":
                return Respuesta("aceptado", codigo, descripcion, cdr=cdr)
            return Respuesta("rechazado", codigo, descripcion, cdr=cdr)

    return Respuesta(
        "error", "?", "SUNAT contestó sin CDR ni error reconocible",
        crudo=r.text[:2000], reintentable=True,
    )
