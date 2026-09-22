'use strict';

const fs = require('node:fs');
const path = require('node:path');
const thresholds = require('./decision-thresholds');

const NEWLINE = String.fromCharCode(10);

/**
 * helpers/decision-config.js — BLOCK-116 P4 决策配置中心（运行时真相，持久化 data 目录）。
 *
 * 契约（plan §P4）：
 *  - 五个运行时接点：enabled/threshold 可经配置文件调整；校准默认来自 decision-thresholds。
 *  - 优先级：env='0' 强制关（杀开关，最高，永不违逆）；其余以配置文件为准（首载=种子值，
 *    从 env='1' 沿用现状）；env='1' 不在运行时强制开（避免 UI 关不掉）——envOverride 字段
 *    如实暴露给 UI 提示。
 *  - 读不落盘（缺文件返回内存种子）；只有 setPointConfig 落盘——测试/只读路径零副作用。
 *  - 只覆盖五个运行时接点；failure-triage/test-suggest 为 CLI 工具不参与。
 */

const RUNTIME_POINTS = {
  'topic-shift': { label: '话题漂移判断', enabledDefault: true, envKey: 'BIOF3_JEV_TOPIC_SHIFT' },
  'knowledge-guard': { label: '知识库二跳守卫', enabledDefault: false, envKey: 'BIOF3_JEV_KNOWLEDGE_GUARD' },
  'marker-celltype': { label: 'marker→细胞类型判别', enabledDefault: false, envKey: 'BIOF3_JEV_MARKER_GUARD' },
  'intent-route': { label: 'copilot 意图路由', enabledDefault: false, envKey: 'BIOF3_JEV_INTENT_ROUTE' },
  'tool-route': { label: '工具两跳预路由', enabledDefault: false, envKey: 'BIOF3_JEV_TOOL_ROUTE' },
};

function configPath() {
  const base = process.env.BIOF3_DECISION_CONFIG_PATH
    || path.join(process.env.BIOF3_LOCAL_DATA_DIR || process.env.LOCAL_DATA_DIR || path.join(process.cwd(), 'data'), 'decision-config.json');
  return base;
}

function envValue(envKey) {
  const v = process.env[envKey];
  if (v === '0') return 'off';
  if (v === '1') return 'on';
  return undefined;
}

/** 内存种子（env='1' 沿用现状；否则校准默认）。读路径不落盘。 */
function seedDoc() {
  const points = {};
  for (const [point, meta] of Object.entries(RUNTIME_POINTS)) {
    points[point] = {
      enabled: envValue(meta.envKey) === 'on' ? true : meta.enabledDefault,
      ...(thresholds[point]?.threshold != null ? { threshold: thresholds[point].threshold } : {}),
    };
  }
  return { version: 1, points };
}

function readDoc() {
  try {
    const doc = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (doc && typeof doc === 'object' && doc.points) return doc;
  } catch { /* 缺文件/损坏 → 内存种子 */ }
  return seedDoc();
}

/** 生效配置（env='0' 强制关最高；env='1' 在 envOverride 如实暴露但不强制——以配置文件为准）。 */
function getPointRuntime(point) {
  const meta = RUNTIME_POINTS[point];
  if (!meta) return null;
  const doc = readDoc();
  const stored = doc.points[point] || {};
  const env = envValue(meta.envKey);
  const registry = thresholds[point] || {};
  return {
    point,
    label: meta.label,
    enabled: env === 'off' ? false : stored.enabled === true,
    envOverride: env || null,
    threshold: typeof stored.threshold === 'number' ? stored.threshold : registry.threshold,
    defaultThreshold: registry.threshold ?? null,
    gates: registry.gates || null,
    evidence: registry.evidence || null,
  };
}

function getAllPointConfigs() {
  return Object.keys(RUNTIME_POINTS).map((point) => {
    const runtime = getPointRuntime(point);
    return {
      ...runtime,
      enabledDefault: RUNTIME_POINTS[point].enabledDefault,
      envKey: RUNTIME_POINTS[point].envKey,
    };
  });
}

/** 更新接点配置（落盘）。非法接点 null；非法值 TypeError 由端点转 400。 */
function setPointConfig(point, patch) {
  if (!RUNTIME_POINTS[point]) return null;
  if (!patch || typeof patch !== 'object') throw new TypeError('patch 必须是对象');
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') {
    throw new TypeError('enabled 必须是布尔');
  }
  if (patch.threshold !== undefined) {
    if (typeof patch.threshold !== 'number' || !Number.isFinite(patch.threshold) || patch.threshold < 0 || patch.threshold > 1) {
      throw new TypeError('threshold 必须是 [0,1] 内的有限数值');
    }
  }
  const doc = readDoc();
  doc.points[point] = { ...(doc.points[point] || {}) };
  if (patch.enabled !== undefined) doc.points[point].enabled = patch.enabled;
  if (patch.threshold !== undefined) doc.points[point].threshold = patch.threshold;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(doc, null, 2) + NEWLINE, 'utf8');
  return getPointRuntime(point);
}

/** 决策模型供给（BLOCK-116 P5）：端点/Key/模型名——本地 Laya 等同类型供给改此三项即可。 */
function getProvider() {
  const doc = readDoc();
  if (doc.provider && doc.provider.apiKey) return doc.provider;
  // 一次性迁移：env 有 key 而文件未存 → 自动落盘（之后删除 jev.env 不影响）
  const envKey = process.env.TYPESAFE_API_KEY;
  if (!envKey) return null;
  const provider = {
    baseUrl: process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai',
    apiKey: envKey,
    model: process.env.TYPESAFE_MODEL || 'jev-1.13.0',
  };
  try {
    doc.provider = provider;
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(doc, null, 2) + NEWLINE, 'utf8');
    console.log('[block116] provider migrated to', configPath());
  } catch (e) {
    console.error('[block116] provider migration write failed:', e && e.message);
  }
  return provider;
}

/** 更新模型供给（PUT）。baseUrl 必须 http(s) 开头；apiKey 必填非空。返回打码视图。 */
function setProvider(patch) {
  if (!patch || typeof patch !== 'object') throw new TypeError('patch 必须是对象');
  const doc = readDoc();
  const cur = doc.provider || {
    baseUrl: process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai',
    apiKey: process.env.TYPESAFE_API_KEY || '',
    model: 'jev-1.13.0',
  };
  const next = {
    baseUrl: patch.baseUrl !== undefined ? String(patch.baseUrl) : cur.baseUrl,
    apiKey: patch.apiKey !== undefined ? String(patch.apiKey) : cur.apiKey,
    model: patch.model !== undefined ? String(patch.model) : cur.model,
  };
  if (!/^https?:\/\//i.test(next.baseUrl || '')) throw new TypeError('baseUrl 必须以 http(s):// 开头');
  if (!next.apiKey) throw new TypeError('apiKey 不能为空');
  if (!next.model) throw new TypeError('model 不能为空');
  doc.provider = next;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(doc, null, 2) + NEWLINE, 'utf8');
  return { baseUrl: next.baseUrl, model: next.model, hasKey: true };
}

/** 打码视图（GET 用：永不回传 apiKey 原文）。 */
function getProviderMasked() {
  const p = getProvider();
  if (!p) return null;
  return { baseUrl: p.baseUrl, model: p.model, hasKey: Boolean(p.apiKey) };
}

module.exports = { RUNTIME_POINTS, getPointRuntime, getAllPointConfigs, setPointConfig, configPath, getProvider, setProvider, getProviderMasked };
