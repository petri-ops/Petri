/**
 * BLOCK-157 W1 P1（KNW-1）— 产品 Skills 会话台可见性契约测试。
 *
 * 钉住：skill_discover / skill_get 进 agent-tools 静态注册表（76→78）；
 * 契约 = retrieval/none/R0（全档可用，read/plan 档 policy allow）；
 * discover 真实内置技能可发现（含 coding-playbook）+ source/category/search 过滤；
 * get 完整手册可读（含 prompts）+ 未知 id 诚实报错；输出有界（清单 ≤ 上限、
 * prompt 截断带标记）。红绿先行：先红（工具不存在）后实现转绿。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b157-skill-vis-'));
process.env.BIOF3_LOCAL_DATA_DIR = tmpDir;

// registry 全图自举临时 DB（与 mcp-projection.test.mjs 同一修法）
{
  const Database = require(path.join(ROOT, 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(path.join(tmpDir, 'biof3.db'));
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = path.join(tmpDir, 'biof3.db');
}

const { TOOL_DEFS } = require(path.join(ROOT, 'core/biof3-server/agent-tools/tool-defs'));
const registry = require(path.join(ROOT, 'core/biof3-server/agent-tools/registry'));
const policy = require(path.join(ROOT, 'core/biof3-server/agent-tools/agent-tool-policy'));
const skillTools = require(path.join(ROOT, 'core/biof3-server/agent-tools/skill-tools'));

test('BLOCK-157 KNW-1 注册表：skill_discover/skill_get 进静态面（76→78）', () => {
  const names = TOOL_DEFS.map((d) => d.function.name);
  assert.ok(names.includes('skill_discover'), 'skill_discover 应在 TOOL_DEFS');
  assert.ok(names.includes('skill_get'), 'skill_get 应在 TOOL_DEFS');
  assert.equal(TOOL_DEFS.length, 78, '静态工具总数 76→78（+2 技能台）');
  // 三方一致性：handler/contract 已接线（registry 模块加载即校验，此处显式双查）
  assert.equal(typeof registry.getToolHandler('skill_discover'), 'function');
  assert.equal(typeof registry.getToolHandler('skill_get'), 'function');
  assert.ok(registry.getToolContract('skill_discover'));
  assert.ok(registry.getToolContract('skill_get'));
});

test('BLOCK-157 KNW-1 契约：retrieval/none/R0，read/plan 档 policy allow（全档可用）', () => {
  for (const name of ['skill_discover', 'skill_get']) {
    const contract = registry.getToolContract(name);
    assert.equal(contract.category, 'retrieval', `${name}.category`);
    assert.equal(contract.sideEffect, 'none', `${name}.sideEffect`);
    assert.equal(contract.riskTier, 'R0', `${name}.riskTier`);
    for (const accessMode of ['read', 'plan', 'workspace-write', 'full']) {
      const decision = policy.decideAgentToolCall({ name, args: {}, ctx: { accessMode }, contract });
      assert.equal(decision.decision, 'allow', `${name}@${accessMode}: ${JSON.stringify(decision)}`);
    }
  }
});

test('BLOCK-157 KNW-1 discover：真实内置技能可发现（coding-playbook 在册）+ search 过滤', async () => {
  const result = await registry.getToolHandler('skill_discover')({});
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 300));
  assert.ok(Array.isArray(result.skills) && result.skills.length >= 4, `内置 ≥4，实际 ${result.skills?.length}`);
  const ids = result.skills.map((s) => s.id);
  assert.ok(ids.includes('coding-playbook'), `coding-playbook 应在册，实际 ${ids.join(',')}`);
  // 列表行不带 prompts 正文（渐进披露：正文走 skill_get）
  for (const row of result.skills) assert.ok(!('prompts' in row), 'discover 行不得携带 prompts 正文');

  const filtered = await registry.getToolHandler('skill_discover')({ search: 'enrichment' });
  assert.equal(filtered.ok, true);
  assert.ok(filtered.skills.some((s) => s.id === 'go-enrichment-analysis'), 'search=enrichment 应命中 go-enrichment-analysis');
});

test('BLOCK-157 KNW-1 get：完整手册可读（含 prompts）+ 未知 id 诚实报错', async () => {
  const got = await registry.getToolHandler('skill_get')({ id: 'coding-playbook' });
  assert.equal(got.ok, true, JSON.stringify(got).slice(0, 300));
  assert.equal(got.skill.id, 'coding-playbook');
  assert.ok(got.skill.prompts, 'get 应携带 prompts（触发加载通道）');

  const missing = await registry.getToolHandler('skill_get')({ id: 'no-such-skill' });
  assert.equal(missing.ok, false);
  assert.match(missing.error || '', /not_found|unknown/);
});

test('BLOCK-157 KNW-1 有界：discover 上限截断诚实标记；get prompt 截断带标记', () => {
  // 纯函数级有界契约（构造超界输入直接打投影函数）
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: `s${i}`, name: `n${i}`, version: '1.0.0', source: 'built-in',
    category: 'bioinformatics/x', tags: [], description: 'd'.repeat(200),
    capabilities: {}, plugins: { required: [] }, parameters: { required: {}, optional: {} },
  }));
  const bounded = skillTools.boundDiscoverRows(many, 50);
  assert.equal(bounded.rows.length, 50);
  assert.equal(bounded.truncated, true);
  assert.ok(bounded.rows[0].description.length <= 160, '描述应截断到 ≤160');

  const longPrompt = { prompts: { system: 'x'.repeat(20000) } };
  const clipped = skillTools.boundSkillPrompts(longPrompt, 8000);
  assert.ok(clipped.prompts.system.length <= 8200, 'prompt 应截断到预算内');
  assert.match(clipped.prompts.system, /\[truncated\]/, '截断须带标记');
});
