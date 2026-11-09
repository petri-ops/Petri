/**
 * POST-S7 H4/B-17 —— schema / 契约版本单源契约。
 *
 * 钉三件事：
 *   ① 四个消费模块导出的版本 === schema-versions 登记值（单边升版即红）；
 *   ② 六个原字面量点不再有独立字面量（源码扫描：出现 `= 1;` / `= '1.0.0';` 即红）；
 *   ③ intent 域版本**不被并进来**（BLOCK-379 澄清的双版本域，误并会破坏回放协议）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const versions = require(path.join(ROOT, 'core/shared-backend/schema-versions.js'));

test('四个消费模块导出的版本与 schema-versions 一致', () => {
  const truth = require(path.join(ROOT, 'core/petri-server/helpers/artifact-truth.js'));
  const studio = require(path.join(ROOT, 'core/shared-backend/result-studio-contracts.js'));
  const manifest = require(path.join(ROOT, 'core/shared-backend/delivery-manifest.js'));
  assert.equal(truth.ARTIFACT_TRUTH_VERSION, versions.ARTIFACT_TRUTH_VERSION);
  assert.equal(studio.RESULT_STUDIO_CONTRACT_VERSION, versions.RESULT_STUDIO_CONTRACT_VERSION);
  assert.equal(manifest.DELIVERY_MANIFEST_VERSION, versions.DELIVERY_MANIFEST_VERSION);
  assert.equal(versions.TOOL_CONTRACT_VERSION, '1.0.0');
});

test('六个原字面量点不再各自定义版本字面量', () => {
  const literalPoints = [
    ['core/petri-server/helpers/artifact-truth.js', /const ARTIFACT_TRUTH_VERSION = \d+;/],
    ['core/shared-backend/result-studio-contracts.js', /const RESULT_STUDIO_CONTRACT_VERSION = \d+;/],
    ['core/shared-backend/delivery-manifest.js', /const DELIVERY_MANIFEST_VERSION = \d+;/],
    ['core/petri-server/agent-tools/registry.js', /const CONTRACT_VERSION = '/],
    ['core/petri-server/agent-tools/tool-execution.js', /const TOOL_RESULT_CONTRACT_VERSION = '/],
    ['core/petri-server/agent-tools/plugin-loader.js', /const CONTRACT_VERSION = '/],
  ];
  for (const [rel, pattern] of literalPoints) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!pattern.test(text), `${rel} 仍有独立版本字面量——改为从 schema-versions 取`);
  }
});

test('intent 域版本保持独立（双版本域不被误并）', () => {
  const studio = require(path.join(ROOT, 'core/shared-backend/result-studio-contracts.js'));
  const intentIsNumber = typeof studio.RESULT_STUDIO_CONTRACT_VERSION === 'number';
  assert.equal(intentIsNumber, true, 'studio 契约版本是 number 形态');
  assert.equal(typeof versions.TOOL_CONTRACT_VERSION, 'string', 'tool 契约版本是 string 形态');
  // intent 域常量不在 schema-versions 里（误并会让回放协议形状漂移）
  assert.equal(Object.prototype.hasOwnProperty.call(versions, 'RESULT_EDIT_INTENT_VERSION'), false);
});
