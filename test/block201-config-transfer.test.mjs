/**
 * BLOCK-201 W2 — 设置全景导出/导入/按区重置契约测（隔离 data dir，零网络零渲染）。
 *
 * 钉住的红线：
 *  · 导出=用户覆盖层（不含默认值、不含 env 生效值、不含凭据）；
 *  · 导入=先全量校验后落盘（任一错误零写入），往返幂等；
 *  · 重置=只清覆盖层回落默认，不删用户数据；
 *  · env 遮蔽在导出里点名（否则「导入后不生效」无从解释）。
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

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'b201-transfer-'));
process.env.PETRI_LOCAL_DATA_DIR = sandbox;
process.env.PETRI_DECISION_CONFIG_PATH = path.join(sandbox, 'decision-config.json');

const transfer = require(path.join(ROOT, 'core/petri-server/helpers/config-transfer.js'));
const flags = require(path.join(ROOT, 'core/petri-server/helpers/feature-flags.js'));
const keymap = require(path.join(ROOT, 'core/petri-server/helpers/keymap.js'));
const aiSettings = require(path.join(ROOT, 'core/petri-server/helpers/ai-settings.js'));
const reasoning = require(path.join(ROOT, 'core/petri-server/helpers/reasoning-config.js'));

test.after(() => {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
});

test.beforeEach(() => {
  fs.rmSync(path.join(sandbox, 'feature-flags.json'), { force: true });
  fs.rmSync(path.join(sandbox, 'keymap.json'), { force: true });
  fs.rmSync(path.join(sandbox, 'decision-config.json'), { force: true });
  fs.rmSync(path.join(sandbox, 'ai-settings.json'), { force: true });
  fs.rmSync(path.join(sandbox, 'network.json'), { force: true });
  fs.rmSync(path.join(sandbox, 'runtime-policy.json'), { force: true });
});

test('导出信封：版本化 + 八族齐 + 显式排除清单（不漏族也不假装全覆盖）', () => {
  const envelope = transfer.exportConfig({ env: {} });
  assert.equal(envelope.format, 'petri-config');
  assert.equal(envelope.version, 1);
  assert.deepEqual(Object.keys(envelope.families).sort(), [...transfer.CONFIG_TRANSFER_FAMILIES].sort());
  assert.ok(Array.isArray(envelope.excludes) && envelope.excludes.length >= 4);
  assert.ok(envelope.excludes.some((row) => row.what === 'credentials'));
  assert.ok(Array.isArray(envelope.envShadowed));
});

test('导出=覆盖层：api-settings 里的名称再像凭据也不会被带出去（D-2）', () => {
  fs.writeFileSync(
    aiSettings.SETTINGS_FILE,
    JSON.stringify({
      apiKey: 'sk-SECRET-SHOULD-NOT-LEAK',
      credential_updates: { 'profile-1': 'sk-ALSO-SECRET' },
      generation: { temperature: 0.5 },
      costCapCny: 12.5,
      reasoning: { defaultLevel: 'high' },
    }),
  );
  const serialized = JSON.stringify(transfer.exportConfig({ env: {} }));
  assert.ok(!serialized.includes('sk-SECRET-SHOULD-NOT-LEAK'));
  assert.ok(!serialized.includes('sk-ALSO-SECRET'));
  assert.equal(JSON.parse(serialized).families.generation.temperature, 0.5);
});

test('导入往返幂等：导出 → 导入 → 再导出，覆盖层逐字节等价', () => {
  flags.setFlag('session_compaction', false);
  keymap.setKeymapBindings({ 'nav-home': 'Mod+Shift+H' });
  aiSettings.saveGenerationDefaults({ temperature: 0.7 });
  reasoning.saveReasoning({ defaultLevel: 'high' });

  const before = transfer.exportConfig({ env: {} }).families;
  const replay = transfer.importConfig({ format: 'petri-config', version: 1, families: before });
  assert.equal(replay.ok, true, JSON.stringify(replay.diagnostics));
  const after = transfer.exportConfig({ env: {} }).families;
  assert.deepEqual(after, before, '导入后再导出必须与导入前逐字段相同');
  // 再导一次仍等价（幂等不是「第一次恰好」）
  assert.equal(transfer.importConfig({ format: 'petri-config', version: 1, families: before }).ok, true);
  assert.deepEqual(transfer.exportConfig({ env: {} }).families, before);
});

test('导入拒绝未知键且零写入（fail-closed，不静默丢）', () => {
  aiSettings.saveGenerationDefaults({ temperature: 0.4 });
  const result = transfer.importConfig({
    format: 'petri-config',
    version: 1,
    families: { generation: { temperature: 1.2, nope: 1 } },
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.path === 'nope' && d.code === 'unknown-key'));
  assert.ok(result.applied.length === 0);
  assert.equal(transfer.exportConfig({ env: {} }).families.generation.temperature, 0.4, '校验失败不得有任何写入');
});

test('导入拒绝未知族 / 错版本 / 非 Petri 文件', () => {
  assert.equal(transfer.importConfig({ format: 'petri-config', version: 1, families: { nope: {} } }).ok, false);
  assert.equal(transfer.importConfig({ format: 'petri-config', version: 99, families: {} }).ok, false);
  assert.equal(transfer.importConfig({ hello: 1 }).ok, false);
});

test('导入拒绝非法值（数值越界/键位语法/未知决策接点）', () => {
  const outOfRange = transfer.importConfig({ format: 'petri-config', version: 1, families: { generation: { temperature: 9 } } });
  assert.equal(outOfRange.ok, false);
  assert.ok(outOfRange.diagnostics.some((d) => d.code === 'out-of-range'));

  const badCombo = transfer.importConfig({ format: 'petri-config', version: 1, families: { keymap: { bindings: { 'nav-home': 'K' } } } });
  assert.equal(badCombo.ok, false);

  const badPoint = transfer.importConfig({ format: 'petri-config', version: 1, families: { 'decision-points': { points: { 'not-a-point': { enabled: true } } } } });
  assert.equal(badPoint.ok, false);
  assert.ok(badPoint.diagnostics.some((d) => d.path === 'not-a-point'));
});

test('按区重置：只清覆盖层回落默认，清后导出为空覆盖', () => {
  flags.setFlag('agent_resilience', false);
  keymap.setKeymapBindings({ 'nav-home': 'Mod+Shift+H' });
  aiSettings.saveGenerationDefaults({ temperature: 0.9 });

  const result = transfer.resetConfigFamilies(['feature-flags', 'keymap', 'generation']);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(flags.resolveFlag('agent_resilience', {}), true, '开关回落默认 true');
  assert.deepEqual(keymap.readStore(), {});
  const families = transfer.exportConfig({ env: {} }).families;
  assert.deepEqual(families['feature-flags'].flags, {});
  assert.deepEqual(families.keymap.bindings, {});
  assert.deepEqual(families.generation, {});
});

test('按区重置拒绝未知族与空清单（不猜意图）', () => {
  assert.equal(transfer.resetConfigFamilies([]).ok, false);
  assert.equal(transfer.resetConfigFamilies(['nope']).ok, false);
});

test('env 遮蔽在导出里点名（导入后不生效的原因必须可见）', () => {
  aiSettings.saveGenerationDefaults({ temperature: 0.5 });
  const envelope = transfer.exportConfig({ env: { PETRI_LLM_TEMPERATURE: '1.5' } });
  const shadow = envelope.envShadowed.find((row) => row.family === 'generation' && row.path === 'temperature');
  assert.ok(shadow, 'env 覆盖必须出现在 envShadowed 里');
  assert.equal(shadow.envKey, 'PETRI_LLM_TEMPERATURE');
  assert.equal(shadow.overrides, true);
});
