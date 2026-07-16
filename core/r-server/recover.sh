#!/bin/bash
# BioF3 R Server — restore SQLite from latest backup.
#
# Usage:
#   /opt/biof3-r-server/recover.sh [--list]      # List available backups
#   /opt/biof3-r-server/recover.sh [--latest]    # Restore from most recent local backup (default)
#   /opt/biof3-r-server/recover.sh <file>        # Restore from specific .db.gz file
#   /opt/biof3-r-server/recover.sh --from-oss <yyyy-mm-wN>  # Pull weekly backup from OSS
#   /opt/biof3-r-server/recover.sh --dry-run     # Show what would happen, change nothing
#
# What it does:
#   1. Stop pm2 process (so SQLite is not held open)
#   2. Move current biof3.db to biof3.db.broken-<ts> (NEVER delete)
#   3. Decompress chosen backup to biof3.db
#   4. Run integrity_check
#   5. Restart pm2
#   6. Health check
#
# Safety:
#   - Never deletes the broken DB; you can roll back manually
#   - Refuses to run during a 04:00-04:05 backup window
#   - Logs everything to /var/log/biof3-recover.log
set -e

# Source secrets
if [ -f /etc/biof3.env ]; then
  set -a; . /etc/biof3.env; set +a
fi

SERVER_DIR="/opt/biof3-r-server"
BACKUP_DIR="${SERVER_DIR}/backups"
LOG="/var/log/biof3-recover.log"

mode="latest"
arg=""
dry_run=0

while [ $# -gt 0 ]; do
  case "$1" in
    --list)     mode="list"; shift ;;
    --latest)   mode="latest"; shift ;;
    --from-oss) mode="oss"; arg="$2"; shift 2 ;;
    --dry-run)  dry_run=1; shift ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# //'
      exit 0
      ;;
    *) mode="file"; arg="$1"; shift ;;
  esac
done

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

cd "$SERVER_DIR"

# ---- LIST mode ----
if [ "$mode" = "list" ]; then
  echo "Local backups in $BACKUP_DIR:"
  ls -lh "$BACKUP_DIR"/biof3.*.db.gz 2>/dev/null | awk '{printf "  %s  %s\n", $5, $9}' | sort -r
  echo
  echo "OSS weekly backups (path: backups/biof3-r-server/):"
  if [ -n "${OSS_AK:-}" ]; then
    node -e '
      const OSS = require("'"$SERVER_DIR"'/node_modules/ali-oss");
      const c = new OSS({region:"oss-cn-hangzhou", accessKeyId:process.env.OSS_AK, accessKeySecret:process.env.OSS_SK, bucket:"biof3-uploads"});
      c.list({prefix:"backups/biof3-r-server/", "max-keys":20}, {timeout:8000}).then(r => {
        for (const o of (r.objects || [])) console.log("  " + (o.size/1024).toFixed(0) + "K  " + o.name);
      }).catch(e => console.error("  (OSS list failed: " + e.message + ")"));
    '
  else
    echo "  (OSS_AK not set — only local backups available)"
  fi
  exit 0
fi

# ---- Determine source file ----
src=""
case "$mode" in
  latest)
    src=$(ls -t "$BACKUP_DIR"/biof3.*.db.gz 2>/dev/null | head -1)
    [ -z "$src" ] && { log "ERROR: no local backups in $BACKUP_DIR"; exit 1; }
    ;;
  file)
    if [ -f "$arg" ]; then
      src="$arg"
    elif [ -f "$BACKUP_DIR/$arg" ]; then
      src="$BACKUP_DIR/$arg"
    else
      log "ERROR: backup file not found: $arg"; exit 1
    fi
    ;;
  oss)
    [ -z "$arg" ] && { log "ERROR: --from-oss needs a key (e.g. 2026-05-w3)"; exit 1; }
    [ -z "${OSS_AK:-}" ] && { log "ERROR: OSS_AK not set"; exit 1; }
    src="$BACKUP_DIR/biof3.from-oss-$arg.db.gz"
    log "Pulling backups/biof3-r-server/biof3.${arg}.db.gz from OSS → $src"
    [ "$dry_run" = "1" ] && { log "[dry-run] would download from OSS"; exit 0; }
    node -e "
      const OSS = require('$SERVER_DIR/node_modules/ali-oss');
      const c = new OSS({region:'oss-cn-hangzhou', accessKeyId:process.env.OSS_AK, accessKeySecret:process.env.OSS_SK, bucket:'biof3-uploads'});
      c.get('backups/biof3-r-server/biof3.${arg}.db.gz', '$src').then(()=>{console.log('  ✓ downloaded');}).catch(e=>{console.error('  ✗ ' + e.message); process.exit(1);});
    " || exit 1
    ;;
esac

log "Source backup: $src"
[ ! -f "$src" ] && { log "ERROR: source not found"; exit 1; }

# ---- Refuse during backup window ----
hh=$(date +%H); mm=$(date +%M)
if [ "$hh" = "04" ] && [ "$mm" -lt 5 ]; then
  log "WARN: nightly backup window (04:00-04:05). Wait a few minutes."
  exit 1
fi

# ---- Show plan ----
log "Plan:"
log "  1. Stop pm2 biof3-r-server"
log "  2. Move biof3.db → biof3.db.broken-$(date +%Y%m%d_%H%M%S)"
log "  3. Decompress $src → biof3.db"
log "  4. SQLite integrity_check"
log "  5. Restart pm2 + health check"

if [ "$dry_run" = "1" ]; then
  log "[dry-run] No actions taken."
  exit 0
fi

# ---- Confirm if interactive ----
if [ -t 0 ]; then
  echo -n "Proceed? [y/N] "
  read ans
  [ "$ans" != "y" ] && { log "Aborted."; exit 1; }
fi

# ---- Execute ----
log "▶ pm2 stop"
pm2 stop biof3-r-server 2>&1 | tail -2 | tee -a "$LOG"

ts=$(date +%Y%m%d_%H%M%S)
broken="${SERVER_DIR}/biof3.db.broken-${ts}"
if [ -f "$SERVER_DIR/biof3.db" ]; then
  log "▶ Moving current DB → $broken"
  mv "$SERVER_DIR/biof3.db" "$broken"
  # Also move WAL/SHM if present (will be regenerated)
  [ -f "$SERVER_DIR/biof3.db-wal" ] && mv "$SERVER_DIR/biof3.db-wal" "${broken}-wal"
  [ -f "$SERVER_DIR/biof3.db-shm" ] && mv "$SERVER_DIR/biof3.db-shm" "${broken}-shm"
fi

log "▶ Decompressing $src"
gunzip -c "$src" > "$SERVER_DIR/biof3.db"
log "  ✓ size: $(ls -lh $SERVER_DIR/biof3.db | awk '{print $5}')"

log "▶ SQLite integrity_check"
check=$(node -e "
  const D = require('$SERVER_DIR/node_modules/better-sqlite3');
  const d = new D('$SERVER_DIR/biof3.db', {readonly: true});
  console.log(d.prepare('PRAGMA integrity_check').get().integrity_check);
" 2>&1)
log "  result: $check"
if [ "$check" != "ok" ]; then
  log "ERROR: integrity check failed. Restoring broken DB."
  mv "$broken" "$SERVER_DIR/biof3.db"
  pm2 start biof3-r-server 2>&1 | tail -2 | tee -a "$LOG"
  exit 1
fi

log "▶ Restarting pm2"
pm2 start biof3-r-server 2>&1 | tail -2 | tee -a "$LOG"

sleep 3
log "▶ Health check"
status=$(curl -so /dev/null -w "%{http_code}" -m 5 "http://127.0.0.1:3001/api/health")
if [ "$status" = "200" ]; then
  log "  ✓ HTTP $status"
  log "✅ Recovery complete. Broken DB preserved at $broken (delete after verification)."
else
  log "  ✗ HTTP $status — service not healthy"
  exit 1
fi
