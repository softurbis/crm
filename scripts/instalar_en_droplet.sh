#!/usr/bin/env bash
# ============================================================================
# INSTALADOR DEL BACKUP DIARIO — correr UNA VEZ dentro del droplet (como root)
# ----------------------------------------------------------------------------
# Qué deja instalado:
#   /opt/urbis-backup/backup_supabase.mjs   el script de respaldo (datos+storage)
#   /opt/urbis-backup/correr_backup.sh      wrapper: corre + retención 14 días
#   /opt/urbis-backup/.env                  credenciales (copiadas de un .env ya presente)
#   cron diario a las 03:00                 log en /opt/urbis-backup/backup.log
#
# Los respaldos quedan en /opt/urbis-backup/copias/
#   data/AAAA-MM-DD/*.ndjson   (un snapshot por día, se conservan 14)
#   storage/<bucket>/...        (espejo incremental: solo baja lo nuevo)
# ============================================================================
set -u

DIR=/opt/urbis-backup
mkdir -p "$DIR/copias"

# 0) el script de respaldo: si no está, copiarlo del repo clonado
if [ ! -f "$DIR/backup_supabase.mjs" ]; then
  if [ -f /root/crm/scripts/backup_supabase.mjs ]; then
    cp /root/crm/scripts/backup_supabase.mjs "$DIR/"
    echo "OK: backup_supabase.mjs copiado del repo"
  else
    echo "ERROR: falta $DIR/backup_supabase.mjs (copialo primero)" >&2
    exit 1
  fi
fi

# 1) credenciales: reusar las de un .env que ya viva en el droplet (bot o worker)
if [ ! -f "$DIR/.env" ]; then
  ORIGEN=""
  if [ -f /opt/urbis-marketing/.env ]; then
    ORIGEN=/opt/urbis-marketing/.env
  else
    ORIGEN=$(grep -rls '^SUPABASE_SERVICE_KEY=' /opt /root --include='.env' 2>/dev/null | head -1 || true)
  fi
  if [ -n "$ORIGEN" ]; then
    grep -E '^SUPABASE_(URL|SERVICE_KEY|SERVICE_ROLE_KEY)=' "$ORIGEN" > "$DIR/.env"
    echo "OK: credenciales copiadas de $ORIGEN"
  else
    echo "ERROR: no encontre ningun .env con SUPABASE_SERVICE_KEY." >&2
    echo "Crea $DIR/.env con SUPABASE_URL=... y SUPABASE_SERVICE_KEY=..." >&2
    exit 1
  fi
fi
chmod 600 "$DIR/.env"

# 2) wrapper con retención
cat > "$DIR/correr_backup.sh" <<'EOS'
#!/usr/bin/env bash
set -u
DIR=/opt/urbis-backup
# cron trae un PATH pelado: sumar rutas tipicas de node (apt, manual y nvm)
PATH="$PATH:/usr/local/bin:/usr/bin"
command -v node >/dev/null 2>&1 || { for d in /root/.nvm/versions/node/*/bin; do PATH="$PATH:$d"; done; }
command -v node >/dev/null 2>&1 || { echo "ERROR: no encuentro node"; exit 1; }
echo "===== $(date '+%F %T') inicio ====="
# 1) la base de datos (todas las tablas)
node "$DIR/backup_supabase.mjs" --env "$DIR/.env" --out "$DIR/copias" --jobs 3
RC=$?
# 2) los ARCHIVOS, que desde ago 2026 viven en Cloudflare R2 (Cloudflare no hace
#    copias por ti). Si aún no hay credenciales de R2, se avisa y se continúa.
if [ -f "$DIR/.env.r2" ] && [ -f "$DIR/backup_r2.mjs" ]; then
  node "$DIR/backup_r2.mjs" --env "$DIR/.env.r2" --out "$DIR/copias/r2" --jobs 4 || RC=$?
else
  echo "AVISO: sin $DIR/.env.r2 — los archivos de R2 NO se estan respaldando"
fi
# retención: solo los últimos 14 snapshots diarios de datos (el storage es espejo, no crece por día)
ls -1d "$DIR/copias/data/"*/ 2>/dev/null | sort | head -n -14 | xargs -r rm -rf
echo "===== $(date '+%F %T') fin (rc=$RC) ====="
exit $RC
EOS
chmod +x "$DIR/correr_backup.sh"

# 3) cron diario a las 03:00 (hora del servidor) — sin trampas de set -e
TMPCRON=$(mktemp)
( crontab -l 2>/dev/null || true ) | grep -v correr_backup > "$TMPCRON" || true
echo "0 3 * * * /opt/urbis-backup/correr_backup.sh >> /opt/urbis-backup/backup.log 2>&1" >> "$TMPCRON"
crontab "$TMPCRON"
rm -f "$TMPCRON"
echo "OK: cron instalado (diario 03:00). Log: /opt/urbis-backup/backup.log"

echo ""
echo "INSTALADO. Prueba ahora mismo con:"
echo "  /opt/urbis-backup/correr_backup.sh | tail -20"
