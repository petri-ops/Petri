#!/usr/bin/env node
/**
 * decision-session-count — 会话级 Jev 调用计数（2026-09-25 用户裁决：透明标签 jev×N 的 N 取数锚）。
 *
 * 用法：
 *   npm run decision:session        # 会话起点 marker 不存在则创建（=本会话首跑），输出自起点以来的 calls 合计
 *   npm run decision:session -- --reset   # 强制重开会话锚（新会话首跑也可手动重置）
 *
 * 语义：marker 文件 .biof3-dev-user-data/jev-session-start.txt 存 ISO 时间戳（gitignored，不脏仓）；
 * 计数=decision_log 中 at >= marker 的行数（跨接点求和，与 decision:report 的 calls 合计同口径）。
 * 规则配套（AGENTS.md「Skill 使用透明度」）：收尾标签的 jev×N 必须每次收尾重跑本脚本取数，
 * 禁止复用上一轮数字（会话内数字随调用增长是正确行为，不变才可疑）。
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
let start;
let created = false;
if (reset || !fs.existsSync(mp)) {
  start = new Date().toISOString();
  fs.writeFileSync(mp, start + '\n');
  created = true;
  console.log(`decision:session 锚点已${reset ? '重置' : '创建'}：${start}（此后调用计入本会话）`);
} else {
  start = fs.readFileSync(mp, 'utf8').trim();
}
const Database = require('better-sqlite3');
const db = new Database(dbPath, { readonly: true });
const row = db.prepare('SELECT COUNT(*) AS n FROM decision_log WHERE at >= ?').get(start);
db.close();
console.log(`jev×${row.n}（自 ${start}，会话锚=${created ? '新建' : '沿用'}）`);
