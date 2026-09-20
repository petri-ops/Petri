/**
 * BLOCK-60 加映三 — 自动计划模式触发（chat.js 意图识别纯函数）单测。
 * 触发逻辑从 chat.js 抽为可测纯函数 AUTO_PLAN_TRIGGER 的 tester。
 */
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 从 chat.js 源码中提取正则做同源测试（避免双写漂移）
const chatSrc = fs.readFileSync(
  path.join(repoRoot, 'core/biof3-server/routes/ai-agent/chat.js'), 'utf8'
);
const wantsPlanMatch = chatSrc.match(/const wantsPlan = (\/.+\/i)\.test\(text\);/);
const wantsExecMatch = chatSrc.match(/const wantsExecute = (\/.+\/i)\.test\(execProbe\);/);
const execProbeClean = (t) => t.replace(/(不要|别|先别)[^，。；,;\n]{0,6}(执行|跑|动手|开跑|做|开始)/g, '');
assert.ok(wantsPlanMatch && wantsExecMatch, 'trigger regexes must exist in chat.js');
const wantsPlan = eval(wantsPlanMatch[1]);
const wantsExecute = eval(wantsExecMatch[1]);
const clean = execProbeClean;
const decide = (text) => {
  const wantsPlanHit = wantsPlan.test(text);
  const wantsExecuteHit = wantsExecute.test(clean(text));
  return wantsPlanHit && !wantsExecuteHit;
};

test('计划意图触发自动计划模式', () => {
  for (const text of [
    '先别执行，给我个计划',
    '先出个方案再动手',
    '不要直接执行，先规划一下步骤',
    '只讨论思路，先做个计划',
    '先规划这次的差异分析怎么做',
  ]) {
    assert.equal(decide(text), true, `应触发: ${text}`);
  }
});

test('执行类短指令不触发', () => {
  for (const text of [
    '直接跑 deseq2',
    '开始执行吧',
    '马上执行这个分析',
    '直接执行 volcano-plot 重新出图',
  ]) {
    assert.equal(decide(text), false, `不应触发: ${text}`);
  }
});

test('普通对话与执行意图优先级：执行词压制计划词', () => {
  assert.equal(decide('先做个计划，然后直接执行'), false);
  assert.equal(decide('帮我看看这个数据的质量情况'), false);
});
