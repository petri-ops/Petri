'use strict';

/**
 * helpers/model-access.js — BLOCK-264（C-37）模型选择器权限来源。
 *
 * 单一真相 = 配置注册表 `model-access` 族（file:model-access.json）：
 *   allowedModels: string[] —— 空=全放行（默认，零行为变化）；非空=白名单模式
 *   reasonNotes:   object   —— 逐模型豁免/限制理由账本（只做可解释，不参与判定）
 *
 * 判定纯函数 modelAccessFor(preset)：放行 / 不放行 + 逐行可解释理由（含来源：
 * 白名单未列入 / 密钥缺失 / 发现失败——与 model-catalog.ts 的三态对齐）。
 * 写面走 schema 校验（saveModelAccess）；无 env 层（本地单用户，不留第二真相）。
 */

const fs = require('node:fs');
const path = require('node:path');
const dataPaths = require('../../shared-backend/data-paths.js');

const FAMILY = 'model-access';
const STORE_FILENAME = 'model-access.json';
const DEFAULTS = Object.freeze({ allowedModels: [], reasonNotes: {} });

function storePath() {
  return dataPaths.dataFile(STORE_FILENAME);
}

function readStore() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(raw);
    const allowed = Array.isArray(parsed.allowedModels)
      ? parsed.allowedModels.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim()).slice(0, 64)
      : [];
    const notes = parsed.reasonNotes && typeof parsed.reasonNotes === 'object' && !Array.isArray(parsed.reasonNotes)
      ? parsed.reasonNotes
      : {};
    return { allowedModels: allowed, reasonNotes: notes };
  } catch {
    return { allowedModels: [], reasonNotes: {} };
  }
}

function writeStore(store) {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    allowedModels: Array.isArray(store.allowedModels) ? store.allowedModels.slice(0, 64) : [],
    reasonNotes: store.reasonNotes && typeof store.reasonNotes === 'object' ? store.reasonNotes : {},
  }, null, 2), 'utf8');
}

/** 保存（元素级字符串校验 + 归一；任何非字符串项=整批拒绝，不留半批）。 */
function saveModelAccess(input) {
  const allowed = Array.isArray(input && input.allowedModels) ? input.allowedModels : [];
  if (allowed.some((m) => typeof m !== 'string' || !m.trim())) {
    return {
      ok: false,
      error: 'value_invalid',
      diagnostics: [{ code: 'item_type', path: 'allowedModels', message: 'allowedModels 的每一项必须是非空字符串' }],
    };
  }
  const notes = input && input.reasonNotes && typeof input.reasonNotes === 'object' && !Array.isArray(input.reasonNotes)
    ? input.reasonNotes
    : {};
  writeStore({ allowedModels: allowed.map((m) => m.trim()).slice(0, 64), reasonNotes: notes });
  return { ok: true };
}

/**
 * 判定（纯函数，供路由投影与测试共用）：
 * @returns {{ allowed: boolean, reason: string | null, source: 'allowlist' | 'open' }}
 *  白名单模式下被拒的模型带「未列入本机允许清单」理由 + reasonNotes 账本注记。
 */
function modelAccessFor(preset, store) {
  const effective = store || readStore();
  const allowlist = effective.allowedModels || [];
  const model = String((preset && (preset.model || preset.defaultModel)) || '');
  if (allowlist.length === 0) return { allowed: true, reason: null, source: 'open' };
  if (allowlist.includes(model)) {
    const note = effective.reasonNotes && effective.reasonNotes[model];
    return { allowed: true, reason: typeof note === 'string' ? note : null, source: 'allowlist' };
  }
  const note = effective.reasonNotes && effective.reasonNotes[model];
  return {
    allowed: false,
    reason: note ? `未列入本机允许清单（${note}）` : '未列入本机允许清单',
    source: 'allowlist',
  };
}

module.exports = {
  FAMILY,
  STORE_FILENAME,
  DEFAULTS,
  storePath,
  readStore,
  writeStore,
  saveModelAccess,
  modelAccessFor,
};
