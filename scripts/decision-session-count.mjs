#!/usr/bin/env node
/**
 * decision-session-count — Jev 调用计数（2026-09-25 用户裁决两连）：
 *   v1：会话锚（marker 起点）——修复"24h 窗口跨会话误量"
 *   v2（本版，用户追问「为啥一直 jev×1」）：**分段口径**——marker 记 startedAt +
 *   lastReadAt 两个时间戳；每次收尾重跑输出「本轮增量 N（自上次收尾）+ 累计 M（自锚点）」，
 *   读写后 lastReadAt 前移。增量=当前工作阶段的 Jev 消耗，累计=会话总量，双双如实。
 *
 * 用法：npm run decision:session [-- --reset]
 * 配套规则（AGENTS.md 透明标签）：收尾标签写 jev×N（**本轮增量**，即自上次收尾）；
 * 禁止复用上一轮数字；零次如实标 jev×0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function anchorDecisionDbPath() {
  if (process.env.BIOF3_DB_PATH) return;
  const candidates = [
    path.join(process.cwd(), '.biof3-dev-user-data', 'data', 'biof3.db'),
    path.join(process.cwd(), 'data', 'biof3.db'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) { process.env.BIOF3_DB_PATH = c; return; }
  }
}

function markerPath() {
  return path.join(process.cwd(), '.biof3-dev-user-data', 'jev-session-start.txt');
}

anchorDecisionDbPath();
const dbPath = process.env.BIOF3_DB_PATH;
if (!dbPath || !fs.existsSync(dbPath)) {
  console.error('decision:session：找不到决策台账 DB（未设 BIOF3_DB_PATH 且无 dev 数据面）。');
  process.exit(3);
}
const mp = markerPath();
fs.mkdirSync(path.dirname(mp), { recursive: true });
const reset = process.argv.includes('--reset');

let startedAt = null;
let lastReadAt = null;
if (reset || !fs.existsSync(mp)) {
  startedAt = new Date().toISOString();
  lastReadAt = startedAt;
  fs.writeFileSync(mp, JSON.stringify({ startedAt, lastReadAt }));
  console.log(`decision:session 锚点已${reset ? '重置' : '创建'}：${startedAt}`);
} else {
  try {
    const doc = JSON.parse(fs.readFileSync(mp, 'utf8'));
    startedAt = doc.startedAt || doc.replace?.('\n', '') || null;
    lastReadAt = doc.lastReadAt || startedAt;
    if (typeof startedAt !== 'string') { startedAt = doc; lastReadAt = startedAt; }
  } catch {
    startedAt = fs.readFileSync(mp, 'utf8').trim();
    lastReadAt = startedAt;
  }
}

const Database = require('better-sqlite3');
const db = new Database(dbPath, { readonly: true });
const sinceLast = db.prepare('SELECT COUNT(*) AS n FROM decision_log WHERE at >= ?').get(lastReadAt).n;
const sinceStart = db.prepare('SELECT COUNT(*) AS n FROM decision_log WHERE at >= ?').get(startedAt).n;
db.close();

// lastReadAt 前移（本轮已读，下轮增量从此刻起）
fs.writeFileSync(mp, JSON.stringify({ startedAt, lastReadAt: new Date().toISOString() }));

console.log(`jev×${sinceLast}（本轮增量，自 ${lastReadAt}）· 累计 ${sinceStart}（自 ${startedAt} 锚点）`);
