import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, '..');
const { tool_skill_discover, tool_skill_get } = require('../core/petri-server/agent-tools/skill-tools.js');

test('C-56 注册面 — paper-writing 可被发现并读取手册', async () => {
  const discovered = await tool_skill_discover({ search: 'paper-writing' });
  assert.equal(discovered.ok, true);
  assert.ok(discovered.skills.some((skill) => skill.id === 'paper-writing'), JSON.stringify(discovered.skills));

  const read = await tool_skill_get({ id: 'paper-writing' });
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.skill.prompts.system, 'prompts/system.md');
  const prompt = readFileSync(resolve(ROOT, 'resources/skills/paper-writing/prompts/system.md'), 'utf8');
  assert.match(prompt, /确定程度保护/);
  assert.match(prompt, /归因保护/);
  assert.match(prompt, /完成状态保护/);
  assert.match(prompt, /数字锁定/);
});

test('C-56 注册面 — system prompt 保留十节与四条保真纪律', () => {
  const prompt = readFileSync(resolve(ROOT, 'resources/skills/paper-writing/prompts/system.md'), 'utf8');
  for (const heading of [
    '## 1. 适用与触发',
    '## 2. 事实保真内核（四保护）',
    '## 3. 不编造红线',
    '## 4. 方法/结果段锁定',
    '## 5. 中文 F 类六项检查',
    '## 6. claim 保真对照',
    '## 7. provenance 与未覆盖说明',
    '## 8. 人机边界',
    '## 9. 执行流程',
    '## 10. 反模式',
  ]) {
    assert.ok(prompt.includes(heading), `prompt missing ${heading}`);
  }
  for (const f of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']) {
    assert.ok(prompt.includes(f), `prompt missing ${f}`);
  }
  assert.match(prompt, /逐字符/);
  assert.match(prompt, /原句 → 改写句 → 保真说明/);
  assert.match(prompt, /〈未覆盖：/);
  assert.match(prompt, /英文论文覆盖另批/);
});

test('C-56 注册面 — 零运行时依赖且 manifest 双向一致', () => {
  const skill = JSON.parse(readFileSync(resolve(ROOT, 'resources/skills/paper-writing/skill.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'resources/skills/manifest.json'), 'utf8'));
  assert.equal(skill.id, 'paper-writing');
  assert.deepEqual(skill.plugins.required, []);
  assert.ok(!skill.dependencies || !skill.dependencies.requiresBins || skill.dependencies.requiresBins.length === 0);
  assert.equal(manifest.skills['paper-writing']?.version, skill.version);
});
