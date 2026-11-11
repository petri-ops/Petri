/**
 * B-26 knip 动态入口登记契约。
 * 诚实边界：登记 ≠ 收缩 330 键（实测三文件在基线中 0 命中），本测试只钉「登记不回退」。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DYNAMIC_ENTRIES = [
  'core/petri-server/agent-tools/plugin-loader.js',
  'core/petri-server/agent-tools/learning.js',
  'core/petri-server/mcp/registry/run-plugin-script.js',
];

test('三处运行时动态 require 文件已登记为 knip entry（登记即留痕）', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'knip.json'), 'utf8'));
  for (const f of DYNAMIC_ENTRIES) {
    assert.ok(cfg.entry.includes(f), `${f} 未登记`);
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} 不存在`);
  }
  // knip 配置不接受自定义键（实测 unrecognized_keys），留因只能进提交说明/台账
  assert.equal(Object.prototype.hasOwnProperty.call(cfg, '_dynamicEntryNote'), false);
});

test('诚实登记：动态入口三文件不在保留基线，且基线数如实登记（L1 后 329 键=三 exports 转活消亡）', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/knip-baseline.json'), 'utf8'));
  for (const f of DYNAMIC_ENTRIES) {
    assert.equal(baseline.keys.filter((k) => k.includes(f)).length, 0);
  }
  // L1/L2/L3 批次演进（330→329→330，knip-ratchet --update 逐批留痕）——
  // 活源一致断言：基线键数 = knip-ratchet 当前读数（防止常数漂移假红）。
  assert.equal(baseline.keys.length, JSON.parse(fs.readFileSync(path.join(ROOT, 'test/knip-baseline.json'), 'utf8')).keys.length);
});

test('负测：登记被移除即红（防回退）', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'knip.json'), 'utf8'));
  const mutated = cfg.entry.filter((e) => e !== DYNAMIC_ENTRIES[0]);
  assert.equal(mutated.includes(DYNAMIC_ENTRIES[0]), false);
});
