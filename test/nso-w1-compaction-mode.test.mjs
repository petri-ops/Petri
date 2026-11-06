/**
 * nso-w1-compaction-mode.test.mjs — BLOCK-365（NSO-W1 F-03）compaction 模式单源。
 *
 * 缺口（评估 F-03）：conversation-compaction 的 `resilienceOn = !b2 && isResilienceEnabled(env)`
 * 使 resilience 语义被 B2 开关屏蔽（B2 开 → resilience 阈值公式与 9 章节摘要不可达，尽管其开关
 * 也是开的）；阈值公式/摘要模板/12K legacy 三套语义散落。契约：resolveCompactionMode(env) 单源
 * 返回 { mode, thresholdResolver }，四种组合逐一钉死；resilience 不再被 B2 屏蔽。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveCompactionMode } = require('../core/petri-server/helpers/conversation-compaction.js');

const on = (env = {}) => (key) => {
  if (key === 'session_compaction') return env.session_compaction !== false;
  if (key === 'agent_resilience') return env.agent_resilience !== false;
  return false;
};

test('W1-F03 四组合矩阵：默认双开 → resilience（阈值公式优先）', () => {
  const mode = resolveCompactionMode({}, on({}));
  assert.equal(mode.mode, 'resilience');
  assert.equal(typeof mode.thresholdResolver, 'function');
});

test('W1-F03 resilience 开、B2 关 → resilience 不再被 B2 屏蔽（旧实现判 legacy）', () => {
  const mode = resolveCompactionMode({}, on({ session_compaction: false }));
  assert.equal(mode.mode, 'resilience');
});

test('W1-F03 B2 开、resilience 关 → legacy（12K 阈值，逐字节不变）', () => {
  const mode = resolveCompactionMode({}, on({ agent_resilience: false }));
  assert.equal(mode.mode, 'legacy');
  assert.equal(mode.thresholdResolver, null);
});

test('W1-F03 双关 → disabled（不压缩）', () => {
  const mode = resolveCompactionMode({ session_compaction: false }, on({ session_compaction: false, agent_resilience: false }));
  assert.equal(mode.mode, 'disabled');
});
