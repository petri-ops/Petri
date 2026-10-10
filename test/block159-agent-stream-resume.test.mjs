'use strict';

/**
 * BLOCK-159 P0-3/P0-4/P1-7 — agent SSE 心跳 / 审计异步写 / 限流按会话分桶。
 *
 * 契约：
 *  ① agent SSE 15s 心跳（源码扫描钉，BLOCK-157 server 接线钉先例）：events.js
 *     订阅建立后 setInterval(15_000) 写 ': ping' 注释帧；req.close 与终态路径
 *     必须清理（stopHeartbeat）；注释行形状与终端 SSE 同款（EventSource 与
 *     ^data: 手工解析器天然透明）。
 *  ② 审计写异步化：createAuditWriter 用 fs.appendFile（fire-and-forget），
 *     appendFileSync 退役（每请求同步落盘=事件循环抖动源，GW-PERF 同型根因）。
 *  ③ 限流桶键按会话 token：同 token 计入同桶、不同 token 互不挤占、无 token
 *     退回 IP；哈希桶键不落 token 本体。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVENTS_PATH = path.join(ROOT, 'core/petri-server/routes/ai-agent/events.js');
const GATEWAY_PATH = path.join(ROOT, 'core/petri-server/mobile-gateway/index.js');

// ── ① agent SSE 心跳（源码扫描钉）────────────────────────────────────────

test('BLOCK-159 ① agent SSE 心跳：15s 注释帧 + close/终态双路径清理', () => {
  const source = readFileSync(EVENTS_PATH, 'utf8');
  assert.ok(/setInterval\(\(\) => \{\s*try \{ res\.write\(': ping\\n\\n'\); \} catch \{ \/\* closed \*\/ \}\s*\}, 15_000\)/.test(source),
    'events.js 必须有 15s ": ping" 注释帧心跳（与终端 SSE 同款）');
  assert.ok(source.includes('const stopHeartbeat = () => clearInterval(heartbeat);'),
    '必须提供 stopHeartbeat 清理句柄');
  const closeBlock = source.match(/req\.on\('close', \(\) => \{[\s\S]*?\}\);/);
  assert.ok(closeBlock && closeBlock[0].includes('stopHeartbeat()'), 'req.close 必须清理心跳');
  // 终态路径（回放终态 + 轮询终态）都要在 sseDone() 前停心跳
  const doneCalls = source.split('stopHeartbeat();').length - 1;
  assert.ok(doneCalls >= 2, `终态两处（回放/轮询）都必须 stopHeartbeat（实际 ${doneCalls}）`);
});

test('BLOCK-159 ① 终端 SSE 心跳基线保持（回归锚：15s ping 不因本包漂移）', () => {
  const source = readFileSync(path.join(ROOT, 'core/petri-server/mobile-gateway/index.js'), 'utf8');
  assert.ok(/setInterval\(\(\) => \{\s*try \{ res\.write\(': ping\\n\\n'\); \} catch \{ \/\* closed \*\/ \}\s*\}, 15_000\)/.test(source),
    '终端流 15s ping 基线（index.js）保持');
});

// ── ② 审计异步写 ─────────────────────────────────────────────────────────

test('BLOCK-159 ② 审计写异步化：appendFile fire-and-forget，appendFileSync 退役', async () => {
  const source = readFileSync(GATEWAY_PATH, 'utf8');
  assert.ok(!source.includes('fs.appendFileSync('), 'fs.appendFileSync( 调用必须退役（每请求同步落盘）');
  assert.ok(source.includes('fs.appendFile(auditPath'), '必须用异步 appendFile');

  // 行为级：createAuditWriter 异步落盘且内容合法 JSONL
  const { buildMobileGateway } = require(GATEWAY_PATH);
  const dir = mkdtempSync(path.join(tmpdir(), 'petri-block159-audit-'));
  const auditPath = path.join(dir, 'audit.log');
  try {
    const { app } = buildMobileGateway({ dataDir: dir, auditPath, mountRoutes: () => {} });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    // 真实请求触发审计中间件（res finish 钩子写 JSONL）
    await fetch(`http://127.0.0.1:${server.address().port}/m/api/health`);
    await new Promise((r) => setTimeout(r, 50)); // fire-and-forget 落盘窗口
    const lines = readFileSync(auditPath, 'utf8').split('\n').filter(Boolean);
    assert.ok(lines.length >= 1, '异步审计仍须落盘');
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.ok(parsed.ts && parsed.method, 'JSONL 形状（ts/method）');
    }
    await new Promise((resolve) => server.close(resolve));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── ③ 限流按会话 token 分桶 ──────────────────────────────────────────────

test('BLOCK-159 ③ 限流分桶：同 token 同桶、异 token 不挤占、无 token 退回 IP', () => {
  const { createRateLimiter } = require(GATEWAY_PATH);
  let clock = 0;
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: () => clock });

  const resWith = () => {
    const out = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
    return out;
  };
  const reqFor = (token) => ({
    path: '/api/runtime/status',
    headers: token ? { cookie: `gw_session=${token}` } : {},
    ip: '10.9.9.9',
  });
  const run = (token) => {
    const res = resWith();
    limiter(reqFor(token), res, () => {});
    return res.statusCode;
  };

  assert.equal(run('tokA'), 200);
  assert.equal(run('tokA'), 200);
  assert.equal(run('tokA'), 429, '同 token 第 3 次必须 429（同桶）');
  assert.equal(run('tokB'), 200, '另一 token 不被 tokA 挤占');
  assert.equal(run('tokB'), 200);
  assert.equal(run('tokB'), 429, 'tokB 自身桶独立计数');
  assert.equal(run(''), 200, '无 token 退回 IP 桶（配对面）');
  assert.equal(run(null), 200);
  assert.equal(run(undefined), 429, 'IP 桶第 3 次也 429');
});

test('BLOCK-159 ③ Bearer/?session= token 同样分桶（三种来源互不共享桶）', () => {
  const { createRateLimiter } = require(GATEWAY_PATH);
  let clock = 0;
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, now: () => clock });
  const mk = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json() {} });
  const run = (req) => {
    const res = mk();
    limiter(req, res, () => {});
    return res.statusCode;
  };
  const reqCookie = { path: '/api/x', headers: { cookie: 'gw_session=secret-cookie-token' }, ip: '1.1.1.1', query: {} };
  const reqBearer = { path: '/api/x', headers: { authorization: 'Bearer secret-bearer-token' }, ip: '1.1.1.1', query: {} };
  const reqQuery = { path: '/api/x', headers: {}, ip: '1.1.1.1', query: { session: 'secret-query-token' } };

  // max=1：每个来源首次放行、同源第二次 429（各自独立成桶）
  assert.equal(run(reqCookie), 200);
  assert.equal(run(reqCookie), 429, 'cookie token 同桶二次 429');
  assert.equal(run(reqBearer), 200, 'Bearer 是另一个桶');
  assert.equal(run(reqBearer), 429);
  assert.equal(run(reqQuery), 200, '?session= 是第三个桶');
  assert.equal(run(reqQuery), 429);
});
