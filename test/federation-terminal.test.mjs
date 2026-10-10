/**
 * BLOCK-85 P4 — 投影终端探针（真实 node-pty 端到端）。
 *
 * 覆盖：start → SSE 流（回显包含写入命令的输出）→ exit 事件 → 会话上限
 * （4 会话诚实拒绝）→ 未知会话 404。全部走 gateway 会话门（配对拿 cookie）。
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { buildMobileGateway } = require(path.join(ROOT, 'core/petri-server/mobile-gateway/index.js'));
const { resetStoresForTest } = require(path.join(ROOT, 'core/petri-server/mobile-gateway/pairing.js'));

function tmpRoot() {
  return mkdtempSync(path.join(tmpdir(), 'petri-fedterm-test-'));
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

async function body(response) {
  return response.json();
}

/** 极简 SSE 消费：收集事件直到谓词命中或超时。 */
async function collectSse(url, cookie, predicate, timeoutMs = 30_000) {
  const controller = new AbortController();
  const events = [];
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { headers: { Cookie: cookie }, signal: controller.signal });
  assert.equal(response.status, 200);
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = response.body.getReader();
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const eventMatch = frame.match(/^event: (.+)$/m);
          const dataMatch = frame.match(/^data: (.+)$/m);
          if (eventMatch) {
            const event = { event: eventMatch[1], data: dataMatch ? JSON.parse(dataMatch[1]) : null };
            events.push(event);
            if (predicate(events)) {
              controller.abort();
              return;
            }
          }
        }
      }
    } catch { /* abort 后正常 */ }
  })();
  try {
    await new Promise((resolve) => { controller.signal.addEventListener('abort', resolve); });
  } finally {
    clearTimeout(timer);
  }
  return events;
}

test('BLOCK-85 P4: projection terminal start -> echo roundtrip -> exit -> limit', async () => {
  const execRoot = tmpRoot();
  resetStoresForTest();
  try {
    const express = require('express');
    const adminApp = express();
    adminApp.use(express.json({ limit: '4kb' }));
    require(path.join(ROOT, 'core/petri-server/routes/mobile-admin.js'))(adminApp, { dataDir: execRoot });
    const adminServer = await listen(adminApp);
    const adminBase = `http://127.0.0.1:${adminServer.address().port}`;

    const { app: gatewayApp } = buildMobileGateway({ dataDir: execRoot });
    const gatewayServer = await listen(gatewayApp);
    const gatewayPort = gatewayServer.address().port;

    const pairToken = await body(await fetch(`${adminBase}/api/mobile/pairing/token`, { method: 'POST' }));
    const pairRes = await fetch(`http://127.0.0.1:${gatewayPort}/pair?token=${pairToken.token}`, { redirect: 'manual' });
    const cookie = (pairRes.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('gw_session='));

    // 1. 启动真 pty 会话
    const started = await body(await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    }));
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.match(started.sessionId, /^pter_/);
    const sessionId = started.sessionId;

    // 2. 连 SSE 并写入标记命令，断言回显出现标记输出（win/posix 通用 echo）
    const marker = `FEDTERM-${Date.now().toString(36)}`;
    const eventsPromise = collectSse(
      `http://127.0.0.1:${gatewayPort}/m/api/terminal/${sessionId}/stream`,
      cookie,
      (events) => events.some((e) => e.event === 'terminal:data' && typeof e.data?.data === 'string' && e.data.data.includes(marker)),
    );
    await new Promise((resolve) => setTimeout(resolve, 800)); // 给 shell 启动时间
    const echoed = await body(await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/${sessionId}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ data: `echo ${marker}\r` }),
    }));
    assert.equal(echoed.ok, true);
    const events = await eventsPromise;
    assert.ok(events.some((e) => e.event === 'terminal:data' && e.data.data.includes(marker)), 'echo output must roundtrip via SSE');

    // 3. kill → exit 事件
    await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/${sessionId}/kill`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    const exitEvents = await collectSse(
      `http://127.0.0.1:${gatewayPort}/m/api/terminal/${sessionId}/stream`,
      cookie,
      (list) => list.some((e) => e.event === 'terminal:exit' || (e.event === 'terminal:replay' && e.data?.exited === true)),
      15_000,
    );
    assert.ok(exitEvents.length > 0, 'exit must surface on a fresh stream (live or replay)');

    // 4. 会话上限：再起 4 个凑满 live（首个已在回显测试后 kill），第 5 个诚实拒绝
    const openedIds = [sessionId];
    for (let index = 0; index < 4; index += 1) {
      const more = await body(await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({}),
      }));
      if (more.sessionId) openedIds.push(more.sessionId);
    }
    const fifth = await body(await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    }));
    assert.equal(fifth.error, 'too_many_sessions', `5th session must be rejected, got ${JSON.stringify(fifth)}`);
    // 释放一个名额给 SSH 探针
    await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/${encodeURIComponent(openedIds[1])}/kill`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    // 4.5 SSH 远程会话（真实 aliyun 节点，BLOCK-67 同款语义；不可达时显式 skip）
    const sshProbe = await body(await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ssh: { alias: 'aliyun', remotePath: '/root' } }),
    }));
    if (sshProbe.ok && sshProbe.sessionId) {
      const sshMarker = `FEDSSH-${Date.now().toString(36)}`;
      await collectSse(
        `http://127.0.0.1:${gatewayPort}/m/api/terminal/${sshProbe.sessionId}/stream`,
        cookie,
        (list) => list.some((e) => e.event === 'terminal:data' && typeof e.data?.data === 'string' && e.data.data.includes(sshMarker)),
        45_000,
      );
      await new Promise((resolve) => setTimeout(resolve, 6000)); // ssh 建连 + 远端登录 shell 就绪（conda 初始化约 3-6s）
      const sshInput = await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/${sshProbe.sessionId}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ data: `echo ${sshMarker}\r` }),
      });
      console.log(`  ssh input status=${sshInput.status} body=${JSON.stringify(await body(sshInput)).slice(0, 100)}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const replayCheck = await collectSse(
        `http://127.0.0.1:${gatewayPort}/m/api/terminal/${sshProbe.sessionId}/stream`,
        cookie,
        (list) => list.some((e) => e.event === 'terminal:replay'),
        10_000,
      );
      const replayText = replayCheck.find((e) => e.event === 'terminal:replay')?.data?.data || '';
      console.log(`  replay 含 marker: ${replayText.includes(sshMarker)} | replay 尾部: ${JSON.stringify(replayText.slice(-120))}`);
      // 断言用 replay 轮询（可靠）：单条 SSE 长连接在 undici 客户端下实时帧
      // 可能不达（浏览器 EventSource 有自动重连+重放兜底，实机不受影响）；
      // replay 含 marker 即证明 pty 引擎/SSH 会话/环形缓冲全链正常。
      let sshRoundtrip = false;
      for (let attempt = 0; attempt < 10 && !sshRoundtrip; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const replayPoll = await collectSse(
          `http://127.0.0.1:${gatewayPort}/m/api/terminal/${sshProbe.sessionId}/stream`,
          cookie,
          (list) => list.some((e) => e.event === 'terminal:replay'),
          10_000,
        );
        const replayText = replayPoll.find((e) => e.event === 'terminal:replay')?.data?.data || '';
        sshRoundtrip = replayText.includes(sshMarker);
      }
      assert.ok(sshRoundtrip, 'ssh session echo must roundtrip (via replay)');
      await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/${sshProbe.sessionId}/kill`, { method: 'POST', headers: { Cookie: cookie } });
      openedIds.push(sshProbe.sessionId);
      console.log('  ✔ ssh(alivun→aliyun) roundtrip ok');
    } else {
      console.log(`  SKIP ssh session (start: ${JSON.stringify(sshProbe).slice(0, 120)})`);
    }

    // 5. 未知会话 404
    const missing = await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/pter_missing/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ data: 'x' }),
    });
    assert.equal(missing.status, 404);

    // 清理全部 pty（Windows conpty 句柄会拽住 event loop），然后显式收尾
    for (const id of openedIds) {
      await fetch(`http://127.0.0.1:${gatewayPort}/m/api/terminal/${encodeURIComponent(id)}/kill`, {
        method: 'POST',
        headers: { Cookie: cookie },
      }).catch(() => {});
    }
    await closeServer(gatewayServer);
    await closeServer(adminServer);
    process.exit(0);
  } catch (error) {
    process.exitCode = 1;
    throw error;
  } finally {
    resetStoresForTest();
    rmSync(execRoot, { recursive: true, force: true });
  }
});
