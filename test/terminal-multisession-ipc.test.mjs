import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);

/**
 * BLOCK-54 P2 — src/ipc/terminal.js 多 Tab 用户终端定向测试。
 *
 * 覆盖（plan §3 P2 验收）：
 *   1) 多会话并存：独立 pty 进程、write/resize 按 sessionId 路由、session-list 清单
 *   2) 事件路由：terminal:data / terminal:exit payload 带 sessionId；exit 后会话移除
 *   3) 上限拒绝：第 5 个 tab limitReached 诚实拒绝；关闭后可再开
 *   4) 旧形态兼容：string/无 sessionId 调用归一 default tab，单会话语义不回归
 *   5) before-quit kill-all：遍历 Map 全量 kill，0 孤儿
 *
 * 策略：require.cache 预播种 electron / node-pty / platform-compat mock，
 * 再 require src/ipc/terminal.js 真模块，直接调用注册的 ipcMain.handle。
 */

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const TERMINAL_PATH = path.join(ROOT, 'src/ipc/terminal.js');
const PLATFORM_COMPAT_PATH = path.join(ROOT, 'src/platform-compat.js');
const ROOT_REQUIRE = createRequire(path.join(ROOT, 'package.json'));

const ELECTRON_RESOLVED = ROOT_REQUIRE.resolve('electron');
const NODE_PTY_RESOLVED = ROOT_REQUIRE.resolve('node-pty');

/** 构造一个记录型 fake pty 进程（onData/onExit 返回可 dispose 句柄）。 */
function makeFakeProc(pid) {
  const dataHandlers = [];
  const exitHandlers = [];
  const proc = {
    pid,
    killed: false,
    writes: [],
    resizes: [],
    onData(cb) {
      dataHandlers.push(cb);
      return {
        dispose: () => {
          const i = dataHandlers.indexOf(cb);
          if (i >= 0) dataHandlers.splice(i, 1);
        },
      };
    },
    onExit(cb) {
      exitHandlers.push(cb);
      return {
        dispose: () => {
          const i = exitHandlers.indexOf(cb);
          if (i >= 0) exitHandlers.splice(i, 1);
        },
      };
    },
    write(text) {
      proc.writes.push(text);
    },
    resize(cols, rows) {
      proc.resizes.push([cols, rows]);
    },
    kill() {
      proc.killed = true;
    },
    __emitData(data) {
      for (const cb of [...dataHandlers]) cb(data);
    },
    __emitExit(payload) {
      for (const cb of [...exitHandlers]) cb(payload);
    },
  };
  return proc;
}

/**
 * 每个用例独立加载：清 terminal.js 缓存 + 重新播种 mock，
 * 返回 { call, sent, procs, beforeQuitFns, spawnOpts } 供断言。
 */
function loadFreshTerminal() {
  let pidSeq = 0;
  const procs = [];
  const spawnOptsLog = [];
  const electronMock = {
    ipcMain: {
      handle(channel, fn) {
        handleMap.set(channel, fn);
      },
    },
    app: {
      isPackaged: true,
      once(event, fn) {
        if (event === 'before-quit') beforeQuitFns.push(fn);
      },
    },
    shell: { openPath: async () => null },
  };
  const nodePtyMock = {
    spawn(shellPath, shellArgs, opts) {
      pidSeq += 1;
      const proc = makeFakeProc(1000 + pidSeq);
      procs.push(proc);
      spawnOptsLog.push({ shellPath, shellArgs, opts });
      return proc;
    },
  };
  const platformCompatMock = {
    getOpenShellPlan: () => ({ type: 'none', candidates: [] }),
    getSessionShellSpec: () => ({ shellPath: '/bin/zsh', args: ['-l'] }),
  };

  function seed(request, exportsObj) {
    const mod = new (require('node:module').Module)(request, null);
    mod.exports = exportsObj;
    mod.loaded = true;
    require.cache[request] = mod;
  }

  const handleMap = new Map();
  const beforeQuitFns = [];

  seed(ELECTRON_RESOLVED, electronMock);
  seed(NODE_PTY_RESOLVED, nodePtyMock);
  seed(PLATFORM_COMPAT_PATH, platformCompatMock);
  delete require.cache[TERMINAL_PATH];

  const mod = require(TERMINAL_PATH);
  const sent = [];
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => sent.push([channel, payload]) },
  };
  mod.setupTerminalIpc({
    mainWindow,
    getProcs: () => ({ rServerProc: null }),
    getLogDir: () => os.tmpdir(),
    readLogTail: () => '',
  });

  const call = (channel, payload) => handleMap.get(channel)(null, payload);
  return { call, sent, procs, beforeQuitFns, spawnOptsLog, MAX_TABS: mod.MAX_TERMINAL_TABS, DEFAULT_ID: mod.DEFAULT_SESSION_ID };
}

test('多会话并存：独立 pty、write/resize 按 sessionId 路由、session-list 清单', async () => {
  const t = loadFreshTerminal();
  const cwd = os.tmpdir();
  const r1 = await t.call('terminal:session-start', { sessionId: 'tab-1', targetPath: cwd });
  const r2 = await t.call('terminal:session-start', { sessionId: 'tab-2', targetPath: cwd });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r1.sessionId, 'tab-1');
  assert.equal(r2.sessionId, 'tab-2');
  assert.notEqual(r1.pid, r2.pid);
  assert.equal(t.procs.length, 2);

  // write 只进对应会话
  await t.call('terminal:session-write', { sessionId: 'tab-1', text: 'echo 1\n' });
  await t.call('terminal:session-write', { sessionId: 'tab-2', text: 'echo 2\n' });
  assert.deepEqual(t.procs[0].writes, ['echo 1\n']);
  assert.deepEqual(t.procs[1].writes, ['echo 2\n']);

  // resize 按 sessionId + 边界钳制（rows 0 → 兜底 24）
  await t.call('terminal:session-resize', { sessionId: 'tab-2', cols: 120, rows: 30 });
  await t.call('terminal:session-resize', { sessionId: 'tab-2', cols: 99999, rows: 0 });
  assert.deepEqual(t.procs[1].resizes, [
    [120, 30],
    [500, 24],
  ]);

  // session-list：id/cwd/pid/running/maxTabs
  const list = await t.call('terminal:session-list');
  assert.equal(list.ok, true);
  assert.equal(list.maxTabs, 4);
  assert.deepEqual(
    list.sessions.map((s) => s.sessionId).sort(),
    ['tab-1', 'tab-2'],
  );
  for (const s of list.sessions) {
    assert.equal(s.running, true);
    assert.equal(s.cwd, cwd);
    assert.equal(typeof s.pid, 'number');
  }

  // 重复 start 同一 sessionId → reused 不新开
  const again = await t.call('terminal:session-start', { sessionId: 'tab-1', targetPath: cwd });
  assert.equal(again.reused, true);
  assert.equal(again.pid, r1.pid);
  assert.equal(t.procs.length, 2);
});

test('事件路由：terminal:data / terminal:exit 带 sessionId；exit 后会话移除', async () => {
  const t = loadFreshTerminal();
  await t.call('terminal:session-start', { sessionId: 'tab-1', targetPath: os.tmpdir() });
  await t.call('terminal:session-start', { sessionId: 'tab-2', targetPath: os.tmpdir() });

  t.procs[0].__emitData('hello-from-1');
  assert.deepEqual(t.sent[0], ['terminal:data', { sessionId: 'tab-1', data: 'hello-from-1' }]);

  t.procs[1].__emitExit({ exitCode: 0, signal: null });
  const exitEvent = t.sent.find(([ch]) => ch === 'terminal:exit');
  assert.deepEqual(exitEvent, ['terminal:exit', { sessionId: 'tab-2', code: 0, signal: null }]);

  // exit 后该会话从 Map 移除；write 报未启动；不影响 tab-1
  const list = await t.call('terminal:session-list');
  assert.deepEqual(list.sessions.map((s) => s.sessionId), ['tab-1']);
  const w = await t.call('terminal:session-write', { sessionId: 'tab-2', text: 'x' });
  assert.equal(w.ok, false);
  assert.match(w.error, /未启动/);
  assert.equal(t.procs[0].killed, false);
});

test('上限拒绝：第 5 个 tab limitReached；关闭一个后可再开', async () => {
  const t = loadFreshTerminal();
  for (let i = 1; i <= 4; i += 1) {
    const r = await t.call('terminal:session-start', { sessionId: `tab-${i}`, targetPath: os.tmpdir() });
    assert.equal(r.ok, true);
  }
  const fifth = await t.call('terminal:session-start', { sessionId: 'tab-5', targetPath: os.tmpdir() });
  assert.equal(fifth.ok, false);
  assert.equal(fifth.limitReached, true);
  assert.match(fifth.error, /上限/);
  assert.equal(t.procs.length, 4);

  // 关一个 → 腾出名额
  await t.call('terminal:session-stop', { sessionId: 'tab-3' });
  const reopen = await t.call('terminal:session-start', { sessionId: 'tab-5', targetPath: os.tmpdir() });
  assert.equal(reopen.ok, true);
  assert.equal(t.procs.length, 5);
  assert.equal(t.procs[2].killed, true); // tab-3 进程已回收
});

test('旧形态兼容：string/无 sessionId 归一 default tab，单会话语义不回归', async () => {
  const t = loadFreshTerminal();
  const cwd = os.tmpdir();

  // 旧 session-start：string targetPath → default tab
  const r1 = await t.call('terminal:session-start', cwd);
  assert.equal(r1.ok, true);
  assert.equal(r1.sessionId, 'default');

  // 旧 reused 语义：再次 string 调用不新开
  const r2 = await t.call('terminal:session-start', cwd);
  assert.equal(r2.reused, true);
  assert.equal(r2.pid, r1.pid);
  assert.equal(t.procs.length, 1);

  // 旧 write：string input → default
  await t.call('terminal:session-write', 'ls\n');
  assert.deepEqual(t.procs[0].writes, ['ls\n']);

  // 旧 resize：{ cols, rows }（无 sessionId）→ default
  await t.call('terminal:session-resize', { cols: 100, rows: 30 });
  assert.deepEqual(t.procs[0].resizes, [[100, 30]]);

  // 旧 stop：undefined → default
  const stop = await t.call('terminal:session-stop', undefined);
  assert.equal(stop.wasRunning, true);
  assert.equal(t.procs[0].killed, true);
  const stopAgain = await t.call('terminal:session-stop', undefined);
  assert.equal(stopAgain.wasRunning, false);

  // default 腾出后，新形态会话可开
  const r3 = await t.call('terminal:session-start', { sessionId: 'tab-1', targetPath: cwd });
  assert.equal(r3.ok, true);
});

test('before-quit kill-all：遍历 Map 全量 kill，0 孤儿', async () => {
  const t = loadFreshTerminal();
  await t.call('terminal:session-start', { sessionId: 'tab-1', targetPath: os.tmpdir() });
  await t.call('terminal:session-start', { sessionId: 'tab-2', targetPath: os.tmpdir() });
  await t.call('terminal:session-start', os.tmpdir()); // default

  assert.equal(t.beforeQuitFns.length, 1);
  t.beforeQuitFns[0]();

  assert.ok(t.procs.every((p) => p.killed), '所有 pty 进程必须被 kill');
  const list = await t.call('terminal:session-list');
  assert.deepEqual(list.sessions, []);
});

test('pty spawn 规格：xterm-256color + TERM/COLORTERM 环境注入', async () => {
  const t = loadFreshTerminal();
  await t.call('terminal:session-start', { sessionId: 'tab-1', targetPath: os.tmpdir() });
  const spec = t.spawnOptsLog[0];
  assert.equal(spec.shellPath, '/bin/zsh');
  assert.deepEqual(spec.shellArgs, ['-l']);
  assert.equal(spec.opts.name, 'xterm-256color');
  assert.equal(spec.opts.env.TERM, 'xterm-256color');
  assert.equal(spec.opts.env.COLORTERM, 'truecolor');
});
