/**
 * BLOCK-203 W4a P6 — `ai-settings.json` 顶层未知键收口契约测。
 *
 * 背景：`saveAiSettings` 是整坨 `{ ...prev, ...settings }` 合并，`normalizeAiSettings` 又只做
 * `{ ...settings }` 起手 —— 顶层未知键于是**永久存活**（BLOCK-199 §12 已登记"报告不拒"）。
 * 本片把语义改成**白名单过滤 + 诊断回传**（D-W4a-3：不 400，因为设置页整坨写入会把 GET 回来的
 * 键原样回传，400 会让有历史脏键的用户保存不了任何设置）。
 *
 * 钉四件事：
 *  ① 未知顶层键**不进盘**，且下一次写入把磁盘上的历史脏键**自愈掉**；
 *  ② 合法键（模型 profile 全家桶 + 注册表三个键袋）**一个都不能丢**——这是本片最大风险；
 *  ③ 白名单是**派生**的（normalize 输出形状 ∪ 注册表 store root ∪ 显式 legacy），不是手写清单；
 *  ④ `config:doctor` 能点名磁盘上已有的未知顶层键（否则"过滤"等于静默）。
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b203-ai-settings-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;

const aiSettings = require(path.join(ROOT, 'core/petri-server/helpers/ai-settings.js'));
const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));
const { buildReport } = await import(path.join(ROOT, 'scripts/block199-config-doctor.mjs'));

const FILE = path.join(tmpDir, 'ai-settings.json');
const readFile = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

test('BLOCK-203 P6 — 白名单是派生的：覆盖 normalize 输出形状 + 注册表键袋 + 显式 legacy', () => {
  const keys = aiSettings.AI_SETTINGS_TOP_LEVEL_KEYS;
  for (const root of ['generation', 'reasoning', 'costCapCny']) {
    assert.ok(keys.has(root), `注册表键袋 ${root} 必须在白名单里（否则保存即丢配置）`);
  }
  for (const key of ['chat_model_presets', 'model_profiles', 'active_chat_model_id', 'llm_provider']) {
    assert.ok(keys.has(key), `模型配置键 ${key} 必须在白名单里`);
  }
  assert.ok(keys.has('chat_provider'), '显式放行的 legacy 派生键不得被当成未知键');
  // 注册表加族时白名单自动跟上：ai-settings 上的 store root 全部在册
  const roots = Object.values(schema.CONFIG_FAMILIES)
    .map((family) => /^file:ai-settings\.json#(.+)$/.exec(family.store || ''))
    .filter(Boolean)
    .map((match) => match[1]);
  assert.deepEqual(roots.sort(), ['costCapCny', 'generation', 'reasoning']);
  for (const root of roots) assert.ok(keys.has(root));
});

test('BLOCK-203 P6 — 未知顶层键不进盘；返回诊断（不静默）', () => {
  fs.rmSync(FILE, { force: true });
  const result = aiSettings.saveAiSettings({ themeColorHack: 'x', generation: { temperature: 0.3 } });
  assert.ok(result && Array.isArray(result.dropped));
  assert.deepEqual(result.dropped.map((d) => d.path), ['themeColorHack']);
  assert.equal(readFile().themeColorHack, undefined, '未知顶层键不得写盘');
  assert.equal(readFile().generation.temperature, 0.3, '已知键照常写入');
});

test('BLOCK-203 P6 — 历史脏键自愈：下一次保存即清掉（读侧仍不炸）', () => {
  // 手工写入一份带历史脏键的文件（模拟旧版本/手改）
  fs.writeFileSync(FILE, JSON.stringify({
    version: 3,
    legacy_junk: { a: 1 },
    generation: { temperature: 0.5 },
  }, null, 2));
  const before = aiSettings.getAiSettings();
  assert.equal(before.legacy_junk.a, 1, '读侧宽容：脏键不炸（只是不被信任）');

  aiSettings.saveAiSettings({ generation: { temperature: 0.6 } });
  const after = readFile();
  assert.equal(after.legacy_junk, undefined, '写入即自愈');
  assert.equal(after.version, undefined, 'version 不是该文件的合法顶层键，一并清掉');
  assert.equal(after.generation.temperature, 0.6);
});

test('BLOCK-203 P6 — 合法键一个都不丢：模型 profile 全家桶 + 三个键袋往返', () => {
  fs.rmSync(FILE, { force: true });
  const payload = {
    chat_model_presets: [{ id: 'p1', label: 'P1', provider: 'deepseek', model: 'deepseek-chat' }],
    active_chat_model_id: 'p1',
    llm_provider: 'deepseek',
    chat_provider: 'deepseek',
    generation: { temperature: 0.4, maxTokens: 2048 },
    reasoning: { defaultLevel: 'high' },
    costCapCny: 12.5,
  };
  aiSettings.saveAiSettings(payload);
  const stored = readFile();
  for (const key of Object.keys(payload)) {
    assert.ok(stored[key] !== undefined, `合法键 ${key} 被误删——这是本片最危险的回归`);
  }
  assert.equal(stored.generation.temperature, 0.4);
  assert.equal(stored.reasoning.defaultLevel, 'high');
  assert.equal(stored.costCapCny, 12.5);
  assert.equal(stored.chat_model_presets[0].id, 'p1');
});

test('BLOCK-203 P6 — doctor 点名磁盘上的未知顶层键（过滤不静默）', () => {
  fs.writeFileSync(FILE, JSON.stringify({
    generation: { temperature: 0.5 },
    totally_made_up: 42,
  }, null, 2));
  const report = buildReport({
    readJson: (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
    env: { PETRI_LOCAL_DATA_DIR: tmpDir },
  });
  const hit = report.unknownKeys.find((d) => d.family === 'ai-settings-root' && d.path === 'totally_made_up');
  assert.ok(hit, `doctor 未点名未知顶层键：${JSON.stringify(report.unknownKeys)}`);
  assert.equal(hit.where, '(file root)');
  assert.ok(report.summary.unknownKeys >= 1);
  fs.rmSync(FILE, { force: true });
});
