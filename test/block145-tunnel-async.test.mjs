import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * BLOCK-145 D1 — tunnel 异步化契约测试（红绿先行，BK-08 根因修复守卫）。
 *
 * 已定位根因（BLOCK-144 取证）：
 *   - core/biof3-server/mobile-gateway/tunnel.js:20  顶层解构 spawnSync（别名 cpSpawnSync）
 *   - tunnel.js:200-208 remotePortSweep() 用 cpSpawnSync 同步跑 ssh（ConnectTimeout=10、
 *     timeout=25s）——在 spawnTunnel() 冷启动链上同步等待网络往返，阻塞 event loop
 *   - core/biof3-server/server.js:370 启动路径 getTunnelManager(...).startIfEnabled()
 *     在模块求值期同步走到上述同步 ssh → 桌面冷启动被卡（BK-08）
 *
 * 契约（修好后必须全绿）：
 *   ① 源码守卫：tunnel.js 冷启动路径（remotePortSweep 及其调用链 spawnTunnel /
 *      killStaleTunnelProcesses / createTunnelManager / getTunnelManager，含模块顶层）
 *      不得出现任何同步子进程调用（spawnSync / execSync / execFileSync，含别名）。
 *   ② 启动非阻塞：startIfEnabled() 不得在返回前同步等待网络往返（经导出面 +
 *      依赖注入测：spawnProcess/killStale 注入假件，阻塞源被隔离为 remotePortSweep）。
 */

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TUNNEL_PATH = path.join(ROOT, 'core/biof3-server/mobile-gateway/tunnel.js');
const SERVER_PATH = path.join(ROOT, 'core/biof3-server/server.js');

const SYNC_SPAWN_RE = /spawnSync|execSync|execFileSync/gi;

// ── 轻量 JS 预处理：注释 / 字符串 / 模板字面量按 1:1 长度打空 ──────────────
// 目的：① 同步子进程 API 的词法守卫不被注释/字符串里的字样误触；
//       ② 打空后长度不变，违规可精确回指源码行号。
// 已知局限（对本文件面足够）：不解析正则字面量内容；模板内插值整体打空。
function stripJs(src) {
  let out = '';
  let mode = 'code'; // code | line | block | squote | dquote | template
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const d = i + 1 < src.length ? src[i + 1] : '';
    if (c === '\n') {
      out += '\n';
      if (mode === 'line') mode = 'code';
      continue;
    }
    if (mode === 'code') {
      if (c === '/' && d === '/') { mode = 'line'; out += '  '; i += 1; continue; }
      if (c === '/' && d === '*') { mode = 'block'; out += '  '; i += 1; continue; }
      if (c === "'" || c === '"' || c === '`') {
        mode = c === "'" ? 'squote' : c === '"' ? 'dquote' : 'template';
        out += ' ';
        continue;
      }
      out += c;
      continue;
    }
    if (mode === 'line') { out += ' '; continue; }
    if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; out += '  '; i += 1; continue; }
      out += ' ';
      continue;
    }
    // 字符串 / 模板内部
    if (c === '\\') { out += '  '; i += 1; continue; }
    if ((mode === 'squote' && c === "'") || (mode === 'dquote' && c === '"') || (mode === 'template' && c === '`')) {
      mode = 'code';
      out += ' ';
      continue;
    }
    out += ' ';
  }
  return out;
}

function lineOf(stripped, idx) {
  let line = 1;
  for (let i = 0; i < idx; i += 1) if (stripped[i] === '\n') line += 1;
  return line;
}

/**
 * 在打空源码里按名提取函数体（声明式 `function name(...)`，含嵌套函数）。
 * 先括号配对参数表（默认参数里可能有箭头函数/对象字面量），再花括号配对函数体。
 */
function extractFunction(stripped, name) {
  const sig = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(stripped);
  if (!sig) return null;
  let depth = 0;
  let i = sig.index + sig[0].length - 1; // 指向参数表的 '('
  for (; i < stripped.length; i += 1) {
    if (stripped[i] === '(') depth += 1;
    else if (stripped[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  const bodyOpen = stripped.indexOf('{', i + 1);
  if (bodyOpen === -1) return null;
  let bDepth = 0;
  for (let j = bodyOpen; j < stripped.length; j += 1) {
    if (stripped[j] === '{') bDepth += 1;
    else if (stripped[j] === '}') {
      bDepth -= 1;
      // start 与 text 同源（都从函数体 '{' 起算），行号换算才精确（参数表跨行时不得用 paramStart）
      if (bDepth === 0) return { start: bodyOpen, end: j + 1, text: stripped.slice(bodyOpen, j + 1) };
    }
  }
  return null;
}

// ── ① 源码守卫：冷启动路径不得含同步子进程调用（当前必红） ─────────────────

test('BLOCK-145 D1① tunnel.js 冷启动路径不得含同步子进程调用（BK-08 根因守卫）', () => {
  const src = readFileSync(TUNNEL_PATH, 'utf8');
  const stripped = stripJs(src);
  const srcLines = src.split('\n');

  // 冷启动链（BK-08 取证：server.js:370 → getTunnelManager → createTunnelManager
  // → startIfEnabled/spawnTunnel → killStale + remotePortSweep）
  const scopes = [
    ['remotePortSweep', extractFunction(stripped, 'remotePortSweep')],
    ['spawnTunnel', extractFunction(stripped, 'spawnTunnel')],
    ['killStaleTunnelProcesses', extractFunction(stripped, 'killStaleTunnelProcesses')],
    ['createTunnelManager', extractFunction(stripped, 'createTunnelManager')],
    ['getTunnelManager', extractFunction(stripped, 'getTunnelManager')],
  ];
  // 守卫锚：链上函数必须全部定位得到，防改名后守卫空转
  for (const [name, span] of scopes) {
    assert.ok(span, `guard anchor: function ${name} 必须存在（如改名需同步更新本守卫）`);
  }

  const violations = [];
  const seen = new Set();
  const record = (label, line) => {
    const key = `${label}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push(`${key}  ${String(srcLines[line - 1] || '').trim()}`);
  };
  for (const [name, span] of scopes) {
    SYNC_SPAWN_RE.lastIndex = 0;
    for (const m of span.text.matchAll(SYNC_SPAWN_RE)) {
      record(`${name}()`, lineOf(stripped, span.start + m.index));
    }
  }
  // 模块顶层兜底：顶层解构别名（如 const { spawnSync: cpSpawnSync }）一并禁
  SYNC_SPAWN_RE.lastIndex = 0;
  for (const m of stripped.matchAll(SYNC_SPAWN_RE)) {
    record('tunnel.js(模块级)', lineOf(stripped, m.index));
  }

  assert.deepEqual(
    violations,
    [],
    'BK-08/D1 契约违反：tunnel.js 冷启动路径存在同步子进程调用（阻塞 event loop，卡桌面冷启动）:\n  '
      + (violations.length ? violations.join('\n  ') : '(none)')
  );

  // 清场语义锚（清场结果一致）：远端清场的 ssh 参数、远端命令与超时上限必须逐字保留
  // （在原始源码上查——这些 token 活在字符串字面量里，会被 stripJs 打空）。
  for (const token of ['ConnectTimeout=10', 'BatchMode=yes', 'ss -tlnp', 'sleep 1; true']) {
    assert.ok(src.includes(token), `清场语义锚缺失: ${token}`);
  }
  assert.match(stripped, /REMOTE_SWEEP_TIMEOUT_MS\s*=\s*25_000/, '远端清场硬超时必须保持 25s（与旧同步实现一致）');
});

// ── ② 现状锚：server.js 隧道引导在 listen 注册之后、且经 setImmediate 异步触发 ──

test('BLOCK-145 D1② 现状锚：server.js 在 app.listen 注册后经 setImmediate 异步引导 tunnel', () => {
  const stripped = stripJs(readFileSync(SERVER_PATH, 'utf8'));
  const listenIdx = stripped.indexOf('app.listen(');
  const bootIdx = stripped.indexOf('.startIfEnabled(');
  assert.ok(listenIdx !== -1, 'server.js 必须有 app.listen 注册点');
  assert.ok(bootIdx !== -1, 'server.js 启动路径必须引导 tunnel startIfEnabled');
  assert.ok(
    bootIdx > listenIdx,
    'tunnel 引导点位于 listen 注册之后 → 引导链上的同步网络等待会卡住 accept 循环（BK-08 症状面）'
  );
  assert.ok(
    stripped.slice(listenIdx, bootIdx).includes('setImmediate('),
    '隧道引导必须经 setImmediate 移出冷启动关键路径（BLOCK-145 D1：listen 后异步触发）'
  );
});

// ── ② 启动非阻塞契约：startIfEnabled() 不得同步等待网络往返（红→绿主判据） ──

test('BLOCK-145 D1② 启动非阻塞契约：startIfEnabled() 不得同步等待网络往返', () => {
  const { createTunnelManager, writeTunnelConfig } = require(TUNNEL_PATH);
  const root = mkdtempSync(path.join(tmpdir(), 'gewu-tunnel-async-'));
  let manager = null;
  try {
    // 先以 disabled 建 manager（避免构造期自动 spawn 干扰归因），再落 enabled 配置
    // 走 startIfEnabled()——即 server.js 启动路径的同一条导出面。
    writeTunnelConfig(root, { enabled: false, host: '', remotePort: 2299, localPort: 3005 });
    const spawned = [];
    manager = createTunnelManager({
      dataDir: root,
      // spawnProcess / killStale 注入假件；remoteSweep 刻意不注入——
      // 真实默认清场（对 RFC 5737 TEST-NET-1 192.0.2.1 的真 ssh，ConnectTimeout=10）
      // 正是本契约要排除的「同步网络等待」源。
      spawnProcess() {
        const proc = new EventEmitter();
        proc.pid = 424242 + spawned.length;
        spawned.push(proc);
        return proc;
      },
      killStale: () => [],
      // 60s 大于清场时长：排除 tick() 的 connected 晋升干扰，红/绿都归属于同步阻塞本身
      stableConnectedMs: 60_000,
    });
    writeTunnelConfig(root, { enabled: true, host: '192.0.2.1', remotePort: 2299 });

    const t0 = performance.now();
    const status = manager.startIfEnabled();
    const syncBlockMs = performance.now() - t0;

    assert.equal(status.state, 'connecting', 'startIfEnabled 应立即进入 connecting 态');
    assert.equal(
      spawned.length,
      0,
      '真实远端清场（ssh 在途）未完成前不得 spawn 正式隧道——启动调用必须先于网络往返返回'
    );
    assert.ok(
      syncBlockMs < 1000,
      `D1 契约失败：startIfEnabled() 同步阻塞 event loop ${Math.round(syncBlockMs)}ms（阈值 1000ms）`
        + '——清场 ssh 在返回前同步等待网络往返，server.js 启动路径因此被卡（BK-08）'
    );
  } finally {
    // stop() 撤销在途清场（SIGTERM）→ 无残留子进程、无残留定时器，测试即退
    try { if (manager) manager.stop(); } catch { /* 假进程无 kill，try/catch 兜住 */ }
    rmSync(root, { recursive: true, force: true });
  }
});

// ── ② 清场顺序契约：清场完成前绝不 spawn 正式隧道（语义与旧同步实现一致） ───

test('BLOCK-145 D1② 清场顺序契约：killStale → 远端清场完成 → 才 spawn 正式隧道', async () => {
  const { createTunnelManager, writeTunnelConfig } = require(TUNNEL_PATH);
  const root = mkdtempSync(path.join(tmpdir(), 'gewu-tunnel-order-'));
  let manager = null;
  try {
    // enabled 配置直接建 manager：走构造期冷启动路径（与 server.js 引导同链）
    writeTunnelConfig(root, { enabled: true, host: 'aliyun-fake', remotePort: 2299, localPort: 3005 });
    const events = [];
    const spawned = [];
    let releaseSweep;
    const sweepGate = new Promise((resolve) => { releaseSweep = resolve; });
    manager = createTunnelManager({
      dataDir: root,
      spawnProcess() {
        const proc = new EventEmitter();
        proc.pid = 43210 + spawned.length;
        spawned.push(proc);
        events.push('spawn');
        return proc;
      },
      killStale: async () => { events.push('killStale'); },
      remoteSweep: async () => {
        events.push('sweep:start');
        await sweepGate; // 闸门：清场挂起，验证 spawn 绝不抢跑
        events.push('sweep:done');
      },
    });

    await sleep(10);
    assert.equal(spawned.length, 0, '远端清场未完成前不得 spawn 正式隧道（清场 → spawn 顺序语义）');
    assert.deepEqual(events, ['killStale', 'sweep:start'], '冷启动链必须先清孤儿、再起远端清场');

    releaseSweep();
    await waitFor(() => spawned.length === 1, 2000);
    assert.deepEqual(
      events,
      ['killStale', 'sweep:start', 'sweep:done', 'spawn'],
      'spawn 必须等清场链全部完成——旧同步实现的顺序语义在异步化后逐项保持'
    );
    assert.equal(manager.status().state, 'connecting', 'spawn 后、stable 阈值前保持 connecting');
  } finally {
    try { if (manager) manager.stop(); } catch { /* noop */ }
    rmSync(root, { recursive: true, force: true });
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitFor timeout (${timeoutMs}ms)`);
    await sleep(5);
  }
}
