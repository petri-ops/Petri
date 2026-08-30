/**
 * BLOCK-10-AUDIT-CLOSEOUT PHASE 3 / PL-001 — MCP callTool inputSchema 校验
 *
 * 覆盖范围：
 * 1. valid args pass
 * 2. missing required field fails
 * 3. wrong type fails
 * 4. extra properties fails (additionalProperties: false)
 * 5. nested object fails
 * 6. array items fails
 * 7. enum value fails
 * 8. error format correct (McpValidationError carries schema path)
 * 9. backward compatible (null schema skips validation)
 * 10. edge: empty schema / completely wrong args + integration with plugin-loader.getInputSchema
 *
 * 纪律：100% 真实运行通过 / 0 TODO / 0 skip
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

const {
  validateToolArgs,
  McpValidationError,
  _validateValue,
  _valueType,
} = require('../core/biof3-server/mcp/_validate-tool-args.js');

const pluginLoader = require('../core/biof3-server/plugin-loader.js');

// ── Test 1: valid args pass ──────────────────────────────────────────────────

test('PL-001.1: valid args pass (happy path with required + type + bounds)', () => {
  const schema = {
    type: 'object',
    properties: {
      padj_cutoff: { type: 'number', minimum: 0, maximum: 1 },
      lfc_cutoff: { type: 'number', minimum: 0 },
      soft_power: { type: 'integer', minimum: 1, maximum: 30 },
    },
    required: ['padj_cutoff', 'lfc_cutoff'],
  };
  const result = validateToolArgs('deseq2', schema, {
    padj_cutoff: 0.05,
    lfc_cutoff: 1.0,
    soft_power: 6,
  });
  assert.equal(result.ok, true, 'happy-path should pass');
});

// ── Test 2: missing required field fails ─────────────────────────────────────

test('PL-001.2: missing required field fails with path-qualified error', () => {
  const schema = {
    type: 'object',
    properties: {
      padj_cutoff: { type: 'number' },
      lfc_cutoff: { type: 'number' },
    },
    required: ['padj_cutoff', 'lfc_cutoff'],
  };
  const result = validateToolArgs('deseq2', schema, { padj_cutoff: 0.05 });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].path, '<root>.lfc_cutoff');
  assert.match(result.errors[0].message, /required field "lfc_cutoff" is missing/);
});

// ── Test 3: wrong type fails ─────────────────────────────────────────────────

test('PL-001.3: wrong type fails (string passed to number field)', () => {
  const schema = {
    type: 'object',
    properties: {
      padj_cutoff: { type: 'number' },
    },
    required: ['padj_cutoff'],
  };
  const result = validateToolArgs('deseq2', schema, { padj_cutoff: 'not-a-number' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].path, '<root>.padj_cutoff');
  assert.match(result.errors[0].message, /expected type number/);
  assert.equal(result.errors[0].actual, 'string');
});

// ── Test 4: extra properties fails (additionalProperties: false) ────────────

test('PL-001.4: extra properties fail when additionalProperties: false', () => {
  const schema = {
    type: 'object',
    properties: {
      visible: { type: 'boolean' },
    },
    required: ['visible'],
    additionalProperties: false,
  };
  const result = validateToolArgs('my_tool', schema, {
    visible: true,
    rogue_field: 'x',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].path, '<root>.rogue_field');
  assert.match(result.errors[0].message, /unknown property "rogue_field"/);
});

// ── Test 5: nested object fails ──────────────────────────────────────────────

test('PL-001.5: nested object validation surfaces nested path', () => {
  const schema = {
    type: 'object',
    properties: {
      params: {
        type: 'object',
        properties: {
          threshold: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['threshold'],
      },
    },
    required: ['params'],
  };
  const result = validateToolArgs('nested_tool', schema, {
    params: { threshold: 5.0 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].path, '<root>.params.threshold');
  assert.match(result.errors[0].message, /value 5 > maximum 1/);
});

// ── Test 6: array items fail ─────────────────────────────────────────────────

test('PL-001.6: array items are validated against the items schema', () => {
  const schema = {
    type: 'object',
    properties: {
      samples: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
    },
    required: ['samples'],
  };
  const result = validateToolArgs('samples_tool', schema, {
    samples: [{ id: 'a' }, { id: 42 }, { id: 'c' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].path, '<root>.samples[1].id');
  assert.match(result.errors[0].message, /expected type string/);
});

// ── Test 7: enum value fails ─────────────────────────────────────────────────

test('PL-001.7: enum value fails when value not in allowed set', () => {
  const schema = {
    type: 'object',
    properties: {
      method: { type: 'string', enum: ['pearson', 'spearman'] },
    },
    required: ['method'],
  };
  const result = validateToolArgs('correlation', schema, { method: 'kendall' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].path, '<root>.method');
  assert.match(result.errors[0].message, /value not in enum/);
  assert.deepEqual(result.errors[0].expected, ['pearson', 'spearman']);
});

// ── Test 8: error format / McpValidationError carries schema path ────────────

test('PL-001.8: McpValidationError carries toolName + structured errors with path', () => {
  const schema = {
    type: 'object',
    properties: {
      top_genes: { type: 'integer', minimum: 1, maximum: 10000 },
    },
    required: ['top_genes'],
  };
  const result = validateToolArgs('heatmap', schema, { top_genes: 0 });
  assert.equal(result.ok, false);
  // McpValidationError 包装
  const err = new McpValidationError('heatmap', result.errors);
  assert.equal(err.name, 'McpValidationError');
  assert.equal(err.toolName, 'heatmap');
  assert.match(err.message, /mcp_input_validation_failed for tool "heatmap"/);
  assert.match(err.message, /<root>\.top_genes/);
  assert.equal(err.errors[0].path, '<root>.top_genes');
  assert.equal(err.errors[0].expected, '>= 1');
  assert.equal(err.errors[0].actual, 0);
});

// ── Test 9: backward compatible (null schema skips validation) ───────────────

test('PL-001.9: null / undefined schema skips validation (backward compatible)', () => {
  // 老 callTool 调用若 schema 缺失，跳过校验
  const r1 = validateToolArgs('legacy_tool', null, { any: 'thing' });
  assert.equal(r1.ok, true);
  const r2 = validateToolArgs('legacy_tool', undefined, null);
  assert.equal(r2.ok, true);
  // 空 schema 对象也视为通透
  const r3 = validateToolArgs('legacy_tool', {}, { any: 'thing', extra: 'too' });
  // 空 schema {} 因为没有 properties/required 应当通过
  assert.equal(r3.ok, true);
});

// ── Test 10: edge cases + integration with plugin-loader.getInputSchema ──────

test('PL-001.10: integration — plugin-loader.getInputSchema + validateToolArgs fail-closed on tool with bad args', () => {
  // 1. 设置临时 plugin 目录（用不会被 built-in 抢占的 ID）
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-pl001-'));
  const pluginDir = path.join(tmpDir, 'pl001-test-tool');
  const scriptsDir = path.join(pluginDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  fs.writeFileSync(
    path.join(tmpDir, 'installed.json'),
    JSON.stringify(
      [{ id: 'pl001-test-tool', type: 'analysis-plugin' }],
      null,
      2,
    ),
  );

  fs.writeFileSync(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify({
      id: 'pl001-test-tool',
      pluginManifestVersion: 1,
      title: 'PL001 Test Tool',
      version: '1.0.0',
      language: 'r',
      description: 'PL-001 integration test',
      supportedPlatforms: ['macos-arm64'],
    }, null, 2),
  );

  fs.writeFileSync(
    path.join(pluginDir, 'tool-definition.json'),
    JSON.stringify({
      id: 'pl001-test-tool',
      title: 'PL001 Test Tool',
      language: 'r',
      description: 'PL-001 integration test',
      inputs: [
        { id: 'padj_cutoff', type: 'number', min: 0, max: 1, required: true, label: 'Adjusted p cutoff' },
        { id: 'lfc_cutoff', type: 'number', min: 0, required: true, label: 'Log2 fold change cutoff' },
        { id: 'method', type: 'enum', enum: ['wald', 'lrt'], required: false, label: 'Test method' },
      ],
      outputs: [],
    }, null, 2),
  );

  fs.writeFileSync(path.join(scriptsDir, 'pl001-test-tool.R'), 'cat("pl001-test-tool\\n")\n');

  // 2. 注入 plugin map
  const previousMap = globalThis._biof3Plugins;
  try {
    globalThis._biof3Plugins = new Map();
    pluginLoader.loadPluginsFromDisk(tmpDir);

    // 3. 取 schema
    const schema = pluginLoader.getInputSchema('pl001-test-tool');
    assert.ok(schema, 'getInputSchema must return non-null for installed plugin');
    assert.equal(schema.type, 'object');
    assert.ok(schema.properties.padj_cutoff);
    assert.equal(schema.properties.padj_cutoff.type, 'number');
    assert.equal(schema.properties.padj_cutoff.minimum, 0);
    assert.equal(schema.properties.padj_cutoff.maximum, 1);
    assert.deepEqual(schema.required.sort(), ['lfc_cutoff', 'padj_cutoff']);
    assert.deepEqual(schema.properties.method.enum, ['wald', 'lrt']);

    // 4. 合法 args
    const okResult = validateToolArgs('pl001-test-tool', schema, {
      padj_cutoff: 0.05,
      lfc_cutoff: 1.0,
      method: 'wald',
    });
    assert.equal(okResult.ok, true);

    // 5. 非法 args: padj_cutoff 越界
    const badResult = validateToolArgs('pl001-test-tool', schema, {
      padj_cutoff: -0.5,
      lfc_cutoff: 1.0,
    });
    assert.equal(badResult.ok, false);
    assert.equal(badResult.errors[0].path, '<root>.padj_cutoff');
    assert.match(badResult.errors[0].message, /value -0\.5 < minimum 0/);

    // 6. 非法 args: enum 错值
    const badEnum = validateToolArgs('pl001-test-tool', schema, {
      padj_cutoff: 0.05,
      lfc_cutoff: 1.0,
      method: 'bayes',
    });
    assert.equal(badEnum.ok, false);
    assert.equal(badEnum.errors[0].path, '<root>.method');

    // 7. 完全错误: args 不是 object
    const notObject = validateToolArgs('pl001-test-tool', schema, 'string-not-object');
    assert.equal(notObject.ok, false);
    assert.equal(notObject.errors[0].path, '<root>');
    assert.match(notObject.errors[0].message, /expected arguments to be an object/);

    // 8. 不存在的 plugin
    const missing = pluginLoader.getInputSchema('nonexistent_tool');
    assert.equal(missing, null);
  } finally {
    globalThis._biof3Plugins = previousMap || new Map();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // 清理失败时吞掉
    }
  }
});
