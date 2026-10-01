#!/usr/bin/env bash
# PROBAR LA CLAVE SOL DE UN RUC CONTRA SUNAT, SIN EMITIR NADA.
#
#     bash /opt/facturador/probar-clave.sh EL_RUC
#
# Le pide a SUNAT (servicio de consulta de CDR, en producción) un dato con las
# credenciales de ese emisor. No emite ni cambia nada. Los códigos 0100 a 0111 de
# SUNAT son de la puerta de entrada (usuario que no existe, clave mala, usuario
# sin perfil): con cualquiera de esos NO entraron. Otra respuesta —por ejemplo
# "el comprobante no existe"— significa que sí. Existe
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
import re
n = (re.search(r"(\d{4})\s*$", cod) or [None, ""])[1]
if d["usuario_sol"] == d["ruc"]:
    print("  EN EL USUARIO SE GUARDÓ EL RUC. Ahí va el nombre del usuario secundario de SUNAT.")
    raise SystemExit(1)
if n in ("0110", "0111"):
    print("  EL USUARIO NO TIENE EL PERFIL DE FACTURACIÓN ->", cod, msg)
    print("  En SUNAT: al usuario secundario hay que asignarle 'SEE - Del Contribuyente y Envío de Documentos'.")
    raise SystemExit(1)
if n == "0103":
    print("  ESE USUARIO NO EXISTE EN SUNAT ->", cod, msg)
    print("  Va solo el nombre del usuario secundario (sin el RUC), tal como lo creaste en SUNAT.")
    raise SystemExit(1)
if n in ("0102", "0104"):
    print("  CLAVE INCORRECTA ->", cod, msg); raise SystemExit(1)
if n in ("0105", "0106"):
    print("  EL USUARIO NO ESTÁ ACTIVO O NO ES VÁLIDO ->", cod, msg); raise SystemExit(1)
# 0100-0111 es la puerta de entrada de SUNAT: nada de ese rango es "entraron"
if n.isdigit() and 100 <= int(n) <= 111:
    print("  SUNAT NO DEJÓ ENTRAR ->", cod, msg); raise SystemExit(1)
if not cod and r.status_code >= 500:
    print("  SUNAT no está contestando (", r.status_code, "). Prueba de nuevo en unos minutos.")
    raise SystemExit(2)
print("  CREDENCIALES OK (SUNAT contestó:", cod, msg[:60] + ")")

# SEGUNDA PUERTA (1 oct 2026): la consulta de arriba y el ENVÍO son servicios
# distintos de SUNAT, cada uno con su perfil. El usuario de Century pasó la consulta
# y aun así SUNAT le rechazó la primera factura real con 0111: le faltaba el perfil
# de envío. Aquí se toca el servicio de envío de verdad preguntando por un ticket
# que no existe: no envía nada, pero SUNAT contesta 0111 si el perfil no está.
sobre2 = """<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ser="http://service.sunat.gob.pe" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><soapenv:Header><wsse:Security><wsse:UsernameToken><wsse:Username>%s</wsse:Username><wsse:Password>%s</wsse:Password></wsse:UsernameToken></wsse:Security></soapenv:Header><soapenv:Body><ser:getStatus><ticket>100000000000000</ticket></ser:getStatus></soapenv:Body></soapenv:Envelope>""" % (esc(d["ruc"] + d["usuario_sol"]), esc(d["clave_sol"]))
try:
    r2 = requests.post("https://e-factura.sunat.gob.pe/ol-ti-itcpfegem/billService", data=sobre2.encode(), headers={"Content-Type": "text/xml; charset=utf-8", "SOAPAction": ""}, timeout=40)
except Exception as e:
    print("  No se pudo llegar al servicio de ENVÍO de SUNAT:", e); raise SystemExit(2)
cod2 = msg2 = ""
try:
    for el in etree.fromstring(r2.content).iter():
        n2 = etree.QName(el).localname
        if n2 in ("faultcode", "statusCode") and not cod2: cod2 = (el.text or "").strip()
        if n2 in ("faultstring", "statusMessage") and not msg2: msg2 = (el.text or "").strip()
except Exception:
    pass
n2 = (re.search(r"(\d{4})\s*$", cod2) or [None, ""])[1]
if n2 in ("0110", "0111"):
    print("  PERO NO PUEDE ENVIAR COMPROBANTES ->", cod2, msg2)
    print("  En SUNAT (con la Clave SOL principal): Empresas -> Administración de usuarios secundarios ->")
    print("  ese usuario -> marcar el perfil 'Envío de documentos electrónicos - Grandes Emisores'")
    print("  (está dentro de Comprobantes de pago / SEE - Del Contribuyente) y guardar.")
    raise SystemExit(1)
if n2.isdigit() and 100 <= int(n2) <= 111:
    print("  EL SERVICIO DE ENVÍO NO LO DEJÓ ENTRAR ->", cod2, msg2); raise SystemExit(1)
if not cod2 and r2.status_code >= 500:
    print("  El servicio de envío de SUNAT no está contestando (", r2.status_code, "): no se pudo comprobar el perfil de envío.")
    raise SystemExit(2)
print("  PUEDE ENVIAR COMPROBANTES (SUNAT contestó:", cod2, msg2[:60] + ")")
PY
