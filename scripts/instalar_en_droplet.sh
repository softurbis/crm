#!/usr/bin/env bash
# ============================================================================
# INSTALADOR DEL BACKUP DIARIO — correr UNA VEZ dentro del droplet (como root)
# ----------------------------------------------------------------------------
# Qué deja instalado:
#   /opt/urbis-backup/backup_supabase.mjs   el script de respaldo (datos+storage)
#   /opt/urbis-backup/correr_backup.sh      wrapper: corre + retención 14 días
#   /opt/urbis-backup/.env                  credenciales (copiadas del worker mkt)
#   cron diario a las 03:00                 log en /opt/urbis-backup/backup.log
#
# Los respaldos quedan en /opt/urbis-backup/copias/
#   data/AAAA-MM-DD/*.ndjson   (un snapshot por día, se conservan 14)
#   storage/<bucket>/...        (espejo incremental: solo baja lo nuevo)
# ============================================================================
set -euo pipefail

DIR=/opt/urbis-backup
mkdir -p "$DIR/copias"

# 1) credenciales: reusar las de un .env que ya viva en el droplet (worker mkt o bot)
if [ ! -f "$DIR/.env" ]; then
  ORIGEN=""
  [ -f /opt/urbis-marketing/.env ] && ORIGEN=/opt/urbis-marketing/.env
  if [ -z "$ORIGEN" ]; then
    ORIGEN=$(grep -rlsE '^SUPABASE_SERVICE_KEY=' /opt /root --include='.env' 2>/dev/null | head -1)
  fi
  if [ -n "$ORIGEN" ]; then
    grep -E '^SUPABASE_(URL|SERVICE_KEY|SERVICE_ROLE_KEY)=' "$ORIGEN" > "$DIR/.env"
    echo "OK: credenciales copiadas de $ORIGEN"
  else
    echo "ATENCION: crea $DIR/.env con SUPABASE_URL=... y SUPABASE_SERVICE_KEY=..." >&2
    exit 1
  fi
fi
chmod 600 "$DIR/.env"

# 2) wrapper con retención
cat > "$DIR/correr_backup.sh" <<'EOS'
#!/usr/bin/env bash
set -uo pipefail
DIR=/opt/urbis-backup
# cron trae un PATH pelado: sumar rutas tipicas de node (apt, manual y nvm)
PATH="$PATH:/usr/local/bin:/usr/bin"
command -v node >/dev/null 2>&1 || { for d in /root/.nvm/versions/node/*/bin; do PATH="$PATH:$d"; done; }
command -v node >/dev/null 2>&1 || { echo "ERROR: no encuentro node"; exit 1; }
echo "===== $(date '+%F %T') inicio ====="
node "$DIR/backup_supabase.mjs" --env "$DIR/.env" --out "$DIR/copias" --jobs 3
RC=$?
# retención: solo los últimos 14 snapshots diarios de datos (el storage es espejo, no crece por día)
ls -1d "$DIR/copias/data/"*/ 2>/dev/null | sort | head -n -14 | xargs -r rm -rf
echo "===== $(date '+%F %T') fin (rc=$RC) ====="
exit $RC
EOS
chmod +x "$DIR/correr_backup.sh"

# 3) cron diario a las 03:00 (hora del servidor)
( crontab -l 2>/dev/null | grep -v correr_backup ; echo "0 3 * * * /opt/urbis-backup/correr_backup.sh >> /opt/urbis-backup/backup.log 2>&1" ) | crontab -

echo ""
echo "INSTALADO. Prueba ahora mismo con:"
echo "  /opt/urbis-backup/correr_backup.sh | tail -20"
echo "Y revisa el espacio libre con: df -h /"
