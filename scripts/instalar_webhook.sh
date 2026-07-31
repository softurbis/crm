#!/usr/bin/env bash
# ============================================================================
# WEBHOOK HTTPS PARA EL MOTOR DE LEADS (Cloud API) — correr en el droplet (root)
# ----------------------------------------------------------------------------
# Instala Caddy (HTTPS automatico con Let's Encrypt), publica /webhook hacia
# leads_api.js (puerto 8090) y deja el motor corriendo bajo pm2.
#
# Uso:  bash instalar_webhook.sh TU_SUBDOMINIO      (sin .duckdns.org)
# Antes: crear el subdominio en duckdns.org apuntando a la IP de este droplet.
# ============================================================================
set -u
SUB="${1:-}"
if [ -z "$SUB" ]; then echo "Uso: bash instalar_webhook.sh TU_SUBDOMINIO (sin .duckdns.org)"; exit 1; fi
DOM="$SUB.duckdns.org"

echo "== 1/4 Caddy =="
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
else
  echo "caddy ya instalado"
fi

echo "== 2/4 puertos 80/443 (si hay firewall) =="
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true

echo "== 3/4 Caddyfile para $DOM =="
cat > /etc/caddy/Caddyfile <<EOF
$DOM {
    handle /webhook* {
        reverse_proxy localhost:8090
    }
    handle {
        respond "Urbis webhook OK" 200
    }
}
EOF
systemctl restart caddy

echo "== 4/4 motor de leads bajo pm2 =="
cd /root/crm/agente
if pm2 describe leads-api >/dev/null 2>&1; then pm2 restart leads-api --update-env; else pm2 start leads_api.js --name leads-api; fi
pm2 save >/dev/null

echo ""
echo "== VERIFICACION =="
sleep 4
curl -s -o /dev/null -w "https://$DOM  ->  HTTP %{http_code}\n" "https://$DOM" || echo "(el certificado puede tardar ~1 min; reintenta el curl)"
echo ""
echo "Pega esto en Meta (Paso 2 - Configurar webhooks):"
echo "  URL de devolucion de llamada:  https://$DOM/webhook"
echo "  Token de verificacion:         el WA_VERIFY_TOKEN de tu .env"
echo ""
pm2 status
