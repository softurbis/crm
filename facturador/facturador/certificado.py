# -*- coding: utf-8 -*-
"""
EL CERTIFICADO DIGITAL.

Es la llave con la que se firma a nombre del negocio. Vive en un archivo del
servidor que carga el dueño —nunca en el repositorio, nunca en un chat— y este
módulo solo sabe abrirlo.

Acepta los dos formatos con los que llega en Perú:

  · `.pfx` / `.p12`  — lo normal: certificado y clave privada en un archivo,
                       protegido por contraseña;
  · `.pem`           — sueltos, para pruebas.

Si no hay ninguno y el ambiente es de pruebas, genera uno autofirmado. Eso
alcanza para el ambiente beta de SUNAT, que valida la MECÁNICA de la firma y no
la identidad. En producción no se genera nada: emitir sin el certificado real
no es un error del que se pueda volver.
"""
import datetime as dt
import os

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID


class ErrorDeCertificado(Exception):
    pass


class Certificado:
    """La clave privada y el certificado, ya en memoria y listos para firmar."""

    def __init__(self, pem_clave, pem_cert, origen):
        self.pem_clave = pem_clave
        self.pem_cert = pem_cert
        self.origen = origen
        self._x509 = x509.load_pem_x509_certificate(pem_cert)

    @property
    def vence(self):
        return self._x509.not_valid_after_utc

    @property
    def dias_para_vencer(self):
        return (self.vence - dt.datetime.now(dt.timezone.utc)).days

    @property
    def sujeto(self):
        try:
            return self._x509.subject.rfc4514_string()
        except Exception:
            return "?"

    def resumen(self):
        return "%s · vence %s (faltan %d días) · %s" % (
            self.origen,
            self.vence.date().isoformat(),
            self.dias_para_vencer,
            self.sujeto,
        )


def _de_pkcs12(ruta, clave):
    with open(ruta, "rb") as f:
        crudo = f.read()
    try:
        privada, cert, _ = pkcs12.load_key_and_certificates(
            crudo, clave.encode("utf-8") if clave else None
        )
    except Exception as err:
        # El error más común y el más confuso: la contraseña. Vale la pena
        # decirlo con todas las letras en vez de dejar el error de la librería.
        raise ErrorDeCertificado(
            "no se pudo abrir %s. Suele ser la contraseña del certificado. (%s)"
            % (ruta, err)
        )
    if privada is None or cert is None:
        raise ErrorDeCertificado("%s no trae clave privada y certificado" % ruta)

    pem_clave = privada.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pem_cert = cert.public_bytes(serialization.Encoding.PEM)
    return Certificado(pem_clave, pem_cert, os.path.basename(ruta))


def _de_pem(ruta_cert):
    # Convención: junto a `algo.crt.pem` va `algo.key.pem`.
    base = ruta_cert.replace(".crt.pem", "").replace(".pem", "")
    ruta_clave = base + ".key.pem"
    if not os.path.exists(ruta_clave):
        raise ErrorDeCertificado("falta la clave privada en %s" % ruta_clave)
    with open(ruta_clave, "rb") as f:
        pem_clave = f.read()
    with open(ruta_cert, "rb") as f:
        pem_cert = f.read()
    return Certificado(pem_clave, pem_cert, os.path.basename(ruta_cert))


def _autofirmado(ruc, razon_social, carpeta):
    """Solo para pruebas. Ver el encabezado de este archivo."""
    os.makedirs(carpeta, exist_ok=True)
    ruta_clave = os.path.join(carpeta, "pruebas.key.pem")
    ruta_cert = os.path.join(carpeta, "pruebas.crt.pem")
    if os.path.exists(ruta_clave) and os.path.exists(ruta_cert):
        return _de_pem(ruta_cert)

    privada = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    sujeto = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "PE"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, razon_social[:64] or "PRUEBAS"),
        x509.NameAttribute(NameOID.COMMON_NAME, ruc or "20000000001"),
    ])
    ahora = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(sujeto)
        .issuer_name(sujeto)
        .public_key(privada.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(ahora - dt.timedelta(days=1))
        .not_valid_after(ahora + dt.timedelta(days=825))
        .sign(privada, hashes.SHA256())
    )
    pem_clave = privada.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pem_cert = cert.public_bytes(serialization.Encoding.PEM)
    with open(ruta_clave, "wb") as f:
        f.write(pem_clave)
    os.chmod(ruta_clave, 0o600)
    with open(ruta_cert, "wb") as f:
        f.write(pem_cert)
    return Certificado(pem_clave, pem_cert, "autofirmado de pruebas")


def cargar(config):
    ruta = config.certificado_ruta
    if ruta and os.path.exists(ruta):
        if ruta.lower().endswith((".pfx", ".p12")):
            return _de_pkcs12(ruta, config.certificado_clave)
        return _de_pem(ruta)

    if config.es_produccion:
        raise ErrorDeCertificado(
            "no existe el certificado en %s y el ambiente es PRODUCCIÓN" % ruta
        )
    return _autofirmado(
        config.ruc, config.razon_social, os.path.join(config.archivo_dir, "certificado")
    )
