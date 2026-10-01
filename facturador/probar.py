# -*- coding: utf-8 -*-
"""
PROBAR EL FACTURADOR CONTRA EL AMBIENTE DE PRUEBAS DE SUNAT.

    python facturador/probar.py

No necesita nada configurado: usa el RUC y la clave de juguete que publica
SUNAT, y un certificado autofirmado que se genera solo. Emite lo que va a emitir
Urbis de verdad: la boleta y la factura de UNA CUOTA DE UN LOTE, sin IGV, en las
dos formas en que se puede declarar (exonerada por la Amazonía, Ley 27037, e
inafecta) para que el contador elija con las dos ya probadas.
"""
import datetime as dt
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from facturador import certificado as mod_cert  # noqa: E402
from facturador import config as mod_config     # noqa: E402
from facturador import emisor                   # noqa: E402


def config_de_pruebas(afectacion):
    carpeta = os.path.join(tempfile.gettempdir(), "facturador-urbis-pruebas")
    os.makedirs(carpeta, exist_ok=True)
    return mod_config.Config({
        "ambiente": "beta",
        "ruc": "20000000001",
        "razon_social": "EMPRESA DE PRUEBA SAC",
        "nombre_comercial": "LAS PRADERAS DE PUCALLPA",
        "usuario_sol": "MODDATOS",
        "clave_sol": "moddatos",
        "certificado_ruta": "",     # vacío: se genera uno autofirmado
        "archivo_dir": carpeta,
        "token": "pruebas",
        "afectacion_por_defecto": afectacion,
    })


def probar(afectacion):
    cfg = config_de_pruebas(afectacion)
    cert = mod_cert.cargar(cfg)
    # Número distinto en cada corrida: SUNAT guarda lo que recibe.
    n = str(int(dt.datetime.now().timestamp()) % 100000)
    ok = True
    for tipo, serie, cliente in [
        ("boleta", "B001", {"tipo_doc": "1", "numero": "44896429", "nombre": "MARITZA REYES FASABI"}),
        ("factura", "F001", {"tipo_doc": "6", "numero": "20123456789", "nombre": "CLIENTE DE PRUEBA SAC"}),
    ]:
        print()
        print("  %s %s-%s · %s" % (tipo.upper(), serie, n, afectacion.upper()))
        peticion = {
            "tipo": tipo, "serie": serie, "numero": n, "cliente": cliente,
            "items": [{
                "descripcion": "CUOTA 5 DE 48 - LOTE 12 MZ G - LAS PRADERAS DE PUCALLPA",
                "cantidad": 1, "precio_con_igv": "367.00",
            }],
            "total_cobrado": "367.00",
        }
        try:
            r = emisor.emitir(cfg, cert, peticion)
        except Exception as err:
            print("     FALLA antes de SUNAT: %s" % err)
            ok = False
            continue
        print("     estado %s · código %s · %s" % (r["estado"], r["codigo"], r["mensaje"]))
        print("     gravadas %s · exoneradas %s · inafectas %s · IGV %s · total %s"
              % (r["gravadas"], r["exoneradas"], r["inafectas"], r["igv"], r["total"]))
        if r["estado"] != "aceptado":
            print("     detalle: %s" % r.get("detalle", "")[:300])
            ok = False
    return ok


def main():
    # La consola de Windows viene en cp1252 y revienta con un acento.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    print()
    print("EL FACTURADOR DE URBIS — prueba contra SUNAT (beta)")
    todo = True
    for afectacion in ("exonerado", "inafecto"):
        print()
        print("=" * 70)
        print("  UNA CUOTA DE LOTE, %s" % afectacion.upper())
        print("=" * 70)
        todo = probar(afectacion) and todo
    print()
    print("=" * 70)
    print("  TODO BIEN: SUNAT aceptó boleta y factura, exoneradas e inafectas."
          if todo else "  ALGO FALLÓ. El detalle está arriba.")
    print("=" * 70)
    return 0 if todo else 1


if __name__ == "__main__":
    sys.exit(main())
