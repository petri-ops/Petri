#!/usr/bin/env node
// ============================================================
// install-r-tool-dependencies.mjs — BLOCK-58 R 工具依赖显式补装
//
// 用法：node scripts/install-r-tool-dependencies.mjs [--tool <toolId>] [--check]
//   --tool <id>  只装/查指定工具（默认全部；id 见 _dependencies.json.tools）
//   --check      只检查不安装（打印缺失清单）
//
// 这是用户显式运行的一次性维护动作（BLOCK-58 治理：分析执行路径零联网安装）。
// 读 core/biof3-server/tool-scripts/_dependencies.json，CRAN/Bioconductor binary
// 优先安装；完成后打印实际安装版本快照（真实落库版本以本机 R library 为准，
// 后续由预编译包插件 biof3-r-toolchain 候选提供版本锁定，登记于 BLOCK-58 plan）。
// 0 新 npm 依赖（child_process 调本机 Rscript）。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPS_FILE = path.join(ROOT, 'core', 'biof3-server', 'tool-scripts', '_dependencies.json');

const args = process.argv.slice(2);
const toolArgIdx = args.indexOf('--tool');
const onlyTool = toolArgIdx >= 0 ? args[toolArgIdx + 1] : null;
const checkOnly = args.includes('--check');

const deps = JSON.parse(fs.readFileSync(DEPS_FILE, 'utf-8'));
const tools = deps.tools || {};

// Rscript 定位：与 biof3 运行时同源。优先 BIOF3_R_HOME（plugin-manager 装 R 时固化），
// 其次默认安装位置（BioF3-Local/runtimes/R），最后 PATH（用户自备 R）。
function resolveRscript() {
  const candidates = [];
  if (process.env.BIOF3_R_HOME) candidates.push(path.join(process.env.BIOF3_R_HOME, 'bin', 'Rscript'));
  candidates.push(path.join(process.env.HOME || '', 'Documents', 'BioF3-Local', 'runtimes', 'R', 'bin', 'Rscript'));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'Rscript';
}

const rscript = resolveRscript();

function rEval(expr) {
  return execFileSync(rscript, ['-e', expr], { encoding: 'utf-8' }).trim();
}

// 已装集合（一次 R 调用拿全量，避免逐包 spawn）
const installedRaw = rEval('cat(paste(rownames(installed.packages()), collapse = "\\n"))');
const installed = new Set(installedRaw.split('\n').map((s) => s.trim()).filter(Boolean));

const toolIds = onlyTool ? [onlyTool] : Object.keys(tools);
if (onlyTool && !tools[onlyTool]) {
  console.error(`未知工具: ${onlyTool}（可选: ${Object.keys(tools).join(', ')}）`);
  process.exit(2);
}

// 汇总全部缺失包（跨工具去重，一次安装会话完成）
const missingByPkg = new Map(); // pkg -> source (cran|bioc)
for (const toolId of toolIds) {
  const info = tools[toolId];
  if (!info) continue;
  for (const [pkg, source] of Object.entries(info.packages || {})) {
    if (!installed.has(pkg) && !missingByPkg.has(pkg)) {
      missingByPkg.set(pkg, source || 'cran');
    }
  }
}

if (missingByPkg.size === 0) {
  console.log('全部依赖已就位，无需安装。');
  process.exit(0);
}

console.log(`缺失 ${missingByPkg.size} 个包: ${[...missingByPkg.keys()].join(', ')}`);
if (checkOnly) process.exit(1);

const cranPkgs = [...missingByPkg.entries()].filter(([, s]) => s === 'cran').map(([p]) => p);
const biocPkgs = [...missingByPkg.entries()].filter(([, s]) => s === 'bioc').map(([p]) => p);

if (cranPkgs.length > 0) {
  console.log(`[CRAN] 安装: ${cranPkgs.join(', ')}`);
  execFileSync(rscript, ['-e', `install.packages(c(${cranPkgs.map((p) => `'${p}'`).join(',')}), repos='https://cloud.r-project.org')`], { stdio: 'inherit' });
}
if (biocPkgs.length > 0) {
  console.log(`[Bioconductor] 安装: ${biocPkgs.join(', ')}`);
  execFileSync(rscript, ['-e', `if (!requireNamespace('BiocManager', quietly=TRUE)) install.packages('BiocManager', repos='https://cloud.r-project.org'); BiocManager::install(c(${biocPkgs.map((p) => `'${p}'`).join(',')}), ask=FALSE, update=FALSE)`], { stdio: 'inherit' });
}

// 安装后版本快照（用户可见的真实落库版本；版本锁定待预编译包插件候选）
const allPkgs = [...missingByPkg.keys()];
const versions = rEval(`ip <- installed.packages()[intersect(rownames(installed.packages()), c(${allPkgs.map((p) => `'${p}'`).join(',')})), 'Version', drop = FALSE]; cat(paste(rownames(ip), ip[,1], sep='=', collapse='\\n'))`);
console.log('\n=== 已安装版本快照 ===');
console.log(versions);

const stillMissing = allPkgs.filter((p) => !versions.includes(p + '='));
if (stillMissing.length > 0) {
  console.error(`\n以下包安装后仍未就位（检查上方 R 输出）: ${stillMissing.join(', ')}`);
  process.exit(1);
}
console.log('\n完成。');
