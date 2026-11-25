'use strict';

/**
 * speech-config.js — 语音（ASR/TTS）渠道授权与参数（BLOCK-454 P6）。
 *
 * 形态复刻 ocr-config（BLOCK-454 P3）：能力授权面，全部即时生效（每次调用现读），
 * 无 env 层、无"需重启"话术。与凭据的分工同款——**key 不进本文件**：由
 * asr/tts-provider 经凭据族（credential store 'deepseek'，与对话共用）解析。
 *
 * 诚实边界：
 *  1. **默认关**（enabled=false）：语音调用不会静默产生云调用/花费（P5-a 付费知情）。
 *  2. **WS 流式留接口**（findings 在册）：本期只接整段 REST，不实现不冒充。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  commitGuard,
  findEntryByPath,
} = require('../../packages/shared-config/config-schema.js');
const { DEFAULT_LOCAL_MODEL_ID } = require('./local-asr-model');

const FAMILY = 'speech';
const STORE_FILENAME = 'speech-config.json';

const DEFAULTS = Object.freeze({
  enabled: false,
  provider: 'none',
  ttsVoice: 'stella',
  ttsFormat: 'wav',
  filterMarkdown: true,
  timeoutMs: 60000,
  // BLOCK-519 — additive：chain 模式下 provider_chain 顺序即回退链；
  // local_model 只存配置意图，「已下载/使用中」以本地模型目录真实落盘为准。
  provider_chain: Object.freeze(['local', 'deepseek']),
  local_model: Object.freeze({ modelId: DEFAULT_LOCAL_MODEL_ID, language: 'auto' }),
});

const ASR_PROVIDERS = ['local', 'deepseek'];
const ASR_LANGUAGES = ['auto', 'zh', 'en', 'ja', 'ko', 'yue'];

function cleanChain(value) {
  if (!Array.isArray(value)) return undefined;
  const chain = [...new Set(value.map((item) => String(item).trim()).filter((item) => ASR_PROVIDERS.includes(item)))].slice(0, 4);
  return chain;
}

function cleanLocalModel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out = {};
  if (typeof value.modelId === 'string' && value.modelId.trim()) out.modelId = value.modelId.trim();
  if (ASR_LANGUAGES.includes(value.language)) out.language = value.language;
  return Object.keys(out).length > 0 ? out : undefined;
}

function storePath() {
  const root = process.env.PETRI_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'Petri-Local');
  return path.join(root, STORE_FILENAME);
}

function lookup(family, storagePath) {
  return findEntryByPath(family, storagePath);
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // 显式键构建（security/detect-object-injection 零计算访问；键序=DEFAULTS 同序）。
    const out = {};
    if (typeof parsed.enabled === 'boolean') out.enabled = parsed.enabled;
    if (typeof parsed.provider === 'string') out.provider = parsed.provider;
    if (typeof parsed.ttsVoice === 'string') out.ttsVoice = parsed.ttsVoice;
    if (typeof parsed.ttsFormat === 'string') out.ttsFormat = parsed.ttsFormat;
    if (typeof parsed.filterMarkdown === 'boolean') out.filterMarkdown = parsed.filterMarkdown;
    if (typeof parsed.timeoutMs === 'number' && Number.isFinite(parsed.timeoutMs)) out.timeoutMs = parsed.timeoutMs;
    const chain = cleanChain(parsed.provider_chain);
    if (chain) out.provider_chain = chain;
    const localModel = cleanLocalModel(parsed.local_model);
    if (localModel) out.local_model = localModel;
    return out;
  } catch {
    return {};
  }
}

function writeStore(values) {
  const dir = path.dirname(storePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    storePath(),
    JSON.stringify({ ...values, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
  return values;
}

function normalize(values) {
  const source = values && typeof values === 'object' ? values : {};
  return {
    enabled: source.enabled === true,
    provider: typeof source.provider === 'string' ? source.provider.trim() : DEFAULTS.provider,
    ttsVoice: typeof source.ttsVoice === 'string' ? source.ttsVoice.trim() : DEFAULTS.ttsVoice,
    ttsFormat: typeof source.ttsFormat === 'string' ? source.ttsFormat.trim() : DEFAULTS.ttsFormat,
    filterMarkdown: source.filterMarkdown !== false,
    timeoutMs: Number.isFinite(source.timeoutMs) ? source.timeoutMs : DEFAULTS.timeoutMs,
    provider_chain: cleanChain(source.provider_chain) || [...DEFAULTS.provider_chain],
    local_model: { ...DEFAULTS.local_model, ...(cleanLocalModel(source.local_model) || {}) },
  };
}

/** 生效配置 = 默认值 ⊕ 落盘值（读侧宽松：坏形状回默认，不炸）。 */
function getEffectiveConfig() {
  return normalize({ ...DEFAULTS, ...readStore() });
}

/** 写侧：逐项过共享注册表守卫；未知键/非法形状 → 抛 config_value_rejected（路由映射 400）。 */
function saveSpeechConfig(patch) {
  const guard = commitGuard(FAMILY, patch && typeof patch === 'object' ? patch : {}, lookup);
  if (!guard.ok) {
    const error = new Error('config_value_rejected');
    error.diagnostics = guard.diagnostics;
    throw error;
  }
  const current = readStore();
  const next = { ...current, ...guard.normalized };
  // BLOCK-519 — 容器型字段由落点按语义收窄后再落盘（共享 schema 只做浅层容器判断）。
  const chain = cleanChain(next.provider_chain);
  if (chain) next.provider_chain = chain;
  const localModel = cleanLocalModel(next.local_model);
  if (localModel) next.local_model = localModel;
  writeStore(next);
  return getSnapshot();
}

function getSnapshot() {
  const effective = getEffectiveConfig();
  return { effective, stored: readStore(), diagnostics: [] };
}

module.exports = {
  FAMILY,
  STORE_FILENAME,
  DEFAULTS,
  storePath,
  readStore,
  writeStore,
  getEffectiveConfig,
  saveSpeechConfig,
  getSnapshot,
};
