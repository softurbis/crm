#!/usr/bin/env bash
# PROBAR LA CLAVE SOL DE UN RUC CONTRA SUNAT, SIN EMITIR NADA.
#
#     bash /opt/facturador/probar-clave.sh EL_RUC
#
# Le pide a SUNAT (servicio de consulta de CDR, en producción) un dato con las
# credenciales de ese emisor. No emite ni cambia nada. Si SUNAT contesta
# 0102/0104 la clave está mal; 0110 es que el usuario secundario no tiene el
# perfil de facturación; cualquier otra respuesta significa que entraron. Existe
# porque la clave se escribe a ciegas y un dedo de más solo se descubre cuando
# SUNAT rechaza una factura de verdad.
set -euo pipefail
RUC="$(printf '%s' "${1:-}" | tr -cd '0-9')"
[ ${#RUC} -eq 11 ] || { echo "Uso: bash probar-clave.sh EL_RUC (11 dígitos)" >&2; exit 2; }
cd /opt/facturador && venv/bin/python - "$RUC" <<"PY"
import json, sys, requests
from lxml import etree
ruc = sys.argv[1]
d = json.load(open("/etc/facturador/emisores/%s.json" % ruc, encoding="utf-8"))
esc = lambda t: t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
sobre = """<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><soapenv:Header><wsse:Security><wsse:UsernameToken><wsse:Username>%s</wsse:Username><wsse:Password>%s</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header><soapenv:Body><ser:getStatusCdr><rucComprobante>%s</rucComprobante><tipoComprobante>01</tipoComprobante><serieComprobante>F001</serieComprobante><numeroComprobante>1</numeroComprobante></ser:getStatusCdr></soapenv:Body></soapenv:Envelope>""" % (esc(d["ruc"] + d["usuario_sol"]), esc(d["clave_sol"]), d["ruc"])
try:
    r = requests.post("https://e-factura.sunat.gob.pe/ol-it-wsconscpegem/billConsultService", data=sobre.encode(), headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": ""}, timeout=40)
except Exception as e:
    print("  No se pudo llegar a SUNAT:", e); raise SystemExit(2)
cod = msg = ""
try:
    for el in etree.fromstring(r.content).iter():
        n = etree.QName(el).localname
        if n in ("faultcode", "statusCode") and not cod: cod = (el.text or "").strip()
        if n in ("faultstring", "statusMessage") and not msg: msg = (el.text or "").strip()
except Exception:
    pass
print("  Usuario:", d["ruc"] + d["usuario_sol"])
if "0110" in cod:
    print("  EL USUARIO NO TIENE EL PERFIL DE FACTURACIÓN ->", cod, msg)
    print("  En SUNAT: al usuario secundario hay que asignarle 'SEE - Del Contribuyente y Envío de Documentos'.")
    raise SystemExit(1)
if any(k in cod for k in ("0102", "0104")):
    print("  CLAVE INCORRECTA ->", cod, msg); raise SystemExit(1)
print("  CREDENCIALES OK (SUNAT contestó:", cod, msg[:60] + ")")
PY
