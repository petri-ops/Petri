'use strict';

/**
 * provider 工具名双向映射（conv_99208eb5-6b7 回归修复）。
 * OpenAI 兼容 provider 要求 function.name 匹配 ^[a-zA-Z0-9_-]+$；内核规范名（如
 * generate.image）投影时替换非法字符，调用时回填规范名。独立模块零 import，
 * 避免 agent-loop-control → registry 的架构环。
 */

const PROVIDER_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const PROVIDER_TO_CANONICAL = new Map();

function toProviderToolName(name) {
  const raw = typeof name === 'string' ? name : '';
  return PROVIDER_NAME_RE.test(raw) ? raw : raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function registerCanonicalToolNames(names) {
  for (const name of names || []) {
    if (typeof name === 'string' && name) PROVIDER_TO_CANONICAL.set(toProviderToolName(name), name);
  }
}

function fromProviderToolName(name) {
  return PROVIDER_TO_CANONICAL.get(name) || name;
}

module.exports = { toProviderToolName, registerCanonicalToolNames, fromProviderToolName };
