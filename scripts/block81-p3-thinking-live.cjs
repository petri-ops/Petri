#!/usr/bin/env node
'use strict';
/**
 * block81-p3-thinking-live.cjs — BLOCK-81 P3 实机对比验收（标准 vs 高）。
 *
 * 目标：用**真实渠道**（本机已配置的 OpenAI 兼容网关）跑两轮真实对话，证明
 * 「档位确实映射成上游请求参数」并且「上游实际收到/未收到该参数」，同时如实
 * 记录响应侧是否出现思考段（reasoning_content）。
 *
 * 证据三层：
 *   1) UI 层   — composer 档位控件（data-testid=thinking-level-trigger）的档位与默认值；
 *   2) 后端层  — 任务参数落库（DB tasks.params，由 P2 UI-345 已覆盖，本脚本只读会话消息 meta）；
 *   3) 上游层  — `llm-transcripts/<convId>.jsonl` 的 `request.params`（网关发给上游的
 *                请求体去掉 messages 后的序列化文本）→ 这是本阶段的核心新证据。
 *
 * 判定纪律（禁止编造效果）：上游是否产生思考段由渠道决定，本脚本只如实记录
 * 「发出去了什么 + 上游回了什么」；渠道不产思考段、或 400 后按 D3 去参重试，
 * 都属合格结论。
 *
 * 前置：dev 栈在跑（3001 API + 3000 Vite + 9222 CDP）；改了 core/ 必须重启 dev 栈。
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const DATA_DIR = process.env.BIOF3_LOCAL_DATA_DIR || path.join(ROOT, '.biof3-dev-user-data', 'data');
const TRANSCRIPT_DIR = path.join(DATA_DIR, 'llm-transcripts');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-81');

const PROMPT = '一个班有 30 名学生，其中 60% 是女生。把 5 名男生换成女生后，女生有多少人？只输出最后结论一行，不要使用任何工具。';
// 工具轮：UI-272 的思考段渲染面挂在「执行记录」内（仅当本轮有工具活动才存在），
// 零工具直答轮看不到思考行——故补一轮必然触发工具的对照。
const TOOL_PROMPT = '先看当前项目根目录里有什么文件，再只回复一行「文件数量=N」，不要展开细节。';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── HTTP ────────────────────────────────────────────────────────────────── */

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
    if (data) r.write(data);
    r.end();
  });
}

/* ── 信息流读取（BLOCK-37 落盘 / BLOCK-38 readLastRecord 同源目录） ─────────── */

function safeIdPart(value) {
  const cleaned = String(value || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'unattributed';
}

function transcriptFile(conversationId) {
  return path.join(TRANSCRIPT_DIR, `${safeIdPart(conversationId)}.jsonl`);
}

function readRecords(conversationId) {
  try {
    return fs.readFileSync(transcriptFile(conversationId), 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 从落盘记录里抽出「网关实际发给上游的请求参数」（request.params 是去 messages 的 JSON 文本）。 */
function sentParams(record) {
  try {
    const parsed = JSON.parse((record && record.request && record.request.params) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function reasoningKeysOf(params) {
  return ['reasoning_effort', 'thinking', 'enable_thinking'].filter((k) => k in params);
}

function summarizeRecord(record) {
  const params = sentParams(record);
  const response = record.response || null;
  return {
    ts: record.ts,
    attemptIndex: record.attemptIndex,
    profileId: record.profileId || null,
    provider: record.provider || null,
    model: record.model || null,
    sentParamKeys: Object.keys(params).filter((k) => k !== 'model').sort(),
    reasoningKeys: reasoningKeysOf(params),
    reasoning_effort: params.reasoning_effort === undefined ? null : params.reasoning_effort,
    temperature: params.temperature === undefined ? null : params.temperature,
    max_tokens: params.max_tokens === undefined ? null : params.max_tokens,
    error: record.error || null,
    finishReason: response ? response.finishReason : null,
    contentLength: response && typeof response.content === 'string' ? response.content.length : 0,
    reasoningLength: response && typeof response.reasoningContent === 'string' ? response.reasoningContent.length : 0,
    reasoningPreview: response && typeof response.reasoningContent === 'string'
      ? response.reasoningContent.slice(0, 200)
      : null,
    contentPreview: response && typeof response.content === 'string' ? response.content.slice(0, 200) : null,
  };
}

/* ── CDP 页面附着 ───────────────────────────────────────────────────────── */

async function attachWorkspacePage() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  // 排除 /window/* 辅助窗（RailPage / 结果窗等），只留主窗页面
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (client) => lib.evalJs(client, `!!document.getElementById('root')`).catch(() => false),
  });
  if (!target) throw new Error('no_workspace_page_target');
  return lib.connectTarget(target);
}

const COMPOSER_READY = `(function(){ var ta=document.querySelector('textarea.sc-input'); return ta ? 'ready' : null; })()`;
const MODEL_LABEL = `(function(){
  var b = document.querySelector('.sc-model-picker:not(.sc-model-picker-footer) button');
  return b ? (b.getAttribute('title') || b.textContent || '').trim() : null;
})()`;
const TRIGGER_STATE = `(function(){
  var el = document.querySelector('[data-testid="thinking-level-trigger"]');
  if (!el) return null;
  return JSON.stringify({
    level: el.getAttribute('data-level'),
    label: (el.textContent || '').trim(),
    hasTextLabel: !!el.querySelector('span'),
    title: el.getAttribute('title')
  });
})()`;
const REASONING_ROWS = `document.querySelectorAll('.sc-tool-reasoning').length`;
const SEND_BUTTON = `(function(){
  var b = [].slice.call(document.querySelectorAll('button')).find(function (x) {
    var t = (x.getAttribute('title') || '') + ' ' + (x.getAttribute('aria-label') || '');
    return t.indexOf('发送消息') >= 0;
  });
  if (!b) return 'send_button_missing';
  if (b.disabled) return 'send_disabled';
  b.click();
  return 'sent';
})()`;
const INSTALL_RECORDER = `(function(){
  window.__p3sent = [];
  if (!window.__p3patched) {
    window.__p3patched = true;
    var orig = window.fetch;
    window.fetch = function () {
      try {
        var a = arguments[0], b = arguments[1];
        var url = typeof a === 'string' ? a : (a && a.url);
        if (String(url).indexOf('/ai/agent') >= 0 && b && b.method === 'POST') {
          window.__p3sent.push(String(b.body || ''));
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
  }
  return 'installed';
})()`;
const READ_RECORDER = `JSON.stringify(window.__p3sent || [])`;

/** 读回页面实发 /api/ai/agent 请求体（UI 层证据：档位是否随本轮下发）。 */
async function readSentBodies(client) {
  const raw = await lib.evalJs(client, READ_RECORDER).catch(() => '[]');
  return JSON.parse(raw || '[]').map((body) => {
    try {
      const parsed = JSON.parse(body);
      return {
        conversationId: parsed.conversationId || null,
        modelPresetId: parsed.modelPresetId || null,
        thinkingLevel: parsed.thinkingLevel === undefined ? null : parsed.thinkingLevel,
        kind: parsed.kind || null,
      };
    } catch {
      return { unparsed: String(body).slice(0, 120) };
    }
  });
}

async function waitComposer(client, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await lib.evalJs(client, COMPOSER_READY).catch(() => null);
    if (ok === 'ready') return true;
    await sleep(1000);
  }
  return false;
}

async function waitTrigger(client, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = await lib.evalJs(client, TRIGGER_STATE).catch(() => null);
    if (raw) return JSON.parse(raw);
    await sleep(1000);
  }
  return null;
}

async function setLevel(client, level) {
  await lib.evalJs(client, `(function(){ var el=document.querySelector('[data-testid="thinking-level-trigger"]'); if (el) el.click(); return 'opened'; })()`);
  await sleep(500);
  const clicked = await lib.evalJs(client, `(function(){ var o=document.querySelector('[data-testid="thinking-level-option-${level}"]'); if(!o) return 'option_missing'; o.click(); return 'clicked'; })()`);
  await sleep(700);
  const raw = await lib.evalJs(client, TRIGGER_STATE).catch(() => null);
  return { clicked, state: raw ? JSON.parse(raw) : null };
}

async function typeAndSend(client, text) {
  const typed = await lib.evalJs(client, `(function(){
    var ta = document.querySelector('textarea.sc-input');
    if (!ta) return 'no_textarea';
    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed:' + ta.value.length;
  })()`);
  await sleep(900);
  const sent = await lib.evalJs(client, SEND_BUTTON);
  return { typed, sent };
}

/** 等这一轮的 assistant 消息落库（内容非空即为该轮跑完）。 */
async function waitAssistantMessage(conversationId, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const r = await req('GET', `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`);
    const messages = (r.json && r.json.messages) || [];
    const assistant = messages.filter((m) => m.role === 'assistant' && String(m.content || '').trim().length > 0);
    if (assistant.length > 0) {
      last = assistant[assistant.length - 1];
      // 落库后可能仍在写 meta，短暂稳定期再取终值
      await sleep(2500);
      const r2 = await req('GET', `/api/ai/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`);
      const again = ((r2.json && r2.json.messages) || []).filter((m) => m.role === 'assistant' && String(m.content || '').trim().length > 0);
      if (again.length > 0) last = again[again.length - 1];
      return { messages, assistant: last };
    }
    await sleep(3000);
  }
  return { messages: [], assistant: last, timedOut: true };
}

function metaOf(message) {
  if (!message) return {};
  if (message.meta && typeof message.meta === 'object') return message.meta;
  try { return JSON.parse(message.meta_json || '{}'); } catch { return {}; }
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */

(async () => {
  const run = lib.createRun({ name: 'block-81-p3-thinking', evidenceDir: EVIDENCE_DIR });
  const observations = {};
  let patchedProfiles = null;
  let client = null;

  try {
    /* 1) 渠道能力位就绪（D3 双保险①的声明面） */
    const settingsRes = await req('GET', '/api/ai/settings');
    const settings = (settingsRes.json && settingsRes.json.settings) || {};
    const profiles = Array.isArray(settings.model_profiles) ? settings.model_profiles : [];
    if (profiles.length === 0) throw new Error('no_model_profiles');

    const projectsRes = await req('GET', '/api/data/projects');
    const projectId = ((projectsRes.json && projectsRes.json.projects) || [])[0]
      && projectsRes.json.projects[0].id;
    if (!projectId) throw new Error('no_project');

    /* 2) 附着工作区页面 → 读 composer 当前绑定的模型 → 保证该渠道声明 reasoning */
    client = await attachWorkspacePage();
    await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${projectId}'; 'nav'`);
    await sleep(5000);
    client = await attachWorkspacePage();
    const composerReady = await waitComposer(client);
    run.assert('P0_composer_ready', composerReady, `工作区 composer 就绪（project=${projectId}）`);
    if (!composerReady) throw new Error('composer_not_ready');

    const modelLabel = await lib.evalJs(client, MODEL_LABEL).catch(() => null);
    const activeProfile = profiles.find((p) => p.model && String(modelLabel || '').includes(p.model))
      || profiles.find((p) => p.provider === 'deepseek' && (p.protocol || '') === 'openai-compatible')
      || profiles[0];
    observations.composerModelLabel = modelLabel;
    observations.targetProfileId = activeProfile.id;
    observations.targetProfileProtocol = activeProfile.protocol || null;
    observations.targetProfileModel = activeProfile.model;

    const hadReasoning = Array.isArray(activeProfile.capabilities) && activeProfile.capabilities.includes('reasoning');
    if (!hadReasoning) {
      const baseline = Array.isArray(activeProfile.capabilities) && activeProfile.capabilities.length
        ? activeProfile.capabilities
        : ['chat', 'streaming', 'tools'];
      patchedProfiles = profiles;
      const next = profiles.map((p) => (p.id === activeProfile.id
        ? { ...p, capabilities: Array.from(new Set([...baseline, 'reasoning'])) }
        : p));
      const w = await req('POST', '/api/ai/settings', { model_profiles: next });
      run.assert('P1_capability_declared', w.status === 200, `渠道 ${activeProfile.id} 声明 capabilities.reasoning（写 settings HTTP ${w.status}）`);
      const targets2 = await lib.pollTargets({ timeoutMs: 15000 });
      client = await lib.connectTarget(lib.filterPageTargets(targets2, /^http:\/\/localhost:3000\/(?!window\/)/)[0]);
      await lib.evalJs(client, `location.reload(); 'r'`).catch(() => {});
      await sleep(5000);
      client = await attachWorkspacePage();
      await waitComposer(client);
    } else {
      run.assert('P1_capability_declared', true, `渠道 ${activeProfile.id} 已在配置中声明 capabilities.reasoning（无需改写）`);
    }

    const trigger0 = await waitTrigger(client);
    run.assert('P2_control_visible', !!trigger0,
      trigger0 ? `档位控件出现（data-level=${trigger0.level}，label=${trigger0.label}）` : '档位控件未出现');

    /* 3) 两轮真实对话：标准 → 高（各自独立会话，提示词逐字相同） */
    const rounds = [
      { key: 'standard', title: 'BLOCK-81 P3 · 标准档对比', level: 'standard', prompt: PROMPT },
      { key: 'high', title: 'BLOCK-81 P3 · 高档对比', level: 'high', prompt: PROMPT },
      { key: 'tool', title: 'BLOCK-81 P3 · 工具轮（高）', level: 'high', prompt: TOOL_PROMPT, expandActivity: true },
    ];
    const roundEvidence = [];

    for (const round of rounds) {
      const created = await req('POST', '/api/ai/conversations', { project_id: projectId, title: round.title });
      const conversationId = created.json && created.json.conversation && created.json.conversation.id;
      if (!conversationId) throw new Error(`conversation_create_failed_${round.key}`);

      // 新会话须被工作区自动选中（列表按 updated_at DESC，新建即最新）
      await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${projectId}'; 'nav'`);
      await sleep(5000);
      client = await attachWorkspacePage();
      const ready = await waitComposer(client);
      await lib.evalJs(client, INSTALL_RECORDER).catch(() => null);
      const before = await waitTrigger(client);
      if (round.level !== 'standard' || (before && before.level !== round.level)) {
        await setLevel(client, round.level);
      }
      const after = await waitTrigger(client);
      const typedSent = await typeAndSend(client, round.prompt);
      const waited = await waitAssistantMessage(conversationId);
      const sentBodies = await readSentBodies(client);
      // UI-272 展示面核对：展开「执行记录」后再数思考行（工具轮专用）
      let expandClick = null;
      let reasoningRowsExpanded = null;
      if (round.expandActivity) {
        expandClick = await lib.evalJs(client, `(function(){
          var b = document.querySelector('.sc-tool-activity-summary');
          if (!b) return 'no_activity_summary';
          b.click();
          return 'clicked';
        })()`).catch((e) => 'err:' + String(e.message).slice(0, 60));
        await sleep(1200);
        reasoningRowsExpanded = await lib.evalJs(client, REASONING_ROWS).catch(() => null);
      }
      const messages = waited.messages || [];
      const userProbe = round.prompt.slice(0, 12);
      const boundToConversation = messages.some((m) => m.role === 'user' && String(m.content || '').includes(userProbe));
      const records = readRecords(conversationId).map(summarizeRecord);
      const meta = metaOf(waited.assistant);
      const reasoningByIteration = meta.reasoningByIteration && typeof meta.reasoningByIteration === 'object'
        ? meta.reasoningByIteration
        : {};
      const reasoningRows = await lib.evalJs(client, REASONING_ROWS).catch(() => null);

      roundEvidence.push({
        key: round.key,
        conversationId,
        requestedLevel: round.level,
        composerLevelBeforeSwitch: before ? before.level : null,
        composerLevelAfterSwitch: after ? after.level : null,
        composerReady: ready,
        typed: typedSent.typed,
        send: typedSent.sent,
        uiSentBodies: sentBodies,
        boundToConversation,
        assistantTimedOut: !!waited.timedOut,
        assistantMessageId: waited.assistant ? waited.assistant.id : null,
        assistantContentPreview: waited.assistant ? String(waited.assistant.content || '').slice(0, 400) : null,
        reasoningIterations: Object.keys(reasoningByIteration),
        reasoningLengths: Object.fromEntries(Object.entries(reasoningByIteration).map(([k, v]) => [k, String(v || '').length])),
        reasoningRowsInDom: reasoningRows,
        activityExpandClick: expandClick,
        reasoningRowsInDomExpanded: reasoningRowsExpanded,
        transcriptFile: transcriptFile(conversationId),
        upstreamRecords: records,
      });

      await lib.screenshotPng(client, EVIDENCE_DIR, `block81-p3-${round.key}.png`).catch(() => null);
    }

    const [std, high] = roundEvidence;
    const uiBodies = (round) => (round.uiSentBodies || []).filter((b) => b.conversationId === round.conversationId);

    /* 4) 断言：标准档 = 上游零思考参数 */
    run.assert('R1_default_standard', std.composerLevelBeforeSwitch === 'standard',
      `新会话档位控件默认 data-level=${std.composerLevelBeforeSwitch}（默认标准）`);
    run.assert('R1_ui_body_standard', uiBodies(std).length > 0 && uiBodies(std).every((b) => b.thinkingLevel === 'standard'),
      `UI 实发请求体 thinkingLevel 全为 standard（实测 ${JSON.stringify(uiBodies(std).map((b) => b.thinkingLevel))}）`);
    run.assert('R1_ui_bound_to_conversation', !!std.boundToConversation,
      `发送落到了本轮新建会话 ${std.conversationId}（会话级隔离）`);
    run.assert('R1_upstream_records_present', std.upstreamRecords.length > 0,
      `标准档会话信息流落盘 ${std.upstreamRecords.length} 条上游记录`);
    run.assert('R1_no_reasoning_param', std.upstreamRecords.length > 0 && std.upstreamRecords.every((r) => r.reasoningKeys.length === 0),
      `标准档全部上游请求体均无思考参数（参数键实测：${JSON.stringify(std.upstreamRecords.map((r) => r.sentParamKeys))}）`);

    /* 5) 断言：高档 = 上游确实收到 reasoning_effort=high */
    run.assert('R2_control_set_high', high.composerLevelAfterSwitch === 'high',
      `控件切到高（data-level=${high.composerLevelAfterSwitch}）`);
    run.assert('R2_ui_body_high', uiBodies(high).length > 0 && uiBodies(high).every((b) => b.thinkingLevel === 'high'),
      `UI 实发请求体 thinkingLevel=high（实测 ${JSON.stringify(uiBodies(high).map((b) => b.thinkingLevel))}）——档位控件到请求体不再静默失效`);
    run.assert('R2_ui_bound_to_conversation', !!high.boundToConversation,
      `发送落到了本轮新建会话 ${high.conversationId}`);
    const highWithParam = high.upstreamRecords.filter((r) => r.reasoningKeys.includes('reasoning_effort'));
    run.assert('R2_reasoning_effort_sent', highWithParam.length > 0 && highWithParam.every((r) => r.reasoning_effort === 'high'),
      `上游请求体实测 reasoning_effort=high（${highWithParam.length}/${high.upstreamRecords.length} 条记录携带；值=${JSON.stringify(highWithParam.map((r) => r.reasoning_effort))}）`);

    /* 6) 工具轮：UI-272 思考段展示面实机核对（思考行只存在于「执行记录」内） */
    const tool = roundEvidence[2];
    const toolWithParam = tool.upstreamRecords.filter((r) => r.reasoningKeys.includes('reasoning_effort'));
    run.assert('R4_tool_round_param_sent', toolWithParam.length > 0 && toolWithParam.every((r) => r.reasoning_effort === 'high'),
      `工具轮上游请求体同样携带 reasoning_effort=high（${toolWithParam.length}/${tool.upstreamRecords.length} 条记录）`);
    const toolReasoningChars = Object.values(tool.reasoningLengths || {}).reduce((n, v) => n + Number(v || 0), 0);
    run.assert('R4_reasoning_row_visible', toolReasoningChars > 0 && Number(tool.reasoningRowsInDomExpanded) > 0,
      `展开「执行记录」后渲染出思考行（meta 思考字数=${toolReasoningChars}，DOM .sc-tool-reasoning=${tool.reasoningRowsInDomExpanded}，展开点击=${tool.activityExpandClick}）`);

    /* 6) 观测（非判定）：上游响应侧是否真的产生思考段 / 是否走了 D3 去参重试 */
    const stdReasoning = std.upstreamRecords.reduce((n, r) => n + r.reasoningLength, 0);
    const highReasoning = high.upstreamRecords.reduce((n, r) => n + r.reasoningLength, 0);
    const highErrors = high.upstreamRecords.filter((r) => r.error);
    const droppedRetry = high.upstreamRecords.filter((r) => r.reasoningKeys.length === 0 && !r.error);
    observations.responseEvidence = {
      standard: {
        upstreamCalls: std.upstreamRecords.length,
        reasoningChars: stdReasoning,
        reasoningRowsInDom: std.reasoningRowsInDom,
        reasoningIterations: std.reasoningIterations,
        reasoningLengths: std.reasoningLengths,
        finishReasons: std.upstreamRecords.map((r) => r.finishReason),
        errors: std.upstreamRecords.map((r) => r.error).filter(Boolean),
      },
      high: {
        upstreamCalls: high.upstreamRecords.length,
        reasoningChars: highReasoning,
        reasoningRowsInDom: high.reasoningRowsInDom,
        reasoningIterations: high.reasoningIterations,
        reasoningLengths: high.reasoningLengths,
        finishReasons: high.upstreamRecords.map((r) => r.finishReason),
        errors: high.upstreamRecords.map((r) => r.error).filter(Boolean),
        paramDroppedRetryRecords: droppedRetry.length,
      },
      verdict: highErrors.length > 0
        ? 'upstream_rejected_param'
        : highReasoning > 0
          ? 'upstream_emitted_reasoning'
          : 'upstream_accepted_param_no_reasoning_emitted',
    };
    observations.responseEvidence.upstreamReasoningNote = '响应侧思考段取自上游流式 delta（前端 conversationRunStore 按迭代聚合 → 消息 meta.reasoningByIteration）；'
      + '信息流落盘的聚合 response.reasoningContent 为空属落盘面事实（agent 路径走 chatStream，聚合体不含 reasoning_content），展示面不受影响。';
    observations.responseEvidence.toolRound = {
      upstreamCalls: tool.upstreamRecords.length,
      reasoningChars: toolReasoningChars,
      reasoningRowsInDomExpanded: tool.reasoningRowsInDomExpanded,
      reasoningIterations: tool.reasoningIterations,
      reasoningLengths: tool.reasoningLengths,
      activityExpandClick: tool.activityExpandClick,
      assistantContentPreview: tool.assistantContentPreview,
    };
    run.assert('R3_response_captured', std.upstreamRecords.length > 0 && high.upstreamRecords.length > 0,
      `两轮响应均已捕获（标准 ${std.upstreamRecords.length} 条 / 高 ${high.upstreamRecords.length} 条上游记录，判定=${observations.responseEvidence.verdict}）`);

    observations.rounds = roundEvidence;

    return await run.finish({ observations });
  } catch (err) {
    run.assert('RUN_COMPLETED', false, `脚本异常：${err && err.message ? err.message : String(err)}`);
    observations.error = String((err && err.stack) || err).slice(0, 1200);
    return await run.finish({ observations });
  } finally {
    if (patchedProfiles) {
      const restore = await req('POST', '/api/ai/settings', { model_profiles: patchedProfiles }).catch(() => null);
      lib.log(`capability restore: HTTP ${restore ? restore.status : 'failed'}`);
    }
    try { client?.socket?.close(); } catch { /* ignore */ }
  }
})().then((payload) => {
  process.exit(payload && payload.allPass ? 0 : 1);
}).catch((e) => {
  console.error('FATAL', e && e.message);
  process.exit(2);
});
