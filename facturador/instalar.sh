#!/usr/bin/env bash
# INSTALAR (O ACTUALIZAR) EL FACTURADOR EN EL SERVIDOR DEL CRM.
#
#     bash /root/crm/facturador/instalar.sh
#
# Se corre EN EL SERVIDOR, como root. Se puede correr las veces que haga falta:
# actualiza el código y NO toca los emisores ya cargados.
#
# QUÉ MONTA
#   /opt/facturador            el código y su entorno de Python
#   /etc/facturador            servicio.json (token) y emisores/<RUC>.json + .p12
#   /var/lib/facturador/<RUC>  los XML firmados y los CDR — el respaldo legal
#   facturador.service         el servicio, en localhost:8097
#
# NO TOCA la base, ni el bot, ni el agente de cobranza. Queda SIN emisores: cada
# RUC se agrega después con agregar-emisor.sh, y nace en ambiente de PRUEBAS.
set -euo pipefail

DESTINO="/opt/facturador"
CONFIG="/etc/facturador"
DATOS="/var/lib/facturador"
USUARIO="facturador"

if [ "$(id -u)" != "0" ]; then
  echo "Se corre como root." >&2
  exit 1
fi

echo "==> usuario del servicio"
if ! id "$USUARIO" >/dev/null 2>&1; then
  useradd --system --home-dir "$DESTINO" --shell /usr/sbin/nologin "$USUARIO"
  echo "    creado: $USUARIO"
else
  echo "    ya existía"
fi

echo "==> carpetas"
mkdir -p "$DESTINO" "$CONFIG/emisores" "$DATOS"
chown -R "$USUARIO:$USUARIO" "$DATOS"

echo "==> código"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rm -rf "$DESTINO/facturador"
cp -r "$AQUI/facturador" "$DESTINO/"
find "$DESTINO/facturador" -name "__pycache__" -type d -prune -exec rm -rf {} + 2>/dev/null || true
cp "$AQUI/requirements.txt" "$AQUI/probar.py" "$AQUI/agregar-emisor.sh" "$AQUI/probar-clave.sh" "$AQUI/pasar-a-produccion.sh" "$DESTINO/"
chown -R "$USUARIO:$USUARIO" "$DESTINO/facturador"

echo "==> entorno de Python"
# Ubuntu trae Python pero NO trae `ensurepip`: viene en un paquete aparte
# (`python3.X-venv`). Sin eso `python3 -m venv` falla y deja un entorno a medias.
if ! python3 -c "import ensurepip" >/dev/null 2>&1; then
  VERSION="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
  echo "    falta ensurepip; instalando python${VERSION}-venv…"
  apt-get update -qq
  apt-get install -y -qq "python${VERSION}-venv" || apt-get install -y -qq python3-venv
fi
if ! python3 -c "import ensurepip" >/dev/null 2>&1; then
  echo "    NO se pudo instalar el soporte de entornos de Python (apt install python3-venv)." >&2
  exit 1
fi
# Se pregunta por `pip`, no por la carpeta: una carpeta no es un entorno.
if [ ! -x "$DESTINO/venv/bin/pip" ]; then
  rm -rf "$DESTINO/venv"
  python3 -m venv "$DESTINO/venv"
fi
"$DESTINO/venv/bin/pip" install --quiet --upgrade pip
"$DESTINO/venv/bin/pip" install --quiet -r "$DESTINO/requirements.txt"
chown -R "$USUARIO:$USUARIO" "$DESTINO/venv"
echo "    listo ($("$DESTINO/venv/bin/python" --version))"

echo "==> configuración común"
if [ ! -f "$CONFIG/servicio.json" ]; then
  TOKEN="$(openssl rand -hex 32)"
  printf '{\n  "token": "%s",\n  "archivo_dir": "%s"\n}\n' "$TOKEN" "$DATOS" > "$CONFIG/servicio.json"
  echo "    creado $CONFIG/servicio.json con un token nuevo"
else
  echo "    ya existía, no se toca"
fi

# LOS PERMISOS SE REHACEN SIEMPRE. El servicio corre como `facturador`, no como
# root: un archivo que no puede alcanzar se ve, desde adentro, igual que uno que
# no existe. El agente del CRM corre como root y lee el token de servicio.json.
echo "==> permisos de los secretos"
chown "root:$USUARIO" "$CONFIG" "$CONFIG/emisores" "$CONFIG/servicio.json"
chmod 750 "$CONFIG" "$CONFIG/emisores"
chmod 640 "$CONFIG/servicio.json"
for F in "$CONFIG"/emisores/*; do
  [ -f "$F" ] || continue
  chown "root:$USUARIO" "$F"
  chmod 640 "$F"
done

echo "==> servicio"
cp "$AQUI/facturador.service" /etc/systemd/system/facturador.service
systemctl daemon-reload
systemctl enable facturador >/dev/null 2>&1 || true
systemctl restart facturador
sleep 2

echo ""
if ! systemctl is-active --quiet facturador; then
  echo "    NO ARRANCÓ. Lo que dijo:"
  journalctl -u facturador -n 20 --no-pager
  exit 1
fi
echo "    activo"
echo ""
echo "==> emisores cargados"
curl -fsS http://127.0.0.1:8097/salud && echo ""

echo ""
echo "==> prueba completa contra SUNAT (ambiente de pruebas, con datos de juguete)"
"$DESTINO/venv/bin/python" "$DESTINO/probar.py" || {
  echo ""
  echo "  La prueba contra SUNAT falló. El servicio quedó instalado; manda esta salida a Claude."
  exit 1
}

cat <<'FIN'

LISTO. El facturador está instalado.

Para cargar el RUC de un proyecto (pide los datos ahí mismo; las claves no se ven):

    bash /opt/facturador/agregar-emisor.sh

Cada emisor nace en PRUEBAS. Pasarlo a producción es otro comando, a propósito:

    bash /opt/facturador/pasar-a-produccion.sh EL_RUC
FIN
