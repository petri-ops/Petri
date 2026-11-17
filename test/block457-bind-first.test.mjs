/**
 * BLOCK-457 P1 — bind-first fail-fast 契约（HK-01 红绿先行）。
 *
 * 缺陷史：第二个后端此前「先 require 全部业务模块、最后才 listen」——模块加载期
 * 启动清扫（agent-task-store sweepInterruptedRunningTasks）在每个僵尸 boot 都执行，
 * 把健康后端 in-flight 任务误标「服务重启，Agent 任务中断」（2026-11-17 实机：
 * 749 boot / 734 EADDRINUSE / 4 任务误杀，millisecond 对账见 plan §0）。
 *
 * 契约：
 *   C1 port-guard 内核：同端口第二次绑定返回 null（可测内核）。
 *   C2 真实 server.js 在被占端口上：秒级 exit 77 + 单行守卫日志 + **零 DB 副作用**
 *      （temp dataDir 不出现 petri.db——模块加载根本不发生）。
 *   C3 正常端口上完整启动：/api/health 返回 instanceId/pid/dataDir 身份字段
 *      （main.js 探活 attach 的判据，BLOCK-457 P3）。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(ROOT, 'core/petri-server', 'server.js');
const SERVER_CWD = path.join(ROOT, 'core/petri-server');

/** 占住一个系统分配的空闲端口并返回 { server, port }（调用方负责 close）。 */
function occupyFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function makeTempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'block457-'));
}

function spawnServer(port, dataDir) {
  return spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_CWD,
    env: {
      ...process.env,
      R_SERVER_PORT: String(port),
      PETRI_DB_PATH: path.join(dataDir, 'petri.db'),
      PETRI_LOCAL_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function collect(stream) {
  let text = '';
  stream.on('data', (chunk) => { text += chunk.toString('utf8'); });
  return () => text;
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`exit timeout ${timeoutMs}ms`)), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function pollHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (resp.ok) return await resp.json();
    } catch { /* 未就绪继续轮询 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

test('C1 port-guard 内核：同端口第二次绑定返回 null', async () => {
  const { tryBindPort } = await import('../core/petri-server/port-guard.js');
  const { PORT_IN_USE_EXIT_CODE } = await import('../core/petri-server/port-guard.js');
  assert.equal(PORT_IN_USE_EXIT_CODE, 77, '退出码 77 = supervisor noRetryExitCodes 的契约值');

  // 先借 port 0 拿一个系统确认的空闲端口，释放后再测
  const { server, port } = await occupyFreePort();
  await new Promise((r) => server.close(r));
  const first = await tryBindPort(port);
  try {
    assert.notEqual(first, null, '空闲端口首次绑定应成功');
    const second = await tryBindPort(port);
    assert.equal(second, null, '同端口第二次绑定必须返回 null（不抛异常）');
  } finally {
    if (first) first.close();
  }
});

test('C2 被占端口上 spawn 真实 server.js：exit 77 + 守卫日志 + 零 DB 副作用', async () => {
  const { server, port } = await occupyFreePort();
  const dataDir = makeTempDataDir();
  try {
    const child = spawnServer(port, dataDir);
    const getOut = collect(child.stdout);
    const getErr = collect(child.stderr);
    const { code } = await waitForExit(child, 15_000);
    assert.equal(code, 77, `被占端口必须 exit 77（实测 code=${code}，stderr=${getErr().slice(0, 300)}）`);
    const combined = getOut() + getErr();
    assert.ok(combined.includes('[port-guard]'), '必须输出 [port-guard] 单行守卫日志');
    const leftovers = fs.readdirSync(dataDir);
    assert.deepEqual(leftovers, [], `零副作用：dataDir 不得出现任何文件（实测 ${JSON.stringify(leftovers)}）`);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('C3 空闲端口正常启动：health 带 instanceId/pid/dataDir 身份字段', async () => {
  const { server, port } = await occupyFreePort();
  const freePort = port;
  await new Promise((r) => server.close(r)); // 释放给被测后端
  const dataDir = makeTempDataDir();
  const dbPath = path.join(dataDir, 'petri.db');
  // 生产契约：迁移子进程先建表，后端才启动（main.js/wrapper 同序）。后端自身
  // initSchema 只建子集——空库直启会撞 no such table（生产不会走到这条路径）。
  const migration = spawn(process.execPath, [
    path.join(ROOT, 'src', 'migration-runner.js'), dbPath, path.join(ROOT, 'src', 'migrations'),
  ], {
    cwd: SERVER_CWD,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PETRI_BETTER_SQLITE3_ROOT: SERVER_CWD },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const migExit = await waitForExit(migration, 30_000);
  assert.equal(migExit.code, 0, `迁移子进程必须成功（实测 code=${migExit.code}）`);
  const child = spawnServer(freePort, dataDir);
  try {
    const body = await pollHealth(freePort, 30_000);
    assert.notEqual(body, null, '后端 30s 内未就绪');
    assert.equal(body.status, 'ok');
    assert.ok(typeof body.instanceId === 'string' && body.instanceId.length > 8,
      `health.instanceId 缺失或过短：${JSON.stringify(body.instanceId)}`);
    assert.ok(Number.isInteger(body.pid) && body.pid === child.pid,
      `health.pid 应等于子进程 pid（${body.pid} vs ${child.pid}）`);
    assert.equal(body.dataDir, dataDir, 'health.dataDir 应等于 PETRI_LOCAL_DATA_DIR（attach 身份判据）');
  } finally {
    child.kill();
    await waitForExit(child, 8_000).catch(() => { try { child.kill('SIGKILL'); } catch {} });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
