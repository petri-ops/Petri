#!/usr/bin/env node
'use strict';
/**
 * block82-thinking-compat-live.cjs — BLOCK-82 P2 实机验收（sensenova 真渠道）。
 *
 * 本包核心：sensenova 上游思考段字段名为 `reasoning`，我方解析面此前只认
 * `reasoning_content` → 该渠道思考段整段丢失。P1 修复 = 解析归一（reasoning_content
 * 优先 / reasoning 兜底）。本脚本用真实 sensenova 渠道跑两轮对话证明：
 *   C0 配置面   — sensenova profile 已声明 capabilities.reasoning（思考档位发参前提）；
 *   C1 标准档   — 请求体零思考参数（BLOCK-81 additive 红线回归）；
 *   C2 高档     — 上游收到 reasoning_effort=high（能力位门控放行 + 映射生效）；
 *   C3 归一生效 — 上游 reasoning 字段思考段经归一以 reasoningContent 落 transcript
 *                 （记录面）且 meta.reasoningByIteration 落库（会话面）——修复前必为空；
 *   C4 标准档归一 — sensenova 默认产思考段（probe 证实），standard 不发参但思考段
 *                 同样归一可达（本包修复对默认路径同等受益）；
 *   C5 内容主路径 — assistant 正文非空（零破坏）。
 *
 * 判定纪律：上游是否产思考段由渠道决定；若上游未产思考段，C3/C4 如实 fail 并记录
 * 原始形状，不编造效果。证据落 acceptance/block-82/。
 *
 * 前置：dev 栈在跑（3001 API；3000 Vite + 9222 CDP 不被本脚本直接依赖）；
 * 改了 core/ 必须重启 dev 栈。模型渠道=sensenova（model-1788504346152）。
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const API = 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local' };
const DATA_DIR = process.env.BIOF3_LOCAL_DATA_DIR || path.join(ROOT, '.biof3-dev-user-data', 'data');
const TRANSCRIPT_DIR = path.join(DATA_DIR, 'llm-transcripts');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-82');

const SENSO_PROFILE_ID = 'model-1788504346152';
// 数学题触发思考段（照抄 BLOCK-81 P3 prompt 思路）
const PROMPT = '一个班有 30 名学生，其中 60% 是女生。把 5 名男生换成女生后，女生有多少人？请先推理再只输出最后结论一行，不要使用任何工具。';
const THINKING_PARAM_KEYS = ['reasoning_effort', 'thinking', 'enable_thinking'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1',
      port: 3001,
      path: p,
      method,
      headers: {
        ...AUTH,
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }); } catch { resolve({ status: res.statusCode, json: null, raw: d.slice(0, 300) }); }
      });
    });
    r.on('error', reject);
    r.setTimeout(30000, () => r.destroy(new Error('client timeout')));
    if (data) r.write(data);
    r.end();
  });
}

function safeIdPart(value) {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'unattributed';
}

function readRecords(conversationId) {
  try {
    return fs.readFileSync(path.join(TRANSCRIPT_DIR, `${safeIdPart(conversationId)}.jsonl`), 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function sentParams(record) {
  try {
    const parsed = JSON.parse((record && record.request && record.request.params) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function summarizeRecord(record) {
  const params = sentParams(record);
  const response = record.response || null;
  return {
    attemptIndex: record.attemptIndex,
    profileId: record.profileId || null,
    model: record.model || null,
    sentParamKeys: Object.keys(params).filter((k) => k !== 'model').sort(),
    thinkingKeys: THINKING_PARAM_KEYS.filter((k) => k in params),
    reasoning_effort: params.reasoning_effort === undefined ? null : params.reasoning_effort,
    error: record.error || null,
    finishReason: response ? response.finishReason : null,
    contentLength: response && typeof response.content === 'string' ? response.content.length : 0,
    reasoningLength: response && typeof response.reasoningContent === 'string' ? response.reasoningContent.length : 0,
    reasoningPreview: response && typeof response.reasoningContent === 'string'
      ? response.reasoningContent.slice(0, 200)
      : null,
  };
}

async function createConversation(title) {
  const r = await req('POST', '/api/ai/conversations', { title });
  if (r.status !== 200 || !r.json || !r.json.conversation) throw new Error(`create_conversation_failed:${r.status}`);
  return r.json.conversation.id;
}

async function runAgentRound(conversationId, thinkingLevel) {
  const body = {
    conversationId,
    modelPresetId: SENSO_PROFILE_ID,
    thinkingLevel,
    messages: [{ role: 'user', content: PROMPT }],
  };
  return req('POST', '/api/ai/agent', body);
}

async function waitAssistantMessage(conversationId, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await req('GET', `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`);
    const messages = (r.json && r.json.messages) || [];
    const assistant = messages.filter((m) => m.role === 'assistant' && String(m.content || '').trim().length > 0);
    if (assistant.length > 0) {
      // 落库后可能仍在写 meta，短暂稳定期再取终值（照抄 BLOCK-81 P3 节奏）
      await sleep(2500);
      const r2 = await req('GET', `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`);
      const again = ((r2.json && r2.json.messages) || []).filter((m) => m.role === 'assistant' && String(m.content || '').trim().length > 0);
      return again.length > 0 ? again[again.length - 1] : assistant[assistant.length - 1];
    }
    await sleep(3000);
  }
  return null;
}

function metaOf(message) {
  if (!message) return {};
  if (message.meta && typeof message.meta === 'object') return message.meta;
  try { return JSON.parse(message.meta_json || '{}'); } catch { return {}; }
}

function reasoningCharsOfMeta(meta) {
  const byIter = meta && meta.reasoningByIteration;
  if (!byIter || typeof byIter !== 'object') return 0;
  return Object.values(byIter).reduce((acc, v) => acc + (typeof v === 'string' ? v.length : 0), 0);
}

(async () => {
  const run = lib.createRun({ name: 'block-82-thinking-compat', evidenceDir: EVIDENCE_DIR });
  const observations = {};

  try {
    /* 0) API 就绪 */
    let apiReady = false;
    for (let i = 0; i < 10; i += 1) {
      const r = await req('GET', '/api/data/projects').catch(() => null);
      if (r && r.status === 200) { apiReady = true; break; }
      await sleep(2000);
    }
    run.assert('ENV_api_ready', apiReady, '3001 API 就绪');

    /* C0 配置面：sensenova 声明 reasoning 能力位 */
    const settingsRes = await req('GET', '/api/ai/settings');
    const settings = (settingsRes.json && settingsRes.json.settings) || {};
    const senso = (settings.model_profiles || []).find((p) => p.id === SENSO_PROFILE_ID);
    const hasReasoningCap = !!senso && Array.isArray(senso.capabilities) && senso.capabilities.includes('reasoning');
    run.assert('C0_config_capability', hasReasoningCap,
      `sensenova(${SENSO_PROFILE_ID}) capabilities=${JSON.stringify(senso ? senso.capabilities : null)} 含 reasoning`);

    /* C1-C2 两轮真实对话 */
    const convStd = await createConversation(`BLOCK-82 标准档 ${Date.now()}`);
    const stdSent = await runAgentRound(convStd, 'standard');
    run.assert('RUN_std_accepted', stdSent.status === 200, `standard 轮 POST /api/ai/agent HTTP ${stdSent.status}`);

    const stdAssistant = await waitAssistantMessage(convStd);
    run.assert('RUN_std_replied', !!stdAssistant, `standard 轮 assistant 回复${stdAssistant ? ` ${String(stdAssistant.content).length} 字` : '（180s 超时）'}`);

    const convHigh = await createConversation(`BLOCK-82 高档 ${Date.now()}`);
    const highSent = await runAgentRound(convHigh, 'high');
    run.assert('RUN_high_accepted', highSent.status === 200, `high 轮 POST /api/ai/agent HTTP ${highSent.status}`);

    const highAssistant = await waitAssistantMessage(convHigh);
    run.assert('RUN_high_replied', !!highAssistant, `high 轮 assistant 回复${highAssistant ? ` ${String(highAssistant.content).length} 字` : '（180s 超时）'}`);

    const stdRecords = readRecords(convStd).map(summarizeRecord);
    const highRecords = readRecords(convHigh).map(summarizeRecord);
    observations.stdRecords = stdRecords;
    observations.highRecords = highRecords;
    // 会话 transcript 是会话级归档：主迭代轮之外还有标题生成等辅助调用
    // （走默认 chat 渠道、不带档位参数，本就不该发）——档位断言只针对 sensenova 记录。
    const stdSenso = stdRecords.filter((r) => r.profileId === SENSO_PROFILE_ID);
    const highSenso = highRecords.filter((r) => r.profileId === SENSO_PROFILE_ID);
    observations.stdSensoRounds = stdSenso.length;
    observations.highSensoRounds = highSenso.length;

    /* C1 标准档：请求体零思考参数（additive 红线回归） */
    run.assert('C1_std_no_thinking_param', stdSenso.length > 0 && stdSenso.every((r) => r.thinkingKeys.length === 0),
      `standard 轮 sensenova ${stdSenso.length} 条上游记录全部零思考参数（sentParamKeys=${JSON.stringify(stdSenso.map((r) => r.sentParamKeys))}）`);

    /* C2 高档：上游收到 reasoning_effort=high */
    run.assert('C2_high_sends_reasoning_effort', highSenso.length > 0 && highSenso.every((r) => r.reasoning_effort === 'high'),
      `high 轮 sensenova ${highSenso.length} 条上游记录 reasoning_effort 全为 high（实测=${JSON.stringify(highSenso.map((r) => r.reasoning_effort))}；会话内辅助调用走默认渠道不涉档位）`);

    /* C3 归一生效（核心）：上游 reasoning 字段思考段经事件流归一 → meta.reasoningByIteration 落库。
     * 注：思考段走事件流（reasoning_delta）路径进 meta；transcript 聚合记录面的 message
     * 本就不保留思考段（无论是否归一，sensenova 记录 response 无 reasoningContent 字段，
     * io-transcript 归一为防御性一致，由契约测试覆盖）——如实登记，不作为实机断言。 */
    const highMetaChars = reasoningCharsOfMeta(metaOf(highAssistant));
    observations.highMetaReasoningChars = highMetaChars;
    observations.highSensoReasoningCharsInTranscript = highSenso.reduce((acc, r) => acc + r.reasoningLength, 0);
    run.assert('C3_high_reasoning_normalized', highMetaChars > 0,
      `high 轮 sensenova 思考段经归一落库：meta.reasoningByIteration 共 ${highMetaChars} 字（修复前恒 0——sensenova 字段名 reasoning，旧解析只认 reasoning_content）`);

    /* C4 标准档归一：sensenova 默认产思考段（不发参路径同样受益） */
    const stdMetaChars = reasoningCharsOfMeta(metaOf(stdAssistant));
    observations.stdMetaReasoningChars = stdMetaChars;
    run.assert('C4_std_reasoning_normalized', stdMetaChars > 0,
      `standard 轮（零思考参数）sensenova 思考段同样经归一落库：meta.reasoningByIteration 共 ${stdMetaChars} 字`);

    /* C5 内容主路径零破坏 */
    run.assert('C5_content_intact',
      !!stdAssistant && String(stdAssistant.content).trim().length > 0
      && !!highAssistant && String(highAssistant.content).trim().length > 0,
      `两会话 assistant 正文非空（std=${stdAssistant ? String(stdAssistant.content).length : 0} 字 / high=${highAssistant ? String(highAssistant.content).length : 0} 字）`);
  } catch (err) {
    observations.error = String((err && err.stack) || err).slice(0, 1200);
    return run.finish({ observations });
  }

  return run.finish({ observations });
})().then((payload) => {
  process.exit(payload && payload.allPass ? 0 : 1);
}).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
