#!/usr/bin/env node
/**
 * scripts/handoff-compact.mjs — BLOCK-470 / T2：handoff 头部链自稳（仿 audit:compact）。
 *
 * 复用 audit-log-compact.mjs 的 chooseArchiveTarget（搬移不改写 / 脏文件重定向），
 * 链拆分/收敛走 lib/handoff-compact-core.mjs 纯函数。不改 audit-log-compact.mjs 本体。
 *
 * 用法：node scripts/handoff-compact.mjs [--keep N]   （npm run handoff:compact）
 *   --keep  头部保留最近 N 条链（默认 1）
 * 归档：淘汰条目原文追加 docs/archive/checkpoints/project-workspace-handoff-through-<日期>.md。
 * 幂等：无淘汰不改文件（打印 already compact）。改完需 npm run docs:check。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chooseArchiveTarget } from './audit-log-compact.mjs';
import { compactHandoffLines } from './lib/handoff-compact-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HANDOFF = path.join(ROOT, 'docs', 'project-workspace-handoff.md');
const ARCHIVE_DIR = path.join(ROOT, 'docs', 'archive', 'checkpoints');
const args = process.argv.slice(2);
const keepIdx = args.indexOf('--keep');
const KEEP = keepIdx >= 0 && args[keepIdx + 1] ? Number(args[keepIdx + 1]) : 1;

function archiveDirty(absPath) {
  try {
    const rel = path.relative(ROOT, absPath);
    const out = execFileSync('git', ['status', '--porcelain', '--', rel], { cwd: ROOT, encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

function main() {
  let text;
  try { text = fs.readFileSync(HANDOFF, 'utf8'); }
  catch (e) { console.error(`[handoff:compact] 读取失败：${e.message}`); process.exit(1); }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const r = compactHandoffLines(lines, { keep: KEEP });
  if (!r.ok) { console.error(`[handoff:compact] ${r.reason}`); process.exit(1); }
  if (!r.changed || !r.cutLines.length) {
    console.log('[handoff:compact] already compact（无淘汰链条目，文件未改）。');
    return;
  }

  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const baseName = `project-workspace-handoff-through-${r.throughDate || new Date().toISOString().slice(0, 10)}.md`;
  const target = chooseArchiveTarget({
    archiveDir: ARCHIVE_DIR,
    baseName,
    exists: fs.existsSync(path.join(ARCHIVE_DIR, baseName)),
    dirty: archiveDirty(path.join(ARCHIVE_DIR, baseName)),
    nowIso: new Date().toISOString(),
  });
  // 搬移不改写：淘汰条目原文逐条追加（带来源声明），零措辞改动。
  const header = `# project-workspace-handoff 历史链归档（${r.throughDate || 'unknown'}）\n\n> 来源：docs/project-workspace-handoff.md 头部「最后更新」链；搬移不改写、零删除、追溯专用。\n\n`;
  const body = r.cutLines.map((l) => l.replace(/\n/g, ' ')).join('\n\n') + '\n';
  if (fs.existsSync(target.path)) fs.appendFileSync(target.path, '\n' + body, 'utf8');
  else fs.writeFileSync(target.path, header + body, 'utf8');

  fs.writeFileSync(HANDOFF, r.outLines.join('\n') + (text.endsWith('\n') ? '\n' : ''), 'utf8');
  console.log(`[handoff:compact] 保留最近 ${r.keptChain.length} 条；${r.cutLines.length} 条原文搬移 → ${path.relative(ROOT, target.path)}${target.redirected ? '（脏文件重定向）' : ''}。`);
  console.log('[handoff:compact] 请跑 npm run docs:check 验证 entrypoint 直链。');
}

main();
