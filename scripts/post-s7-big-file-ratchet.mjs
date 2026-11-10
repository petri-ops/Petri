#!/usr/bin/env node
/**
 * scripts/post-s7-big-file-ratchet.mjs — B-16 巨型文件行数锚棘轮（独立门）。
 *
 * 为什么不塞进 code-size-ledger：后者是「单文件 ≤700 行预算 + 只出不进例外白名单」，
 * 往里纳管 1579 行文件会立刻必红并要求拆分/新增例外——新增例外违反用户裁决
 * （BLOCK-154 P2-3 只出不进）。故另立独立门，语义不同但同样只减不增：
 *   ① 4 个巨型文件逐个冻结行数 + sha256；
 *   ② 行数上升即红（防继续膨胀）；下降=真拆分，提示 --write 收紧（不拦）；
 *   ③ 内容指纹漂移但行数不变 → 红（改代码必须同批重打并留因，防静默换内容）；
 *   ④ 文件消失 → 红（清单僵化/漏测防护）。
 *
 * 不新建第二真相：本门与 code-size-ledger 各自管不同集合（预算内产品文件 / 预算外巨型文件），
 * 集合互斥由 test/post-s7-h9-size-ledger-trace.test.mjs 断言。
 *
 * 用法：node scripts/post-s7-big-file-ratchet.mjs [--write|--check] [--json]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h9/big-file-anchor.json');

export const BIG_FILES = [
  'core/petri-server/loop-orchestrator.js',
  'frontend/src/components/copilot/SimpleChat.tsx',
  'frontend/src/pages/project-workspace.tsx',
  'frontend/src/components/desktop/WorkingTreeReview/ReviewMode.tsx',
];

const countLines = (text) => {
  const a = text.split('\n');
  if (a.length && a.at(-1) === '') a.pop();
  return a.length;
};

export function measure(readFile = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')) {
  return BIG_FILES.map((f) => {
    let text;
    try { text = readFile(f); } catch { return { path: f, lines: null, sha256: null, missing: true }; }
    return { path: f, lines: countLines(text), sha256: crypto.createHash('sha256').update(text).digest('hex'), missing: false };
  });
}

export function evaluate(current, baseline) {
  const issues = [];
  const improvements = [];
  const byPath = new Map((baseline?.files || []).map((f) => [f.path, f]));
  for (const c of current) {
    if (c.missing) { issues.push(`${c.path}: 文件不存在（清单僵化）`); continue; }
    const b = byPath.get(c.path);
    if (!b) { issues.push(`${c.path}: 基线缺条目——先 --write 生成`); continue; }
    if (c.lines > b.lines) issues.push(`${c.path}: ${c.lines} > 锚 ${b.lines}（巨型文件只减不增）`);
    if (c.lines < b.lines) improvements.push(`${c.path}: ${b.lines} → ${c.lines}（真拆分，建议 --write 收紧）`);
    if (c.sha256 !== b.sha256 && c.lines === b.lines) {
      issues.push(`${c.path}: 内容指纹漂移但行数未变——改代码必须同批 --write 重打并留因`);
    }
  }
  for (const b of baseline?.files || []) {
    if (!current.some((c) => c.path === b.path)) issues.push(`${b.path}: 基线条目在现行清单中消失`);
  }
  return { ok: issues.length === 0, issues, improvements };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const current = measure();
  const baseline = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({
      schemaVersion: 1, kind: 'post-s7-big-file-anchor', generatedAt: new Date().toISOString().slice(0, 10),
      policy: '行数只减不增 + 内容指纹必须同批重打；与 code-size-ledger 集合互斥',
      files: current,
    }, null, 2) + '\n');
    console.log(`[big-file-ratchet] --write ${current.length} 个巨型文件锚入册`);
  } else {
    const r = evaluate(current, baseline);
    if (process.argv.includes('--json')) console.log(JSON.stringify({ current, ...r }, null, 2));
    else if (r.ok) console.log(`[big-file-ratchet] PASS — ${current.length} 个巨型文件行数锚无增长`);
    else { console.error('[big-file-ratchet] FAIL：'); for (const i of r.issues) console.error(`  - ${i}`); }
    process.exitCode = r.ok ? 0 : 1;
  }
}
