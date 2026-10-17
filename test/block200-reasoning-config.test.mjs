/**
 * BLOCK-200 P2 — 推理档位配置面契约测（离线·零网络·不落真实数据目录）。
 *
 * 两条腿缺一不可：
 *  · **写侧拒绝**：跨协议错配（给 openai 配 `thinking:enabled`）、未知协议、非法档位、
 *    预算越界——写进去就是一个上游 400，所以必须拒并带结构化诊断；
 *  · **出站腿**：配置改了必须真的改变 `thinkingParamsFor` 的出参形状。
 *    这条腿是刻意打的——该链路有既往缺陷记录「composer 显示高、请求体发 standard、
 *    上游收不到 reasoning_effort」（`useChatStream.ts:359-363` 注释），只测设置面状态=没测。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-reasoning-'));
process.env.PETRI_LOCAL_DATA_DIR = tmp;

const reasoningConfig = require('../core/petri-server/helpers/reasoning-config.js');
const thinking = require('../core/shared-backend/llm-providers/thinking-level.js');
const CAPS = ['reasoning'];

function clearSection() {
  const file = path.join(tmp, 'ai-settings.json');
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete raw.reasoning;
    fs.writeFileSync(file, JSON.stringify(raw));
  }
  reasoningConfig.getReasoningRuntime();
}

test('空设置=出厂值逐字不变（默认档 standard、预算 16000、映射表原样）', () => {
  clearSection();
  const snapshot = reasoningConfig.getReasoningSnapshot();
  assert.equal(snapshot.effective.defaultLevel, 'standard');
  assert.equal(snapshot.factory.defaultLevel, 'standard');
  assert.equal(snapshot.effective.anthropicHighBudgetTokens, 16000);
  assert.deepEqual(snapshot.levels, ['off', 'standard', 'high']);
  assert.equal(snapshot.protocols['openai-compatible'].tiers.high.effective, 'reasoning_effort:high');
  assert.deepEqual(thinking.thinkingParamsFor({ protocol: 'openai-compatible', capabilities: CAPS }), {}, '未指定档位且默认 standard → 不发参');
});

test('出站腿①：默认档设为 high 后，未带档位的请求确实发出 reasoning_effort', () => {
  clearSection();
  reasoningConfig.saveReasoning({ defaultLevel: 'high' });
  assert.deepEqual(thinking.thinkingParamsFor({ protocol: 'openai-compatible', capabilities: CAPS }), { reasoning_effort: 'high' });
  assert.deepEqual(thinking.thinkingParamsFor({ level: 'off', protocol: 'openai-compatible', capabilities: CAPS }), { reasoning_effort: 'minimal' }, '显式档位仍优先于配置默认档');
});

test('出站腿②：Anthropic 预算改动确实进 thinking.budget_tokens', () => {
  clearSection();
  reasoningConfig.saveReasoning({ anthropicHighBudgetTokens: 24000 });
  assert.deepEqual(
    thinking.thinkingParamsFor({ level: 'high', protocol: 'anthropic-messages', capabilities: CAPS }),
    { thinking: { type: 'enabled', budget_tokens: 24000 } },
  );
});

test('出站腿③：映射可编辑，且只在该协议允许集合内', () => {
  clearSection();
  reasoningConfig.saveReasoning({ mapping: { 'openai-compatible': { high: 'reasoning_effort:medium' } } });
  assert.deepEqual(thinking.thinkingParamsFor({ level: 'high', protocol: 'openai-compatible', capabilities: CAPS }), { reasoning_effort: 'medium' });
  assert.deepEqual(thinking.thinkingParamsFor({ level: 'off', protocol: 'openai-compatible', capabilities: CAPS }), { reasoning_effort: 'minimal' }, '未覆盖的档位仍走出厂映射');
});

test('把某档设为 none=该协议该档不发任何参数（诚实表达"不表态"）', () => {
  clearSection();
  reasoningConfig.saveReasoning({ mapping: { 'dashscope-native': { high: 'none' } } });
  assert.deepEqual(thinking.thinkingParamsFor({ level: 'high', protocol: 'dashscope-native', capabilities: CAPS }), {});
});

test('写侧拒：跨协议错配 / 未知协议 / 未知档位 / 非法默认档 / 预算越界', () => {
  clearSection();
  const cases = [
    [{ mapping: { 'openai-compatible': { high: 'thinking:enabled' } } }, 'not-allowed'],
    [{ mapping: { 'mystery-protocol': { high: 'reasoning_effort:high' } } }, 'unknown-key'],
    [{ mapping: { 'openai-compatible': { maximum: 'reasoning_effort:high' } } }, 'not-allowed'],
    [{ defaultLevel: 'maximum' }, 'not-allowed'],
    [{ anthropicHighBudgetTokens: 512 }, 'out-of-range'],
    [{ anthropicHighBudgetTokens: 'lots' }, 'type-mismatch'],
    [{ 'not-a-reasoning-key': 1 }, 'unknown-key'],
  ];
  for (const [patch, expectedCode] of cases) {
    assert.throws(() => reasoningConfig.saveReasoning(patch), (err) => {
      assert.equal(err.code, 'config_value_rejected', JSON.stringify(patch));
      assert.equal(err.diagnostics[0].code, expectedCode, `${JSON.stringify(patch)} → ${JSON.stringify(err.diagnostics)}`);
      return true;
    }, `应拒：${JSON.stringify(patch)}`);
  }
  // 整批不落盘：上面全拒，出厂行为必须原样
  assert.equal(reasoningConfig.getReasoningSnapshot().effective.anthropicHighBudgetTokens, 16000);
  assert.deepEqual(thinking.thinkingParamsFor({ level: 'high', protocol: 'anthropic-messages', capabilities: CAPS }), { thinking: { type: 'enabled', budget_tokens: 16000 } });
});

test('null 清键：删掉覆盖后回到出厂值', () => {
  clearSection();
  reasoningConfig.saveReasoning({ defaultLevel: 'high', anthropicHighBudgetTokens: 40000 });
  assert.equal(reasoningConfig.getReasoningSnapshot().effective.defaultLevel, 'high');
  reasoningConfig.saveReasoning({ defaultLevel: null, anthropicHighBudgetTokens: null });
  const snapshot = reasoningConfig.getReasoningSnapshot();
  assert.equal(snapshot.effective.defaultLevel, 'standard');
  assert.equal(snapshot.effective.anthropicHighBudgetTokens, 16000);
});

test('读侧宽松：盘上已被写坏的值只报告并回落默认，不炸、不静默采纳', () => {
  clearSection();
  const file = path.join(tmp, 'ai-settings.json');
  const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  raw.reasoning = { defaultLevel: 'ultra', anthropicHighBudgetTokens: 7, mapping: { 'openai-compatible': { high: 'thinking:enabled' }, 'ghost-protocol': { high: 'reasoning_effort:high' } } };
  fs.writeFileSync(file, JSON.stringify(raw));
  const effective = reasoningConfig.effectiveReasoning();
  assert.equal(effective.defaultLevel, 'standard');
  assert.equal(effective.anthropicHighBudgetTokens, 16000);
  assert.equal(effective.mapping['openai-compatible'].high, 'reasoning_effort:high', '非法令牌不得生效');
  const codes = reasoningConfig.diagnoseStoredReasoning().map((d) => d.code);
  assert.ok(codes.includes('not-allowed'), JSON.stringify(codes));
  assert.ok(codes.includes('out-of-range'), JSON.stringify(codes));
  assert.ok(codes.includes('unknown-key'), JSON.stringify(codes));
});

test('覆盖层是进程内单点：resetThinkingOverrides 后行为回到出厂（测试可复位）', () => {
  clearSection();
  reasoningConfig.saveReasoning({ defaultLevel: 'high' });
  thinking.resetThinkingOverrides();
  assert.deepEqual(thinking.thinkingParamsFor({ protocol: 'openai-compatible', capabilities: CAPS }), {}, '复位后不再受注入影响');
  reasoningConfig.getReasoningRuntime();
  assert.deepEqual(thinking.thinkingParamsFor({ protocol: 'openai-compatible', capabilities: CAPS }), { reasoning_effort: 'high' });
});
