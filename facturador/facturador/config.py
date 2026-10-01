# -*- coding: utf-8 -*-
"""
LA CONFIGURACIÓN DEL FACTURADOR.

Todo lo que cambia entre un negocio y otro, y entre pruebas y producción, vive
acá y en ningún otro lado. Es lo que permite que esta pieza se enchufe a otro
proyecto sin tocarle una línea al código.

DÓNDE VIVEN LAS CLAVES
======================
En un archivo del servidor que carga el dueño, NO en el repositorio y NO en
esta conversación. El certificado digital y la clave SOL son las llaves con las
que se firma a nombre del negocio: si alguna vez pasan por un chat, un log o un
commit, dejan de ser secretas para siempre.

    /etc/facturador/config.json        (permisos 600, dueño root)
    /etc/facturador/certificado.pfx    (el certificado, igual)

El archivo se lee al arrancar. Para cambiar algo se edita y se reinicia el
servicio — que es también la forma de saber que el cambio se aplicó.
"""
import json
import os

# El ambiente de PRUEBAS de SUNAT y el de verdad. Se elige por configuración y
# nunca por código: el mismo binario tiene que poder correr contra los dos.
AMBIENTES = {
    "beta": {
        "nombre": "PRUEBAS (beta)",
        "facturas": "https://e-beta.sunat.gob.pe/ol-ti-itcpfegem-beta/billService",
    },
    "produccion": {
        "nombre": "PRODUCCIÓN",
        "facturas": "https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService",
    },
}

RUTA_POR_DEFECTO = os.environ.get("FACTURADOR_CONFIG", "/etc/facturador/config.json")


class ErrorDeConfig(Exception):
    pass


class Config:
    """
    Lo que el facturador necesita saber para emitir a nombre de alguien.

    `ambiente` arranca en "beta" a propósito: el que se olvide de configurarlo
    emite contra pruebas, no contra SUNAT de verdad. El error caro es el otro.
    """

    def __init__(self, datos):
        self.ambiente = datos.get("ambiente", "beta")
        if self.ambiente not in AMBIENTES:
            raise ErrorDeConfig(
                "ambiente '%s' no existe; usa 'beta' o 'produccion'" % self.ambiente
            )

        self.ruc = str(datos.get("ruc", "")).strip()
        self.razon_social = str(datos.get("razon_social", "")).strip()
        self.nombre_comercial = str(datos.get("nombre_comercial", "")).strip()
        self.direccion = datos.get("direccion", {}) or {}

        # SIN VALOR POR DEFECTO, A PROPOSITO.
        #
        # El dueno, 6-set-2026: *"nosotros estamos en Pucallpa, aca todo es sin
        # IGV"* — la exoneracion de la Amazonia (Ley 27037).
        #
        # Cualquier default que se ponga aca esta mal en la mitad de los casos:
        # si asume gravado, un negocio amazonico declara un impuesto que no
        # cobro; si asume exonerado, uno de Lima deja de declarar el que si
        # cobro. Las dos equivocaciones son de las que se arreglan con el
        # contador y no con un despliegue, asi que el config TIENE que decirlo
        # y el servicio no arranca sin eso.
        self.afectacion = str(datos.get("afectacion_por_defecto", "")).strip()

        # El usuario SOL para facturación electrónica. SUNAT lo pide pegado al
        # RUC: "20xxxxxxxxxMIUSUARIO".
        self.usuario_sol = str(datos.get("usuario_sol", "")).strip()
        self.clave_sol = str(datos.get("clave_sol", ""))

        self.certificado_ruta = str(datos.get("certificado_ruta", "")).strip()
        self.certificado_clave = str(datos.get("certificado_clave", ""))

        # Dónde se guardan los XML firmados y los CDR. Son el respaldo legal:
        # hay que poder encontrarlos años después.
        self.archivo_dir = str(datos.get("archivo_dir", "/var/lib/facturador"))

        # Quién puede pedirle al facturador que emita. El servicio escucha solo
        # en localhost, pero un token evita que cualquier proceso de la máquina
        # emita comprobantes a nombre del negocio.
        self.token = str(datos.get("token", ""))

        self._validar()

    def _validar(self):
        faltan = []
        if not self.ruc or len(self.ruc) != 11 or not self.ruc.isdigit():
            faltan.append("ruc (11 dígitos)")
        if not self.razon_social:
            faltan.append("razon_social")
        if not self.usuario_sol:
            faltan.append("usuario_sol")
        if not self.clave_sol:
            faltan.append("clave_sol")
        if not self.token:
            faltan.append("token")
        if self.afectacion not in ("gravado", "exonerado", "inafecto"):
            faltan.append(
                "afectacion_por_defecto (gravado / exonerado / inafecto) — "
                "en Pucallpa, por la Ley de Amazonia, es 'exonerado'"
            )
        # El certificado solo es obligatorio en producción: en pruebas se genera
        # uno autofirmado, que es lo que permite integrar antes de tener el de
        # verdad. En producción, en cambio, emitir sin certificado no es un
        # error del que se pueda volver.
        if self.ambiente == "produccion" and not self.certificado_ruta:
            faltan.append("certificado_ruta")
        if faltan:
            raise ErrorDeConfig("falta configurar: " + ", ".join(faltan))

        if self.ambiente == "produccion" and not os.path.exists(self.certificado_ruta):
            raise ErrorDeConfig(
                "no existe el certificado en %s y el ambiente es PRODUCCIÓN"
                % self.certificado_ruta
            )

    @property
    def endpoint_facturas(self):
        return AMBIENTES[self.ambiente]["facturas"]

    # EN PRUEBAS SE ENTRA CON LAS CREDENCIALES DE PRUEBA DE SUNAT, NO CON LAS REALES.
    #
    # El ambiente beta de SUNAT tiene su propia puerta: cualquier RUC entra con el
    # usuario MODDATOS y la clave "moddatos". El usuario secundario de verdad
    # existe solo en producción, así que mandarlo a beta es jugarse la prueba a
    # cómo conteste ese día — y, de paso, pasear la clave real por un servidor de
    # pruebas. Las credenciales reales se usan recién al pasar a producción (y
    # se prueban antes, sin emitir nada, con probar-clave.sh).
    @property
    def usuario_sunat(self):
        """Como lo pide SUNAT: el RUC y el usuario SOL pegados."""
        if not self.es_produccion:
            return self.ruc + "MODDATOS"
        return self.ruc + self.usuario_sol

    @property
    def clave_sunat(self):
        return self.clave_sol if self.es_produccion else "moddatos"

    @property
    def es_produccion(self):
        return self.ambiente == "produccion"

    def resumen(self):
        """Para el log del arranque. Sin secretos, obviamente."""
        return "%s · RUC %s · %s · IGV: %s · certificado %s" % (
            AMBIENTES[self.ambiente]["nombre"],
            self.ruc,
            self.razon_social,
            self.afectacion.upper(),
            "sí" if os.path.exists(self.certificado_ruta) else "NO ENCONTRADO",
        )


# ===========================================================================
# VARIOS EMISORES (Urbis, 1-oct-2026)
# ===========================================================================
# En El Cholao hay un solo RUC. En Urbis cada proyecto factura con el RUC de SU
# dueño, así que el servicio lleva varios emisores a la vez, cada uno con su
# certificado, su usuario SOL y su carpeta de comprobantes. Nunca se mezclan: lo
# que se emite por un RUC se firma con la llave de ese RUC y se guarda aparte.
#
#     /etc/facturador/servicio.json         lo común: token y carpeta de archivo
#     /etc/facturador/emisores/<RUC>.json   los datos de UN emisor
#     /etc/facturador/emisores/<RUC>.p12    su certificado (o .pfx)
#
# Un emisor mal configurado NO tumba a los demás: se anota su error y los otros
# siguen emitiendo.
CARPETA_POR_DEFECTO = os.environ.get("FACTURADOR_CARPETA", "/etc/facturador")


def _leer_json(ruta):
    with open(ruta, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except ValueError as err:
            raise ErrorDeConfig("el archivo %s no es JSON válido: %s" % (ruta, err))


def cargar_general(carpeta=None):
    """El token y la carpeta de archivo, comunes a todos los emisores."""
    carpeta = carpeta or CARPETA_POR_DEFECTO
    ruta = os.path.join(carpeta, "servicio.json")
    if not os.path.exists(ruta):
        raise ErrorDeConfig("no existe %s. Corré instalar.sh." % ruta)
    datos = _leer_json(ruta)
    token = str(datos.get("token", ""))
    if len(token) < 16:
        raise ErrorDeConfig("falta el token en %s" % ruta)
    return {
        "token": token,
        "archivo_dir": str(datos.get("archivo_dir", "/var/lib/facturador")),
    }


def firma_de_la_carpeta(carpeta=None):
    """
    Nombres, tamaños y fechas de lo que hay en emisores/. Si cambia, el servicio
    vuelve a cargar: agregar un emisor o cambiarle la clave no pide reiniciar.
    """
    carpeta = os.path.join(carpeta or CARPETA_POR_DEFECTO, "emisores")
    try:
        nombres = sorted(os.listdir(carpeta))
    except OSError:
        return ()
    firma = []
    for n in nombres:
        try:
            st = os.stat(os.path.join(carpeta, n))
            firma.append((n, st.st_size, int(st.st_mtime)))
        except OSError:
            pass
    return tuple(firma)


def cargar_emisores(carpeta=None, general=None):
    """
    Devuelve ({ruc: Config}, {archivo: error}). Cada Config hereda el token común
    y guarda sus comprobantes en <archivo_dir>/<RUC>.
    """
    carpeta = carpeta or CARPETA_POR_DEFECTO
    general = general or cargar_general(carpeta)
    emisores, errores = {}, {}
    dir_emisores = os.path.join(carpeta, "emisores")
    try:
        nombres = sorted(n for n in os.listdir(dir_emisores) if n.endswith(".json"))
    except OSError:
        nombres = []
    for nombre in nombres:
        ruta = os.path.join(dir_emisores, nombre)
        try:
            datos = _leer_json(ruta)
            ruc = str(datos.get("ruc", "")).strip()
            if nombre != ruc + ".json":
                raise ErrorDeConfig("el archivo se tiene que llamar <RUC>.json y adentro dice ruc %s" % (ruc or "(vacío)"))
            datos["token"] = general["token"]
            datos["archivo_dir"] = os.path.join(general["archivo_dir"], ruc)
            # el certificado, por convención, al lado y con el mismo nombre
            if not str(datos.get("certificado_ruta", "")).strip():
                for ext in (".p12", ".pfx"):
                    candidato = os.path.join(dir_emisores, ruc + ext)
                    if os.path.exists(candidato):
                        datos["certificado_ruta"] = candidato
                        break
            emisores[ruc] = Config(datos)
        except Exception as err:  # ErrorDeConfig o permisos: se anota y se sigue
            errores[nombre] = str(err)
    return emisores, errores


def cargar(ruta=None):
    ruta = ruta or RUTA_POR_DEFECTO
    if not os.path.exists(ruta):
        raise ErrorDeConfig(
            "no existe %s. Copiá config.ejemplo.json ahí y completalo." % ruta
        )
    with open(ruta, "r", encoding="utf-8") as f:
        try:
            datos = json.load(f)
        except ValueError as err:
            raise ErrorDeConfig("el archivo %s no es JSON válido: %s" % (ruta, err))
    return Config(datos)
