/**
 * Database Backup Manager
 *
 * Strategy:
 *   - ECS platform backs up the production PostgreSQL container through
 *     scripts/backup-ecs-pg.sh (installed as /usr/local/bin/biof3-backup-ecs-pg.sh).
 *   - Legacy / non-platform nodes can still snapshot SQLite with VACUUM INTO.
 *
 * Exposed:
 *   - backupNow() — perform a backup immediately
 *   - listBackups() — list backups on OSS
 *   - downloadBackup(name) — get signed URL for download
 *   - startScheduler() — start daily 02:00 cron
 */

const fs = require('fs');
const path = require('path');
const {execFile} = require('child_process');
const Database = require('better-sqlite3');

const config = require('./config');
const IS_LOCAL = config.storageMode === 'local';

// OSS 模块延迟加载（桌面版不需要）
let OSS = null;
if (!IS_LOCAL) {
  try { OSS = require('ali-oss'); } catch {}
}

const DB_PATH = process.env.BIOF3_DB_PATH || '/opt/biof3-r-server/biof3.db';
const RETENTION_DAYS = 30;
const SQLITE_BACKUP_PREFIX = process.env.BIOF3_SQLITE_BACKUP_OSS_PREFIX || 'backups/db/';
const PG_BACKUP_PREFIX = (process.env.BIOF3_PG_BACKUP_OSS_PREFIX || 'backups/postgresql/').replace(/\/?$/, '/');
const PG_BACKUP_DIR = process.env.BIOF3_PG_BACKUP_DIR || '/opt/biof3-platform/backups/pg';
const PG_BACKUP_SCRIPT = process.env.BIOF3_PG_BACKUP_SCRIPT || '/usr/local/bin/biof3-backup-ecs-pg.sh';
const BACKUP_MODE = (process.env.BIOF3_BACKUP_MODE || (process.env.BIOF3_RUN_MODE === 'platform' ? 'postgres' : 'sqlite')).toLowerCase();
const IS_PG_BACKUP_MODE = BACKUP_MODE === 'postgres' || BACKUP_MODE === 'pg';

let _ossClient = null;
function getOss() {
  if (IS_LOCAL) return null;
  if (_ossClient) return _ossClient;
  if (!OSS) return null;
  _ossClient = new OSS({
    region: 'oss-cn-hangzhou',
    accessKeyId: process.env.OSS_AK,
    accessKeySecret: process.env.OSS_SK,
    bucket: 'biof3-uploads',
    timeout: 120000,
  });
  return _ossClient;
}

function fmtTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Take a consistent SQLite snapshot using VACUUM INTO. Returns local file path. */
function snapshotDb() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`DB not found: ${DB_PATH}`);
  const ts = fmtTimestamp();
  const tmpPath = path.join('/tmp', `biof3-${ts}.db`);
  const db = new Database(DB_PATH, {readonly: true});
  // VACUUM INTO creates a clean consistent copy (works even if DB is being written)
  // Path must not exist
  if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
  db.close();
  return {path: tmpPath, timestamp: ts};
}

/** Upload SQLite backup to OSS and return its key. */
async function uploadSqliteBackup(localPath, timestamp) {
  const key = `${SQLITE_BACKUP_PREFIX}biof3-${timestamp}.db`;
  await getOss().put(key, localPath);
  return key;
}

/** Delete OSS backups older than RETENTION_DAYS. */
async function pruneOldBackups(prefix) {
  const client = getOss();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  const all = [];
  let token;
  do {
    const r = await client.listV2({prefix, 'max-keys': 1000, 'continuation-token': token});
    if (r.objects) for (const o of r.objects) all.push(o);
    token = r.nextContinuationToken;
  } while (token);

  const toDelete = all.filter(o => new Date(o.lastModified).getTime() < cutoff);
  if (toDelete.length === 0) return {deleted: 0};

  const keys = toDelete.map(o => o.name);
  // Delete in batches of 100
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100);
    await client.deleteMulti(batch, {quiet: true});
    deleted += batch.length;
  }
  return {deleted};
}

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, {
      timeout: opts.timeout || 10 * 60 * 1000,
      maxBuffer: opts.maxBuffer || 8 * 1024 * 1024,
      env: {...process.env, ...(opts.env || {})},
    }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({stdout, stderr});
    });
  });
}

function readLatestPgBackup() {
  const latest = path.join(PG_BACKUP_DIR, 'latest.sql.gz');
  let localPath = latest;
  try {
    localPath = fs.realpathSync(latest);
  } catch {
    localPath = latest;
  }
  if (!fs.existsSync(localPath)) return null;
  const stat = fs.statSync(localPath);
  const name = path.basename(localPath);
  return {
    name,
    key: PG_BACKUP_PREFIX + name,
    localPath,
    sizeBytes: stat.size,
    sizeHuman: humanSize(stat.size),
    lastModified: stat.mtime.toISOString(),
  };
}

async function backupPostgresNow() {
  const result = {
    success: false,
    engine: 'postgres',
    timestamp: null,
    ossKey: null,
    sizeBytes: 0,
    sizeHuman: '',
    pruned: 0,
    error: null,
    stdout: '',
  };

  try {
    if (!fs.existsSync(PG_BACKUP_SCRIPT)) {
      throw new Error(`PostgreSQL backup script not found: ${PG_BACKUP_SCRIPT}`);
    }
    const out = await runCommand(PG_BACKUP_SCRIPT, []);
    result.stdout = String(out.stdout || '').slice(-4000);
    const latest = readLatestPgBackup();
    if (latest) {
      result.ossKey = latest.key;
      result.sizeBytes = latest.sizeBytes;
      result.sizeHuman = latest.sizeHuman;
      const m = latest.name.match(/(\d{8}_\d{6})/);
      result.timestamp = m ? m[1] : latest.lastModified;
      await getOss().head(latest.key);
    }
    try {
      const p = await pruneOldBackups(PG_BACKUP_PREFIX);
      result.pruned = p.deleted;
    } catch (e) {
      console.error('[Backup] PostgreSQL prune failed (non-fatal):', e.message);
    }
    result.success = true;
  } catch (e) {
    result.error = e.message + (e.stderr ? `\n${String(e.stderr).slice(-1000)}` : '');
    console.error('[Backup] PostgreSQL backup failed:', e.message);
  }
  return result;
}

/** Run a full SQLite backup: snapshot -> upload -> prune -> cleanup local. */
async function backupSqliteNow() {
  const result = {
    success: false,
    engine: 'sqlite',
    timestamp: null,
    ossKey: null,
    sizeBytes: 0,
    sizeHuman: '',
    pruned: 0,
    error: null,
  };

  let tmpPath = null;
  try {
    // Snapshot
    const snap = snapshotDb();
    tmpPath = snap.path;
    result.timestamp = snap.timestamp;
    const stat = fs.statSync(tmpPath);
    result.sizeBytes = stat.size;
    result.sizeHuman = humanSize(stat.size);

    // Upload
    result.ossKey = await uploadSqliteBackup(tmpPath, snap.timestamp);

    // Prune old
    try {
      const p = await pruneOldBackups(SQLITE_BACKUP_PREFIX);
      result.pruned = p.deleted;
    } catch (e) {
      console.error('[Backup] Prune failed (non-fatal):', e.message);
    }

    result.success = true;
  } catch (e) {
    result.error = e.message;
    console.error('[Backup] Failed:', e.message);
  } finally {
    // Cleanup local temp
    if (tmpPath && fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }
  return result;
}

/** Run a full backup for the active deployment mode. */
async function backupNow() {
  return IS_PG_BACKUP_MODE ? backupPostgresNow() : backupSqliteNow();
}

/** List backups on OSS, sorted by date desc. */
async function listBackups() {
  const client = getOss();
  const prefix = IS_PG_BACKUP_MODE ? PG_BACKUP_PREFIX : SQLITE_BACKUP_PREFIX;
  const engine = IS_PG_BACKUP_MODE ? 'postgres' : 'sqlite';
  const all = [];
  let token;
  do {
    const r = await client.listV2({prefix, 'max-keys': 1000, 'continuation-token': token});
    if (r.objects) for (const o of r.objects) {
      all.push({
        name: o.name.replace(prefix, ''),
        key: o.name,
        engine,
        size: o.size,
        sizeHuman: humanSize(o.size),
        lastModified: o.lastModified,
      });
    }
    token = r.nextContinuationToken;
  } while (token);

  return all.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
}

/** Generate a signed URL for downloading a specific backup. Valid for 1 hour. */
async function getDownloadUrl(name) {
  const prefix = IS_PG_BACKUP_MODE ? PG_BACKUP_PREFIX : SQLITE_BACKUP_PREFIX;
  const key = name.startsWith(prefix) ? name : prefix + name;
  return getOss().signatureUrl(key, {expires: 3600});
}

// ============================================================
// Scheduler — daily at 02:00
// ============================================================

let schedulerHandle = null;

function startScheduler() {
  if (schedulerHandle) return;

  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    schedulerHandle = setTimeout(async () => {
      try {
        const r = await backupNow();
        if (r.success) {
          console.log(`[BackupManager] Daily ${r.engine || BACKUP_MODE} backup OK: ${r.ossKey} (${r.sizeHuman}), pruned ${r.pruned} old`);
        } else {
          console.error('[BackupManager] Daily backup failed:', r.error);
        }
      } catch (e) {
        console.error('[BackupManager] Scheduler error:', e);
      }
      scheduleNext();
    }, delay);
    console.log(`[BackupManager] Next DB backup at ${next.toISOString()} (in ${Math.round(delay / 60000)} min)`);
  }

  scheduleNext();
}

function stopScheduler() {
  if (schedulerHandle) { clearTimeout(schedulerHandle); schedulerHandle = null; }
}

module.exports = {backupNow, listBackups, getDownloadUrl, startScheduler, stopScheduler};
