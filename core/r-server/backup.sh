#!/bin/bash
# BioF3 R Server SQLite backup
# - 每天本地保留 14 份（14 天）
# - 周日另推一份到 OSS 跨机器容灾
# - 用 SQLite 的 .backup 命令保证一致性（不会因为 WAL 中途快照而损坏）

set -e

# Source secrets (OSS_AK / OSS_SK / etc.) — cron doesn't pick these up automatically
if [ -f /etc/biof3.env ]; then
  set -a
  . /etc/biof3.env
  set +a
fi

SERVER_DIR="/opt/biof3-r-server"
BACKUP_DIR="${SERVER_DIR}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)   # 1=Mon ... 7=Sun
RETENTION_DAYS=14

mkdir -p "${BACKUP_DIR}"

cd "${SERVER_DIR}"

DST="${BACKUP_DIR}/biof3.${TIMESTAMP}.db"

echo "[$(date)] 📦 Backing up SQLite to ${DST}"
# Use better-sqlite3 .backup() which is consistent across WAL state
node -e "
const D = require('${SERVER_DIR}/node_modules/better-sqlite3');
const src = new D('${SERVER_DIR}/biof3.db', {readonly: true});
src.backup('${DST}').then(() => { console.log('  ✓ snapshot ok'); process.exit(0); }).catch((e) => { console.error('snapshot failed:', e.message); process.exit(1); });
"

# Compress
gzip -f "${DST}"
echo "  ✓ Compressed → ${DST}.gz ($(ls -lh ${DST}.gz | awk '{print $5}'))"

# Cleanup old (older than 14 days)
DELETED=$(find "${BACKUP_DIR}" -type f -name 'biof3.*.db.gz' -mtime +${RETENTION_DAYS} -delete -print | wc -l)
[ "${DELETED}" -gt 0 ] && echo "  🧹 Removed ${DELETED} old backup(s)"

# On Sundays, also push to OSS for off-site archive
if [ "${DAY_OF_WEEK}" = "7" ]; then
  echo "[$(date)] ☁ Pushing weekly snapshot to OSS"
  node -e "
const OSS = require('${SERVER_DIR}/node_modules/ali-oss');
const fs = require('fs');
const cfg = {
  region: 'oss-cn-hangzhou',
  accessKeyId: process.env.OSS_AK,
  accessKeySecret: process.env.OSS_SK,
  bucket: 'biof3-uploads',
};
const client = new OSS(cfg);
const local = '${DST}.gz';
const remote = 'backups/biof3-r-server/biof3.\$(date +%Y-W%V).db.gz'.replace('\$(date +%Y-W%V)', new Date().toISOString().slice(0,7) + '-w' + Math.ceil(new Date().getDate()/7));
client.put(remote, local).then(r => console.log('  ✓ OSS uploaded: ' + r.url)).catch(e => { console.error('OSS upload failed:', e.message); process.exit(0); });
"
fi

echo "[$(date)] ✅ Done"
