#!/usr/bin/env node
/**
 * build-win-r-runtime-artifact.mjs
 * ---------------------------------------------------------------
 * 在「装有 R 4.5.2 的 Windows 构建机」上，组装 BioF3 的 windows-x64
 * R 运行时制品（对应 manifest.json 的 biof3-r-runtime）。
 *
 * 产物：一个 zip，内部根目录为 `R/`，解压到
 *   userData/runtimes/R 后，resolveRuntime('r') 即可命中
 *   userData/runtimes/R/bin/Rscript.exe。
 *
 * ⚠️ 版本基线：必须用 R 4.5.2（与 macOS 已发布基线一致，见
 *   docs/runtime-version-baseline.md）。此脚本从源 R prefix 复制，
 *   默认继承 build 机安装的 R 版本——请确保 build 机装的是 4.5.2
 *   （Windows 开发者机可用 provision-win-r-runtime.mjs 安装）。
 *
 * 用法（在 Windows 构建机）：
 *   node scripts/build-win-r-runtime-artifact.mjs
 *   # 可选环境变量：
 *   #   BIOF3_BUILD_R     —— 源 R 安装前缀（默认自动探测 Rscript -e 'cat(R.home())'）
 *   #   BIOF3_R_VERSION  —— 仅用于制品命名（默认取源 R 版本）
 *   #   OUT_DIR          —— 产物输出目录（默认 <repo>/dist-runtime）
 *
 * 完成后脚本打印一段 JSON，填进：
 *   manifest.json 的 biof3-r-runtime.artifacts.windows-x64
 *   manifest.placeholders.json 对应条目的 current（由 null 改为真实值）
 * release-contract.json 的 windows-x64.supported 仍保持 false，直到 Week 3/4。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PACKAGES = path.join(REPO_ROOT, 'resources', 'built-in-plugins', 'r-runtime-packages.txt');
const OUT_DIR = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(REPO_ROOT, 'dist-runtime');

function fail(msg, err) {
  console.error(`\n[build-r-runtime] ERROR: ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

function parsePackages(file) {
  return fs.readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function resolveSourceRPrefix() {
  const candidates = [];
  if (process.env.BIOF3_BUILD_R) candidates.push(process.env.BIOF3_BUILD_R);
  candidates.push('Rscript', 'Rscript.exe');
  for (const c of candidates) {
    try {
      const home = execFileSync(c, ['-e', 'cat(normalizePath(R.home()))'], {
        encoding: 'utf-8', timeout: 8000, windowsHide: true,
      }).trim();
      if (home && fs.existsSync(home)) {
        console.log(`[build-r-runtime] source R: ${c} -> ${home}`);
        return { exe: c, prefix: home };
      }
    } catch {}
  }
  fail('找不到可用的 R 4.5 源安装。请先安装 R 4.5 或设置 BIOF3_BUILD_R。');
}

function stagePrefix(srcPrefix, stageR) {
  console.log(`[build-r-runtime] copying ${srcPrefix} -> ${stageR}`);
  fs.mkdirSync(path.dirname(stageR), { recursive: true });
  fs.cpSync(srcPrefix, stageR, { recursive: true });
}

function installPackages(stageR, packages) {
  const rscript = path.join(stageR, 'bin', 'Rscript.exe');
  if (!fs.existsSync(rscript)) fail(`staging 内未找到 Rscript.exe: ${rscript}`);
  // 生成安装脚本：BiocManager 统一安装 CRAN + Bioconductor 包，单包失败继续
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
  const tmpR = path.join(os.tmpdir(), `biof3-r-install-${Date.now()}.R`);
  fs.writeFileSync(tmpR, installR);
  try {
    const r = spawnSync(rscript, [tmpR], { stdio: 'inherit', windowsHide: true, timeout: 1000 * 60 * 60 * 3 });
    if (r.status !== 0) console.warn(`[build-r-runtime] 部分 R 包安装失败（exit ${r.status}），继续打包。`);
  } finally {
    fs.rmSync(tmpR, { force: true });
  }
}

function prune(stageR) {
  console.log('[build-r-runtime] pruning __pycache__/temp ...');
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__pycache__') { fs.rmSync(p, { recursive: true, force: true }); continue; }
        walk(p);
      }
    }
  };
  walk(stageR);
}

function zip(stageR, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  console.log(`[build-r-runtime] compressing -> ${zipPath}`);
  // 压缩 stageR（即 .../R）的内容，使 zip 顶层直接是 R/（不是 staging 外壳）。
  // 若压 stageRoot，会得到 <pid>-staging/R/... 两层外壳，解压后落到
  // runtimes/R/R/bin/Rscript.exe，resolveRuntime 不命中（plugin-manager 的
  // flatten 只剥一层）。实测 Compress-Archive -Path '<R>' 顶层 = R/bin/Rscript.exe ✅
  const ps = `Compress-Archive -Path '${stageR}' -DestinationPath '${zipPath}' -Force`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) fail('Compress-Archive 失败');
}

function digest(zipPath) {
  const buf = fs.readFileSync(zipPath);
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), sizeBytes: buf.length };
}

function main() {
  if (os.platform() !== 'win32') fail('此脚本必须在 Windows 构建机上运行。');
  if (!fs.existsSync(PACKAGES)) fail(`缺少包清单: ${PACKAGES}`);

  const repackOnly = process.argv.includes('--repack-only');
  let stageR;
  if (repackOnly) {
    // 复用最近一个已有 stage（不重新下载/安装包，只重打 zip 修正结构）
    const dirs = fs.existsSync(OUT_DIR)
      ? fs.readdirSync(OUT_DIR).filter((d) => d.startsWith('biof3-r-runtime-staging-'))
      : [];
    if (dirs.length === 0) fail('--repack-only 但找不到已有 stage 目录，请直接完整构建。');
    const newest = dirs
      .map((d) => ({ d, t: fs.statSync(path.join(OUT_DIR, d)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0].d;
    stageR = path.join(OUT_DIR, newest, 'R');
    if (!fs.existsSync(path.join(stageR, 'bin', 'Rscript.exe'))) {
      fail(`--repack-only 的 stage 缺少 R/bin/Rscript.exe: ${stageR}`);
    }
    console.log(`[build-r-runtime] --repack-only 复用 stage: ${stageR}`);
  } else {
    const { prefix } = resolveSourceRPrefix();
    // 用 PID 后缀的唯一 stage 目录，避免多次运行共享目录时触发批量删除门禁
    // （Node fs.rmSync 对 >50 文件目录会被 WorkBuddy 安全删除 shim 拦截）。
    const stageRoot = path.join(OUT_DIR, `biof3-r-runtime-staging-${process.pid}`);
    stageR = path.join(stageRoot, 'R');
    stagePrefix(prefix, stageR);
    installPackages(stageR, parsePackages(PACKAGES));
    prune(stageR);
  }

  const zipPath = path.join(OUT_DIR, 'r-runtime-1.0.0-windows-x64.zip');
  zip(stageR, zipPath);

  const { sha256, sizeBytes } = digest(zipPath);
  console.log('\n==================== BUILD COMPLETE ====================');
  console.log(`artifact : ${zipPath}`);
  console.log(`sizeBytes: ${sizeBytes}`);
  console.log(`sha256   : ${sha256}`);
  console.log('\n⚠️ 收尾边界（2026-08-08 确认）：');
  console.log('  - 此制品只「上传 OSS + 打印真实摘要」，由 scripts/upload-win-r-runtime.mjs 完成。');
  console.log('  - 不要把它写进 manifest.json 的 artifacts.windows-x64 ——');
  console.log('    plugin-manifest-schema.test.mjs 第 70-74 行要求 windows-x64 必须为 0（0.0.1 禁止假 Windows 支持）。');
  console.log('  - zip 落地 OSS 后，才允许把 biof3-r-runtime 从 manifest.placeholders.json 移除。\n');
  console.log(JSON.stringify({
    "windows-x64": {
      "url": "https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/r-runtime/1.0.0/windows-x64.zip",
      "sha256": sha256,
      "sizeBytes": sizeBytes,
    },
  }, null, 2));
  console.log('\n（上传 zip 到上面 url 指向的 OSS 路径后，插件商店即可在 Windows 上分发该 R 运行时。）');
}

try { main(); } catch (e) { fail('未预期错误', e); }
