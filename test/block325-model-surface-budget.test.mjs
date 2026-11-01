/**
 * BLOCK-325 — model-surface 尺寸预算契约（红绿先行；dsh model-surface.spec 同型）。
 *
 * 钉住：
 * - 预算棘轮：实测模型可见面 ⊆ 基线（systemPromptChars/toolDefsCount/toolDefsChars/perTool
 *   任一增长即红）；compareAgainstBaseline 对合成增长逐项点名；
 * - shrinkBaseline 只许收缩/新增（增长拒绝写入语义由脚本 --update 复用同一比较器保证）；
 * - 退役词扫描：核心系统提示（确定性三页拼回）+ 工具定义 JSON 不含域中性迁移退役词
 *   （pack 注入内容不在扫描面——合法域扩展通道）。
 * 运行形态：自带 DB 自举（临时库+migrations，同 block244 姿势），零 dev 栈依赖。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  measureModelSurface,
  compareAgainstBaseline,
  shrinkBaseline,
  RETIRED_TERMS,
  BASELINE_PATH,
} from '../scripts/model-surface-baseline.mjs';
import fs from 'node:fs';

test('BLOCK-325 预算棘轮：实测面 ⊆ 已提交基线（任一增长即红）', () => {
  const current = measureModelSurface();
  assert.ok(fs.existsSync(BASELINE_PATH), '基线文件应已提交（test/model-surface-baselines.json）');
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const violations = compareAgainstBaseline(current, baseline);
  assert.deepEqual(violations, [], `模型可见面超出基线（prompt/工具定义通胀是 CI 红线）：\n  ${violations.join('\n  ')}`);
  assert.ok(baseline.toolDefsCount >= 100, `工具数基线=${baseline.toolDefsCount}（104±，防工具面静默萎缩/膨胀）`);
});

test('BLOCK-325 compareAgainstBaseline：合成增长逐项点名，收缩不报', () => {
  const baseline = { systemPromptChars: 940, toolDefsCount: 104, toolDefsChars: 56000, perToolChars: { plan: 2586 } };
  const grown = {
    systemPromptChars: 1000, toolDefsCount: 105, toolDefsChars: 56100,
    perToolChars: { plan: 2600, new_tool: 800 },
  };
  const violations = compareAgainstBaseline(grown, baseline);
  assert.equal(violations.length, 4, JSON.stringify(violations));
  assert.ok(violations.some((v) => v.includes('systemPromptChars: 1000 > 940')));
  assert.ok(violations.some((v) => v.includes('toolDefsCount: 105 > 104')));
  assert.ok(violations.some((v) => v.includes('toolDefsChars: 56100 > 56000')));
  assert.ok(violations.some((v) => v.includes('perTool[plan]: 2600 > 2586')));
  // 收缩/新增指标（基线缺项）不算增长
  const shrunk = { systemPromptChars: 900, toolDefsCount: 104, toolDefsChars: 55900, perToolChars: { plan: 2500 } };
  assert.deepEqual(compareAgainstBaseline(shrunk, baseline), []);
});

test('BLOCK-325 shrinkBaseline：只许收缩与新指标，绝不写大', () => {
  const previous = { systemPromptChars: 940, toolDefsCount: 104, toolDefsChars: 56000, perToolChars: { plan: 2586 } };
  const grown = { systemPromptChars: 1000, toolDefsCount: 105, toolDefsChars: 56100, perToolChars: { plan: 2600, new_tool: 800 } };
  const next = shrinkBaseline(grown, previous);
  assert.equal(next.systemPromptChars, 940, '增长被拒：维持基线');
  assert.equal(next.toolDefsCount, 104);
  assert.equal(next.perToolChars.plan, 2586);
  assert.equal(next.perToolChars.new_tool, 800, '新指标如实入册');
  // 收缩语义
  const shrunk = shrinkBaseline({ systemPromptChars: 900, toolDefsCount: 104, toolDefsChars: 55000, perToolChars: { plan: 2400 } }, previous);
  assert.equal(shrunk.systemPromptChars, 900);
  assert.equal(shrunk.perToolChars.plan, 2400);
});

test('BLOCK-325 退役词扫描：核心系统提示 + 工具定义 JSON 不含域中性退役词', () => {
  const surface = measureModelSurface();
  const text = `${surface._scanText.systemPrompt}\n${surface._scanText.toolDefsJson}`;
  const hits = [];
  for (const term of RETIRED_TERMS) {
    if (text.toLowerCase().includes(term.toLowerCase())) hits.push(term);
  }
  assert.deepEqual(hits, [], `核心模型可见面出现退役词（应走 pack 注入通道，不进核心提示/工具定义）：${hits.join(', ')}`);
  assert.ok(surface._scanText.systemPrompt.length > 500, '扫描面非空（防止扫描器静默空转）');
});
