/**
 * BLOCK-211（runlist W8 首批）— C-32 清偿契约测：`env='1'` 是**首载种子**，不是运行时强开。
 *
 * 真相表（唯一判据）：
 *   env='0' → 关（杀开关，永不违逆）
 *   文件有值  → 以文件为准（env='1' 不参与）
 *   文件无值 + env='1' → 开（种子）
 *   三者皆无 → 注册表默认
 *
 * 另钉：`envShadowedKeys` 不得把 seed 报成"遮蔽生效值"（否则 doctor 天天假警报）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b211-c32-'));
process.env.PETRI_LOCAL_DATA_DIR = dir;
process.env.PETRI_DECISION_CONFIG_PATH = path.join(dir, 'decision-config.json');

const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));
const dc = require(path.join(ROOT, 'core/petri-server/helpers/decision-config.js'));

function writePoints(points) {
  fs.writeFileSync(process.env.PETRI_DECISION_CONFIG_PATH, JSON.stringify({ version: 1, points }));
}

test.after(() => {
  delete process.env.PETRI_JEV_KNOWLEDGE_GUARD;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
});

test('C-32 — 真相表：env=0 杀 > 文件 > env=1 种子 > 默认', () => {
  // ① 文件显式关 + env=1 ⇒ 关（这就是"我关掉了但它还开着"的根治点）
  writePoints({ 'knowledge-guard': { enabled: false } });
  process.env.PETRI_JEV_KNOWLEDGE_GUARD = '1';
  assert.equal(dc.getPointRuntime('knowledge-guard').enabled, false);

  // ② 文件显式开 + env=1 ⇒ 开（一致，无争议）
  writePoints({ 'knowledge-guard': { enabled: true } });
  assert.equal(dc.getPointRuntime('knowledge-guard').enabled, true);

  // ③ 文件显式开 + env=0 ⇒ 关（杀开关最高）
  process.env.PETRI_JEV_KNOWLEDGE_GUARD = '0';
  assert.equal(dc.getPointRuntime('knowledge-guard').enabled, false);

  // ④ 无文件 + env=1 ⇒ 开（种子；dev 脚本靠它开接点的用法不破）
  fs.rmSync(process.env.PETRI_DECISION_CONFIG_PATH, { force: true });
  process.env.PETRI_JEV_KNOWLEDGE_GUARD = '1';
  assert.equal(dc.getPointRuntime('knowledge-guard').enabled, true);

  // ⑤ 无文件 + 无 env ⇒ 注册表默认（knowledge-guard 默认关；tool-route 独享 defaultOn）
  delete process.env.PETRI_JEV_KNOWLEDGE_GUARD;
  assert.equal(dc.getPointRuntime('knowledge-guard').enabled, false);
  assert.equal(dc.getPointRuntime('tool-route').enabled, true, 'tool-route 的 defaultOn 不受影响');
});

test('C-32 — envOverride 仍如实暴露（UI 提示不因语义修正而丢失）', () => {
  writePoints({ 'knowledge-guard': { enabled: false } });
  process.env.PETRI_JEV_KNOWLEDGE_GUARD = '1';
  assert.equal(dc.getPointRuntime('knowledge-guard').envOverride, 'on');
  process.env.PETRI_JEV_KNOWLEDGE_GUARD = '0';
  assert.equal(dc.getPointRuntime('knowledge-guard').envOverride, 'off');
  delete process.env.PETRI_JEV_KNOWLEDGE_GUARD;
});

test('C-32 — envShadowedKeys 不把 seed 报成遮蔽（否则 doctor 假警报）', () => {
  const lookup = (family, p) => schema.findEntryByPath(family, p);
  // env=1 + 文件 false：seed 不赢 ⇒ **不是**遮蔽
  assert.deepEqual(schema.envShadowedKeys('decision-points', { 'knowledge-guard.enabled': false }, { PETRI_JEV_KNOWLEDGE_GUARD: '1' }, lookup), []);
  // env=0 + 文件 true：杀开关真的盖住了 ⇒ 是遮蔽，且 overrides=true
  const shadowed = schema.envShadowedKeys('decision-points', { 'knowledge-guard.enabled': true }, { PETRI_JEV_KNOWLEDGE_GUARD: '0' }, lookup);
  assert.equal(shadowed.length, 1);
  assert.equal(shadowed[0].overrides, true);
});

test('C-32 — 族标记：decision-points 声明 envOneIsSeed，其他族不得误标', () => {
  assert.equal(schema.CONFIG_FAMILIES['decision-points'].envOneIsSeed, true);
  assert.equal(schema.CONFIG_FAMILIES['feature-flags'].envOneIsSeed, undefined, 'feature-flags 的 env=1 仍是真强制开');
});
