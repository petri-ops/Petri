#!/usr/bin/env node
'use strict';

/**
 * sidecars/sand3d-runner/sand3d-runner.mjs — BLOCK-460 L1 几何生产执行器（B-1 隔离边界内）。
 *
 * sand3d 程序的本地受控入口。纪律（docs/block460-scene-joints-plan.md §1-C）：
 *   - 仅经 agent 的 run_cmd（guard-ack 审批链）调用，不建第二执行通道、零新 IPC；
 *   - Python 侧依赖只进本 sidecar 自管 venv（默认 <repo>/.petri-dev-user-data/sand3d-venv，
 *     env SAND3D_VENV 可覆盖），pin sand3d==1.6.3，不污染全局、不进产品 manifest；
 *   - program 路径必须工作区相对（禁绝对路径与 ..）；--out 目录内的 GLB/URDF 产物
 *     逐个 sha256 后以 JSON 契约打到 stdout（唯一机器可读出口）；
 *   - 失败诚实：任何一步失败以 {ok:false, error, stderr 摘要} 退出，不伪造成功。
 *
 * 用法：
 *   node sand3d-runner.mjs bootstrap                    # 幂等建 venv + pin 安装
 *   node sand3d-runner.mjs run --program model3d/x.py --out model3d/runs/x
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SAND3D_PIN = '1.6.3';

function fail(error, details) {
  process.stdout.write(`${JSON.stringify({ ok: false, error, ...(details ? { details } : {}) })}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--program' || token === '--out' || token === '--venv') {
      args[token.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function repoRoot() {
  // sidecars/sand3d-runner/ → 仓库根两级之上
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
}

function resolveVenv(override) {
  return path.resolve(override || process.env.SAND3D_VENV || path.join(repoRoot(), '.petri-dev-user-data', 'sand3d-venv'));
}

function venvPython(venv) {
  return path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeWorkspaceRelative(value, label) {
  const text = String(value || '').trim().replace(/\\/g, '/');
  if (!text || text.startsWith('/') || /^[A-Za-z]:/.test(text) || text.split('/').some((part) => part === '..' || part === '')) {
    fail(`${label}_path_invalid`, { path: String(value || '') });
  }
  return text;
}

function cmdBootstrap(args) {
  const venv = resolveVenv(args.venv);
  const python = venvPython(venv);
  const steps = [];
  if (!fs.existsSync(python)) {
    const host = process.env.SAND3D_PYTHON || 'python3.11';
    fs.mkdirSync(path.dirname(venv), { recursive: true });
    const made = spawnSync(host, ['-m', 'venv', venv], { encoding: 'utf8' });
    if (made.status !== 0) fail('venv_create_failed', { host, stderr: (made.stderr || '').slice(-400) });
    steps.push(`venv created via ${host}`);
  } else {
    steps.push('venv already present');
  }
  const probe = spawnSync(python, ['-m', 'pip', 'show', `sand3d`], { encoding: 'utf8' });
  const installed = probe.status === 0 && (probe.stdout || '').includes(`Version: ${SAND3D_PIN}`);
  if (!installed) {
    const pinned = spawnSync(python, ['-m', 'pip', 'install', `sand3d==${SAND3D_PIN}`], { encoding: 'utf8' });
    if (pinned.status !== 0) fail('pip_install_failed', { pin: SAND3D_PIN, stderr: (pinned.stderr || '').slice(-400) });
    steps.push(`sand3d==${SAND3D_PIN} installed`);
  } else {
    steps.push(`sand3d==${SAND3D_PIN} already pinned`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, venv, steps })}\n`);
}

function cmdRun(args) {
  const venv = resolveVenv(args.venv);
  const python = venvPython(venv);
  if (!fs.existsSync(python)) fail('venv_missing', { hint: '先跑 bootstrap 子命令' });
  const programRel = safeWorkspaceRelative(args.program, 'program');
  const outRel = safeWorkspaceRelative(args.out ?? path.posix.join(path.posix.dirname(programRel), 'runs', path.basename(programRel, '.py')), 'out');
  const root = repoRoot();
  const programAbs = path.join(root, programRel);
  const outAbs = path.join(root, outRel);
  if (!fs.existsSync(programAbs)) fail('program_missing', { program: programRel });
  fs.mkdirSync(outAbs, { recursive: true });

  // cwd=out：程序内 s3d.export(x, '相对名') 的产物落 --out（Skill 契约：导出必须用相对文件名）
  const executed = spawnSync(python, [programAbs], { cwd: outAbs, encoding: 'utf8', timeout: 120000 });
  if (executed.status !== 0) {
    fail('program_failed', { exitCode: executed.status, stderr: (executed.stderr || '').slice(-800) });
  }
  const artifacts = fs.readdirSync(outAbs)
    .filter((name) => /\.(glb|urdf|obj|stl)$/i.test(name))
    .sort()
    .map((name) => {
      const file = path.join(outAbs, name);
      return { name, bytes: fs.statSync(file).size, sha256: sha256File(file) };
    });
  if (!artifacts.some((a) => a.name.endsWith('.glb'))) fail('no_glb_exported', { out: outRel });
  const fingerprintMatch = [...`${executed.stdout}`.matchAll(/fingerprint[^:]*:\s*([0-9a-f]+)/gi)];
  process.stdout.write(`${JSON.stringify({
    ok: true,
    out: outRel,
    artifacts,
    fingerprint: fingerprintMatch.length > 0 ? fingerprintMatch[fingerprintMatch.length - 1][1] : null,
    programSha256: sha256File(programAbs),
    stdout: (executed.stdout || '').slice(-1000),
  })}\n`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'bootstrap') cmdBootstrap(parseArgs(rest));
else if (command === 'run') cmdRun(parseArgs(rest));
else fail('usage', { usage: 'node sand3d-runner.mjs <bootstrap|run> [--program <ws-relative .py>] [--out <ws-relative dir>] [--venv <path>]' });
