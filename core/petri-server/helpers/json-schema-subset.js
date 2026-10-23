'use strict';

/**
 * helpers/json-schema-subset.js — BLOCK-249（Q4a）结构化输出的**最小 JSON-Schema 子集**。
 *
 * 为什么要自己写：本仓零新依赖（红线），而结构化输出只需要一小撮关键字——
 * type / required / properties / items / enum / additionalProperties / minimum / maximum。
 * 宁可**明确拒绝**不支持的关键字（$ref/oneOf/allOf…），也不静默忽略：静默忽略会让
 * "校验通过"变成一句空话。
 *
 * 两条边界：
 *  ① 写侧 `isSupportedSchema` 是**形状闸**（不合法 schema 直接拒绝 spawn）；
 *  ② 读侧 `validateSubset` 只报错不抛异常（错误清单回给父 agent）。
 */

const MAX_DEPTH = 8;
const SUPPORTED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const SUPPORTED_KEYS = new Set([
  'type', 'required', 'properties', 'items', 'enum', 'additionalProperties',
  'minimum', 'maximum', 'description', 'title',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 形状校验：返回问题清单（空=可用）。 */
function isSupportedSchema(schema, path = 'schema', depth = 0) {
  const problems = [];
  if (!isPlainObject(schema)) {
    problems.push(`${path}: schema 必须是对象`);
    return problems;
  }
  if (depth > MAX_DEPTH) {
    problems.push(`${path}: 嵌套超过 ${MAX_DEPTH} 层`);
    return problems;
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYS.has(key)) problems.push(`${path}.${key}: 不支持的关键字（最小子集：${[...SUPPORTED_KEYS].join('/')}）`);
  }
  if (schema.type !== undefined && !SUPPORTED_TYPES.has(String(schema.type))) {
    problems.push(`${path}.type: 不支持 ${String(schema.type)}`);
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string')) {
      problems.push(`${path}.required: 必须是字符串数组`);
    }
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    problems.push(`${path}.enum: 必须是数组`);
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
    problems.push(`${path}.additionalProperties: 必须是 boolean`);
  }
  if (schema.minimum !== undefined && typeof schema.minimum !== 'number') problems.push(`${path}.minimum: 必须是数值`);
  if (schema.maximum !== undefined && typeof schema.maximum !== 'number') problems.push(`${path}.maximum: 必须是数值`);
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) {
      problems.push(`${path}.properties: 必须是对象`);
    } else {
      for (const [key, sub] of Object.entries(schema.properties)) {
        problems.push(...isSupportedSchema(sub, `${path}.properties.${key}`, depth + 1));
      }
    }
  }
  if (schema.items !== undefined) problems.push(...isSupportedSchema(schema.items, `${path}.items`, depth + 1));
  return problems;
}

/** 值校验：返回错误清单（空=通过）。 */
function validateSubset(value, schema, path = '$', depth = 0) {
  const errors = [];
  if (!isPlainObject(schema)) return errors;
  if (depth > MAX_DEPTH) {
    errors.push(`${path}: 嵌套超过 ${MAX_DEPTH} 层`);
    return errors;
  }
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type !== undefined) {
    const expected = String(schema.type);
    const ok = expected === actual || (expected === 'integer' && actual === 'number' && Number.isInteger(value));
    if (!ok) {
      errors.push(`${path}: 需要 ${expected}，实际 ${actual}`);
      return errors;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    errors.push(`${path}: 不在枚举内（${scalarPreview(value)}）`);
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    errors.push(`${path}: 小于 ${schema.minimum}`);
  }
  if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) {
    errors.push(`${path}: 大于 ${schema.maximum}`);
  }
  if (actual === 'object') {
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key}: 缺少必填字段`);
      }
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        errors.push(...validateSubset(value[key], sub, `${path}.${key}`, depth + 1));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push(`${path}.${key}: 不允许的额外字段`);
      }
    }
  }
  if (actual === 'array' && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateSubset(item, schema.items, `${path}[${index}]`, depth + 1));
    });
  }
  return errors;
}

function scalarPreview(value) {
  try {
    const text = JSON.stringify(value);
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  } catch {
    return String(value).slice(0, 60);
  }
}

/** 从模型终态正文里取 JSON：容忍 ```json 围栏，其余原样 parse。 */
function parseJsonFromText(text) {
  let raw = String(text || '').trim();
  if (!raw) return { ok: false, error: '空输出' };
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) raw = fenced[1].trim();
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: `不是合法 JSON：${String(error && error.message || error).slice(0, 160)}` };
  }
}

module.exports = {
  MAX_DEPTH,
  isSupportedSchema,
  validateSubset,
  parseJsonFromText,
  scalarPreview,
};
