/**
 * BLOCK-231 — dev-task-runner 契约测（进程层看门狗，不依赖 agent 通知）。
 * 覆盖：成功/失败退出码、wait 超时 124、status 清单。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, '.agents/skills/petri-dev-infra/scripts/dev-task-runner.cjs');

function tmpRuns() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'petri-task-runs-'));
}

function runRunner(args, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER, ...args], { cwd: ROOT, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { try { child.kill(); } catch {} reject(new Error('runner timeout')); }, timeoutMs);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on('error', reject);
  });
}

function latestStatus(runsDir) {
  const files = fs.readdirSync(runsDir).filter((name) => name.endsWith('.status.json'));
  assert.ok(files.length > 0, '应存在 status 文件');
  const rows = files.map((name) => JSON.parse(fs.readFileSync(path.join(runsDir, name), 'utf8')));
  rows.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  return rows[0];
}

test('run：成功命令退出 0，日志与 ended 状态落盘', async () => {
  const runsDir = tmpRuns();
  try {
    const cmd = `"${process.execPath}" -e "console.log('runner-ok')"`;
    const result = await runRunner(['run', '--runs-dir', runsDir, '--label', 'ok', '--cmd', cmd]);
    assert.equal(result.code, 0, result.stderr);
    const status = latestStatus(runsDir);
    assert.equal(status.state, 'ended');
    assert.equal(status.exitCode, 0);
    assert.match(fs.readFileSync(status.logPath, 'utf8'), /runner-ok/);
  } finally {
    try { fs.rmSync(runsDir, { recursive: true, force: true }); } catch {}
  }
});

test('run：失败命令原样透传退出码 3', async () => {
  const runsDir = tmpRuns();
  try {
    const cmd = `"${process.execPath}" -e "process.exit(3)"`;
    const result = await runRunner(['run', '--runs-dir', runsDir, '--label', 'fail', '--cmd', cmd]);
    assert.equal(result.code, 3, result.stderr);
    assert.equal(latestStatus(runsDir).exitCode, 3);
  } finally {
    try { fs.rmSync(runsDir, { recursive: true, force: true }); } catch {}
  }
});

test('wait：超时返回 124 并保留 running 状态（不把未知当成功）', async () => {
  const runsDir = tmpRuns();
  const slowCmd = `"${process.execPath}" -e "setTimeout(()=>{}, 8000)"`;
  const runnerProc = spawn(process.execPath, [RUNNER, 'run', '--runs-dir', runsDir, '--label', 'slow', '--cmd', slowCmd], {
    cwd: ROOT,
    windowsHide: true,
    stdio: 'ignore',
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const waited = await runRunner(['wait', '--runs-dir', runsDir, '--latest', '--timeout-ms', '300'], 10_000);
    assert.equal(waited.code, 124, waited.stderr);
    const status = latestStatus(runsDir);
    assert.equal(status.state, 'running');
  } finally {
    try {
      const status = latestStatus(runsDir);
      if (status.pid) process.kill(Number(status.pid));
    } catch {}
    try { runnerProc.kill(); } catch {}
    try { fs.rmSync(runsDir, { recursive: true, force: true }); } catch {}
  }
});

test('status --json：列出 total 与 open/failed', async () => {
  const runsDir = tmpRuns();
  try {
    const okCmd = `"${process.execPath}" -e "process.exit(0)"`;
    const failCmd = `"${process.execPath}" -e "process.exit(2)"`;
    await runRunner(['run', '--runs-dir', runsDir, '--label', 'ok', '--cmd', okCmd]);
    await runRunner(['run', '--runs-dir', runsDir, '--label', 'bad', '--cmd', failCmd]);
    const result = await runRunner(['status', '--runs-dir', runsDir, '--json']);
    assert.equal(result.code, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.total, 2);
    assert.equal(body.open.length, 1);
    assert.equal(body.open[0].label, 'bad');
  } finally {
    try { fs.rmSync(runsDir, { recursive: true, force: true }); } catch {}
  }
});
