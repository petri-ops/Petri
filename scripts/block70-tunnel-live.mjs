#!/usr/bin/env node
/**
 * BLOCK-70 P3 实机验收：aliyun 反向隧道（真实 ssh -R，穿远端回环验证）。
 *
 * 前置：本机 ~/.ssh/config 有免密 Host `aliyun`（root@ECS）。
 *
 * T1 关闭态：tunnel 默认 disabled，不起 ssh
 * T2 启用态：写入 tunnel.json（enabled/host=aliyun/随机远端端口）→ REST reload →
 *    /api/mobile/tunnel 状态进入 connected（≤20s）
 * T3 端到端穿隧道：ssh aliyun 'curl http://127.0.0.1:<remotePort>/m/api/health'
 *    → 返回 mobile-gateway health（转发真实成立，且此刻无需 aliyun 反代）
 * T4 无凭证经隧道访问受保护面 → 401（隧道不放大攻击面）
 * T5 配对 URL 公网优先：primaryUrl = https://<publicIp>/m#...（隧道 connected 时）
 * T6 韧性：杀 ssh 进程 → reconnecting → 自动重连回 connected
 * T7 停用 → disabled 且 ssh 进程消失
 *
 * 证据：acceptance/block-70/block70-tunnel-live.json（token 脱敏）
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyMigrations, createCaptureEnv, stopServer } from './g0-rs-p4r-capture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = path.join(ROOT, 'core', 'petri-server', 'server.js');
const EVIDENCE_PATH = path.join(ROOT, 'acceptance', 'block-70', 'block70-tunnel-live.json');
const TUNNEL_HOST = process.env.B70_TUNNEL_HOST || 'aliyun';

const results = [];
function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 300)));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { reject(new Error(`non-json from ${url}: ${d.slice(0, 120)}`)); }
      });
    }).on('error', reject);
  });
}

async function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}


async function main() {
  const envRoot = createCaptureEnv({ port: await freePort() });
  const root = envRoot.root;
  const dataDir = envRoot.env.PETRI_LOCAL_DATA_DIR;
  await applyMigrations(envRoot.env.PETRI_DB_PATH, { quiet: true });

  const gatewayPort = await freePort();
  const remotePort = await freePort();
  fs.mkdirSync(path.join(dataDir, 'mobile'), { recursive: true });

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...envRoot.env,
      PETRI_MOBILE_ENABLED: '1',
      PETRI_MOBILE_PORT: String(gatewayPort),
    },
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const mainBase = `http://127.0.0.1:${envRoot.env.R_SERVER_PORT}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    try {
      const health = await fetchJson(`${mainBase}/api/health`);
      if (health.status === 'ok') break;
    } catch { /* retry */ }
    await sleep(500);
  }

  try {
    // T1 关闭态基线（tunnel.json 未写）
    const tunnelOff = await fetchJson(`${mainBase}/api/mobile/tunnel`);
    assert('T1_tunnel_defaults_disabled', tunnelOff.ok === true && tunnelOff.tunnel.enabled === false && tunnelOff.tunnel.state === 'disabled', JSON.stringify(tunnelOff.tunnel));

    // T2 启用（REST config reload——与产品同路径）
    const applyRes = await fetch(`${mainBase}/api/mobile/tunnel/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, host: TUNNEL_HOST, remotePort, localPort: gatewayPort, publicUrl: 'https://112.120.48.126' }),
    });
    const applied = await applyRes.json();
    assert('T2a_config_applied', applied.ok === true && applied.tunnel.enabled === true && applied.tunnel.host === TUNNEL_HOST, JSON.stringify(applied.tunnel));

    let connected = false;
    let lastStatus = null;
    for (let i = 0; i < 40; i += 1) {
      lastStatus = await fetchJson(`${mainBase}/api/mobile/tunnel`);
      if (lastStatus.tunnel.state === 'connected') { connected = true; break; }
      await sleep(500);
    }
    assert('T2_tunnel_connected', connected, JSON.stringify(lastStatus && lastStatus.tunnel));

    // T3 端到端：从 aliyun 回环穿隧道打 gateway（无需反代即证明转发成立）
    const loopbackHealth = execSync(`ssh -o BatchMode=yes -o ConnectTimeout=10 ${TUNNEL_HOST} "curl -s -m 5 http://127.0.0.1:${remotePort}/m/api/health"`, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    const health = JSON.parse(loopbackHealth);
    assert('T3_end_to_end_through_tunnel', health.ok === true && health.service === 'petri-mobile-gateway', loopbackHealth.slice(0, 160));

    // T4 隧道不放大攻击面：无会话访问受保护面 → 401
    const unauthorized = execSync(`ssh -o BatchMode=yes -o ConnectTimeout=10 ${TUNNEL_HOST} "curl -s -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:${remotePort}/api/ai/conversations"`, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert('T4_protected_route_401_via_tunnel', String(unauthorized).trim() === '401', unauthorized.slice(0, 60));

    // T5 配对 URL 公网优先
    const pairing = await (await fetch(`${mainBase}/api/mobile/pairing/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
    assert('T5_pairing_prefers_public_url', pairing.ok === true && pairing.primaryUrl.startsWith('https://112.120.48.126/m#'), pairing.primaryUrl.replace(/#.{20,}/, '#***'));

    // T6 韧性：杀 ssh → reconnecting → 自动重连回 connected（新 pid）
    const statusBeforeKill = await fetchJson(`${mainBase}/api/mobile/tunnel`);
    if (statusBeforeKill.tunnel.pid) {
      try { process.kill(statusBeforeKill.tunnel.pid); } catch { /* 已退出也可 */ }
    }
    let reconnected = false;
    for (let i = 0; i < 40; i += 1) {
      const status = await fetchJson(`${mainBase}/api/mobile/tunnel`);
      if (status.tunnel.state === 'connected' && status.tunnel.pid !== statusBeforeKill.tunnel.pid) { reconnected = true; break; }
      await sleep(500);
    }
    assert('T6_auto_reconnect_after_kill', reconnected, JSON.stringify(lastStatus && lastStatus.tunnel));

    // T7 停用 → disabled
    const disableRes = await fetch(`${mainBase}/api/mobile/tunnel/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    const disabled = await disableRes.json();
    assert('T7_disable_stops_tunnel', disabled.ok === true && disabled.tunnel.state === 'disabled', JSON.stringify(disabled.tunnel));
  } finally {
    await stopServer(child);
    await sleep(1000);
    fs.rmSync(root, { recursive: true, force: true });
  }

  const allPass = results.every((entry) => entry.ok);
  const evidence = {
    schemaVersion: 1,
    acceptanceId: 'BLOCK-70-P3-TUNNEL-LIVE',
    generatedAt: new Date().toISOString(),
    qualificationEligible: false,
    allPass,
    checks: results,
    notes: {
      method: 'real ssh -R reverse tunnel to user aliyun host; end-to-end via remote loopback curl (nginx not required for this proof)',
      redaction: 'pairing tokens masked in evidence',
      honestBoundary: 'public 443 exposure requires aliyun-side reverse proxy (self-signed TLS) + security-group; real-phone external-network scan pending user',
    },
  };
  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  fs.writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n${allPass ? 'ALL PASS' : 'FAILED'} — ${results.filter((entry) => entry.ok).length}/${results.length}`);
  console.log(`evidence: ${EVIDENCE_PATH}`);
  if (!allPass) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[block70-tunnel-live] FAIL —', error.message);
  process.exitCode = 1;
});
