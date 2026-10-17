'use strict';

/**
 * helpers/keymap.js — 应用级命令键位的持久化面（BLOCK-200 P0-1）。
 *
 * 分工（刻意的，不是遗漏）：
 *  · **命令 id 与默认组合串的真相在前端命令源** `frontend/src/lib/appKeymap.ts`
 *    （离开 `KeyboardEvent` 一个键位组合毫无意义，默认值也跟着动作走）；两侧集合等价由
 *    `appKeymap.drift.test.ts` 双向钉，沿用 `src/ipc/channels.js` ↔ `preload.js` 先例。
 *  · 本模块只做**落盘/读盘 + 写侧拒绝**，形状与语法一律问 shared-config 注册表（族 `keymap`）。
 *  · 读侧宽松、写侧拒绝（BLOCK-199 立的规矩）：文件里的未知命令 id 或坏组合**只报告不炸启动**，
 *    但经设置页写入时一律 400 + 结构化诊断，不再静默存活。
 *  · **无 env 层**：env 覆盖键位会造出"设置页显示 A、实际按 B"的第三种真相，故该族
 *    `precedence=['file','default']`，注册表里 `envKeys` 全为空。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findEntryByPath,
  diagnoseObject,
  commitGuard,
} = require('../../packages/shared-config/config-schema.js');

const STORE_FILENAME = 'keymap.json';
const FAMILY = 'keymap';

function storePath() {
  const root = process.env.PETRI_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'Petri-Local');
  return path.join(root, STORE_FILENAME);
}

function lookup(family, storagePath) {
  return findEntryByPath(family, storagePath);
}

/** 读盘：文件缺失/损坏=空选择（全走前端默认），**不抛错也不落盘**。 */
function readStore() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(raw);
    const bindings = parsed && typeof parsed.bindings === 'object' && parsed.bindings ? parsed.bindings : {};
    const out = {};
    for (const [id, value] of Object.entries(bindings)) {
      if (value === null) continue; // null=解绑，读侧直接不出现（前端据"无覆盖"回落默认）
      if (typeof value !== 'string') continue;
      out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(bindings) {
  const dir = path.dirname(storePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify({ bindings, updatedAt: new Date().toISOString() }, null, 2) + '\n');
  return bindings;
}

/** 键位快照：生效覆盖层 + 读侧诊断（未知 id / 坏语法点名，不拒启动）。 */
function getKeymapSnapshot() {
  const bindings = readStore();
  return { bindings, diagnostics: diagnoseObject(FAMILY, bindings, lookup) };
}

/**
 * 写侧：逐项过注册表守卫。`patch[id]=null` 解绑该命令（从盘上移除，前端回落默认）；
 * 未知命令 id / 非法组合 → 抛 `config_value_rejected`（`.diagnostics` 结构化），由路由映射 400。
 */
function setKeymapBindings(patch) {
  const guard = commitGuard(FAMILY, patch, lookup);
  if (!guard.ok) {
    const error = new Error('config_value_rejected');
    error.diagnostics = guard.diagnostics;
    throw error;
  }
  const current = readStore();
  const next = { ...current };
  for (const [id, value] of Object.entries(patch)) {
    if (value === null) delete next[id];
    else next[id] = value;
  }
  return { bindings: writeStore(next), diagnostics: [] };
}

module.exports = {
  STORE_FILENAME,
  FAMILY,
  storePath,
  readStore,
  writeStore,
  getKeymapSnapshot,
  setKeymapBindings,
};
