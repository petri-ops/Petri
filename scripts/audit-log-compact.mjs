#!/usr/bin/env node
'use strict';
/**
 * audit-log-compact.mjs — AUDIT-LOG 自动精简（BLOCK-105 增量 · 用户裁决
 * 「AUDIT-LOG 的规范和精简应该是自动化的过程，仅保留必要的内容」）
 *
 * 把原「滚动归档触发（硬性）」的手工剪切纪律脚本化、幂等化：
 *   保留（活跃台）：
 *     - 头部（含入口直链）+ 「最后更新」单行 + 「当前待处理项」全量（🔴/🟡/🟢 是活跃广播）
 *     - 「最近处理记录」：每个工作包仅保留最新一条 + 无论包名的前 5 条兜底 + 广播规则
 *   剪切（归档台）：
 *     - 被淘汰的旧记录行原文追加到 docs/archive/checkpoints/audit-log-compact-<run>.md
 *       （带来源声明；canonical 状态以 roadmap/plan/DOC-REGISTRY 为准）
 *   幂等：重复运行无变化时输出「already compact」且不改文件。
 * 归档后必须跑 `npm run docs:check`（registry entrypoint 直链不得随旧记录进归档）。
 *
 * 用法：node scripts/audit-log-compact.mjs   （npm run audit:compact）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(ROOT, 'docs', 'AUDIT-LOG.md');
const ARCHIVE_DIR = path.join(ROOT, 'docs', 'archive', 'checkpoints');

const KEEP_TAIL_ROWS = 5; // 无论包名，永远保留最新的 N 条
const RECORDS_HEAD = '## 最近处理记录';
const PENDING_HEAD = '## 当前待处理项';
const RULES_HEAD = '## 广播规则';

const raw = fs.readFileSync(LEDGER, 'utf8');
const lines = raw.split('\n');

// ── 定位三段边界 ──
const idxRecords = lines.findIndex((l) => l.trim() === RECORDS_HEAD);
const idxRules = lines.findIndex((l) => l.trim() === RULES_HEAD);
if (idxRecords < 0 || idxRules < 0) {
  console.error('[audit-compact] 未找到「最近处理记录」/「广播规则」段——文件结构变更，人工核查。');
  process.exit(2);
}

const head = lines.slice(0, idxRecords);
const records = lines.slice(idxRecords, idxRules);
const rules = lines.slice(idxRules);

// ── 解析记录行：| ✅ … | … | … | PKG / PHASE | ──
const rows = []; // { line, pkg }
let inTable = false;
for (const l of records) {
  if (l.startsWith('## ')) { inTable = false; continue; }
  if (l.startsWith('| ✅')) {
    inTable = true;
    const cells = l.split('|').map((s) => s.trim()).filter(Boolean);
    const tail = cells[cells.length - 1] || '';
    const pkg = tail.split('/')[0].trim() || 'UNSORTED';
    rows.push({ line: l, pkg });
    continue;
  }
  if (inTable && l.startsWith('|')) {
    rows.push({ line: l, pkg: '__TABLE_STRUCTURE__' }); // 表头/分隔行——原样保留
  }
}

// ── 计算保留集：每包最新一条 + 最新 N 条兜底 ──
const keep = new Set();
const seenPkg = new Set();
const seenRow = new Set();
let newest = 0;
for (const r of rows) {
  if (!r.line.startsWith('| ✅')) continue;
  newest += 1;
  if (!seenPkg.has(r.pkg)) { seenPkg.add(r.pkg); keep.add(r.line); }
  if (newest <= KEEP_TAIL_ROWS) keep.add(r.line);
}
// 表结构行（表头/分隔）与空行原样保留
for (const r of rows) {
  if (r.pkg === '__TABLE_STRUCTURE__') keep.add(r.line);
}

// ── 分离淘汰行 ──
const keptLines = [];
const cutLines = [];
let dumped = false;
for (const r of rows) {
  if (keep.has(r.line)) keptLines.push(r.line);
  else { cutLines.push(r.line); dumped = true; }
  seenRow.add(r.line);
}
// records 段中非表格的陈旧尾注（旧归档指引行）原样保留
for (const l of records) {
  if (l.startsWith('| ✅') || l.startsWith('| -') || l.startsWith('| 状态')) continue;
  if (l.startsWith('## ')) continue;
  if (l.trim() === '') continue;
  if (keptLines.includes(l) || cutLines.includes(l)) continue;
  keptLines.push(l); // 段内说明文字保留
}

if (!dumped) {
  console.log('[audit-compact] already compact——无淘汰行，文件未改动。');
  process.exit(0);
}

// ── 写归档 ──
fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const archivePath = path.join(ARCHIVE_DIR, `audit-log-compact-${stamp}.md`);
const archiveNote = [
  `# AUDIT-LOG 自动精简归档 · ${stamp}（audit-log-compact.mjs）`,
  '',
  '> 来源声明：本档由 scripts/audit-log-compact.mjs 自动剪切生成（用户裁决「AUDIT-LOG 的规范和精简',
  '> 应该是自动化的过程，仅保留必要的内容」）。内容=「最近处理记录」中每包最新一条之外的旧行',
  '> 原文。canonical 状态以 roadmap/plan/DOC-REGISTRY 为准，本档仅作广播历史追溯。',
  '',
  '',
].join('\n');
fs.appendFileSync(archivePath, archiveNote + cutLines.join('\n') + '\n', 'utf8');

// ── 重写活跃台 ──
const next = head.concat([RECORDS_HEAD], keptLines, rules.slice(idxRules - idxRules));
// 注意：rules 数组相对索引 0 = RULES_HEAD 行，直接拼接
const outLines = head.concat([RECORDS_HEAD], keptLines, lines.slice(idxRules));
fs.writeFileSync(LEDGER, outLines.join('\n'), 'utf8');

const size = fs.statSync(LEDGER).size;
console.log(`[audit-compact] 淘汰 ${cutLines.length} 行 → ${path.relative(ROOT, archivePath)}`);
console.log(`[audit-compact] 活跃台现在 ${size} 字节。请跑 npm run docs:check 验证直链完整性。`);
