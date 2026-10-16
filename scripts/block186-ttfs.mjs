#!/usr/bin/env node
/**
 * scripts/block186-ttfs.mjs — BLOCK-186 P3 TTFS 只读查询 CLI（本机自审计面）。
 *
 * 复用已发布原语（不重实现 SQL）：core/petri-server/helpers/funnel-log.js 的
 * computeTTFS() / recentFunnelEvents()，经 _setFunnelDb 注入本机 petri.db 只读句柄。
 * 读目标库：--db=<path> 显式，否则 process.env.PETRI_DB_PATH。断网可用、零外发、
 * 用户可直接查看/删除本机漏斗行（魂②本地主权 + ③证据自证）。只读，不改任何数据。
 *
 * 用法：node scripts/block186-ttfs.mjs [--db=<petri.db>] [--user=<id>] [--limit=N] [--json]
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else if (/^--json$/.test(a)) out.json = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const dbPath = args.db || process.env.PETRI_DB_PATH;
  if (!dbPath) {
    console.error('未指定本机库：用 --db=<petri.db> 或设 PETRI_DB_PATH。');
    process.exit(2);
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`库不存在：${dbPath}`);
    process.exit(2);
  }

  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true });
  db.pragma('busy_timeout = 5000');

  const funnelLog = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'funnel-log.js'));
  funnelLog._setFunnelDb(db);

  const filter = args.user ? { userId: args.user } : {};
  const ttfs = await funnelLog.computeTTFS(filter);
  const recent = await funnelLog.recentFunnelEvents({ limit: Number(args.limit) || 20 });

  if (args.json) {
    console.log(JSON.stringify({ ttfs, recent }, null, 2));
  } else {
    const mins = ttfs && Number.isFinite(ttfs.ttfsMs) ? (ttfs.ttfsMs / 60000).toFixed(2) : null;
    console.log(`TTFS（首次成功 − 启动）：${ttfs?.ttfsMs ?? 'null'} ms${mins ? `（≈ ${mins} 分钟）` : ''}`);
    console.log(`  app_started  : ${ttfs?.appStartedAt ?? '(无)'}`);
    console.log(`  first_success: ${ttfs?.firstSuccessAt ?? '(无——尚无 first_job_succeeded)'}`);
    console.log(`最近漏斗事件（${(recent || []).length} 条，最新在前）：`);
    for (const r of recent || []) console.log(`  ${r.at}  ${r.event}${r.userId ? `  user=${r.userId}` : ''}`);
    if (!ttfs || ttfs.ttfsMs == null) {
      console.log('\n提示：TTFS=null 表示本机台账尚无 app_started→first_job_succeeded 完整对（诚实不编造）。');
    }
  }
  try { db.close(); } catch { /* injected handle cached in funnel-log */ }
}

main().catch((e) => { console.error(e); process.exit(1); });
