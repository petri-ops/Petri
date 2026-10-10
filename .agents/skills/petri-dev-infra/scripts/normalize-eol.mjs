#!/usr/bin/env node
/**
 * normalize-eol.mjs — 工作区换行归一（CRLF → LF）· petri-dev-infra 资产
 *
 * 为什么需要它：Windows 上的编辑器/工具会把工作区文件写成 CRLF，而 `.gitattributes`
 * 的 `text=auto eol=lf` 让 git 在比对时把 CRLF 归一 → `git status` 显示 clean，漂移
 * 只在「读工作区原始字节与 blob 比 SHA」的校验器里现形（g0/acceptance SHA 链、
 * g0-rs-p6 的 sourceMismatches）。检测在 `hygiene-check.mjs`（检查项 3），本脚本是
 * 配套的**安全修法**——不用 `git checkout --`（会连带丢弃未提交 WIP）。
 *
 * 模式：
 *   默认       只列出漂移文件（exit 1 = 有漂移，可作独立检查用）
 *   --write    就地 CRLF→LF 重写，随后自查（exit 0 = 已归零；写盘失败 exit 2）
 *
 * 安全边界：只改**换行字节**，文件内容语义不变；git status 归一后仍为 clean；
 * 与未提交 WIP 不冲突（不读不写其他内容、不 stage、不 commit）。
 * 位置无关：向上查找 package.json 定位仓库根（与其他 dev-infra 脚本一致）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = (() => {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  console.error('[normalize-eol] 找不到仓库根（向上无 package.json）');
  process.exit(2);
})();

const WRITE = process.argv.includes('--write');

function runGit(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** 漂移清单：git 视为文本、且工作区侧为 crlf/mixed 的跟踪文件。 */
function collectDrift() {
  const out = runGit(['ls-files', '--eol']);
  const drift = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const meta = line.slice(0, tab).trim().split(/\s+/);
    const rel = line.slice(tab + 1);
    const worktree = meta[1] || '';
    const attr = meta.slice(2).join(' ');
    if (attr.includes('-text')) continue;
    if (worktree === 'w/crlf' || worktree === 'w/mixed') drift.push({ path: rel, worktree });
  }
  return drift;
}

const drift = collectDrift();

if (!WRITE) {
  if (drift.length === 0) {
    console.log('[normalize-eol] 工作区换行漂移：无');
    process.exit(0);
  }
  console.log(`[normalize-eol] 工作区换行漂移 ${drift.length} 个文件（blob=LF，工作区=CRLF）:`);
  for (const d of drift) console.log(`   ${d.path}  (${d.worktree})`);
  console.log('\n  归一：node .agents/skills/petri-dev-infra/scripts/normalize-eol.mjs --write');
  process.exit(1);
}

/** 索引中该路径的字节（无索引条目返回 null）。用于「是否有真实内容改动」判定。 */
function indexBytes(rel) {
  try {
    return execFileSync('git', ['show', `:${rel}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

let rewritten = 0;
const restat = [];
for (const d of drift) {
  const abs = path.join(ROOT, d.path);
  try {
    const before = fs.readFileSync(abs);
    const after = Buffer.from(before.toString('binary').replace(/\r\n/g, '\n'), 'binary');
    if (after.equals(before)) continue;
    fs.writeFileSync(abs, after);
    rewritten += 1;
    // 只在「归一后与索引字节完全一致」（即该文件没有真实内容改动）时才刷新索引缓存：
    // 归一会改 mtime/size，令 git 索引 stat 缓存失效，`git status` 会把这些文件报成
    // 已修改（`git diff` 却为空）。`git add --renormalize` 对内容相同的文件是 no-op，
    // 只刷新缓存；对带真实 WIP 的文件跳过，绝不改变用户的暂存状态。
    const idx = indexBytes(d.path);
    if (idx && idx.equals(after)) restat.push(d.path);
  } catch (e) {
    console.error(`[normalize-eol] 写盘失败 ${d.path}: ${e.message}`);
    process.exit(2);
  }
}

if (restat.length) {
  try {
    execFileSync('git', ['add', '--renormalize', '--', ...restat], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    console.error(`[normalize-eol] 索引缓存刷新失败（内容已归一，可用 git add --renormalize -- <file> 手工处理）: ${e.message}`);
  }
}

const remaining = collectDrift();
const dirty = runGit(['status', '--porcelain']).split('\n').filter(Boolean);
console.log(`[normalize-eol] 已归一 ${rewritten}/${drift.length} 个文件；残留漂移 ${remaining.length} 个`);
console.log(`[normalize-eol] 索引缓存已刷新 ${restat.length} 个（内容与索引一致，暂存状态不变）`);
console.log(`[normalize-eol] 当前 git status 条目 ${dirty.length} 项（带真实 WIP 的文件会照常显示，属正常）`);
for (const r of remaining) console.log(`   ⚠️ 仍漂移 ${r.path}  (${r.worktree})`);
process.exit(remaining.length === 0 ? 0 : 1);

