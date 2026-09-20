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
 *   3) 工作区换行漂移：git 跟踪的文本文件在**工作区呈 CRLF**（索引/blob 为 LF）。
 *      **为什么算失败（回归→门禁转化，2026-09-11；同类第二次出现）**：
 *      首次 2026-08-07（commit 55183cde `.gitattributes` LF 锁）已记录该坑——任何
 *      「读工作区原始字节与 git blob 比 SHA」的校验链会被它系统性打红；第二次
 *      2026-09-11 表现为 g0-rs-p6 的 `sourceMismatches`（`p6_current_source_tree_not_exact`）
 *      恒红，并被误登记为「P6 证据未重采」长达两周。关键放大效应（2026-09-11 实测）：
 *      git 的**内容比对会做归一**——`git diff` 对该文件为空，stat 缓存命中时 `git status`
 *      连 `M` 都不显示（本仓库实测曾有 44 个 CRLF 文件静默存在而 status 干净），只有
 *      `git ls-files --eol` 与「逐字节比 SHA」的校验器看得见 → 后果隐性滞后，必须机械化
 *      检查（判据三条全中）。
 *      归一：`node .agents/skills/gewu-dev-infra/scripts/normalize-eol.mjs --write`
 *      （只改写换行字节、内容语义不变；工具会自动刷新索引 stat 缓存，避免归一后出现
 *      一批 `git status` 假 `M` 而 `git diff` 为空）。
 *   4) 符号链接检出退化：索引 mode 120000 但工作区落成了普通文件
 *      （Windows Git 默认 `core.symlinks=false` 的检出形态）。
 *      **为什么算失败**：退化形态下文件内容就是目标路径，目标存在时检查项 1 判它「可解析」
 *      而放行，但对宿主运行时它不是目录——Agent skill 发现桥（`.claude/skills/`、
 *      `.codebuddy/skills/`）静默失效，`use_skill <name>` 报 not found 且无任何报错线索
 *      （2026-09-20 实测：8 个桥里 7 个是纯文本，全链路绿灯通过）。
 *      修复：`git config core.symlinks true` 后 `git rm -r --cached <桥目录>`
 *      + `git checkout -- <桥目录>`。
 *      本机确实无法创建 symlink（未开开发者模式/无权限）时可用
 *      `BIOF3_HYGIENE_ALLOW_FLATTENED_SYMLINKS=1` 降级为信息级——但对应宿主功能确实不可用，
 *      必须如实告知用户而不是静默绕过。
 *
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

/**
 * 桥退化检测：索引记为 symlink（mode 120000）但工作区不是真符号链接。
 * 与检查项 1 的分工：1 判「目标能否解析」，本项判「形态是否退化」——
 * 退化形态目标可解析，所以 1 放行而宿主功能实际不可用。
 */
function collectFlattenedSymlinks() {
  const out = runGit(['ls-files', '-s']);
  const flat = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(\d{6})\s+[0-9a-f]+\s+\d+\t(.+)$/);
    if (!m || m[1] !== '120000') continue;
    const rel = m[2];
    let isLink = true;
    try {
      isLink = fs.lstatSync(path.join(ROOT, rel)).isSymbolicLink();
    } catch {
      continue; // 文件缺失由检查项 1 覆盖
    }
    if (!isLink) flat.push(rel);
  }
  return flat;
}

function collectUntracked() {
  const out = runGit(['ls-files', '--others', '--exclude-standard', '-z']);
  return out.split('\0').filter(Boolean);
}

/**
 * 工作区换行漂移：`git ls-files --eol` 逐文件给出 blob/工作区两侧换行，
 * 纯元数据查询——不读文件内容，3122 个跟踪文件毫秒级。
 * 判定：工作区为 crlf/mixed 且该文件被 git 视为文本（attr 非 -text）。
 */
function collectEolDrift() {
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
    if (attr.includes('-text')) continue; // 二进制：换行语义不存在
    if (worktree === 'w/crlf' || worktree === 'w/mixed') drift.push({ path: rel, worktree });
  }
  return drift;
}

function main() {
  let deadLinks;
  let untracked;
  let eolDrift;
  let flattened;
  try {
    deadLinks = collectDeadSymlinks();
    untracked = collectUntracked();
    eolDrift = collectEolDrift();
    flattened = collectFlattenedSymlinks();
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

  if (eolDrift.length) {
    failed = true;
    console.log('\n❌ 工作区换行漂移（blob=LF，工作区=CRLF；git diff 为空、git status 可能完全不显示）:');
    for (const d of eolDrift) console.log(`   ${d.path}  (${d.worktree})`);
    console.log('   为什么算失败：一切「读工作区原始字节与 blob 比 SHA」的校验器（g0/acceptance');
    console.log('   SHA 链、p6 sourceMismatches）会被它静默打红，而 git 的内容比对看不见（diff 为空）。');
    console.log('   归一：node .agents/skills/gewu-dev-infra/scripts/normalize-eol.mjs --write');
  } else {
    console.log('✅ 工作区换行漂移：无');
  }

  const allowFlattened = process.env.BIOF3_HYGIENE_ALLOW_FLATTENED_SYMLINKS === '1';
  if (flattened.length && !allowFlattened) {
    failed = true;
    console.log('\n❌ 符号链接检出退化（索引 mode 120000，工作区是普通文件；宿主按目录加载不到 → 静默失效）:');
    for (const p of flattened) console.log(`   ${p}`);
    console.log('   修复：git config core.symlinks true && git rm -r --cached <所在目录> && git checkout -- <所在目录>');
    console.log('   （Windows 需开开发者模式或管理员权限检出；确无 symlink 能力时');
    console.log('    BIOF3_HYGIENE_ALLOW_FLATTENED_SYMLINKS=1 降级为信息级，但须如实告知对应功能不可用）');
  } else if (flattened.length) {
    console.log(`\nℹ️  符号链接检出退化: ${flattened.length} 项（BIOF3_HYGIENE_ALLOW_FLATTENED_SYMLINKS=1 已降级，对应宿主功能不可用）`);
    for (const p of flattened.slice(0, 30)) console.log(`   ${p}`);
  } else {
    console.log('✅ 符号链接检出形态：全部为真 symlink');
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
