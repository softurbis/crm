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


def probar_notas():
    """
    LA NOTA DE CRÉDITO: se emite una boleta y una factura y después la nota que
    anula cada una (motivo 01), como cuando pasaron los 7 días de la baja.

    En beta la nota de la boleta viaja sola (como la boleta en beta). Además se
    manda un RESUMEN con la nota adentro: en producción es por ahí que viaja.
    """
    cfg = config_de_pruebas("exonerado")
    cert = mod_cert.cargar(cfg)
    n = str(int(dt.datetime.now().timestamp()) % 100000)
    ok = True
    item = {"descripcion": "CUOTA N° 12 DE 48 - LOTE 5 MZ E - LAS PRADERAS DE PUCALLPA", "cantidad": 1, "precio_con_igv": "356.00"}
    for tipo, serie, serie_nc, cliente in [
        ("boleta", "B001", "BC01", {"tipo_doc": "1", "numero": "44896429", "nombre": "MARITZA REYES FASABI"}),
        ("factura", "F001", "FC01", {"tipo_doc": "6", "numero": "20123456789", "nombre": "CLIENTE DE PRUEBA SAC"}),
    ]:
        print()
        print("  %s %s-%s y su NOTA DE CRÉDITO %s-%s" % (tipo.upper(), serie, n, serie_nc, n))
        try:
            r = emisor.emitir(cfg, cert, {"tipo": tipo, "serie": serie, "numero": n, "cliente": cliente,
                                          "items": [item], "total_cobrado": "356.00"})
            print("     original: %s · %s · %s" % (r["estado"], r["codigo"], r["mensaje"]))
            ok = ok and r["estado"] == "aceptado"
            nc = emisor.emitir(cfg, cert, {
                "tipo": "nota_credito", "serie": serie_nc, "numero": n, "cliente": cliente,
                "referencia": {"tipo": tipo, "serie": serie, "numero": n},
                "motivo_codigo": "01", "motivo": "COMPROBANTE DUPLICADO: EL MISMO PAGO SE INFORMO DOS VECES",
                "items": [item], "total_cobrado": "356.00",
            })
            print("     nota:     %s · %s · %s" % (nc["estado"], nc["codigo"], nc["mensaje"]))
            if nc["estado"] != "aceptado":
                print("     detalle: %s" % nc.get("detalle", "")[:400])
                ok = False
        except Exception as err:
            print("     FALLA antes de SUNAT: %s" % err)
            ok = False

    # El resumen con la nota de la boleta adentro (así viaja en producción).
    print()
    print("  RESUMEN con la nota BC01-%s (en producción viaja por aquí)" % n)
    try:
        r = emisor.emitir_resumen(cfg, cert, {
            "fecha": dt.date.today().isoformat(), "correlativo": n[-3:],
            "boletas": [{
                "tipo_codigo": "07", "serie": "BC01", "numero": n, "total": "356.00",
                "exonerado": "356.00", "igv": "0.00", "condicion": "1",
                "cliente_tipo_doc": "1", "cliente_numero": "44896429",
                "referencia": {"serie": "B001", "numero": n, "tipo_codigo": "03"},
            }],
        })
        print("     envío: %s · ticket %s · %s %s" % (r["estado"], r.get("ticket"), r["codigo"], r["mensaje"]))
        if r.get("ticket"):
            import time
            for _ in range(6):
                time.sleep(5)
                t = emisor.consultar(cfg, r["ticket"], r["documento"])
                print("     ticket: %s · %s · %s" % (t["estado"], t["codigo"], t["mensaje"]))
                if t["estado"] != "esperando":
                    break
    except Exception as err:
        print("     FALLA: %s" % err)
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
    if "notas" in sys.argv[1:]:
        print()
        print("=" * 70)
        print("  NOTAS DE CRÉDITO")
        print("=" * 70)
        todo = probar_notas()
        print()
        print("  TODO BIEN" if todo else "  ALGO FALLÓ. El detalle está arriba.")
        return 0 if todo else 1
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
