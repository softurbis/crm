# -*- coding: utf-8 -*-
"""
EL EMISOR — el que junta todas las piezas.

Recibe una venta en el idioma del negocio (qué se vendió, a cuánto, a quién) y
devuelve un comprobante emitido. Adentro pasa todo lo demás: las cuentas, el
XML, la firma, el ZIP, SUNAT y el CDR.

**Acá está la frontera del proyecto.** Todo lo que entra y sale de esta función
es vocabulario del negocio; la palabra SUNAT no aparece en la interfaz. Por eso
esta pieza se puede enchufar a otro proyecto sin arrastrar nada de El Cholao —y
por eso el día que cambie SUNAT, cambia adentro.

EL ARCHIVO ES OBLIGATORIO, NO UNA COMODIDAD
===========================================
El XML firmado y el CDR son el respaldo legal del comprobante y hay que poder
encontrarlos años después. Se guardan SIEMPRE, aunque SUNAT rechace: un
rechazo también hay que poder mostrarlo.
"""
import datetime as dt
import json
import os

from . import firma as mod_firma
from . import resumen as mod_resumen
from . import sunat, ubl
from .dinero import Linea, Totales, redondear
from .letras import en_letras

TIPOS = {
    "factura": ubl.TIPO_FACTURA,
    "boleta": ubl.TIPO_BOLETA,
}


class ErrorDePeticion(Exception):
    """Lo que mandó el POS está mal. No es culpa de SUNAT ni de la red."""


def _validar(peticion):
    if peticion.get("tipo") not in TIPOS:
        raise ErrorDePeticion("tipo tiene que ser 'factura' o 'boleta'")
    for campo in ("serie", "numero"):
        if not str(peticion.get(campo, "")).strip():
            raise ErrorDePeticion("falta %s" % campo)
    items = peticion.get("items") or []
    if not items:
        raise ErrorDePeticion("no hay items que facturar")
    for i, it in enumerate(items, 1):
        if not str(it.get("descripcion", "")).strip():
            raise ErrorDePeticion("el item %d no tiene descripción" % i)
        try:
            if float(it.get("cantidad", 0)) <= 0:
                raise ErrorDePeticion("el item %d tiene cantidad cero o negativa" % i)
            if float(it.get("precio_con_igv", 0)) < 0:
                raise ErrorDePeticion("el item %d tiene precio negativo" % i)
        except (TypeError, ValueError):
            raise ErrorDePeticion("el item %d tiene cantidad o precio no numéricos" % i)

    cliente = peticion.get("cliente") or {}
    if peticion["tipo"] == "factura":
        # Una factura sin RUC del cliente la rechaza SUNAT. Mejor decirlo acá,
        # donde el mensaje puede ser claro, que traducir después un código.
        if (cliente.get("tipo_doc") or ubl.DOC_RUC) != ubl.DOC_RUC or not cliente.get("numero"):
            raise ErrorDePeticion("una factura necesita el RUC del cliente")
        if not cliente.get("nombre"):
            raise ErrorDePeticion("una factura necesita la razón social del cliente")


def _guardar(config, nombre, sufijo, contenido):
    # Por año y mes: con 3.130 comprobantes mensuales, una sola carpeta se
    # vuelve inmanejable al primer año — y el respaldo hay que poder abrirlo.
    carpeta = os.path.join(
        config.archivo_dir, "comprobantes", dt.date.today().strftime("%Y"), dt.date.today().strftime("%m")
    )
    os.makedirs(carpeta, exist_ok=True)
    ruta = os.path.join(carpeta, nombre + sufijo)
    modo = "wb" if isinstance(contenido, (bytes, bytearray)) else "w"
    if modo == "wb":
        with open(ruta, "wb") as f:
            f.write(contenido)
    else:
        with open(ruta, "w", encoding="utf-8") as f:
            f.write(contenido)
    return ruta


def enviar_archivo(config, peticion):
    """
    Manda a SUNAT un comprobante YA FIRMADO (por `emitir(..., solo_firmar=True)`).

    Es el segundo paso del cobro: el ticket ya salió con su QR y su hash, y
    ahora la cola le informa a SUNAT. Se lee el XML guardado tal cual —no se
    vuelve a armar ni a firmar— así lo que recibe SUNAT es byte por byte lo que
    ya tiene el cliente en la mano.
    """
    archivo = ("" + (peticion.get("archivo") or "")).strip()
    # El POS no tiene por qué saber el RUC ni los códigos de SUNAT: con tipo,
    # serie y número alcanza, y el nombre del archivo se arma acá.
    if archivo == "" and peticion.get("tipo") in TIPOS:
        archivo = sunat.nombre_archivo(
            config.ruc, TIPOS[peticion["tipo"]],
            str(peticion.get("serie", "")).strip().upper(),
            str(peticion.get("numero", "")).strip(),
        )
    if not archivo or "/" in archivo or ".." in archivo:
        raise ErrorDePeticion("falta el nombre del archivo firmado")
    partes = archivo.split("-")
    if len(partes) != 4:
        raise ErrorDePeticion("el nombre del archivo no tiene la forma RUC-tipo-serie-numero")
    ruc, tipo_codigo, serie, numero = partes
    if ruc != config.ruc:
        raise ErrorDePeticion("ese archivo no es de este RUC")

    ruta = ""
    raiz = os.path.join(config.archivo_dir, "comprobantes")
    for carpeta, _, archivos in os.walk(raiz):
        if archivo + ".xml" in archivos:
            ruta = os.path.join(carpeta, archivo + ".xml")
            break
    if ruta == "":
        raise ErrorDePeticion("no está el XML firmado de " + archivo + "; hay que firmarlo de nuevo")

    with open(ruta, "rb") as f:
        xml_firmado = f.read()

    respuesta = sunat.enviar(config, xml_firmado, tipo_codigo, serie, numero)
    ruta_cdr = ""
    if respuesta.cdr:
        ruta_cdr = _guardar(config, archivo, ".cdr.xml", respuesta.cdr)

    resultado = {
        "comprobante": "%s-%s" % (serie, numero),
        "archivo": archivo,
        "estado": respuesta.estado,
        "codigo": respuesta.codigo,
        "mensaje": respuesta.mensaje,
        "reintentable": respuesta.reintentable,
        "xml": ruta,
        "cdr": ruta_cdr,
        "ambiente": config.ambiente,
    }
    if respuesta.crudo and respuesta.estado != "aceptado":
        resultado["detalle"] = respuesta.crudo[:1000]
    return resultado


def emitir(config, certificado, peticion, solo_firmar=False):
    """
    Emite un comprobante. Devuelve un diccionario con lo que pasó.

    Con `solo_firmar=True` arma, firma y guarda el XML y devuelve el hash y el
    QR SIN mandar nada a SUNAT: es lo que el cobro necesita para imprimir el
    ticket ya. El envío lo hace después `enviar_archivo`.

    NO lanza excepción cuando SUNAT rechaza: un rechazo es un resultado, no un
    error del programa, y el POS necesita guardarlo igual para mostrarlo en la
    bandeja.
    """
    _validar(peticion)

    # EN PRODUCCIÓN UNA BOLETA NO VIAJA SOLA. Va en el resumen diario, y el
    # ambiente de pruebas la acepta suelta — que es justo la trampa: se prueba
    # en beta, anda, se pasa a producción y ahí SUNAT las rechaza todas. Este
    # resguardo hace que ese error se vea acá y no en la caja.
    if (
        peticion["tipo"] == "boleta"
        and config.es_produccion
        and not peticion.get("en_resumen")
        and not solo_firmar  # firmarla sí: el cliente se lleva su boleta ya
    ):
        raise ErrorDePeticion(
            "Una boleta no se manda sola en producción: va en el resumen diario."
        )

    tipo_codigo = TIPOS[peticion["tipo"]]
    moneda = peticion.get("moneda", "PEN")
    ahora = dt.datetime.now()

    lineas = [
        Linea(
            descripcion=it["descripcion"],
            cantidad=it["cantidad"],
            precio_con_igv=it["precio_con_igv"],
            unidad=it.get("unidad", "NIU"),
            codigo=it.get("codigo", ""),
            # Cada item puede decir la suya; si no dice nada, la del negocio.
            # En Pucallpa eso es "exonerado" para todo, pero alcanza con que
            # entre un producto que no califique para necesitar las dos en el
            # mismo comprobante.
            afectacion=it.get("afectacion") or config.afectacion,
        )
        for it in peticion["items"]
    ]
    totales = Totales(lineas)
    if not totales.cuadra():
        # No debería pasar nunca: `dinero.py` calcula el IGV por resta justamente
        # para que cierre por construcción. Si pasa, algo cambió y es grave.
        raise ErrorDePeticion(
            "los totales no cuadran: %s + %s != %s"
            % (totales.valor_venta, totales.igv, totales.total)
        )

    # Si el POS dice cuánto cobró, se compara. Un céntimo de diferencia entre
    # la caja y el comprobante es exactamente el descuadre que hay que evitar,
    # y es mucho más barato encontrarlo acá que a fin de mes.
    esperado = peticion.get("total_cobrado")
    if esperado is not None and redondear(esperado) != totales.total:
        raise ErrorDePeticion(
            "el total del comprobante (%s) no coincide con lo cobrado (%s)"
            % (totales.total, redondear(esperado))
        )

    doc = {
        "tipo_codigo": tipo_codigo,
        "serie": str(peticion["serie"]).strip().upper(),
        "numero": str(peticion["numero"]).strip(),
        "fecha": peticion.get("fecha") or ahora.date().isoformat(),
        "hora": peticion.get("hora") or ahora.strftime("%H:%M:%S"),
        "moneda": moneda,
        "cliente": peticion.get("cliente") or {},
        "forma_pago": peticion.get("forma_pago", "Contado"),
        "establecimiento": peticion.get("establecimiento", "0000"),
        "monto_en_letras": en_letras(totales.total, moneda),
    }

    xml = ubl.armar_comprobante(config, doc, lineas, totales)
    xml_firmado, resumen_firma = mod_firma.firmar(xml, certificado)
    # Se valida contra sí misma antes de gastar un viaje a SUNAT.
    mod_firma.verificar(xml_firmado, certificado)

    nombre = sunat.nombre_archivo(config.ruc, tipo_codigo, doc["serie"], doc["numero"])
    ruta_xml = _guardar(config, nombre, ".xml", xml_firmado)

    # EL QR DE LA REPRESENTACIÓN IMPRESA, con los campos y el orden que fija
    # SUNAT: RUC | tipo | serie | número | IGV | total | fecha | tipo doc del
    # cliente | número doc del cliente | valor resumen. Se arma acá porque
    # acá están todos los datos ya redondeados; el ticket solo lo imprime.
    cli = doc["cliente"]
    qr = "|".join([
        config.ruc, tipo_codigo, doc["serie"], doc["numero"],
        str(totales.igv), str(totales.total), doc["fecha"],
        str(cli.get("tipo_doc") or ("6" if tipo_codigo == ubl.TIPO_FACTURA else "0")),
        str(cli.get("numero") or "-"),
        resumen_firma,
    ])

    preparado = {
        "comprobante": "%s-%s" % (doc["serie"], doc["numero"]),
        "tipo": peticion["tipo"],
        "archivo": nombre,
        "firma": resumen_firma,
        "qr": qr,
        "valor_venta": str(totales.valor_venta),
        "gravadas": str(totales.gravadas),
        "exoneradas": str(totales.exoneradas),
        "inafectas": str(totales.inafectas),
        "igv": str(totales.igv),
        "total": str(totales.total),
        "xml": ruta_xml,
        "ambiente": config.ambiente,
    }
    if solo_firmar:
        # FIRMAR NO ES MANDAR. Esto contesta en milisegundos y sin internet:
        # es lo que permite que el ticket salga con QR y hash en el momento
        # del cobro, mientras el envío a SUNAT espera en la cola. El
        # comprobante ya existe para el cliente; a SUNAT se le informa después.
        preparado["estado"] = "firmado"
        return preparado

    respuesta = sunat.enviar(config, xml_firmado, tipo_codigo, doc["serie"], doc["numero"])

    ruta_cdr = ""
    if respuesta.cdr:
        ruta_cdr = _guardar(config, nombre, ".cdr.xml", respuesta.cdr)

    resultado = {
        "comprobante": "%s-%s" % (doc["serie"], doc["numero"]),
        "tipo": peticion["tipo"],
        "estado": respuesta.estado,
        "codigo": respuesta.codigo,
        "mensaje": respuesta.mensaje,
        "reintentable": respuesta.reintentable,
        "qr": qr,
        "valor_venta": str(totales.valor_venta),
        # Las tres bases por separado, como las declara el comprobante. El POS
        # las necesita para cuadrar contra la caja sin volver a calcularlas.
        "gravadas": str(totales.gravadas),
        "exoneradas": str(totales.exoneradas),
        "inafectas": str(totales.inafectas),
        "igv": str(totales.igv),
        "total": str(totales.total),
        "firma": resumen_firma,
        "xml": ruta_xml,
        "cdr": ruta_cdr,
        "ambiente": config.ambiente,
    }
    if respuesta.crudo and respuesta.estado != "aceptado":
        resultado["detalle"] = respuesta.crudo[:1000]

    # Una bitácora en texto plano al lado de los XML: cuando algo se discute
    # meses después, esto es lo que se lee primero.
    try:
        with open(os.path.join(config.archivo_dir, "emisiones.log"), "a", encoding="utf-8") as f:
            f.write(json.dumps({"cuando": ahora.isoformat(timespec="seconds"), **{
                k: v for k, v in resultado.items() if k != "detalle"
            }}, ensure_ascii=False) + "\n")
    except Exception:
        pass  # la bitácora no puede voltear una emisión

    return resultado


# ===========================================================================
# EL RESUMEN DIARIO Y LA COMUNICACIÓN DE BAJA
# ===========================================================================
# Los dos se mandan igual —`sendSummary`— y los dos contestan un TICKET, no un
# CDR: SUNAT los procesa en diferido. El resultado se busca después con
# `consultar`. Por eso quien los usa necesita dos pasos y no uno.
def _firmar_y_mandar(config, certificado, identificador, xml, etiqueta):
    xml_firmado, resumen_firma = mod_firma.firmar(xml, certificado)
    mod_firma.verificar(xml_firmado, certificado)

    nombre = "%s-%s" % (config.ruc, identificador)
    ruta_xml = _guardar(config, nombre, ".xml", xml_firmado)

    respuesta = sunat.enviar_resumen(config, xml_firmado, identificador)
    return {
        "documento": identificador,
        "tipo": etiqueta,
        "estado": respuesta.estado,
        "codigo": respuesta.codigo,
        "mensaje": respuesta.mensaje,
        "ticket": getattr(respuesta, "ticket", ""),
        "reintentable": respuesta.reintentable,
        "firma": resumen_firma,
        "xml": ruta_xml,
        "ambiente": config.ambiente,
    }


def emitir_resumen(config, certificado, peticion):
    """
    El resumen diario de boletas.

    `peticion`: {fecha, correlativo, boletas: [{serie, numero, total,
    gravado/exonerado/inafecto, igv, condicion}]}
    """
    boletas = peticion.get("boletas") or []
    if not boletas:
        raise ErrorDePeticion("no hay boletas que resumir")
    fecha = peticion.get("fecha")
    if not fecha:
        raise ErrorDePeticion("falta la fecha de las boletas")
    correlativo = str(peticion.get("correlativo", "1"))

    identificador, xml = mod_resumen.armar_resumen(
        config, fecha, correlativo, boletas, peticion.get("moneda", "PEN")
    )
    return _firmar_y_mandar(config, certificado, identificador, xml, "resumen")


def emitir_baja(config, certificado, peticion):
    """
    La comunicación de baja: dar de baja comprobantes que SUNAT ya aceptó.

    El motivo es obligatorio y lo lee una persona: "error en el RUC del
    cliente" sirve; "anulado" no dice nada.
    """
    documentos = peticion.get("documentos") or []
    if not documentos:
        raise ErrorDePeticion("no hay documentos que dar de baja")
    motivo = ("" + (peticion.get("motivo") or "")).strip()
    if len(motivo) < 4:
        raise ErrorDePeticion("falta el motivo de la baja")
    fecha = peticion.get("fecha")
    if not fecha:
        raise ErrorDePeticion("falta la fecha de los documentos")

    for d in documentos:
        if d.get("tipo") in TIPOS:
            d["tipo_codigo"] = TIPOS[d["tipo"]]
        if not d.get("tipo_codigo"):
            raise ErrorDePeticion("un documento no dice de qué tipo es")

    identificador, xml = mod_resumen.armar_baja(
        config, fecha, str(peticion.get("correlativo", "1")), documentos, motivo
    )
    return _firmar_y_mandar(config, certificado, identificador, xml, "baja")


def consultar(config, ticket, identificador=""):
    """
    Pregunta por un ticket de resumen o de baja.

    `esperando` no es un error: SUNAT todavía lo está procesando y hay que
    volver más tarde. Confundirlo con un fallo haría que el sistema reintente
    el ENVÍO, y mandar dos veces el mismo resumen es un duplicado.
    """
    respuesta = sunat.consultar_ticket(config, ticket)
    ruta_cdr = ""
    if respuesta.cdr and identificador:
        ruta_cdr = _guardar(
            config, "%s-%s" % (config.ruc, identificador), ".cdr.xml", respuesta.cdr
        )
    return {
        "ticket": ticket,
        "estado": respuesta.estado,
        "codigo": respuesta.codigo,
        "mensaje": respuesta.mensaje,
        "reintentable": respuesta.reintentable,
        "cdr": ruta_cdr,
    }
