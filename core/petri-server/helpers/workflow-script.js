'use strict';

/**
 * helpers/workflow-script.js — BLOCK-262（Q4b）工作流脚本纯函数层。
 *
 * 定位：meta 校验 + 稳定哈希（scriptHash/argsHash 是 resume 前缀命中的身份基础）。
 * 纯函数、零依赖（node:crypto 除外）、零 IO；执行面在 workflow-sandbox.js。
 * 红线（plan §3）：fail-closed——未知键拒绝而非忽略；数值越界拒绝而非钳位。
 */

const crypto = require('node:crypto');

const WORKFLOW_META_DEFAULTS = Object.freeze({
  concurrency: 2,
  budget: Object.freeze({
    maxAgents: 4,
    maxSteps: 50,
    timeoutMs: 10 * 60 * 1000,
  }),
});

const META_TOP_KEYS = ['name', 'version', 'budget', 'concurrency'];
const BUDGET_KEYS = ['maxAgents', 'maxSteps', 'timeoutMs'];

const LIMITS = Object.freeze({
  nameMax: 120,
  maxAgents: { min: 1, max: 32 },
  maxSteps: { min: 1, max: 200 },
  timeoutMs: { min: 1000, max: 30 * 60 * 1000 },
  concurrency: { min: 1, max: 8 },
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 校验并归一工作流 meta。
 * @returns {{ ok: true, meta: object } | { ok: false, error: 'meta_invalid', diagnostics: string[] }}
 */
function validateWorkflowMeta(meta) {
  const diagnostics = [];
  if (!isPlainObject(meta)) {
    return { ok: false, error: 'meta_invalid', diagnostics: ['meta 必须是对象字面量'] };
  }

  for (const key of Object.keys(meta)) {
    if (!META_TOP_KEYS.includes(key)) diagnostics.push(`未知顶层键 ${key}`);
  }

  const name = meta.name;
  if (typeof name !== 'string' || name.length === 0) {
    diagnostics.push('name 必须是非空字符串');
  } else if (name.length > LIMITS.nameMax) {
    diagnostics.push(`name 长度 ${name.length} 超上限 ${LIMITS.nameMax}`);
  }

  if (!Number.isInteger(meta.version) || meta.version < 1) {
    diagnostics.push('version 必须是 ≥1 的整数');
  }

  const rawBudget = meta.budget === undefined ? {} : meta.budget;
  if (!isPlainObject(rawBudget)) {
    diagnostics.push('budget 必须是对象');
  } else {
    for (const key of Object.keys(rawBudget)) {
      if (!BUDGET_KEYS.includes(key)) diagnostics.push(`budget 未知子键 ${key}`);
    }
    if (
      rawBudget.maxAgents !== undefined &&
      (!Number.isInteger(rawBudget.maxAgents) ||
        rawBudget.maxAgents < LIMITS.maxAgents.min ||
        rawBudget.maxAgents > LIMITS.maxAgents.max)
    ) {
      diagnostics.push(`budget.maxAgents 须为 ${LIMITS.maxAgents.min}..${LIMITS.maxAgents.max} 的整数`);
    }
    if (
      rawBudget.maxSteps !== undefined &&
      (!Number.isInteger(rawBudget.maxSteps) ||
        rawBudget.maxSteps < LIMITS.maxSteps.min ||
        rawBudget.maxSteps > LIMITS.maxSteps.max)
    ) {
      diagnostics.push(`budget.maxSteps 须为 ${LIMITS.maxSteps.min}..${LIMITS.maxSteps.max} 的整数`);
    }
    if (
      rawBudget.timeoutMs !== undefined &&
      (!Number.isInteger(rawBudget.timeoutMs) ||
        rawBudget.timeoutMs < LIMITS.timeoutMs.min ||
        rawBudget.timeoutMs > LIMITS.timeoutMs.max)
    ) {
      diagnostics.push(`budget.timeoutMs 须为 ${LIMITS.timeoutMs.min}..${LIMITS.timeoutMs.max} ms`);
    }
  }

  const concurrency = meta.concurrency === undefined ? WORKFLOW_META_DEFAULTS.concurrency : meta.concurrency;
  if (!Number.isInteger(concurrency) || concurrency < LIMITS.concurrency.min || concurrency > LIMITS.concurrency.max) {
    diagnostics.push(`concurrency 须为 ${LIMITS.concurrency.min}..${LIMITS.concurrency.max} 的整数`);
  }

  if (diagnostics.length > 0) {
    return { ok: false, error: 'meta_invalid', diagnostics };
  }

  return {
    ok: true,
    meta: {
      name,
      version: meta.version,
      budget: {
        maxAgents: rawBudget.maxAgents === undefined ? WORKFLOW_META_DEFAULTS.budget.maxAgents : rawBudget.maxAgents,
        maxSteps: rawBudget.maxSteps === undefined ? WORKFLOW_META_DEFAULTS.budget.maxSteps : rawBudget.maxSteps,
        timeoutMs: rawBudget.timeoutMs === undefined ? WORKFLOW_META_DEFAULTS.budget.timeoutMs : rawBudget.timeoutMs,
      },
      concurrency,
    },
  };
}

function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(Buffer.from(String(text), 'utf8')).digest('hex');
}

/** 脚本内容哈希（resume 前缀命中的第一身份维度）。 */
function hashWorkflowSource(source) {
  return sha256(source);
}

/** args 稳定哈希（键序无关；resume 前缀命中的第二身份维度）。 */
function hashWorkflowArgs(args) {
  return sha256(stableStringify(args === undefined ? null : args));
}

module.exports = {
  WORKFLOW_META_DEFAULTS,
  LIMITS,
  validateWorkflowMeta,
  stableStringify,
  hashWorkflowSource,
  hashWorkflowArgs,
};
