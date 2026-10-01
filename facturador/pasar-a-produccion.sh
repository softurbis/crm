#!/usr/bin/env bash
# PASAR UN RUC A PRODUCCIÓN (O DEVOLVERLO A PRUEBAS).
#
#     bash /opt/facturador/pasar-a-produccion.sh EL_RUC            -> producción
#     bash /opt/facturador/pasar-a-produccion.sh EL_RUC pruebas    -> vuelve a pruebas
#
# Es un comando aparte A PROPÓSITO: desde que un RUC está en producción, todo lo
# que se emita por él es un comprobante de verdad ante SUNAT. Pide escribir el
# RUC otra vez para que no pase por un Enter de más.
set -euo pipefail
if [ "$(id -u)" != "0" ]; then echo "Se corre como root." >&2; exit 1; fi
RUC="$(printf '%s' "${1:-}" | tr -cd '0-9')"
DESTINO="${2:-produccion}"
[ ${#RUC} -eq 11 ] || { echo "Uso: bash pasar-a-produccion.sh EL_RUC [pruebas]" >&2; exit 2; }
ARCHIVO="/etc/facturador/emisores/$RUC.json"
[ -f "$ARCHIVO" ] || { echo "Ese RUC no está cargado. Corre agregar-emisor.sh." >&2; exit 1; }
case "$DESTINO" in produccion) AMBIENTE=produccion;; pruebas|beta) AMBIENTE=beta;; *) echo "El segundo dato es 'pruebas' o nada." >&2; exit 2;; esac

if [ "$AMBIENTE" = "produccion" ]; then
  CERT=""
  for EXT in p12 pfx; do [ -f "/etc/facturador/emisores/$RUC.$EXT" ] && CERT=1; done
  [ -n "$CERT" ] || { echo "Ese RUC no tiene certificado cargado: sin certificado no se emite en producción." >&2; exit 1; }
  echo ""
  echo "  Desde ahora lo que se emita con el RUC $RUC es REAL ante SUNAT."
  read -r -p "  Para confirmar, escribe el RUC otra vez: " OTRA
  [ "$(printf '%s' "$OTRA" | tr -cd '0-9')" = "$RUC" ] || { echo "  No coincide. No se cambió nada." >&2; exit 1; }
  echo "==> probando la Clave SOL antes de cambiar…"
  bash /opt/facturador/probar-clave.sh "$RUC" || { echo "  No se cambió nada." >&2; exit 1; }
fi

python3 - "$ARCHIVO" "$AMBIENTE" <<'PY'
import json, os, sys
ruta, ambiente = sys.argv[1], sys.argv[2]
with open(ruta, encoding="utf-8") as f:
    d = json.load(f)
d["ambiente"] = ambiente
tmp = ruta + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
os.replace(tmp, ruta)
PY
chown root:facturador "$ARCHIVO"; chmod 640 "$ARCHIVO"
sleep 1
echo ""
curl -fsS http://127.0.0.1:8097/salud | RUC="$RUC" python3 -c "
import json, os, sys
d = json.load(sys.stdin); ruc = os.environ['RUC']
e = next((x for x in d.get('emisores', []) if x['ruc'] == ruc), None)
if not e:
    err = d.get('errores', {}); print('  NO CARGÓ: ' + (err.get(ruc) or err.get(ruc + '.json') or 'sin detalle')); sys.exit(1)
print('  %s · %s · AMBIENTE: %s · certificado %s (vence %s)' % (e['ruc'], e['razon_social'], e['ambiente'].upper(), e['certificado'], e['certificado_vence']))
"
