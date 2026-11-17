import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, '..');
const { tool_skill_discover, tool_skill_get } = require('../core/petri-server/agent-tools/skill-tools.js');

test('C-52 P2 — design-brief 可被 agent 发现并读取手册', async () => {
  const discovered = await tool_skill_discover({ search: 'design-brief' });
  assert.equal(discovered.ok, true);
  assert.ok(discovered.skills.some((skill) => skill.id === 'design-brief'), JSON.stringify(discovered.skills));

  const read = await tool_skill_get({ id: 'design-brief' });
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.match(read.skill.prompts.system, /输出格式/);
  assert.match(read.skill.prompts.system, /pending_human_eye/);
});

test('C-52 P2 — design-brief prompt has ten sections and no implementation shortcut', () => {
  const prompt = readFileSync(resolve(ROOT, 'resources/skills/design-brief/prompts/system.md'), 'utf8');
  for (const heading of [
    '1. **目标与非目标**',
    '2. **规范锚点**',
    '3. **信息层级**',
    '4. **模块状态矩阵**',
    '5. **布局与响应式契约**',
    '6. **Token 与组件映射**',
    '7. **交互与键盘**',
    '8. **反例与排除项**',
    '9. **参考来源与许可**',
    '10. **验证计划**',
  ]) {
    assert.ok(prompt.includes(heading), `prompt missing ${heading}`);
  }
  assert.match(prompt, /先产出\*\*结构化设计说明\*\*，不要直接写实现代码/);
  assert.match(prompt, /零新增依赖/);
});

test('C-52 P2 — design-brief has no runtime dependency or forbidden replacement', () => {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, 'resources/skills/design-brief/skill.json'), 'utf8'));
  assert.deepEqual(manifest.plugins.required, []);
  assert.ok(!manifest.dependencies || !manifest.dependencies.requiresBins || manifest.dependencies.requiresBins.length === 0);
  const prompt = readFileSync(resolve(ROOT, 'resources/skills/design-brief/prompts/system.md'), 'utf8');
  assert.match(prompt, /不用外部 UI 框架替换 `SimpleChat`/);
});
