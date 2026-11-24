#!/usr/bin/env node
/**
 * scripts/roadmap-compact.mjs — BLOCK-511 S5.3：roadmap 头部链自稳（幂等，仿 handoff-compact）。
 *
 * 复用 handoff-compact-core 的 compactHandoffLines（链拆分/收敛/搬移不改写）与
 * audit-log-compact 的 chooseArchiveTarget。默认 keep=1。
 * 用法：node scripts/roadmap-compact.mjs [--keep N]（npm run roadmap:compact）
 * 归档：docs/archive/checkpoints/next-steps-roadmap-through-<日期>.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chooseArchiveTarget } from './audit-log-compact.mjs';
import { compactHandoffLines } from './lib/handoff-compact-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROADMAP = path.join(ROOT, 'docs', 'next-steps-roadmap.md');
const ARCHIVE_DIR = path.join(ROOT, 'docs', 'archive', 'checkpoints');
const args = process.argv.slice(2);
const keepIdx = args.indexOf('--keep');
const KEEP = keepIdx >= 0 && args[keepIdx + 1] ? Number(args[keepIdx + 1]) : 1;

function archiveDirty(absPath) {
  try {
    const rel = path.relative(ROOT, absPath);
    return execFileSync('git', ['status', '--porcelain', '--', rel], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0;
  } catch { return null; }
}

function main() {
  let text;
  try { text = fs.readFileSync(ROADMAP, 'utf8'); }
  catch (e) { console.error(`[roadmap:compact] 读取失败：${e.message}`); process.exit(1); }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const r = compactHandoffLines(lines, { keep: KEEP });
  if (!r.ok) { console.error(`[roadmap:compact] ${r.reason}`); process.exit(1); }
  if (!r.changed || !r.cutLines.length) {
    console.log('[roadmap:compact] already compact（无淘汰链条目，文件未改）。');
    return;
  }
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const baseName = `next-steps-roadmap-through-${r.throughDate || new Date().toISOString().slice(0, 10)}.md`;
  const target = chooseArchiveTarget({
    archiveDir: ARCHIVE_DIR, baseName,
    exists: fs.existsSync(path.join(ARCHIVE_DIR, baseName)),
    dirty: archiveDirty(path.join(ARCHIVE_DIR, baseName)),
    nowIso: new Date().toISOString(),
  });
  const header = `# next-steps-roadmap 历史链归档（${r.throughDate || 'unknown'}）\n\n> 来源：docs/next-steps-roadmap.md 头部「最后更新」链；搬移不改写、零删除、追溯专用。\n\n`;
  const body = r.cutLines.map((l) => l.replace(/\n/g, ' ')).join('\n\n') + '\n';
  if (fs.existsSync(target.path)) fs.appendFileSync(target.path, '\n' + body, 'utf8');
  else fs.writeFileSync(target.path, header + body, 'utf8');
  fs.writeFileSync(ROADMAP, r.outLines.join('\n') + (text.endsWith('\n') ? '\n' : ''), 'utf8');
  console.log(`[roadmap:compact] 保留最近 ${r.keptChain.length} 条；${r.cutLines.length} 条原文搬移 → ${path.relative(ROOT, target.path)}${target.redirected ? '（脏文件重定向）' : ''}。`);
}

main();
