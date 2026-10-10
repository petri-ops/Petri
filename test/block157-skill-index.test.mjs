/**
 * BLOCK-157 W1 P2（KNW-2）— 渐进披露闭环：技能索引常驻注入。
 *
 * 钉住：buildSkillsIndexBlock 纯函数契约（空清单零注入 / ≤12 条 / 描述 ≤100 /
 * 整块 ≤2200 截断带标记 / 超列「另有 N 个未列出」诚实）；agent-runner 接线钉
 * （源码扫描：注入调用必须在场——防未来 prompt 链重构静默丢失本段，
 * 同 getRuntimeBinName 源码扫描守卫先例）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const skillTools = require(path.join(ROOT, 'core/biof3-server/agent-tools/skill-tools'));
const { buildSkillsIndexBlock } = skillTools;

function mkSkill(i, descLen = 40) {
  return {
    id: `skill-${i}`,
    name: `技能${i}`,
    version: '1.0.0',
    source: 'built-in',
    category: 'bioinformatics/x',
    tags: [],
    description: 'd'.repeat(descLen),
    capabilities: {},
    plugins: { required: [] },
    parameters: { required: {}, optional: {} },
  };
}

test('BLOCK-157 KNW-2 索引块：空清单零注入（null）', () => {
  assert.equal(buildSkillsIndexBlock([]), null);
  assert.equal(buildSkillsIndexBlock(null), null);
});

test('BLOCK-157 KNW-2 索引块：标准形态=表头+条目行+纪律行', () => {
  const block = buildSkillsIndexBlock([mkSkill(1), mkSkill(2)]);
  assert.match(block, /=== 可用技能/);
  assert.match(block, /- skill-1（bioinformatics\/x）：d+/);
  assert.match(block, /skill_get <id>/);
  assert.ok(!/未列出/.test(block), '≤12 条不得出现截断注记');
});

test('BLOCK-157 KNW-2 索引块：>12 条只列 12 + 「另有 N 个未列出」诚实注记', () => {
  const block = buildSkillsIndexBlock(Array.from({ length: 15 }, (_, i) => mkSkill(i)));
  const listed = block.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(listed.length, 12);
  assert.match(block, /另有 3 个未列出/);
});

test('BLOCK-157 KNW-2 索引块：描述截 100；整块 ≤2200 超界截断带标记', () => {
  const block = buildSkillsIndexBlock([mkSkill(1, 500)]);
  const line = block.split('\n').find((l) => l.startsWith('- skill-1'));
  assert.ok(line.length <= 160, `描述行应截断，实际 ${line.length}`);

  // 整块上限护栏：行内 id/category 无内联截断，靠整块 2200 兜底（超长 category 构造真实超界）
  const huge = buildSkillsIndexBlock(
    Array.from({ length: 12 }, (_, i) => ({ ...mkSkill(i), category: 'x'.repeat(300) }))
  );
  assert.ok(huge.length <= 2200 + 20, `整块应 ≤2200（+标记余量），实际 ${huge.length}`);
  assert.match(huge, /…\[truncated\]/);
});

test('BLOCK-157 KNW-2 接线钉：agent-runner 必须注入技能索引（源码扫描守卫）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/biof3-server/agent-runner.js'), 'utf8');
  assert.match(src, /buildSkillsIndexBlock/, 'agent-runner 应调用 buildSkillsIndexBlock（KNW-2 常驻注入）');
  assert.match(src, /tool_skill_discover/, 'agent-runner 应经 skill_discover 取索引数据');
});
