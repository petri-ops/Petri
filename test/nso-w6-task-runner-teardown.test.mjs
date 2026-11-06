/**
 * nso-w6-task-runner-teardown.test.mjs — BLOCK-363（NSO-W6a）runner 终止不留孤儿。
 *
 * 实证（W0）：评估会话 eval-full-tests 被 SIGTERM（exit 143）后，其 node --test 孙进程空转
 * 16 小时。根因：runner `spawn(cmd, { shell: true })` 后 `child.kill(sig)` 只终止 shell。
 * 契约：POSIX 下向 runner 发 SIGTERM，命令派生的孙进程在有界时间内消失（修前必红）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'scripts', 'dev-task-runner.cjs');
const posixOnly = process.platform === 'win32' ? test.skip : test;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor(predicate, timeoutMs, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return predicate();
}

posixOnly('W6a runner 收到 SIGTERM → 命令派生的孙进程一并终止（不留孤儿）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-w6a-'));
  const pidFile = path.join(dir, 'grandchild.pid');
  // 孙进程：长寿 node，自报 pid；外层 shell 再 sleep，模拟 `sh -c "node --test …"` 形态
  const grandchild = `node -e "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)" ${JSON.stringify(pidFile)}`;
  const runner = spawn(process.execPath, [RUNNER, 'run', '--label', 'w6a-teardown', '--runs-dir', dir, '--cmd', `${grandchild} & wait`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let gpid = null;
  try {
    assert.ok(await waitFor(() => fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim() !== '', 10000), '孙进程未启动');
    gpid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    assert.ok(alive(gpid), '孙进程应在运行');
    const exited = new Promise((resolve) => runner.on('exit', resolve));
    runner.kill('SIGTERM');
    await exited;
    const gone = await waitFor(() => !alive(gpid), 5000);
    assert.equal(gone, true, `runner 终止后孙进程 ${gpid} 仍存活（孤儿）`);
  } finally {
    if (gpid && alive(gpid)) { try { process.kill(gpid, 'SIGKILL'); } catch { /* best-effort */ } }
    try { runner.kill('SIGKILL'); } catch { /* best-effort */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
