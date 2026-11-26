/**
 * 意图预设 + 自动参数 集成门（owner msg_b9d146535752）：getGenerationDefaults(context)
 * 在真实 ai-settings.json 上验证三层优先级链与「无 context 零行为变化」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MODULE = path.resolve('core/petri-server/helpers/ai-settings.js');

function run(script, settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-gen-intent-'));
  fs.writeFileSync(path.join(dir, 'ai-settings.json'), JSON.stringify(settings));
  const result = spawnSync(process.execPath, ['-e', `
    const s = require(${JSON.stringify(MODULE)});
    ${script}
  `], { encoding: 'utf8', env: { ...process.env, PETRI_LOCAL_DATA_DIR: dir }, timeout: 20000 });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('集成：无 context 的既有调用走原路径（temperature 保留、无 source 字段）', () => {
  const out = run(
    'console.log(JSON.stringify(s.getGenerationDefaults()))',
    { generation: { temperature: 0.7 } },
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.temperature, 0.7);
  assert.equal(parsed.source, undefined);
});

test('集成：context 启用自动档——创作关键词落 0.8（无裸值）', () => {
  const out = run(
    'console.log(JSON.stringify(s.getGenerationDefaults({ userText: "写一个有创意的故事开头", taskKind: "primary" })))',
    {},
  );
  assert.deepEqual(JSON.parse(out), { temperature: 0.8, source: 'auto' });
});

test('集成：旧 generation 裸值优先于自动档（今天行为零突变）', () => {
  const out = run(
    'console.log(JSON.stringify(s.getGenerationDefaults({ userText: "写一个有创意的故事" })))',
    { generation: { temperature: 0.7, maxTokens: 222 } },
  );
  assert.deepEqual(JSON.parse(out), { temperature: 0.7, maxTokens: 222, source: 'legacy_generation' });
});

test('集成：env 后门已死——即使环境有 PETRI_LLM_TEMPERATURE 也被忽略（终裁 msg_b8392b7ee460）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-gen-intent-env-'));
  fs.writeFileSync(path.join(dir, 'ai-settings.json'), JSON.stringify({ generation: { temperature: 0.7 } }));
  const result = spawnSync(process.execPath, ['-e', `
    const s = require(${JSON.stringify(MODULE)});
    console.log(JSON.stringify(s.getGenerationDefaults({ userText: '写一个创意故事' })));
  `], { encoding: 'utf8', env: { ...process.env, PETRI_LOCAL_DATA_DIR: dir, PETRI_LLM_TEMPERATURE: '1.3' }, timeout: 20000 });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { temperature: 0.7, source: 'legacy_generation' });
});

test('集成：intentPreset 覆盖优先于自动判定（用户选意图）', () => {
  const out = run(
    'console.log(JSON.stringify(s.getGenerationDefaults({ userText: "你好" })))',
    { generation: { intentPreset: 'creative' } },
  );
  assert.deepEqual(JSON.parse(out), { temperature: 0.8, source: 'intent_override' });
});
