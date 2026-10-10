#!/usr/bin/env node
/**
 * provision-win-r-runtime.mjs
 * ---------------------------------------------------------------
 * 开发机一键引导：在本机 Windows 上把 Petri 的 R 运行时装进
 *   %USERPROFILE%/Documents/Petri-Local/runtimes/R
 * （与 main.js resolveRuntime 的第一优先路径一致），从而 petri-server
 * 在下次 `npm run dev` 时自动启动——无需手动安装 R，也无需等
 * OSS 上的官方 windows-x64 制品（Week 3/4）。
 *
 * 原理：静默安装官方 R 4.5.2（与 macOS 已发布基线一致，详见
 *   docs/runtime-version-baseline.md）到运行时目录 -> BiocManager 安装科学包。
 *
 * 用法（在 Windows 开发机，需网络；R 安装可能弹 UAC，点允许）：
 *   node scripts/provision-win-r-runtime.mjs
 * 环境变量：
 *   PETRI_R_VERSION       R 版本（默认 4.5.2×x；≥4.6.1 从 base 根目录拉取，历史版本从
 *                         bin/windows/base/old/<ver>/ 拉取）
 *   PETRI_LOCAL_DATA_DIR  覆盖数据根目录（默认 Documents/Petri-Local）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PACKAGES = path.join(REPO_ROOT, 'resources', 'built-in-plugins', 'r-runtime-packages.txt');

const R_VERSION = process.env.PETRI_R_VERSION || '4.5.2';
const DATA_ROOT = process.env.PETRI_LOCAL_DATA_DIR
  ? path.resolve(process.env.PETRI_LOCAL_DATA_DIR)
  : path.join(os.homedir(), 'Documents', 'Petri-Local');
const TARGET = path.join(DATA_ROOT, 'runtimes', 'R');

function fail(msg, err) {
  console.error(`\n[provision-r] ERROR: ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

function rScriptExeAt(dir) {
  for (const sub of ['bin', '']) {
    const p = path.join(dir, sub, 'Rscript.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function download(url, dest) {
  console.log(`[provision-r] download ${url}`);
  const res = await fetch(url);
  if (!res.ok) fail(`下载失败 ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) fail(`命令失败: ${cmd} ${args.join(' ')} (exit ${r.status})`);
}

function parsePackages(file) {
  return fs.readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

async function main() {
  if (os.platform() !== 'win32') fail('此脚本仅用于 Windows 开发机。');

  const existing = rScriptExeAt(TARGET);
  if (existing) {
    console.log(`[provision-r] 已就绪，无需重复安装: ${existing}`);
    console.log('[provision-r] 直接重启 `npm run dev` 即可启动 petri-server。');
    return;
  }

  fs.mkdirSync(TARGET, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-r-'));
  const installer = path.join(tmp, `R-${R_VERSION}-win.exe`);
  // CRAN bin/windows/base 只保留当前最新版在根目录；历史版本(如 4.5.2)在
  // bin/windows/base/old/<version>/ 子目录。这里沿用与 macOS 一致的版本基线
  // R 4.5.2（见 docs/runtime-version-baseline.md），因此必须从 old 目录拉取。
  const BASE = 'https://cran.r-project.org/bin/windows/base';
  const isCurrent = R_VERSION === '4.6.1'; // 当前 base 根目录在线的版本
  const installerUrl = isCurrent
    ? `${BASE}/R-${R_VERSION}-win.exe`
    : `${BASE}/old/${R_VERSION}/R-${R_VERSION}-win.exe`;

  try {
    await download(installerUrl, installer);
    console.log(`[provision-r] 静默安装 R ${R_VERSION} -> ${TARGET}（若弹 UAC 请允许）`);
    sh(installer, ['/VERYSILENT', '/SUPPRESSMSGBOXES', `/DIR=${TARGET}`]);

    const rscript = rScriptExeAt(TARGET);
    if (!rscript) fail(`安装后未找到 ${path.join(TARGET, 'bin', 'Rscript.exe')}`);
    console.log(`[provision-r] Rscript: ${rscript}`);

    // 生成安装脚本：BiocManager 统一安装 CRAN + Bioconductor 包，单包失败继续
    const packages = parsePackages(PACKAGES);
    const vec = packages.map((p) => JSON.stringify(p)).join(', ');
    const installR = [
      'options(repos = c(CRAN = "https://cloud.r-project.org"))',
      'pkgs <- c(' + vec + ')',
      'if (!requireNamespace("BiocManager", quietly = TRUE)) install.packages("BiocManager", Ncpus = 4)',
      'for (p in pkgs) {',
      '  tryCatch(BiocManager::install(p, ask = FALSE, update = FALSE, Ncpus = 4),',
      '          error = function(e) cat("FAILED:", p, "\\n"))',
      '}',
      'cat("DONE\\n")',
    ].join('\n');
    const tmpR = path.join(tmp, 'install.R');
    fs.writeFileSync(tmpR, installR);

    console.log(`[provision-r] installing ${packages.length} R packages (CRAN + Bioconductor)...`);
    const r = spawnSync(rscript, [tmpR], { stdio: 'inherit', windowsHide: true, timeout: 1000 * 60 * 90 });
    if (r.status !== 0) {
      console.warn(`[provision-r] 部分 R 包安装失败（exit ${r.status}）。petri-server 仍可启动；失败包待官方制品就绪后再补。`);
    }

    console.log('\n==================== PROVISION COMPLETE ====================');
    console.log(`R 运行时已安装到: ${TARGET}`);
    console.log('下一步：重启 `npm run dev`，main.js 会在启动时解析到该运行时并自动 spawn petri-server(3001)。');
    console.log('验证：dev 控制台应出现 `[desktop] R runtime: ...` 与 petri-server 启动日志。');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => fail('未预期错误', e));
