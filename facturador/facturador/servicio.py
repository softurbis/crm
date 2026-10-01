# -*- coding: utf-8 -*-
"""
EL SERVICIO — la puerta por la que el CRM le pide comprobantes al facturador.

    python -m facturador.servicio

Nació en el POS de El Cholao (un solo RUC). Acá lleva VARIOS EMISORES: en Urbis
cada proyecto factura con el RUC de su dueño, así que cada pedido dice con qué
RUC se emite y el servicio usa el certificado, el usuario SOL y la carpeta de
ese RUC. Ver `config.py` (cargar_emisores).

ESCUCHA SOLO EN LOCALHOST, y eso no es una configuración menor: este proceso
tiene los certificados digitales en memoria. Cualquiera que le pueda hablar
puede emitir comprobantes a nombre de esos RUC. Que no salga de la máquina es la
primera defensa; el token es la segunda, para que tampoco pueda hacerlo
cualquier proceso de la misma máquina.

LA API ESTÁ EN CASTELLANO Y EN VOCABULARIO DEL NEGOCIO
======================================================
Ni "invoice", ni "UBL", ni "SUNAT". El CRM pide *emitir* una *boleta* con unos
*items* a nombre de un *ruc*. Eso es lo que hace que esta pieza se pueda
enchufar a otro proyecto.
"""
import hmac
import json
import logging
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import certificado as mod_cert
from . import config as mod_config
from . import emisor

log = logging.getLogger("facturador")

# Un comprobante con cien líneas ya es raro; con un megabyte, es un ataque.
LIMITE_CUERPO = 512 * 1024


class Estado:
    """Los emisores, cargados al arrancar y vueltos a cargar si cambia su carpeta."""

    def __init__(self):
        self.carpeta = None
        self.general = None
        self.emisores = {}      # ruc -> {"config": Config, "certificado": Certificado}
        self.errores = {}       # archivo o ruc -> por qué no se pudo cargar
        self.firma = None
        self.candado = threading.Lock()

    def arrancar(self, carpeta=None):
        self.carpeta = carpeta or mod_config.CARPETA_POR_DEFECTO
        self.general = mod_config.cargar_general(self.carpeta)
        os.makedirs(self.general["archivo_dir"], exist_ok=True)
        self.cargar()
        return self

    def cargar(self):
        configs, errores = mod_config.cargar_emisores(self.carpeta, self.general)
        emisores = {}
        for ruc, cfg in configs.items():
            try:
                os.makedirs(cfg.archivo_dir, exist_ok=True)
                emisores[ruc] = {"config": cfg, "certificado": mod_cert.cargar(cfg)}
            except Exception as err:
                errores[ruc] = str(err)
        self.emisores, self.errores = emisores, errores
        self.firma = mod_config.firma_de_la_carpeta(self.carpeta)
        for ruc, e in emisores.items():
            log.info("emisor %s", e["config"].resumen())
            if e["certificado"].dias_para_vencer < 30:
                log.warning("EL CERTIFICADO DE %s VENCE EN %d DÍAS", ruc, e["certificado"].dias_para_vencer)
        for quien, err in errores.items():
            log.error("emisor %s NO cargó: %s", quien, err)

    def refrescar(self):
        """Agregar un emisor o cambiarle la clave no pide reiniciar el servicio."""
        if mod_config.firma_de_la_carpeta(self.carpeta) != self.firma:
            log.info("cambió la carpeta de emisores: se vuelve a cargar")
            self.cargar()


ESTADO = Estado()


class Manejador(BaseHTTPRequestHandler):
    server_version = "facturador"

    # El log por defecto escribe a stderr con un formato propio; se unifica.
    def log_message(self, formato, *args):
        log.info("%s %s", self.address_string(), formato % args)

    def _responder(self, codigo, datos):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _autorizado(self):
        cabecera = self.headers.get("Authorization", "")
        esperado = "Bearer " + ESTADO.general["token"]
        # Comparación de largo constante: comparar tokens con == filtra
        # información por el tiempo que tarda en fallar.
        return hmac.compare_digest(cabecera, esperado)

    def _cuerpo(self):
        largo = int(self.headers.get("Content-Length") or 0)
        if largo <= 0:
            raise ValueError("el pedido vino sin cuerpo")
        if largo > LIMITE_CUERPO:
            raise ValueError("el pedido es demasiado grande")
        return json.loads(self.rfile.read(largo).decode("utf-8"))

    def do_GET(self):
        if self.path == "/salud":
            with ESTADO.candado:
                ESTADO.refrescar()
                emisores = [{
                    "ruc": ruc,
                    "razon_social": e["config"].razon_social,
                    "ambiente": e["config"].ambiente,
                    "afectacion": e["config"].afectacion,
                    "certificado": e["certificado"].origen,
                    "certificado_vence": e["certificado"].vence.date().isoformat(),
                    "certificado_dias": e["certificado"].dias_para_vencer,
                } for ruc, e in sorted(ESTADO.emisores.items())]
                # los errores dicen QUÉ emisor falló y por qué, nunca una clave
                errores = dict(ESTADO.errores)
            return self._responder(200, {"ok": True, "emisores": emisores, "errores": errores})
        return self._responder(404, {"ok": False, "mensaje": "no existe"})

    # Lo que sabe hacer, cada cosa con su verbo del negocio. `resumen`, `anular`
    # y `ticket` van juntas a propósito: las tres hablan del mismo mecanismo
    # diferido de SUNAT.
    ACCIONES = {
        "/emitir": "emitir",
        # firmar y mandar por separado: el comprobante existe (con QR y hash)
        # apenas se firma; a SUNAT se le informa después, desde la cola.
        "/firmar": "firmar",
        "/enviar": "enviar",
        "/resumen": "resumen",
        "/anular": "anular",
        "/ticket": "ticket",
    }

    def do_POST(self):
        accion = self.ACCIONES.get(self.path)
        if accion is None:
            return self._responder(404, {"ok": False, "mensaje": "no existe"})
        if not self._autorizado():
            return self._responder(401, {"ok": False, "mensaje": "token inválido"})

        try:
            peticion = self._cuerpo()
        except ValueError as err:
            return self._responder(400, {"ok": False, "mensaje": str(err)})

        try:
            # Se emite de a uno: dos emisiones a la vez podrían pelearse por el
            # mismo número de comprobante, y un número repetido ante SUNAT no se
            # arregla — se da de baja.
            with ESTADO.candado:
                ESTADO.refrescar()
                ruc = str(peticion.get("ruc", "")).strip()
                quien = ESTADO.emisores.get(ruc)
                if quien is None:
                    motivo = ESTADO.errores.get(ruc) or ESTADO.errores.get(ruc + ".json")
                    raise emisor.ErrorDePeticion(
                        "el RUC %s no está configurado en el facturador%s"
                        % (ruc or "(vacío)", (": " + motivo) if motivo else "")
                    )
                cfg, cert = quien["config"], quien["certificado"]
                if accion == "emitir":
                    resultado = emisor.emitir(cfg, cert, peticion)
                elif accion == "firmar":
                    resultado = emisor.emitir(cfg, cert, peticion, solo_firmar=True)
                elif accion == "enviar":
                    resultado = emisor.enviar_archivo(cfg, peticion)
                elif accion == "resumen":
                    resultado = emisor.emitir_resumen(cfg, cert, peticion)
                elif accion == "anular":
                    resultado = emisor.emitir_baja(cfg, cert, peticion)
                else:
                    ticket = ("" + (peticion.get("ticket") or "")).strip()
                    if ticket == "":
                        raise emisor.ErrorDePeticion("falta el ticket")
                    resultado = emisor.consultar(cfg, ticket, peticion.get("documento", ""))
        except emisor.ErrorDePeticion as err:
            # Culpa del que pidió: el CRM puede mostrar esto tal cual.
            return self._responder(400, {"ok": False, "mensaje": str(err)})
        except Exception as err:
            log.exception("fallo emitiendo")
            return self._responder(500, {
                "ok": False,
                "mensaje": "no se pudo emitir: %s" % err,
                "reintentable": True,
            })

        # Un rechazo de SUNAT NO es un error del servicio: se contesta 200 con
        # el estado adentro. El CRM lo guarda igual y lo muestra en la bandeja.
        # `esperando` tampoco es un fallo — es un resumen en cola en SUNAT, y
        # quien pregunte tiene que volver, no reintentar el envío.
        return self._responder(
            200, {"ok": resultado["estado"] in ("aceptado", "firmado"), "ruc": ruc, **resultado}
        )


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    carpeta = argv[0] if argv else None

    try:
        ESTADO.arrancar(carpeta)
    except Exception as err:
        log.error("no se pudo arrancar: %s", err)
        return 2

    if not ESTADO.emisores:
        # Arranca igual: el primer emisor se agrega después, sin reiniciar.
        log.warning("todavía no hay ningún emisor configurado")
    for e in ESTADO.emisores.values():
        if not e["config"].es_produccion:
            log.warning("%s en ambiente de PRUEBAS: nada de lo que emita es real", e["config"].ruc)

    puerto = int(os.environ.get("FACTURADOR_PUERTO", "8097"))
    servidor = ThreadingHTTPServer(("127.0.0.1", puerto), Manejador)
    log.info("escuchando en http://127.0.0.1:%d (solo localhost)", puerto)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        log.info("cortado a mano")
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
