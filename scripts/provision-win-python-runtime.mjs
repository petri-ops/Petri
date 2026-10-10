#!/usr/bin/env node
// BLOCK-104 P4 — Windows 专属脚本入口护栏：非 win32 直接退出，杜绝半途怪异失败。
if (process.platform !== 'win32') {
  console.error(`[platform] provision-win-python-runtime.mjs 仅支持 Windows（当前 ${process.platform}）。`);
  process.exit(2);
}
/**
 * provision-win-python-runtime.mjs
 * ---------------------------------------------------------------
 * 开发机一键引导：在本机 Windows 上把 Petri 的 Python 运行时装进
 *   %USERPROFILE%/Documents/Petri-Local/runtimes/Python
 * （与 main.js resolveRuntime 的第一优先路径一致），从而 Python 执行器
 * 在下次 `npm run dev` 时自动启动——无需手动安装 Python，也无需等
 * OSS 上的官方 windows-x64 制品（Week 3/4）。
 *
 * 原理：下载官方「可嵌入 Python 3.11」zip -> 解压到运行时目录 ->
 *        bootstrap pip -> pip 安装科学栈。
 *
 * 用法（在 Windows 开发机，需网络）：
 *   node scripts/provision-win-python-runtime.mjs
 * 环境变量：
 *   PETRI_PY_VERSION      嵌入版版本（默认 3.11.9）
 *   PETRI_LOCAL_DATA_DIR  覆盖数据根目录（默认 Documents/Petri-Local）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REQUIREMENTS = path.join(REPO_ROOT, 'resources', 'built-in-plugins', 'py-runtime-requirements.txt');

const PY_VERSION = process.env.PETRI_PY_VERSION || '3.11.9';
const DATA_ROOT = process.env.PETRI_LOCAL_DATA_DIR
  ? path.resolve(process.env.PETRI_LOCAL_DATA_DIR)
  : path.join(os.homedir(), 'Documents', 'Petri-Local');
const TARGET = path.join(DATA_ROOT, 'runtimes', 'Python');

function fail(msg, err) {
  console.error(`\n[provision] ERROR: ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

function pyExeAt(dir) {
  for (const sub of ['', 'bin', 'Scripts']) {
    const p = path.join(dir, sub, 'python.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function download(url, dest) {
  console.log(`[provision] download ${url}`);
  const res = await fetch(url);
  if (!res.ok) fail(`下载失败 ${res.status} ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) fail(`命令失败: ${cmd} ${args.join(' ')} (exit ${r.status})`);
}

async function main() {
  if (os.platform() !== 'win32') fail('此脚本仅用于 Windows 开发机。');

  const existing = pyExeAt(TARGET);
  if (existing) {
    console.log(`[provision] 已就绪，无需重复安装: ${existing}`);
    console.log('[provision] 直接重启 `npm run dev` 即可使用新运行时。');
    return;
  }

  fs.mkdirSync(TARGET, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-py-'));
  const embedZip = path.join(tmp, 'embed.zip');
  const embedUrl = `https://www.python.org/ftp/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip`;

  try {
    await download(embedUrl, embedZip);
    const extractTmp = path.join(tmp, 'extracted');
    fs.mkdirSync(extractTmp, { recursive: true });
    sh('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -Path '${embedZip}' -DestinationPath '${extractTmp}' -Force`]);

    // Python 嵌入版 zip 是平铺结构（无顶层子目录）。若解压后 extractTmp
    // 下恰好只有一个目录条目，则视为顶层包目录；否则直接用 extractTmp。
    const entries = fs.readdirSync(extractTmp);
    const onlyDir = entries.length === 1 && fs.statSync(path.join(extractTmp, entries[0])).isDirectory()
      ? path.join(extractTmp, entries[0])
      : extractTmp;
    for (const f of fs.readdirSync(onlyDir)) {
      fs.renameSync(path.join(onlyDir, f), path.join(TARGET, f));
    }

    // 让嵌入版支持 pip：取消 ._pth 中 `import site` 的注释并包含 Lib/site-packages
    const pth = fs.readdirSync(TARGET).find((f) => f.endsWith('._pth'));
    if (pth) {
      const p = path.join(TARGET, pth);
      const lines = fs.readFileSync(p, 'utf-8').split(/\r?\n/).map((l) => (l.trim() === '#import site' ? 'import site' : l));
      if (!lines.some((l) => l.trim() === 'Lib/site-packages')) lines.push('Lib/site-packages');
      fs.writeFileSync(p, lines.join('\n'));
    } else {
      console.warn('[provision] 未找到 ._pth，嵌入版布局可能异常。');
    }

    const py = path.join(TARGET, 'python.exe');
    if (!fs.existsSync(py)) fail(`解压后未找到 ${py}`);

    // bootstrap pip
    const getpip = path.join(tmp, 'get-pip.py');
    await download('https://bootstrap.pypa.io/get-pip.py', getpip);
    sh(py, [getpip]);

    // 安装科学栈（单个包失败不阻断，保证 Python 执行器可用）
    console.log(`[provision] installing requirements: ${REQUIREMENTS}`);
    const r = spawnSync(py, ['-m', 'pip', 'install', '--no-cache-dir', '-r', REQUIREMENTS], {
      stdio: 'inherit', windowsHide: true,
    });
    if (r.status !== 0) {
      console.warn(`[provision] 部分包安装失败（exit ${r.status}）。Python 执行器仍可用；失败的包待官方制品就绪后再补。`);
    }

    console.log('\n==================== PROVISION COMPLETE ====================');
    console.log(`Python 运行时已安装到: ${TARGET}`);
    console.log('下一步：重启 `npm run dev`，main.js 会在启动时解析到该运行时并注入后端。');
    console.log('验证：dev 控制台应出现 `[desktop] Python runtime: ...`。');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => fail('未预期错误', e));
