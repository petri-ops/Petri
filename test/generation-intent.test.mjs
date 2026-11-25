/**
 * 意图预设 + 任务感知自动参数 HK-01（owner 授权 msg_b9d146535752，推荐 A）。
 * 红线：策展常量表、agent 不可自写参数、优先级 env>意图覆盖>旧 generation 兼容>自动档、
 * 判定失败落平衡 0.4（今天行为零突变）、旧 generation 键兼容读取、底层 provider 链零改。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS,
  detectIntentPreset,
  resolveGenerationParams,
} from '../core/petri-server/helpers/generation-intent.js';

test('HK-01-1：策展四档有界常量（精准0.2/平衡0.4/创作0.8/长文预算自适应）', () => {
  assert.equal(PRESETS.precise.temperature, 0.2);
  assert.equal(PRESETS.balanced.temperature, 0.4);
  assert.equal(PRESETS.creative.temperature, 0.8);
  assert.equal(PRESETS.longform.temperature, 0.4);
  assert.equal(PRESETS.longform.maxTokens, 'adaptive');
  for (const p of Object.values(PRESETS)) {
    assert.ok(typeof p.temperature === 'number' && p.temperature >= 0 && p.temperature <= 2);
  }
});

test('HK-01-2：本地规则分层判定（关键词白名单+taskKind+工具动作），判定失败落平衡', () => {
  assert.equal(detectIntentPreset({ userText: '写一段精确的代码走查，逐条指出问题' }).preset, 'precise');
  assert.equal(detectIntentPreset({ userText: '写一个有创意的故事开头' }).preset, 'creative');
  assert.equal(detectIntentPreset({ userText: '生成一篇长文报告，完整展开所有章节' }).preset, 'longform');
  assert.equal(detectIntentPreset({ userText: '你好' }).preset, 'balanced');
  assert.equal(detectIntentPreset({}).preset, 'balanced');
});

test('HK-01-3：优先级链 env > 意图覆盖 > 旧 generation 裸值 > 自动档', () => {
  const env = { PETRI_LLM_TEMPERATURE: '1.1', PETRI_LLM_MAX_TOKENS: '999' };
  // env 最高
  assert.deepEqual(resolveGenerationParams({ env, intentPreset: 'creative', generation: { temperature: 0.2 }, detected: 'precise' }), { temperature: 1.1, maxTokens: 999, source: 'env' });
  // 意图覆盖（用户选意图）
  assert.deepEqual(resolveGenerationParams({ env: {}, intentPreset: 'creative', generation: {}, detected: 'precise' }), { temperature: 0.8, maxTokens: undefined, source: 'intent_override' });
  // 旧裸值兼容（今天行为零突变）
  assert.deepEqual(resolveGenerationParams({ env: {}, intentPreset: '', generation: { temperature: 0.7, maxTokens: 222 }, detected: 'creative' }), { temperature: 0.7, maxTokens: 222, source: 'legacy_generation' });
  // 自动档（默认，判定落平衡）
  assert.deepEqual(resolveGenerationParams({ env: {}, intentPreset: '', generation: {}, detected: 'balanced' }), { temperature: 0.4, maxTokens: undefined, source: 'auto' });
});

test('HK-01-4：自动档判定失败/未知档一律落平衡（零意外），不读 agent 自报参数', () => {
  const r = resolveGenerationParams({ env: {}, intentPreset: '', generation: {}, detected: 'unknown_from_agent' });
  assert.equal(r.temperature, 0.4);
  assert.equal(r.source, 'auto');
  // agent 自报的温度字段被忽略（红线：不可自写参数）
  const r2 = resolveGenerationParams({ env: {}, intentPreset: '', generation: {}, detected: 'balanced', agentDeclared: { temperature: 2 } });
  assert.equal(r2.temperature, 0.4);
});

test('HK-01-5：长文预设只给预算信号，自适应公式由 loop 既有 resolveOutputBudget 承接', () => {
  const r = resolveGenerationParams({ env: {}, intentPreset: '', generation: {}, detected: 'longform' });
  assert.equal(r.temperature, 0.4);
  assert.equal(r.maxTokens, 'adaptive');
  assert.equal(r.source, 'auto');
});
