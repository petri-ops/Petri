#!/usr/bin/env node
/**
 * Stage 2 live provider acceptance — items 4 & 5.
 *
 * Drives the REAL ModelGateway + registered Provider adapters against REAL
 * endpoints to verify, per configured target:
 *   1. chat connectivity      (non-streaming request returns content)
 *   2. streaming              (chatStream emits incremental content_delta)
 *   3. Agent tool calling      (a tool schema round-trips to tool_calls)
 *
 * This is NOT part of the unit test suite and is never run by CI: it needs
 * real credentials and live network. Run it by hand from Cursor / a terminal.
 *
 * Secrets: read only from environment variables. Never hardcoded, never printed.
 *
 * Usage:
 *   node acceptance/stage2/live-provider-check.mjs
 *
 * Configure targets via env (see README.md). Example:
 *   ACCEPT_TARGETS=deepseek,openai-compatible,local \
 *   DEEPSEEK_API_KEY=sk-... \
 *   OPENAI_COMPAT_BASE_URL=https://api.example.com/v1 OPENAI_COMPAT_MODEL=gpt-4o-mini OPENAI_COMPAT_API_KEY=sk-... \
 *   LOCAL_PROVIDER=ollama LOCAL_BASE_URL=http://127.0.0.1:11434/v1 LOCAL_MODEL=qwen2.5 \
 *   node acceptance/stage2/live-provider-check.mjs
 *
 * Exit code: 0 when every configured target passes chat + streaming.
 *            1 when any target fails a required check, or when fewer than two
 *              targets succeed at Agent tool calling (Stage 2 exit item 5).
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const providers = require(resolve(REPO_ROOT, 'core/shared-backend/llm-providers/index.js'));
const { ModelGateway } = providers;
const { getProvider } = providers;
const aiUsageHelper = require(resolve(REPO_ROOT, 'core/shared-backend/ai-usage-helper.js'));

// Keep acceptance runs from touching the usage DB.
aiUsageHelper.configure({ recordAiUsage: () => {} });

const CHECK = '\u2713';
const CROSS = '\u2717';
const DASH = '\u2013';

function env(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Resolve the configured targets from the environment. Each target maps to a
 * single-profile gateway config with chat + agent roles bound to that profile.
 */
function resolveTargets() {
  const requested = (env('ACCEPT_TARGETS') || 'deepseek,openai-compatible,anthropic,local')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const targets = [];

  if (requested.includes('deepseek') && env('DEEPSEEK_API_KEY')) {
    targets.push(makeTarget('deepseek', {
      provider: 'deepseek',
      model: env('DEEPSEEK_MODEL') || 'deepseek-chat',
      apiKey: env('DEEPSEEK_API_KEY'),
    }));
  }

  if (requested.includes('openai-compatible') && env('OPENAI_COMPAT_BASE_URL') && env('OPENAI_COMPAT_MODEL')) {
    targets.push(makeTarget('openai-compatible', {
      // Use `openai` (requiresApiKey: true) for a cloud endpoint that needs a
      // key; fall back to `openai-compatible` when explicitly chosen.
      provider: env('OPENAI_COMPAT_PROVIDER') || 'openai',
      model: env('OPENAI_COMPAT_MODEL'),
      baseUrl: env('OPENAI_COMPAT_BASE_URL'),
      apiKey: env('OPENAI_COMPAT_API_KEY'),
    }));
  }

  if (requested.includes('anthropic') && env('ANTHROPIC_BASE_URL') && env('ANTHROPIC_MODEL')) {
    targets.push(makeTarget('anthropic', {
      provider: 'anthropic',
      model: env('ANTHROPIC_MODEL'),
      baseUrl: env('ANTHROPIC_BASE_URL'),
      apiKey: env('ANTHROPIC_API_KEY'),
    }));
  }

  if (requested.includes('local') && env('LOCAL_BASE_URL') && env('LOCAL_MODEL')) {
    targets.push(makeTarget('local', {
      provider: env('LOCAL_PROVIDER') || 'ollama',
      model: env('LOCAL_MODEL'),
      baseUrl: env('LOCAL_BASE_URL'),
      apiKey: env('LOCAL_API_KEY') || '',
    }));
  }

  return targets;
}

function makeTarget(name, cfg) {
  const profileId = `${name}-profile`;
  const profile = {
    id: profileId,
    label: name,
    provider: cfg.provider,
    model: cfg.model,
    credentialRef: `provider:${cfg.provider}`,
    capabilities: ['chat', 'streaming', 'tools'],
    roles: ['chat', 'agent'],
  };
  if (cfg.baseUrl) profile.baseUrl = cfg.baseUrl;
  return {
    name,
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey || '',
    profileId,
    gateway: new ModelGateway({
      getSettings: () => ({
        model_profiles: [profile],
        model_role_bindings: { chat: profileId, agent: profileId },
      }),
      getCredential: () => cfg.apiKey || '',
      getProvider,
    }),
  };
}

function messageContent(result) {
  const message = result && result.choices && result.choices[0] && result.choices[0].message;
  if (message && typeof message.content === 'string') return message.content;
  if (result && typeof result.content === 'string') return result.content; // dashscope-vision shape
  return '';
}

async function checkChat(target) {
  const result = await target.gateway.chat({
    role: 'chat',
    body: { messages: [{ role: 'user', content: '仅回复一个词：pong' }], max_tokens: 64 },
    telemetry: { kind: 'acceptance_chat' },
  });
  if (!result || result.error) {
    return { ok: false, detail: result ? `error=${JSON.stringify(result.error)}${result.status ? ` status=${result.status}` : ''}` : 'no result' };
  }
  const content = messageContent(result).trim();
  return content
    ? { ok: true, detail: `reply="${content.slice(0, 40).replace(/\s+/g, ' ')}"` }
    : { ok: false, detail: 'empty content' };
}

async function checkStreaming(target) {
  let deltas = 0;
  let streamed = '';
  const result = await target.gateway.chat({
    role: 'chat',
    body: { messages: [{ role: 'user', content: '从 1 数到 5，每个数字之间用空格。' }], max_tokens: 128 },
    telemetry: { kind: 'acceptance_stream' },
    onEvent: (event) => {
      if (event && event.type === 'content_delta' && event.content) {
        deltas += 1;
        streamed += event.content;
      }
    },
  });
  if (!result || result.error) {
    return { ok: false, detail: result ? `error=${JSON.stringify(result.error)}` : 'no result' };
  }
  return deltas > 0
    ? { ok: true, detail: `${deltas} delta(s), "${streamed.slice(0, 30).replace(/\s+/g, ' ')}"` }
    : { ok: false, detail: 'no content_delta events (not streamed)' };
}

const WEATHER_TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: '查询指定城市的当前天气',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string', description: '城市名' } },
      required: ['city'],
    },
  },
};

async function checkToolCalling(target) {
  const result = await target.gateway.chat({
    role: 'agent',
    body: {
      messages: [{ role: 'user', content: '请使用 get_weather 工具查询巴黎的天气。你必须调用该工具。' }],
      tools: [WEATHER_TOOL],
      tool_choice: 'auto',
      max_tokens: 256,
    },
    telemetry: { kind: 'acceptance_tools' },
  });
  if (!result || result.error) {
    return { ok: false, detail: result ? `error=${JSON.stringify(result.error)}` : 'no result' };
  }
  const toolCalls = result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.tool_calls;
  if (toolCalls && toolCalls.length) {
    const call = toolCalls[0];
    return { ok: true, detail: `tool_call=${call.function && call.function.name} args=${(call.function && call.function.arguments || '').slice(0, 40)}` };
  }
  return { ok: false, detail: 'no tool_calls emitted (may be a weak model, not a code fault)' };
}

function line(label, res) {
  const mark = res.skipped ? DASH : res.ok ? CHECK : CROSS;
  console.log(`    ${mark} ${label.padEnd(14)} ${res.detail || ''}`);
}

async function run() {
  console.log('BioF3 Stage 2 — live provider acceptance (items 4 & 5)\n');
  const targets = resolveTargets();

  if (!targets.length) {
    console.log('未配置任何可运行目标。请设置环境变量后重试，例如：\n');
    console.log('  ACCEPT_TARGETS=deepseek,openai-compatible,local');
    console.log('  DEEPSEEK_API_KEY=sk-...');
    console.log('  OPENAI_COMPAT_BASE_URL=... OPENAI_COMPAT_MODEL=... OPENAI_COMPAT_API_KEY=...');
    console.log('  LOCAL_PROVIDER=ollama LOCAL_BASE_URL=http://127.0.0.1:11434/v1 LOCAL_MODEL=qwen2.5\n');
    console.log('详见 acceptance/stage2/README.md。');
    process.exit(0);
  }

  let requiredFailures = 0;
  let toolCallSuccesses = 0;

  for (const target of targets) {
    console.log(`- ${target.name}  [provider=${target.provider} model=${target.model}${target.baseUrl ? ` baseUrl=${target.baseUrl}` : ''}]`);

    const chat = await checkChat(target);
    line('chat', chat);
    if (!chat.ok) requiredFailures += 1;

    const streaming = await checkStreaming(target);
    line('streaming', streaming);
    if (!streaming.ok) requiredFailures += 1;

    const tools = await checkToolCalling(target);
    line('tool-calling', tools);
    if (tools.ok) toolCallSuccesses += 1;

    console.log('');
  }

  console.log('----------------------------------------------------------------');
  console.log(`目标数: ${targets.length}  |  必检失败(chat+streaming): ${requiredFailures}  |  工具调用成功: ${toolCallSuccesses}`);

  const notes = [];
  if (requiredFailures > 0) notes.push(`${requiredFailures} 项 chat/streaming 必检失败`);
  if (toolCallSuccesses < 2) notes.push(`工具调用成功仅 ${toolCallSuccesses} 个 (Stage 2 出口要求 ≥2 Provider)`);
  if (notes.length) {
    console.log(`结果: FAIL — ${notes.join('；')}`);
    console.log('提示: 工具调用失败可能是模型能力弱，请用具备 tool calling 能力的模型复验，再判断是否代码问题。');
    process.exit(1);
  }
  console.log('结果: PASS — 所有目标 chat+streaming 通过，且 ≥2 Provider 工具调用成功。');
  process.exit(0);
}

run().catch((error) => {
  console.error('acceptance run crashed:', error && error.message ? error.message : error);
  process.exit(1);
});
