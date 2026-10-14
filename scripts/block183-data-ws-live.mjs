'use strict';

/**
 * BLOCK-183 实机探针 — 数据桥 WS-first 全链走查（隔离网关 + 真实路由模块）。
 *
 * 架设=生产同形：buildMobileGateway（sessionAuth/限流/审计链全量在链）
 * + mountRoutes 注入真实 projection-data / ai-settings-api 路由模块
 * （七条白名单读路径的生产实现）+ attachAgentWs（与 startMobileGateway
 * 同一挂载点）。断言：
 *   ① 七路径 data-res 与 HTTP 响应 status+JSON 逐字段一致（形状单一真相实证）；
 *   ② 白名单外 WS 请求 data-err path_not_allowed（fail-closed 实证）；
 *   ③ 错 token upgrade 401（会话门实证）；
 *   ④ WS vs HTTP 延迟对比（各 10 轮中位数，本机 loopback 口径如实登记——
 *      隧道增益另测属 riders）。
 * 证据落 acceptance/block-183/data-ws-live.json。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WsTestClient } = await import(pathToFileURL(path.join(ROOT, 'test/block162-ws-client.mjs')).href);

const DATA_ALLOWED_PATHS = [
  '/api/skills/registry',
  '/api/plugins/installed',
  '/api/plugins/catalog',
  '/api/packs/installed',
  '/api/packs/available',
  '/api/runtime/status',
  '/api/ai/settings',
];

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block183-live-'));
  process.env.PETRI_LOCAL_DATA_DIR = root;
  const { buildMobileGateway } = require(path.join(ROOT, 'core/petri-server/mobile-gateway/index.js'));
  const { attachAgentWs } = require(path.join(ROOT, 'core/petri-server/mobile-gateway/agent-ws.js'));

  const { app, stores } = buildMobileGateway({
    dataDir: root,
    // 七条白名单路径由 buildMobileGateway 内建的 full route registry 挂载
    // （desktop dist 在场时自动装配，与生产投影同源）；此处不再手动注入，
    // 避免同路径双注册双 handler。
  });
  let resolveServer;
  const started = new Promise((resolve) => { resolveServer = resolve; });
  const server = app.listen(0, '127.0.0.1', () => resolveServer(server));
  await started;
  attachAgentWs(server, { stores }); // 与 startMobileGateway 同一挂载点
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const { sessionToken } = stores.sessions.createSession({ name: 'block183-probe' });
  console.log(`[block183-live] gateway on :${port} dataDir=${root}`);

  const results = { startedAt: new Date().toISOString(), paths: {}, checks: [] };
  let allPass = true;
  const note = (name, pass, detail) => {
    results.checks.push({ name, pass, detail });
    allPass = allPass && pass;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // ③ 会话门（先于任何 data 面）
  const badUpgrade = await WsTestClient.connect(port, '/m/api/ws', { Authorization: 'Bearer forged' });
  note('unauthorized-upgrade-401', badUpgrade.rejected === 401, `rejected=${badUpgrade.rejected}`);

  const client = await WsTestClient.connect(port, '/m/api/ws', { Authorization: `Bearer ${sessionToken}` });
  note('ws-upgrade-ok', !client.rejected, client.rejected ? `rejected=${client.rejected}` : '101');

  // ①②③ 七路径同形状对账 + 白名单外 fail-closed
  for (const p of DATA_ALLOWED_PATHS) {
    const httpTimes = [];
    const wsTimes = [];
    let shapeMatch = true;
    let lastHttp = null;
    let lastWs = null;
    for (let i = 0; i < 10; i += 1) {
      const t0 = Date.now();
      const res = await fetch(base + p, { headers: { Authorization: `Bearer ${sessionToken}` } });
      const body = await res.json().catch(() => ({}));
      httpTimes.push(Date.now() - t0);
      lastHttp = { status: res.status, body };

      const t1 = Date.now();
      client.send({ t: 'data', id: `probe-${p}-${i}`, url: p });
      let frame = null;
      while (frame === null) {
        const msg = await client.next(9000);
        if (msg === null) break;
        if ((msg.t === 'data-res' || msg.t === 'data-err') && msg.id === `probe-${p}-${i}`) { frame = msg; break; }
      }
      wsTimes.push(Date.now() - t1);
      lastWs = frame;
    }
    shapeMatch = lastWs && lastWs.t === 'data-res'
      && lastWs.status === lastHttp.status
      && JSON.stringify(lastWs.data) === JSON.stringify(lastHttp.body);
    results.paths[p] = {
      httpStatus: lastHttp.status,
      wsStatus: lastWs?.status,
      shapeMatch,
      httpMedianMs: median(httpTimes),
      wsMedianMs: median(wsTimes),
      httpTimes,
      wsTimes,
    };
    note(`shape:${p}`, Boolean(shapeMatch), `http=${lastHttp.status} ws=${lastWs?.t}/${lastWs?.status} httpMedian=${median(httpTimes)}ms wsMedian=${median(wsTimes)}ms`);
  }

  // ② 白名单外 fail-closed
  client.send({ t: 'data', id: 'nope', url: '/api/conversations' });
  let errFrame = null;
  while (errFrame === null) {
    const msg = await client.next(3000);
    if (msg === null) break;
    if (msg.id === 'nope') { errFrame = msg; break; }
  }
  note('whitelist-fail-closed', errFrame && errFrame.t === 'data-err' && errFrame.error === 'path_not_allowed', JSON.stringify(errFrame));

  client.close();
  results.allPass = allPass;
  results.finishedAt = new Date().toISOString();
  const outDir = path.join(ROOT, 'acceptance', 'block-183');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'data-ws-live.json'), JSON.stringify(results, null, 2));
  console.log(`[block183-live] allPass=${allPass} evidence → acceptance/block-183/data-ws-live.json`);
  server.close();
  server.closeAllConnections?.();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('[block183-live] probe crashed:', err);
  process.exit(1);
});
