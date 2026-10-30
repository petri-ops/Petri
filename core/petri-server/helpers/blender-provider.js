'use strict';

/**
 * helpers/blender-provider.js — NEXT-04A 可选本地 Blender 执行后端。
 *
 * 只调用仓库内固定 Python 脚本 + 已校验 SceneSpec JSON；不接受任意脚本、
 * 任意 shell 参数、网络 URL 或 shader。Blender 缺席时诚实返回 unavailable。
 * Three.js 负责交互预览，Blender 负责构建/渲染/导出；两者不互相冒充。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'resources', 'model3d', 'blender_scene.py');
const { DEFAULT_RENDER_VIEWS } = require('./model3d-views');
const TIMEOUT_MS = 180_000;
let cachedBinary;

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function findBlenderBinary() {
  if (cachedBinary !== undefined) return cachedBinary;
  const candidates = [];
  if (process.env.PETRI_BLENDER_BIN) candidates.push(process.env.PETRI_BLENDER_BIN);
  if (process.platform === 'win32') {
    const roots = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Blender Foundation'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Blender Foundation'),
    ];
    for (const root of roots) {
      try {
        for (const entry of fs.readdirSync(root)) {
          candidates.push(path.join(root, entry, 'blender.exe'));
        }
      } catch { /* root absent */ }
    }
    candidates.push('blender.exe', 'blender');
  } else {
    candidates.push('/Applications/Blender.app/Contents/MacOS/Blender', 'blender');
  }
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && fs.existsSync(candidate)) {
        cachedBinary = candidate;
        return candidate;
      }
      if (!candidate.includes(path.sep)) {
        const resolved = require('node:child_process').execFileSync(
          process.platform === 'win32' ? 'where' : 'which',
          [candidate],
          { encoding: 'utf8', timeout: 5000 }
        ).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        if (resolved && fs.existsSync(resolved)) {
          cachedBinary = resolved;
          return resolved;
        }
      }
    } catch { /* try next */ }
  }
  cachedBinary = null;
  return null;
}

function probeBlender() {
  const binary = findBlenderBinary();
  if (!binary) {
    return Promise.resolve({
      status: 'unavailable',
      reason: 'blender_not_installed',
      binary: null,
      version: null,
    });
  }
  return new Promise((resolve) => {
    execFile(binary, ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      if (error) {
        cachedBinary = undefined;
        resolve({ status: 'unavailable', reason: 'blender_probe_failed', binary, version: null });
        return;
      }
      const version = String(stdout || '').split(/\r?\n/).find((line) => /^Blender\s+/i.test(line))
        || String(stdout || '').split(/\r?\n/)[0]
        || null;
      resolve({ status: 'ready', reason: null, binary, version });
    });
  });
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const normalizedRoot = path.resolve(root);
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) {
    throw new Error('output_path_outside_workspace');
  }
  return target;
}

async function runBlenderScene({ scene, workspaceRoot, relativeOutDir = 'model3d/runs', views = [...DEFAULT_RENDER_VIEWS], formats = ['glb', 'stl', 'obj'], turntable = null, signal } = {}) {
  const binary = findBlenderBinary();
  if (!binary) {
    return { ok: false, error: 'capability_unavailable', reason: 'blender_not_installed' };
  }
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const runId = `m3d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const outDir = resolveInside(workspaceRoot, path.join(relativeOutDir, runId));
  fs.mkdirSync(outDir, { recursive: true });
  const scenePath = path.join(outDir, 'scene.json');
  fs.writeFileSync(scenePath, JSON.stringify(scene, null, 2));
  const args = [
    '--background',
    '--factory-startup',
    '--python', SCRIPT_PATH,
    '--',
    '--scene', scenePath,
    '--out', outDir,
    '--views', views.join(','),
    '--formats', formats.join(','),
    '--root', workspaceRoot,
  ];
  if (turntable) {
    args.push('--turntable', String(turntable.frames), '--spin-elevation', String(turntable.elevationDeg));
  }
  const started = Date.now();
  const result = await new Promise((resolve) => {
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already exited */ }
      finish({ code: 124, stdout, stderr: `${stderr}\nblender_timeout` });
    }, TIMEOUT_MS);
    if (timer.unref) timer.unref();
    const abort = () => {
      try { child.kill(); } catch { /* already exited */ }
      finish({ code: 130, stdout, stderr: `${stderr}\nblender_cancelled` });
    };
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      finish({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      finish({ code: code ?? 1, stdout, stderr });
    });
  });

  const reportPath = path.join(outDir, 'blender-report.json');
  if (result.code !== 0 || !fs.existsSync(reportPath)) {
    return {
      ok: false,
      error: result.code === 124 ? 'blender_timeout' : result.code === 130 ? 'blender_cancelled' : 'blender_failed',
      message: String(result.stderr || result.stdout).slice(-2000),
      outDir,
      durationMs: Date.now() - started,
    };
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const describe = (found) => {
    if (!found || !fs.existsSync(found)) return null;
    return {
      path: path.relative(workspaceRoot, found).replace(/\\/g, '/'),
      sha256: hashFile(found),
      bytes: fs.statSync(found).size,
    };
  };
  const outputFiles = [
    ...Object.values(report.renders || {}),
    ...Object.values(report.exports || {}),
    report.turntable?.video || null,
  ].map(describe).filter(Boolean);
  // 序列帧算过程产物：路径/哈希/字节可核（frameAssets），但不进成果面——终态产物是 mp4，
  // 把 N 张几乎相同的帧图也登记成成果会把面板淹没（P2-05 负责结果面播放）。
  const frameAssets = (report.turntable?.stills || []).map(describe).filter(Boolean);
  return {
    ok: report.ok === true,
    outDir: path.relative(workspaceRoot, outDir).replace(/\\/g, '/'),
    report,
    outputs: outputFiles,
    frameAssets,
    sceneHashFile: path.relative(workspaceRoot, scenePath).replace(/\\/g, '/'),
    durationMs: Date.now() - started,
  };
}

module.exports = {
  findBlenderBinary,
  probeBlender,
  runBlenderScene,
};
