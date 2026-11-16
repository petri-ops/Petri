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

const FAMILY = 'speech';
const STORE_FILENAME = 'speech-config.json';

const DEFAULTS = Object.freeze({
  enabled: false,
  provider: 'none',
  ttsVoice: 'stella',
  ttsFormat: 'wav',
  filterMarkdown: true,
  timeoutMs: 60000,
});

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
