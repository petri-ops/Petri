'use strict';

/**
 * helpers/ocr-config.js — OCR 渠道授权与参数（BLOCK-454 P3）。
 *
 * 形态复刻 web-search-config（BLOCK-247）：能力授权面，全部即时生效（每次调用现读），
 * 无 env 层、无"需重启"话术。与凭据的分工同款——**key 不进本文件**：DeepSeek key 由
 * ocr-provider 经凭据族（credential store 'deepseek'，与对话共用）解析，这里只有开关。
 *
 * 诚实边界：
 *  1. **默认关**（enabled=false）：扫描件 PDF 摄取不会静默产生云调用/花费（P5-a 付费
 *     副作用知情权）；开启后 knowledge 摄取才对无文本层 PDF 走 OCR adapter。
 *  2. **provider=local 是留接口**（D1 预置裁决：不引本地 OCR 依赖）：选择它时窄口诚实
 *     报 ocr_provider_not_implemented，绝不静默空转。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  commitGuard,
  findEntryByPath,
} = require('../../packages/shared-config/config-schema.js');

const FAMILY = 'ocr';
const STORE_FILENAME = 'ocr-config.json';

const DEFAULTS = Object.freeze({
  enabled: false,
  provider: 'none',
  purpose: 'rich_layout_recognition',
  timeoutMs: 60000,
});

const FIELD_ORDER = Object.keys(DEFAULTS);

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
    const out = {};
    for (const key of FIELD_ORDER) {
      const value = parsed[key];
      if (typeof DEFAULTS[key] === 'boolean') {
        if (typeof value === 'boolean') out[key] = value;
      } else if (typeof DEFAULTS[key] === 'number') {
        if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
      } else if (typeof value === 'string') {
        out[key] = value;
      }
    }
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
    purpose: typeof source.purpose === 'string' ? source.purpose.trim() : DEFAULTS.purpose,
    timeoutMs: Number.isFinite(source.timeoutMs) ? source.timeoutMs : DEFAULTS.timeoutMs,
  };
}

/** 生效配置 = 默认值 ⊕ 落盘值（读侧宽松：坏形状回默认，不炸）。 */
function getEffectiveConfig() {
  return normalize({ ...DEFAULTS, ...readStore() });
}

/** 写侧：逐项过共享注册表守卫；未知键/非法形状 → 抛 config_value_rejected（路由映射 400）。 */
function saveOcrConfig(patch) {
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
  const diagnostics = [];
  if (effective.enabled && effective.provider === 'local') {
    diagnostics.push({
      code: 'ocr-local-not-implemented',
      family: FAMILY,
      path: 'provider',
      message: '本地 OCR 引擎未引入（新依赖默认 no，D1）：当前该档位会诚实报 ocr_provider_not_implemented。',
    });
  }
  return { effective, stored: readStore(), diagnostics };
}

module.exports = {
  FAMILY,
  STORE_FILENAME,
  DEFAULTS,
  storePath,
  readStore,
  writeStore,
  getEffectiveConfig,
  saveOcrConfig,
  getSnapshot,
};
