#!/usr/bin/env bash
# AGREGAR (O CORREGIR) EL RUC DE UN PROYECTO, PREGUNTANDO.
#
#     bash /opt/facturador/agregar-emisor.sh
#
# Se corre EN EL SERVIDOR, como root. Pregunta campo por campo, las claves no se
# ven al escribirlas y nunca pasan por un chat ni quedan en el historial de la
# terminal. Un emisor nuevo nace en ambiente de PRUEBAS; pasarlo a producción es
# otro comando (pasar-a-produccion.sh), a propósito.
#
# ANTES: subir el certificado del dueño (.p12 o .pfx) al servidor, por ejemplo:
#     scp "C:\ruta\certificado.p12" root@157.245.8.78:/root/
set -euo pipefail

DIR="/etc/facturador/emisores"
USUARIO="facturador"

if [ "$(id -u)" != "0" ]; then echo "Se corre como root." >&2; exit 1; fi
if [ ! -d "$DIR" ]; then echo "No existe $DIR. Corré primero instalar.sh." >&2; exit 1; fi

leer() { # leer ARCHIVO CAMPO
  [ -f "$1" ] || { echo ""; return; }
  python3 -c "import json,sys; print(json.load(open(sys.argv[1], encoding='utf-8')).get(sys.argv[2], ''))" "$1" "$2"
}
preguntar() { # preguntar VARIABLE "Texto" [actual]
  local var="$1" texto="$2" actual="${3:-}" valor
  if [ -n "$actual" ]; then read -r -p "  $texto [$actual]: " valor; valor="${valor:-$actual}"
  else read -r -p "  $texto: " valor; fi
  printf -v "$var" '%s' "$valor"
}
preguntar_secreto() { # preguntar_secreto VARIABLE "Texto" ya_tiene(si/no)
  local var="$1" texto="$2" tiene="$3" valor
  if [ "$tiene" = "si" ]; then read -r -s -p "  $texto [ya hay una; Enter para dejarla]: " valor; echo
  else read -r -s -p "  $texto: " valor; echo; fi
  printf -v "$var" '%s' "$valor"
}

echo ""
echo "=================================================================="
echo "  EL RUC DE UN PROYECTO (emisor de boletas y facturas)"
echo "=================================================================="
echo "  Enter deja el valor que ya está (entre corchetes)."
echo ""

preguntar RUC "RUC del dueño del proyecto (11 dígitos)"
RUC="$(printf '%s' "$RUC" | tr -cd '0-9')"
if ! [[ "$RUC" =~ ^[0-9]{11}$ ]]; then echo "  El RUC tiene que ser 11 dígitos. No se guardó nada." >&2; exit 1; fi
ARCHIVO="$DIR/$RUC.json"
[ -f "$ARCHIVO" ] && echo "  (ese RUC ya está cargado: se corrige)"

echo ""
echo "--- Como figura en SUNAT (ficha RUC) ---"
preguntar RAZON     "Nombre o razón social"            "$(leer "$ARCHIVO" razon_social)"
preguntar COMERCIAL "Nombre comercial (el proyecto)"   "$(leer "$ARCHIVO" nombre_comercial)"

echo ""
echo "--- El IGV ---"
echo "  exonerado = sin IGV por la Amazonía (Ley 27037) · inafecto · gravado (con IGV)"
preguntar AFECTACION "Cómo vende este RUC" "$(leer "$ARCHIVO" afectacion_por_defecto)"
AFECTACION="${AFECTACION:-exonerado}"
case "$AFECTACION" in exonerado|inafecto|gravado) ;; *) echo "  Tiene que ser exonerado, inafecto o gravado. No se guardó nada." >&2; exit 1;; esac

echo ""
echo "--- La Clave SOL ---"
echo "  El usuario SECUNDARIO de facturación electrónica, SIN el RUC adelante."
echo "  (Si en SUNAT figura como ${RUC}MIUSUARIO, acá va solo MIUSUARIO.)"
preguntar USUARIO_SOL "Usuario SOL" "$(leer "$ARCHIVO" usuario_sol)"
[ -n "$USUARIO_SOL" ] || { echo "  Falta el usuario SOL. No se guardó nada." >&2; exit 1; }
TIENE="no"; [ -n "$(leer "$ARCHIVO" clave_sol)" ] && TIENE="si"
preguntar_secreto CLAVE_SOL "Clave SOL (no se ve al escribir)" "$TIENE"
if [ -n "$CLAVE_SOL" ]; then
  read -r -s -p "  Clave SOL otra vez, para confirmar: " CLAVE_SOL2; echo
  [ "$CLAVE_SOL" = "$CLAVE_SOL2" ] || { echo "  Las dos claves no coinciden. No se guardó nada." >&2; exit 1; }
  unset CLAVE_SOL2
  # LA CLAVE SOL TIENE MÁXIMO 12 CARACTERES y la web de SUNAT no lo dice: con 13
  # el portal se queda con los primeros 12 en silencio y deja entrar, pero el
  # servicio de envío compara los 12 (costó tres vueltas en El Cholao).
  if [ "${#CLAVE_SOL}" -gt 12 ]; then
    echo "  OJO: la clave tiene ${#CLAVE_SOL} caracteres y SUNAT usa solo 12. Se guardan los primeros 12."
    CLAVE_SOL="${CLAVE_SOL:0:12}"
  fi
elif [ "$TIENE" = "no" ]; then
  echo "  Falta la Clave SOL. No se guardó nada." >&2; exit 1
fi

echo ""
echo "--- El certificado digital ---"
CERT=""
for EXT in p12 pfx; do [ -f "$DIR/$RUC.$EXT" ] && CERT="$DIR/$RUC.$EXT"; done
if [ -n "$CERT" ]; then
  echo "  Ya hay uno cargado: $CERT"
  read -r -p "  Ruta de uno NUEVO para reemplazarlo [Enter = dejar el que está]: " ORIGEN
else
  echo "  El archivo .p12 o .pfx que subiste al servidor (por ejemplo /root/certificado.p12)."
  read -r -p "  Ruta del certificado [Enter = todavía no lo tengo]: " ORIGEN
fi
if [ -n "$ORIGEN" ]; then
  [ -f "$ORIGEN" ] || { echo "  No existe $ORIGEN. No se guardó nada." >&2; exit 1; }
  case "${ORIGEN,,}" in *.pfx) EXT=pfx;; *) EXT=p12;; esac
  rm -f "$DIR/$RUC.p12" "$DIR/$RUC.pfx"
  CERT="$DIR/$RUC.$EXT"
  install -o root -g "$USUARIO" -m 640 "$ORIGEN" "$CERT"
  echo "  copiado a $CERT (puedes borrar $ORIGEN)"
fi
TIENE="no"; [ -n "$(leer "$ARCHIVO" certificado_clave)" ] && TIENE="si"
CLAVE_CERT=""
if [ -n "$CERT" ]; then
  preguntar_secreto CLAVE_CERT "Contraseña del certificado (la que pusiste al bajarlo)" "$TIENE"
else
  echo "  Sin certificado: sirve para PRUEBAS (se usa uno de juguete), no para producción."
fi

export RUC RAZON COMERCIAL AFECTACION USUARIO_SOL CLAVE_SOL CERT CLAVE_CERT
python3 - "$ARCHIVO" <<'PY'
import json, os, sys
ruta = sys.argv[1]
d = {}
if os.path.exists(ruta):
    with open(ruta, encoding="utf-8") as f:
        d = json.load(f)
e = os.environ
d["ruc"] = e["RUC"]
d["razon_social"] = e["RAZON"].strip()
d["nombre_comercial"] = e["COMERCIAL"].strip()
d["afectacion_por_defecto"] = e["AFECTACION"]
d["usuario_sol"] = e["USUARIO_SOL"].strip()
if e["CLAVE_SOL"]:
    d["clave_sol"] = e["CLAVE_SOL"]
d["certificado_ruta"] = e["CERT"]
if e["CLAVE_CERT"]:
    d["certificado_clave"] = e["CLAVE_CERT"]
d.setdefault("ambiente", "beta")      # un emisor nuevo nace en PRUEBAS
tmp = ruta + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
os.replace(tmp, ruta)
PY
chown "root:$USUARIO" "$ARCHIVO"
chmod 640 "$ARCHIVO"
unset CLAVE_SOL CLAVE_CERT

echo ""
echo "  Guardado. Ambiente: $(leer "$ARCHIVO" ambiente) · IGV: $(leer "$ARCHIVO" afectacion_por_defecto)"
echo ""
echo "==> lo que dice el servicio (vuelve a cargar solo)"
sleep 1
curl -fsS http://127.0.0.1:8097/salud | RUC="$RUC" python3 -c "
import json, os, sys
d = json.load(sys.stdin); ruc = os.environ['RUC']
e = next((x for x in d.get('emisores', []) if x['ruc'] == ruc), None)
if e:
    print('  OK  %s · %s · ambiente %s · certificado %s (vence %s, faltan %s días)' % (
        e['ruc'], e['razon_social'], e['ambiente'], e['certificado'], e['certificado_vence'], e['certificado_dias']))
else:
    err = d.get('errores', {})
    print('  NO CARGÓ: ' + (err.get(ruc) or err.get(ruc + '.json') or 'sin detalle'))
    print('  Si dice que no se pudo abrir el certificado, suele ser su contraseña: vuelve a correr este asistente.')
    sys.exit(1)
"

echo ""
echo "==> probando la Clave SOL contra SUNAT (no emite nada)…"
bash /opt/facturador/probar-clave.sh "$RUC" || {
  echo ""
  echo "  La Clave SOL guardada NO entra en SUNAT. Vuelve a correr este asistente y"
  echo "  escríbela de nuevo (no des Enter en ese campo)."
  exit 1
}
echo ""
echo "  Listo. Este RUC queda en PRUEBAS hasta que corras:"
echo "      bash /opt/facturador/pasar-a-produccion.sh $RUC"
