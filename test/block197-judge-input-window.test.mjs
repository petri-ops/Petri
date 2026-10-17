/**
 * BLOCK-197 加映 — judge 输入窗口必须可自证（离线·零网络）。
 *
 * 缘起：`output:judge` 送 2900 字符交付总结，两次读数 ESCALATE 且三条 goal 全判否；根因不是
 * 文案也不是 judge，而是 judge-core 把送判文本按内联魔数**静默裁剪**到 1500 字符——goal 要求
 * 核对的内容根本不在判卷窗口里。压进窗口后同一内容同一 goal → fit 3.36 PASS。
 *
 * 钉四件：①窗口常量是单源且已导出（调用方可自证完整性）；②裁剪确实按该常量发生（不是另一处
 * 数字）；③CLI 已接线告警（不告警=误导归因通道仍在）；④judge-core 里不再留内联魔数（防改常量
 * 不改用处的第二真相）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { JUDGE_INPUT_LIMITS, buildJudgeRequest } = require('../scripts/lib/harness/judge-core.mjs');

test('窗口常量单源已导出，四键齐', () => {
  assert.equal(typeof JUDGE_INPUT_LIMITS, 'object');
  for (const key of ['request', 'reference', 'output', 'goal']) {
    assert.equal(typeof JUDGE_INPUT_LIMITS[key], 'number', `${key} 缺窗口值`);
  }
  assert.equal(Object.isFrozen(JUDGE_INPUT_LIMITS), true, '窗口值不得在运行时被改');
});

test('超窗文本按常量裁剪，窗口外内容不进判卷（这就是 goal 失真的机制）', () => {
  const tail = 'TAIL_SENTINEL_窗口外';
  const output = `${'x'.repeat(JUDGE_INPUT_LIMITS.output)}${tail}`;
  const request = `${'r'.repeat(JUDGE_INPUT_LIMITS.request)}REQ_TAIL`;
  const req = buildJudgeRequest({ output, request, goals: ['g'] });
  assert.equal(req.state.includes(tail), false, '窗口外内容不应出现在判卷 state 里');
  assert.equal(req.state.includes('REQ_TAIL'), false, '请求窗口外内容同上');
  assert.equal(req.state.includes('x'.repeat(JUDGE_INPUT_LIMITS.output)), true, '窗口内前段必须在场');
});

test('goal 文本同样按窗口截断（长目标只取前段）', () => {
  const goal = 'G'.repeat(JUDGE_INPUT_LIMITS.goal + 40);
  const req = buildJudgeRequest({ output: 'o', request: 'r', goals: [goal] });
  const instructions = req.questions.goal_0.instructions;
  assert.equal(instructions.includes('G'.repeat(JUDGE_INPUT_LIMITS.goal + 1)), false);
  assert.ok(instructions.includes('G'.repeat(JUDGE_INPUT_LIMITS.goal)));
});

test('CLI 已接线超窗告警（不告警=误导归因通道仍在）', () => {
  const cli = fs.readFileSync(path.join(ROOT, 'scripts', 'block119-output-judge-run.mjs'), 'utf8');
  assert.ok(/JUDGE_INPUT_LIMITS/.test(cli), 'CLI 未引用窗口常量（还在猜数字或根本不告警）');
  assert.match(cli, /超出 judge 输入窗口/);
});

test('judge-core 不再留内联裁剪魔数（防改常量不改用处的第二真相）', () => {
  const core = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'helpers', 'judge-core.js'), 'utf8');
  for (const n of [800, 1200, 1500, 200]) {
    assert.equal(new RegExp(`slice\\(0, ${n}\\)`).test(core), false, `judge-core 仍有内联 slice(0, ${n})`);
  }
  assert.match(core, /slice\(0, JUDGE_INPUT_LIMITS\.output\)/);
});
