'use strict';

/**
 * project-modality.js — BLOCK-230 Q-DOMAIN P4 切片：项目 modality 的基础值与扩展值。
 *
 * - 基础值固定为 general / single-cell / spatial / bulk（兼容存量项目）；
 * - 领域包通过 pack.json `provides.modalities` 声明扩展值（小写 ID，≤20 个）；
 * - 未知值一律回落 `general`（桌面工作流默认域中性，不再默认 single-cell）。
 */

const BASE_MODALITIES = Object.freeze(['general', 'single-cell', 'spatial', 'bulk']);
const MODALITY_ID = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_EXTENSION_MODALITIES = 20;

function normalizeModalities(value, limit = MAX_EXTENSION_MODALITIES) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value.slice(0, limit)) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim().toLowerCase();
    if (!MODALITY_ID.test(id) || BASE_MODALITIES.includes(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function resolveProjectModality(requested, extensions = []) {
  const allowed = new Set([...BASE_MODALITIES, ...normalizeModalities(extensions)]);
  return typeof requested === 'string' && allowed.has(requested) ? requested : 'general';
}

module.exports = {
  BASE_MODALITIES,
  MAX_EXTENSION_MODALITIES,
  normalizeModalities,
  resolveProjectModality,
};
