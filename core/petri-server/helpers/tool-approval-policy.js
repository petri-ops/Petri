'use strict';

/**
 * helpers/tool-approval-policy.js — 逐工具审批策略（BLOCK-244 Q1-REM A1/A8）。
 *
 * 存储：`tool-approval-policy.json`
 *   { version: 1, tools: { "<toolName>": "allow" | "ask" | "deny" } }
 *
 * 语义：
 * - 未配置 = allow（保持历史行为，零默认漂移）；
 * - ask  = 每次调用需经既有审批资源/guardKey 通道确认（guardKey=tool:<name>）；
 * - deny = 直接拦截（用户显式的工具拒绝）。
 * - 读侧 fail-soft（缺失/坏 JSON = 空策略）；写侧 fail-closed（非法模式/名拒绝）。
 * - MCP 服务级 trust / 逐工具 enabled 仍在各自 store；本表是通用工具层。
 */

const fs = require('node:fs');
const path = require('node:path');
const dataPaths = require('../../shared-backend/data-paths.js');

const FILENAME = 'tool-approval-policy.json';
const VERSION = 1;
const MODE_VALUES = new Set(['allow', 'ask', 'deny']);
const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_TOOLS = 200;

function policyFilePath() {
  return path.join(dataPaths.resolveDataDir(), FILENAME);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(policyFilePath(), 'utf8'));
    if (!isPlainObject(raw) || !isPlainObject(raw.tools)) return { version: VERSION, tools: {} };
    const tools = {};
    for (const [name, mode] of Object.entries(raw.tools)) {
      if (!TOOL_NAME_RE.test(name) || !MODE_VALUES.has(mode)) continue;
      tools[name] = mode;
    }
    return { version: VERSION, tools };
  } catch {
    return { version: VERSION, tools: {} };
  }
}

function writeStore(nextStore) {
  const modes = [];
  if (isPlainObject(nextStore) && isPlainObject(nextStore.tools)) {
    for (const [name, mode] of Object.entries(nextStore.tools)) modes.push({ name, mode });
  }
  const validated = validateModes(modes);
  if (!validated.ok) return { ok: false, error: 'policy_rejected', diagnostics: validated.diagnostics };
  const payload = { version: VERSION, tools: { ...validated.modes } };
  try {
    const file = policyFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, store: payload };
  } catch (error) {
    return { ok: false, error: 'write_failed', message: String(error && error.message), diagnostics: [] };
  }
}

function validateModes(list) {
  const diagnostics = [];
  if (!Array.isArray(list)) {
    return { ok: false, modes: {}, diagnostics: [{ code: 'modes_not_array' }] };
  }
  if (list.length > MAX_TOOLS) {
    diagnostics.push({ code: 'tools_too_many', limit: MAX_TOOLS, got: list.length });
  }
  const modes = {};
  for (const entry of list.slice(0, MAX_TOOLS)) {
    if (!isPlainObject(entry)) {
      diagnostics.push({ code: 'entry_not_object' });
      continue;
    }
    const name = String(entry.name || '').trim();
    const mode = String(entry.mode || '').trim();
    if (!TOOL_NAME_RE.test(name)) {
      diagnostics.push({ code: 'tool_name_invalid', value: name.slice(0, 64) });
      continue;
    }
    if (!MODE_VALUES.has(mode)) {
      diagnostics.push({ code: 'mode_invalid', value: mode.slice(0, 32) });
      continue;
    }
    modes[name] = mode;
  }
  return { ok: diagnostics.length === 0, modes, diagnostics };
}

function modeFor(toolName, store = readStore()) {
  const name = String(toolName || '');
  const mode = store && store.tools ? store.tools[name] : undefined;
  return MODE_VALUES.has(mode) ? mode : 'allow';
}

function listModes(store = readStore()) {
  return Object.entries(store.tools || {}).map(([name, mode]) => ({ name, mode }));
}

module.exports = {
  FILENAME,
  VERSION,
  MODE_VALUES,
  TOOL_NAME_RE,
  MAX_TOOLS,
  policyFilePath,
  readStore,
  writeStore,
  validateModes,
  modeFor,
  listModes,
};
