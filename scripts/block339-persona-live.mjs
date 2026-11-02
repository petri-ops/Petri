#!/usr/bin/env node
/**
 * BLOCK-339 P6 — 人设实机腿（真 provider + 真 HTTP mock 上游，抓**模型实际收到的 system prompt**）。
 *
 * 三轮：①闲聊快路径 ②主 agent prompt ③身份透明披露块。
 * 断言每轮 system 内容：零角色域词（生物信息/生信/科研伙伴）+ 正面人设在场
 * （格物（Petri）· 通用 agent）。抓的是发往上游的字节，不是本地函数返回值——
 * 防「本地拼好了但没发出去」这类假绿。
 *
 * 用法：node scripts/block339-persona-live.mjs
 * 证据：acceptance/block-339/persona-live.json
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-339');
const ROLE_TERMS = ['生物信息', '生信', '科研伙伴', 'bioinformatic'];

const { buildSystemPrompt } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'system-prompt.js'));
const { CHITCHAT_SYSTEM_PROMPT } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'chitchat-fast-path.js'));
const { ModelGateway } = require(path.join(ROOT, 'core', 'shared-backend', 'llm-providers', 'model-gateway.js'));
const { DeepSeekProvider } = require(path.join(ROOT, 'core', 'shared-backend', 'llm-providers', 'deepseek.js'));

const assertions = [];
function assert(name, pass, detail) {
  assertions.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${String(detail).slice(0, 260)}`);
}

function hits(text) {
  const lower = String(text || '').toLowerCase();
  return ROLE_TERMS.filter((term) => lower.includes(term.toLowerCase()));
}

/** mock 上游：记录请求体（system 全文）并返回固定回复。 */
function startUpstream() {
  const captured = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { captured.push(JSON.parse(body)); } catch { captured.push({ raw: body }); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'persona-live',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 10, completion_tokens: 1 },
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      captured,
      stop: () => { try { server.close(); } catch { /* closed */ } },
    }));
  });
}

function makeGateway(baseUrl) {
  const profile = { id: 'p_persona', provider: 'deepseek', protocol: 'openai', model: 'persona-live', baseUrl, capabilities: {} };
  return new ModelGateway({
    getSettings: () => ({ model_role_bindings: { chat: profile.id, agent: profile.id }, model_profiles: [profile] }),
    getCredential: () => 'sk-test',
    getProvider: (name) => (name === 'deepseek' ? new DeepSeekProvider() : null),
    recordRouting() {},
    recordTranscript() {},
  });
}

async function round(label, systemPrompt) {
  const upstream = await startUpstream();
  const gateway = makeGateway(`http://127.0.0.1:${upstream.port}`);
  try {
    await gateway.chat({
      role: 'chat',
      body: { messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: '你好' }], stream: false },
    });
    const sent = upstream.captured[0];
    const systemText = sent && Array.isArray(sent.messages)
      ? String((sent.messages.find((m) => m.role === 'system') || {}).content || '')
      : '';
    const found = hits(systemText);
    assert(`${label}_zero_role_terms`, systemText.length > 100 && found.length === 0,
      `systemLen=${systemText.length} hits=${found.join(',') || '无'}`);
    assert(`${label}_persona_present`, systemText.includes('格物（Petri）') && systemText.includes('通用 agent'),
      '正面人设（格物（Petri）· 通用 agent）在场');
    return systemText;
  } finally {
    upstream.stop();
  }
}

const startedAt = new Date().toISOString();

// ① 闲聊快路径（用户体感主因：高置信直答绕过主 prompt）
await round('R1_chitchat', CHITCHAT_SYSTEM_PROMPT);
// ② 主 agent prompt
await round('R2_main_prompt', buildSystemPrompt(null));
// ③ 身份透明披露块（provider/model 在场）
await round('R3_identity_block', buildSystemPrompt(null, { provider: 'deepseek', model: 'deepseek-chat', providerLabel: 'DeepSeek' }));

fs.mkdirSync(EVIDENCE, { recursive: true });
const report = {
  name: 'persona-live',
  block: 'BLOCK-339',
  phase: 'P6',
  platform: process.platform,
  coverage: 'provider + ModelGateway + HTTP（抓上游实际收到的 system prompt；未经 Express 进程）',
  startedAt,
  finishedAt: new Date().toISOString(),
  assertions,
  allPass: assertions.every((item) => item.pass),
  passed: assertions.filter((item) => item.pass).length,
  total: assertions.length,
};
const file = path.join(EVIDENCE, 'persona-live.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
console.log(`\n[block339-p6] ${report.passed}/${report.total} allPass=${report.allPass} → ${path.relative(ROOT, file)}`);
process.exit(report.allPass ? 0 : 1);
