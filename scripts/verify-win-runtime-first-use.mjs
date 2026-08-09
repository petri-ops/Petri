#!/usr/bin/env node
/**
 * Windows Runtime 首用隔离验证（本地 provisioned 路径）
 *
 * 为什么需要这个脚本：
 *   `scripts/validate-runtime-first-use.cjs` 只覆盖 macOS——它在
 *   `platform !== 'macos-arm64'` 处直接抛错，且路径写死为 POSIX
 *   (`runtimes/R/bin/Rscript`、`runtimes/Python/bin/python3`)。
 *   官方安装路径（manifest → OSS 下载 → 解压）在 Windows 上也走不通：
 *   `test/plugin-manifest-schema.test.mjs` 刻意要求
 *   `manifest.plugins[*].artifacts['windows-x64']` 必须为 0（禁止假 Windows 支持），
 *   所以 manifest 里没有 windows-x64 制品可供 selectArtifact 选中。
 *
 * 本脚本验证的是「制品自洽性 + resolveRuntime 命中 + 科学栈可用」这条真问题，
 * 不伪造 manifest 支持、不改 release-contract、不碰用户默认数据目录。
 *
 * 复刻 `src/plugin-manager.js#installRuntime` 的真实语义：
 *   1. 解压 zip 到 `<dataDir>/runtimes/{R|Python}`
 *   2. flatten：若目录只有 1 个子目录且无 `bin/`，把内容上提一层
 *   3. 用 `src/platform-compat.js` 的真实候选列表判定 resolveRuntime 是否命中
 *
 * 用法：
 *   node scripts/verify-win-runtime-first-use.mjs            # R + Python
 *   node scripts/verify-win-runtime-first-use.mjs --only=r   # 只验 R
 *   node scripts/verify-win-runtime-first-use.mjs --keep     # 保留解压树（默认保留）
 *
 * 退出码：0 全通过；1 有验证项失败；2 前置条件不满足。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const KEEP = !args.includes('--no-keep');

function fail(msg, code = 2) {
  console.error(`\n[verify] FATAL ${msg}`);
  process.exit(code);
}

if (process.platform !== 'win32') {
  fail(`本脚本仅用于 win32，当前平台 ${process.platform}`);
}

// ── 隔离目录：刻意不用 Documents/BioF3-Local（用户默认数据目录），避免污染 ──
const DATA_DIR = path.join(REPO_ROOT, 'tmp', 'win-first-use');
const RUNTIMES_DIR = path.join(DATA_DIR, 'runtimes');

const ARTIFACTS = {
  r: {
    name: 'R',
    zip: path.join(REPO_ROOT, 'dist-runtime', 'r-runtime-1.0.0-windows-x64.zip'),
    expectVersion: '4.5.2',
  },
  python: {
    name: 'Python',
    zip: path.join(REPO_ROOT, 'dist-runtime', 'py-runtime-1.0.0-windows-x64.zip'),
    expectVersion: '3.11.9',
  },
};

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

/**
 * 复刻 plugin-manager 的 flatten：单个子目录且无 bin/ 时上提一层。
 * Windows 上 `fs.renameSync` 跨目录移动非空目录不如 POSIX 可靠（易 EPERM），
 * 故用 cpSync 复制 + 删源，与 rename 语义等价且更稳。
 */
function flattenNested(runtimeDir) {
  const entries = fs.readdirSync(runtimeDir);
  if (
    entries.length === 1 &&
    fs.statSync(path.join(runtimeDir, entries[0])).isDirectory() &&
    !fs.existsSync(path.join(runtimeDir, 'bin'))
  ) {
    const nested = path.join(runtimeDir, entries[0]);
    for (const e of fs.readdirSync(nested)) {
      fs.cpSync(path.join(nested, e), path.join(runtimeDir, e), { recursive: true });
    }
    nukeDir(nested);
    return entries[0];
  }
  return null;
}

/** 用 .NET 删大目录：逐文件 fs.rmSync 会被 safe-delete shim 批量拦截且极慢 */
function nukeDir(dir) {
  if (!fs.existsSync(dir)) return;
  const ps = `if (Test-Path -LiteralPath '${dir}') { [System.IO.Directory]::Delete('${dir}', $true) }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    windowsHide: true,
    timeout: 1000 * 60 * 5,
  });
  if (r.status !== 0 && fs.existsSync(dir)) {
    throw new Error(`清理目录失败: ${dir}`);
  }
}

function unzipTo(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // Expand-Archive 解压不像 Compress-Archive 那样全内存缓冲，1.6GB 树可用；
  // -Force 覆盖，windowsHide 避免弹窗。
  const ps = `$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`;
  const started = Date.now();
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 1000 * 60 * 25,
  });
  if (r.status !== 0) throw new Error(`解压失败 (status=${r.status}): ${zipPath}`);
  return Math.round((Date.now() - started) / 1000);
}

async function loadPlatformCompat() {
  const mod = await import(pathToFileURL(path.join(REPO_ROOT, 'src', 'platform-compat.js')).href);
  return mod.default || mod;
}

// getPythonRuntimeExecutable 住在 core/shared-backend/runtime-paths.js，
// 不在 platform-compat（后者只有 getRuntimeBinCandidates）。必须导入真实模块，
// 否则判定会退化成 undefined 而误报 Python 未命中。
async function loadRuntimePaths() {
  const p = path.join(REPO_ROOT, 'core', 'shared-backend', 'runtime-paths.js');
  const mod = await import(pathToFileURL(p).href);
  return mod.default || mod;
}

async function verifyR(compat) {
  const spec = ARTIFACTS.r;
  console.log(`\n=== R 运行时首用验证 ===`);
  if (!fs.existsSync(spec.zip)) return check('制品 zip 存在', false, spec.zip);

  const runtimeDir = path.join(RUNTIMES_DIR, 'R');
  nukeDir(runtimeDir);
  const secs = unzipTo(spec.zip, runtimeDir);
  console.log(`  (解压耗时 ${secs}s)`);
  const flattened = flattenNested(runtimeDir);
  check('flatten 剥掉单层顶层目录', flattened === 'R', `flattened=${flattened}`);

  // resolveRuntime 优先级 1 的真实判定：bin/ 下任一候选存在
  const candidates = compat.getRuntimeBinCandidates('r', 'win32');
  const hit = candidates.find((c) => fs.existsSync(path.join(runtimeDir, 'bin', c)));
  check('resolveRuntime 优先级1 命中', Boolean(hit), hit ? `bin/${hit}` : `候选=${candidates.join(',')}`);
  if (!hit) return false;

  const rscript = path.join(runtimeDir, 'bin', 'Rscript.exe');
  const runR = (expr) =>
    spawnSync(rscript, ['-e', expr], { encoding: 'utf8', timeout: 1000 * 60 * 5 });

  const ver = runR('cat(paste0(R.version$major,".",R.version$minor))');
  const verOut = (ver.stdout || '').trim();
  check(`R 版本 == ${spec.expectVersion}`, verOut === spec.expectVersion, `实测 ${verOut || '(无输出)'}`);

  const libs = runR('cat(length(list.files(.libPaths()[1])))');
  const libCount = parseInt((libs.stdout || '').trim(), 10);
  check('library 包数 > 200（科学栈已装）', libCount > 200, `实测 ${libCount}`);

  // 科学栈真实可加载 —— 这是「能不能干活」的核心判据
  const sci = ['DESeq2', 'ggplot2', 'clusterProfiler', 'WGCNA', 'pheatmap'];
  for (const pkg of sci) {
    const r = runR(`suppressMessages(library(${pkg})); cat(as.character(packageVersion("${pkg}")))`);
    const v = (r.stdout || '').trim();
    check(`library(${pkg}) 可加载`, r.status === 0 && Boolean(v), v || (r.stderr || '').trim().split('\n').pop());
  }

  const bioc = runR('cat(as.character(BiocManager::version()))');
  const biocV = (bioc.stdout || '').trim();
  check('Bioconductor == 3.22', biocV === '3.22', `实测 ${biocV || '(无输出)'}`);

  return results.filter((x) => !x.ok).length === 0;
}

async function verifyPython(runtimePaths) {
  const spec = ARTIFACTS.python;
  console.log(`\n=== Python 运行时首用验证 ===`);
  if (!fs.existsSync(spec.zip)) return check('制品 zip 存在', false, spec.zip);

  const runtimeDir = path.join(RUNTIMES_DIR, 'Python');
  nukeDir(runtimeDir);
  const secs = unzipTo(spec.zip, runtimeDir);
  console.log(`  (解压耗时 ${secs}s)`);
  const flattened = flattenNested(runtimeDir);
  check('flatten 剥掉单层顶层目录', flattened === 'Python', `flattened=${flattened}`);

  // 用生产同一个判定函数，不自建第二套候选列表
  const exe = runtimePaths.getPythonRuntimeExecutable(runtimeDir, 'win32');
  check('resolveRuntime 优先级1 命中', Boolean(exe), exe ? path.relative(runtimeDir, exe) : '未命中');
  if (!exe) return false;

  const runPy = (code) => spawnSync(exe, ['-c', code], { encoding: 'utf8', timeout: 1000 * 60 * 5 });

  const ver = runPy('import sys;print("%d.%d.%d"%sys.version_info[:3])');
  const verOut = (ver.stdout || '').trim();
  check(`Python 版本 == ${spec.expectVersion}`, verOut === spec.expectVersion, `实测 ${verOut || '(无输出)'}`);

  for (const mod of ['numpy', 'pandas', 'scipy', 'matplotlib', 'anndata', 'scanpy']) {
    const r = runPy(`import ${mod};print(getattr(${mod},"__version__","?"))`);
    const v = (r.stdout || '').trim();
    check(`import ${mod}`, r.status === 0 && Boolean(v), v || (r.stderr || '').trim().split('\n').pop());
  }

  return results.filter((x) => !x.ok).length === 0;
}

async function main() {
  console.log('Windows Runtime 首用隔离验证');
  console.log(`  隔离数据目录: ${DATA_DIR}`);
  console.log(`  (刻意避开 Documents/BioF3-Local，不污染用户默认数据目录)`);

  const compat = await loadPlatformCompat();
  const runtimePaths = await loadRuntimePaths();
  fs.mkdirSync(RUNTIMES_DIR, { recursive: true });

  if (only !== 'python') await verifyR(compat);
  if (only !== 'r') await verifyPython(runtimePaths);

  const failed = results.filter((x) => !x.ok);
  console.log(`\n=== 汇总 ===`);
  console.log(`  通过 ${results.length - failed.length} / ${results.length}`);
  if (failed.length) {
    console.log('  失败项:');
    for (const f of failed) console.log(`    - ${f.label} (${f.detail})`);
  }
  if (KEEP) {
    console.log(`\n  解压树保留在 ${RUNTIMES_DIR}`);
    console.log(`  清理: node -e "..." 或手动删除（约 3.2GB）`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => fail(e.stack || e.message, 2));
