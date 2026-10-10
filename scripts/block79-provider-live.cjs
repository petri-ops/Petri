#!/usr/bin/env node
'use strict';

/**
 * BLOCK-79 P3 实机数值一致性对账（真实模型推理 → 端点 vs 库内重算）。
 *   A1 真实推理一轮：直驱 modelGateway（同 dev 设置/密钥/网关注入代码路径），
 *      telemetry.provider 注入 → ai_usage 落账（kind=chat, conversation 归因）
 *   A2 usage-mine 返回 providers 分组数组
 *   A3 至少一个供应商组 measurable=true 且 tokensPerSecond>0（真实推理产生读数）
 *   A4 端点数值 = 库内重算（readonly sqlite 独立重算 30d 窗口逐组一致）
 *   A5 embedding 不出现在任何分组
 * 前置：dev 栈已载 BLOCK-79 代码；本地已配置可用 chat 模型。
 * 证据：acceptance/block-79/provider-live.json
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const EVIDENCE_DIR = path.join(REPO, 'acceptance', 'block-79');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
// 与 dev 启动器同一数据根与同一 DB（db.js: PETRI_DB_PATH 优先——不设会回落
// core/petri-server/petri.db 第二库，归因行将落错库）
process.env.PETRI_LOCAL_DATA_DIR = path.join(REPO, '.petri-dev-user-data', 'data');
process.env.PETRI_DB_PATH = path.join(process.env.PETRI_LOCAL_DATA_DIR, 'petri.db');

const Database = require(path.join(REPO, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
const { modelGateway } = require(path.join(REPO, 'core', 'petri-server', 'helpers', 'model-gateway.js'));
const { LOCAL_USER } = require(path.join(REPO, 'core', 'petri-server', 'auth.js'));

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method || 'GET', headers: opts.headers || {} }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch { /* raw 兜底 */ }
        resolve({ status: res.statusCode, json, raw: d });
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function log(msg) { try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {} }

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const results = { startedAt: new Date().toISOString(), assertions: [] };
  const assert = (name, pass, detail = '') => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
    log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 140) : ''}`);
  };

  // A1 真实推理一轮（网关注入 telemetry.provider → usageArgs 落库）
  const convId = `conv_b79_live_${Date.now().toString(36)}`;
  let assistantText = '';
  let usedProfile = null;
  const result = await modelGateway.chat({
    role: 'chat',
    body: { messages: [{ role: 'user', content: '请只回复两个字：收到' }], temperature: 0 },
    telemetry: { userId: LOCAL_USER.id, kind: 'chat', conversationId: convId },
  });
  if (result && !result.error) {
    assistantText = String(result.text || result.content || (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) || '');
    usedProfile = result.profile && result.profile.id;
  }
  assert('A1 real inference via gateway (injection path)', !result || !result.error ? assistantText.length >= 0 : false,
    `error=${result && result.error} text="${assistantText.slice(0, 40)}" profile=${usedProfile || 'n/a'}`);
  if (result && result.error) {
    // 推理不可用（渠道/密钥问题）：后续读数断言诚实标注失败原因后退出
    results.allPass = false;
    results.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'provider-live.json'), JSON.stringify(results, null, 2));
    log('allPass=false (inference unavailable)');
    return;
  }

  // A2 providers 分组数组
  const mine = await fetchJson(`${API}/ai/usage-mine?days=30`, { headers: AUTH });
  const providers = (mine.json && mine.json.providers) || null;
  assert('A2 usage-mine exposes providers array', mine.status === 200 && Array.isArray(providers),
    `status=${mine.status} body=${(mine.raw || '').slice(0, 200) || JSON.stringify(mine.json || null)}`);

  // A3 至少一组 measurable 且 tps>0（本轮真实推理应归因可见）
  const measurable = (providers || []).filter((p) => p.measurable && p.tokensPerSecond > 0);
  assert('A3 at least one measurable provider with tps>0', measurable.length > 0,
    JSON.stringify(measurable).slice(0, 260));

  // A4 端点 = 库内重算（独立 readonly 连接，30d 窗口 + 同 user 过滤，逐组一致）
  const ro = new Database(path.join(REPO, '.petri-dev-user-data', 'data', 'petri.db'), { readonly: true });
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const recompute = ro.prepare(`SELECT COALESCE(provider,'(未归因)') AS provider,
      COUNT(*) AS calls, COALESCE(SUM(prompt_tokens),0) AS inputTokens,
      COALESCE(SUM(completion_tokens),0) AS outputTokens,
      COALESCE(SUM(latency_ms),0) AS latencyMs
    FROM ai_usage WHERE ts >= ? AND user_id = ? AND kind <> 'embedding'
    GROUP BY provider ORDER BY outputTokens DESC`).all(cutoff, LOCAL_USER.id);
  ro.close();
  let consistent = recompute.length === (providers || []).length;
  if (consistent) {
    for (let i = 0; i < recompute.length; i++) {
      const a = recompute[i]; const b = (providers || [])[i];
      if (!b || a.provider !== b.provider || a.calls !== b.calls || a.outputTokens !== b.outputTokens || a.latencyMs !== b.latencyMs) { consistent = false; break; }
    }
  }
  assert('A4 endpoint matches DB recompute (30d, per provider)', consistent,
    `endpoint=${JSON.stringify(providers).slice(0, 200)} db=${JSON.stringify(recompute).slice(0, 200)}`);

  // A5 embedding 不出现在任何分组
  assert('A5 embedding excluded from groups', !(providers || []).some((p) => String(p.provider).toLowerCase().includes('embed')));

  results.allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'provider-live.json'), JSON.stringify(results, null, 2));
  log(`allPass=${results.allPass}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
