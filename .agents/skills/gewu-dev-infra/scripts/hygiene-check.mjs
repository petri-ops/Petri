#!/usr/bin/env node
/**
 * .agents/skills/gewu-dev-infra/scripts/hygiene-check.mjs — 工作区卫生检查（BLOCK-71）
 *
 * canonical 家在 gewu-dev-infra skill 内（自洽可移植工具包）；位置无关：
 * 向上查找 package.json 定位仓库根。复用到其他仓库见 skill 内 PORTING.md。
 *
 * 检查项（发现即非 0 退出）：
 *   1) 死符号链接：git 跟踪的 symlink（mode 120000），解析目标不存在。
 *      Windows 无 symlink 支持时 git 会把链接检出为「内容即目标路径」的纯文本，
 *      两种形态都覆盖。
 *   2) 疑似残留临时文件：untracked 且命中临时命名模式
 *      （*-tmp.* / *.tmp / *.bak / *.orig / *.rej / *~ / .DS_Store / Thumbs.db / nul）。
 *
 * 信息级（不影响退出码，只列出）：
 *   - 其余 untracked 文件/目录：可能是 active 工作包 WIP，只列出、绝不判定失败。
 *
 * 红线：本脚本只报告，不删除、不移动、不暂存任何文件（治理 guardrail）。
 * 退出码：0 = 干净；1 = 存在需处置项；2 = 自身运行错误。
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
  console.error('[hygiene] 找不到仓库根（向上无 package.json）');
  process.exit(2);
})();

const TEMP_PATTERNS = [
  /-tmp\.[a-z0-9]+$/i,
  /\.tmp$/i,
  /\.bak$/i,
  /\.orig$/i,
  /\.rej$/i,
  /~$/,
  /^\.DS_Store$/,
  /^Thumbs\.db$/i,
  /^nul$/i,
];

function runGit(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function isTempName(relPath) {
  const base = path.basename(relPath);
  return TEMP_PATTERNS.some((re) => re.test(base));
}

/** 解析一个 git 跟踪的 symlink 条目的目标路径；无法解析返回 null。 */
function resolveGitSymlinkTarget(relPath) {
  const abs = path.join(ROOT, relPath);
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) return path.resolve(path.dirname(abs), fs.readlinkSync(abs));
  } catch {
    return null;
  }
  // Windows 无 symlink 支持：链接被检出为内容即目标路径的普通文件
  try {
    const raw = fs.readFileSync(abs, 'utf8');
    if (/[\r\n]/.test(raw) || raw.length === 0 || raw.length > 4096) return null;
    return path.resolve(path.dirname(abs), raw.trim());
  } catch {
    return null;
  }
}

function collectDeadSymlinks() {
  const out = runGit(['ls-files', '-s']);
  const dead = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(\d{6})\s+[0-9a-f]+\s+\d+\t(.+)$/);
    if (!m || m[1] !== '120000') continue;
    const rel = m[2];
    const target = resolveGitSymlinkTarget(rel);
    if (target === null) {
      dead.push({ path: rel, reason: 'unresolvable_link_text' });
      continue;
    }
    if (!fs.existsSync(target)) dead.push({ path: rel, reason: `target_missing: ${target}` });
  }
  return dead;
}

function collectUntracked() {
  const out = runGit(['ls-files', '--others', '--exclude-standard', '-z']);
  return out.split('\0').filter(Boolean);
}

function main() {
  let deadLinks;
  let untracked;
  try {
    deadLinks = collectDeadSymlinks();
    untracked = collectUntracked();
  } catch (e) {
    console.error(`[hygiene] 自身运行错误: ${e.message}`);
    process.exit(2);
  }

  const leftovers = untracked.filter(isTempName);
  const wip = untracked.filter((f) => !isTempName(f));

  console.log('== 工作区卫生检查 ==\n');

  let failed = false;
  if (deadLinks.length) {
    failed = true;
    console.log('❌ 死符号链接（目标不存在 / 无法解析）:');
    for (const d of deadLinks) console.log(`   ${d.path}  —  ${d.reason}`);
    console.log('');
  } else {
    console.log('✅ 死符号链接：无');
  }

  if (leftovers.length) {
    failed = true;
    console.log('\n❌ 疑似残留临时文件（untracked + 临时命名）:');
    for (const f of leftovers) console.log(`   ${f}`);
    console.log('   处置方式由人裁决：确认无用后删除 / 移交对应工作包；本脚本不代删。');
  } else {
    console.log('✅ 疑似残留临时文件：无');
  }

  if (wip.length) {
    console.log(`\nℹ️  其余 untracked（可能是 active 工作包 WIP，仅列出，不判失败）: ${wip.length} 项`);
    for (const f of wip.slice(0, 30)) console.log(`   ${f}`);
    if (wip.length > 30) console.log(`   …以及另外 ${wip.length - 30} 项`);
  }

  console.log(`\n== 卫生检查结果: ${failed ? 'FAIL（存在需处置项）' : 'PASS'} ==`);
  process.exit(failed ? 1 : 0);
}

main();
