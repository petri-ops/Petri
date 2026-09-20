#!/usr/bin/env node
/**
 * UI-124 / MODEL-ANTHROPIC-NATIVE 实机收口证据脚本
 *
 * 模式：
 * - 未设置 BIOTEST_ANTHROPIC_KEY：dryrun 模式，验证脚本与调用 surface 可用，写出 dryrun 证据
 * - 设置 BIOTEST_ANTHROPIC_KEY：live 模式，访问 https://api.anthropic.com/v1 跑 4 步实机
 *
 * 输出：acceptance/MODEL-ANTHROPIC-NATIVE/anthropic-real-key-evidence.json
 * 不向 git 写入任何 Key 本身；evidence 仅记录 keyPresent 与 header 形态。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, '..');
const EVIDENCE_DIR = resolve(ROOT, 'acceptance', 'MODEL-ANTHROPIC-NATIVE');
const EVIDENCE_PATH = resolve(EVIDENCE_DIR, 'anthropic-real-key-evidence.json');
const ANTHROPIC_BASE = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

const KEY = process.env.BIOTEST_ANTHROPIC_KEY || '';
const MODE = KEY ? 'live' : 'dryrun';
const START_TS = new Date().toISOString();

const evidence = {
  uiId: 'UI-124',
  workPackage: 'MODEL-ANTHROPIC-NATIVE',
  mode: MODE,
  baseUrl: ANTHROPIC_BASE,
  anthropicVersion: ANTHROPIC_VERSION,
  keyPresent: Boolean(KEY),
  keyLength: KEY.length,
  startedAt: START_TS,
  steps: [],
  errors: [],
};

function recordStep(name, payload) {
  evidence.steps.push({ name, ts: new Date().toISOString(), ...payload });
}

function recordError(name, err) {
  evidence.errors.push({
    name,
    ts: new Date().toISOString(),
    message: err && err.message ? err.message : String(err),
    code: err && err.code ? err.code : null,
  });
}



async function stepListModels() {
  // Anthropic 不提供 list models endpoint；走 messages minimal ping 作为模型可达性
  // 这里复用核心 provider 类的 discover 路径，仅用其输入契约，不调用 fetch
  const { AnthropicProvider } = require(resolve(
    ROOT,
    'core/shared-backend/llm-providers/anthropic.js',
  ));
  const provider = new AnthropicProvider({
    apiKey: KEY,
    baseUrl: ANTHROPIC_BASE,
    model: 'claude-haiku-4-5',
  });
  recordStep('listModels', {
    providerClass: provider.constructor.name,
    defaultModel: provider.model,
    discovery: 'anthropic-no-list-endpoint; use static defaults from model-provider-options',
  });
}

async function stepChatRoundtrip() {
  const { AnthropicProvider } = require(resolve(
    ROOT,
    'core/shared-backend/llm-providers/anthropic.js',
  ));
  const provider = new AnthropicProvider({
    apiKey: KEY,
    baseUrl: ANTHROPIC_BASE,
    model: 'claude-haiku-4-5',
  });
  const messages = [{ role: 'user', content: 'ping' }];
  const result = await provider.chat({ messages, maxTokens: 16 });
  recordStep('chat', {
    durationMs: result.durationMs || null,
    contentChars: (result.content || '').length,
    usage: result.usage || null,
    finishReason: result.finishReason || null,
    contentHead: (result.content || '').slice(0, 80),
  });
  return result;
}

async function stepChatStream() {
  const { AnthropicProvider } = require(resolve(
    ROOT,
    'core/shared-backend/llm-providers/anthropic.js',
  ));
  const provider = new AnthropicProvider({
    apiKey: KEY,
    baseUrl: ANTHROPIC_BASE,
    model: 'claude-haiku-4-5',
  });
  const messages = [{ role: 'user', content: 'stream-ping' }];
  let firstEventTs = null;
  let lastEventTs = null;
  let textLen = 0;
  let usage = null;
  const events = [];
  await provider.chatStream({
    messages,
    maxTokens: 16,
    onEvent(ev) {
      const now = Date.now();
      if (!firstEventTs) firstEventTs = now;
      lastEventTs = now;
      events.push(ev.type || 'unknown');
      if (typeof ev.text === 'string') textLen += ev.text.length;
      if (ev.usage) usage = ev.usage;
    },
  });
  recordStep('chatStream', {
    eventTypes: Array.from(new Set(events)),
    firstEventMs: firstEventTs ? firstEventTs - START_TS_TS() : null,
    lastEventMs: lastEventTs ? lastEventTs - START_TS_TS() : null,
    textLen,
    usage,
  });
}

function START_TS_TS() {
  return new Date(evidence.startedAt).getTime();
}

async function stepUsageChannel() {
  // 用最轻的 ai-usage-helper 单测 hook 验证通道；只检查导出与 recordAiUsage 函数形态
  const usagePath = resolve(ROOT, 'core/shared-backend/ai-usage-helper.js');
  if (!existsSync(usagePath)) {
    recordStep('usage', { found: false });
    return;
  }
  delete require.cache[usagePath];
  const helper = require(usagePath);
  const fnNames = Object.keys(helper || {}).filter(
    (k) => typeof helper[k] === 'function',
  );
  recordStep('usage', {
    found: true,
    fnNames,
    modulePath: pathToFileURL(usagePath).href,
  });
}

async function run() {
  if (!existsSync(EVIDENCE_DIR)) {
    await mkdir(EVIDENCE_DIR, { recursive: true });
  }
  if (MODE === 'dryrun') {
    evidence.steps.push(
      {
        name: 'listModels',
        ts: new Date().toISOString(),
        note: 'dryrun: 跳过 fetch，仅打印 provider 默认模型',
        expectedProviderClass: 'AnthropicProvider',
        expectedDefaultModel: 'claude-haiku-4-5',
      },
      {
        name: 'chat',
        ts: new Date().toISOString(),
        note: 'dryrun: BIOTEST_ANTHROPIC_KEY 未设置，跳过实机',
        expectedDurationMs: '<3000 on healthy key',
      },
      {
        name: 'chatStream',
        ts: new Date().toISOString(),
        note: 'dryrun: 跳过流式实机',
        expectedEventTypes: ['content_block_delta', 'message_stop', 'message_start'],
      },
      {
        name: 'usage',
        ts: new Date().toISOString(),
        note: 'dryrun: 仅校验 ai-usage-helper 导出形态',
      },
    );
    evidence.errors.push({
      name: 'live-skip',
      ts: new Date().toISOString(),
      message:
        'BIOTEST_ANTHROPIC_KEY 未设置；未做实机。本机配置完成后重跑脚本以升级 evidence。',
      code: 'NO_KEY',
    });
  } else {
    try {
      await stepListModels();
    } catch (err) {
      recordError('listModels', err);
    }
    try {
      await stepChatRoundtrip();
    } catch (err) {
      recordError('chat', err);
    }
    try {
      await stepChatStream();
    } catch (err) {
      recordError('chatStream', err);
    }
    try {
      await stepUsageChannel();
    } catch (err) {
      recordError('usage', err);
    }
  }

  evidence.finishedAt = new Date().toISOString();
  await writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  const summary = {
    mode: MODE,
    steps: evidence.steps.length,
    errors: evidence.errors.length,
    evidence: EVIDENCE_PATH,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (MODE === 'live' && evidence.errors.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('check-model-anthropic-native failed:', err);
  process.exit(2);
});
