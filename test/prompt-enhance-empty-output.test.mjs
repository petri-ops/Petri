/**
 * 缺陷修复（owner msg_b9a2833502db）：prompt-enhance model_output_empty 持续失败。
 * 实机 transcript 根因：deepseek-flash 推理模型 content='' + reasoningContent 非空 +
 * finishReason='length' + completion_tokens=32 全 reasoning → 推理吃光 quick 预算（240）。
 * HK-01：①预算下限足够推理模型产出正文；②空正文但 reasoning 在场时不把推理当答案误用。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const spec = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/task-spec.js'), 'utf8');

function fnBody(name) {
  const at = spec.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `缺函数 ${name}`);
  return spec.slice(at, spec.indexOf('\n}', at));
}

test('HK-01-1：quick 输出预算下限 ≥1024（推理模型思考后仍有正文空间）', () => {
  const body = fnBody('quickOutputBudget');
  const match = body.match(/return Math\.max\(\s*(\d+)/);
  assert.ok(match, '预算下限应显式声明');
  assert.ok(Number(match[1]) >= 1024, `下限 ${match[1]} 太小，推理型模型会吃光预算`);
});

test('HK-01-2：空 content 时不得把 reasoning 字段当正文误用（思考≠答案）', () => {
  const body = fnBody('optimizePromptQuick');
  assert.doesNotMatch(body, /reasoning_content[\s\S]{0,120}optimizedPrompt/);
  assert.match(body, /model_output_empty/);
});

test('HK-01-3：与 generation-intent 新链无耦合（本路径不读 generationDefaults）', () => {
  assert.doesNotMatch(spec, /generationDefaults|getGenerationDefaults|resolveGenerationParams/);
});
