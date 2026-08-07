#!/usr/bin/env node
/**
 * provision-win-r-runtime.mjs
 * ---------------------------------------------------------------
 * 开发机一键引导：在本机 Windows 上把 BioF3 的 R 运行时装进
 *   %USERPROFILE%/Documents/BioF3-Local/runtimes/R
 * （与 main.js resolveRuntime 的第一优先路径一致），从而 r-server
 * 在下次 `npm run dev` 时自动启动——无需手动安装 R，也无需等
 * OSS 上的官方 windows-x64 制品（Week 3/4）。
 *
 * 原理：静默安装官方 R 4.5 到运行时目录 -> BiocManager 安装科学包。
 *
 * 用法（在 Windows 开发机，需网络；R 安装可能弹 UAC，点允许）：
 *   node scripts/provision-win-r-runtime.mjs
 * 环境变量：
 *   BIOF3_R_VERSION       R 版本（默认 4.5.0）
 *   BIOF3_LOCAL_DATA_DIR  覆盖数据根目录（默认 Documents/BioF3-Local）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PACKAGES = path.join(REPO_ROOT, 'resources', 'built-in-plugins', 'r-runtime-packages.txt');

const R_VERSION = process.env.BIOF3_R_VERSION || '4.5.0';
const DATA_ROOT = process.env.BIOF3_LOCAL_DATA_DIR
  ? path.resolve(process.env.BIOF3_LOCAL_DATA_DIR)
  : path.join(os.homedir(), 'Documents', 'BioF3-Local');
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
    console.log('[provision-r] 直接重启 `npm run dev` 即可启动 r-server。');
    return;
  }

  fs.mkdirSync(TARGET, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-r-'));
  const installer = path.join(tmp, `R-${R_VERSION}-win.exe`);
  const installerUrl = `https://cran.r-project.org/bin/windows/base/R-${R_VERSION}-win.exe`;

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
      console.warn(`[provision-r] 部分 R 包安装失败（exit ${r.status}）。r-server 仍可启动；失败包待官方制品就绪后再补。`);
    }

    console.log('\n==================== PROVISION COMPLETE ====================');
    console.log(`R 运行时已安装到: ${TARGET}`);
    console.log('下一步：重启 `npm run dev`，main.js 会在启动时解析到该运行时并自动 spawn r-server(3001)。');
    console.log('验证：dev 控制台应出现 `[desktop] R runtime: ...` 与 r-server 启动日志。');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => fail('未预期错误', e));
