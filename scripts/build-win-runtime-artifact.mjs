#!/usr/bin/env node
/**
 * build-win-runtime-artifact.mjs
 * ---------------------------------------------------------------
 * 在「装有 Python 3.11 的 Windows 构建机」上，组装 BioF3 的 windows-x64
 * Python 运行时制品（对应 manifest.json 的 biof3-py-runtime）。
 *
 * 产物：一个 zip，内部根目录为 `Python/`，解压到
 *   userData/runtimes/Python 后，resolveRuntime('python') 即可命中
 *   userData/runtimes/Python/python.exe。
 *
 * 用法（在 Windows 构建机）：
 *   node scripts/build-win-runtime-artifact.mjs
 *   # 可选环境变量：
 *   #   BIOF3_BUILD_PYTHON  —— 源 Python 解释器（默认 `py -3.11` 或 `python`）
 *   #   BIOF3_PY_VERSION    —— 仅用于制品命名（默认取源解释器版本）
 *   #   OUT_DIR             —— 产物输出目录（默认 <repo>/dist-runtime）
 *
 * 完成后脚本会打印一段 JSON，把它填进：
 *   resources/built-in-plugins/manifest.json 的 biof3-py-runtime.artifacts.windows-x64
 *   resources/built-in-plugins/manifest.placeholders.json 对应条目（current 由 null 改为真实值）
 * 注意：release-contract.json 的 windows-x64.supported 仍保持 false，
 *       直到签名/公证的桌面发布边界（Week 3/4 发布流水线）就绪。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REQUIREMENTS = path.join(REPO_ROOT, 'resources', 'built-in-plugins', 'py-runtime-requirements.txt');
const OUT_DIR = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(REPO_ROOT, 'dist-runtime');

function fail(msg, err) {
  console.error(`\n[build-runtime] ERROR: ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

// 1) 解析源 Python 前缀
function resolveSourcePrefix() {
  const candidates = [];
  if (process.env.BIOF3_BUILD_PYTHON) candidates.push(process.env.BIOF3_BUILD_PYTHON);
  candidates.push('py', 'python', 'python3');
  for (const c of candidates) {
    try {
      const prefix = execFileSync(c, ['-c', 'import sys;print(sys.prefix)'], {
        encoding: 'utf-8', timeout: 8000, windowsHide: true,
      }).trim();
      if (prefix && fs.existsSync(prefix)) {
        const ver = execFileSync(c, ['-c', 'import sys;print("%d.%d"%sys.version_info[:2])'], {
          encoding: 'utf-8', timeout: 8000, windowsHide: true,
        }).trim();
        console.log(`[build-runtime] source python: ${c} -> ${prefix} (${ver})`);
        return { exe: c, prefix, ver };
      }
    } catch {}
  }
  fail('找不到可用的 Python 3.11+ 源解释器。请先安装 Python 3.11 或设置 BIOF3_BUILD_PYTHON。');
}

// 2) 复制前缀到 staging/Python
function stagePrefix(srcPrefix, stagePython) {
  console.log(`[build-runtime] copying ${srcPrefix} -> ${stagePython}`);
  fs.mkdirSync(path.dirname(stagePython), { recursive: true });
  fs.cpSync(srcPrefix, stagePython, { recursive: true });
}

// 3) 在 staging 内 bootstrap pip 并安装 requirements
function installDeps(stagePython) {
  const py = path.join(stagePython, 'python.exe');
  if (!fs.existsSync(py)) fail(`staging 内未找到 python.exe: ${py}`);
  try {
    spawnSync(py, ['-m', 'ensurepip', '--upgrade'], { stdio: 'inherit', windowsHide: true });
  } catch (e) {
    fail('ensurepip 失败', e);
  }
  console.log(`[build-runtime] installing requirements from ${REQUIREMENTS}`);
  const r = spawnSync(py, ['-m', 'pip', 'install', '--no-cache-dir', '-r', REQUIREMENTS], {
    stdio: 'inherit', windowsHide: true,
  });
  if (r.status !== 0) fail(`pip install 失败 (exit ${r.status})`);
}

// 4) 精简体积：删除 __pycache__（保留 .pyc，stdlib 需要）
function prune(stagePython) {
  console.log('[build-runtime] pruning __pycache__ ...');
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
  walk(stagePython);
}

// 5) 压缩（PowerShell Compress-Archive）
function zip(stageRoot, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  console.log(`[build-runtime] compressing -> ${zipPath}`);
  const ps = `Compress-Archive -Path '${stageRoot}' -DestinationPath '${zipPath}' -Force`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) fail('Compress-Archive 失败');
}

// 6) 计算 sha256 + size
function digest(zipPath) {
  const buf = fs.readFileSync(zipPath);
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), sizeBytes: buf.length };
}

function main() {
  if (os.platform() !== 'win32') {
    fail('此脚本必须在 Windows 构建机上运行（依赖 PowerShell Compress-Archive 与 Windows Python 布局）。');
  }
  if (!fs.existsSync(REQUIREMENTS)) fail(`缺少 requirements 文件: ${REQUIREMENTS}`);

  const { prefix, ver } = resolveSourcePrefix();
  const stageRoot = path.join(OUT_DIR, 'biof3-py-runtime-staging');
  const stagePython = path.join(stageRoot, 'Python');
  if (fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true });

  stagePrefix(prefix, stagePython);
  installDeps(stagePython);
  prune(stagePython);

  const zipPath = path.join(OUT_DIR, 'py-runtime-1.0.0-windows-x64.zip');
  zip(stageRoot, zipPath);

  const { sha256, sizeBytes } = digest(zipPath);

  console.log('\n==================== BUILD COMPLETE ====================');
  console.log(`artifact : ${zipPath}`);
  console.log(`sizeBytes: ${sizeBytes}`);
  console.log(`sha256   : ${sha256}`);
  console.log('\n将下面这段填进 manifest.json 的 biof3-py-runtime.artifacts.windows-x64，');
  console.log('并把 manifest.placeholders.json 对应条目的 current 由 null 改为真实值：\n');
  console.log(JSON.stringify({
    "windows-x64": {
      "url": "https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/py-runtime/1.0.0/windows-x64.zip",
      "sha256": sha256,
      "sizeBytes": sizeBytes,
    },
  }, null, 2));
  console.log('\n（上传 zip 到上面 url 指向的 OSS 路径后，插件商店即可在 Windows 上分发该运行时。）');
}

try { main(); } catch (e) { fail('未预期错误', e); }
