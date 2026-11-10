/**
 * BLOCK-406（第五轮 L2 功能断链与假成功）契约测试。
 *
 * 红绿先行：L-01 MCP skill_execute「成功但零执行」当前必红（空产物 + isError:false）。
 * 承载蓝图 §4-L2：L-01 fail-closed / L-02 双 server resources 可达 / L-05 source enum 同源。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- L2-1 / L-01：skill_execute 假成功 fail-closed ----
test('L2-1 红转绿：11 个内置 Skill 逐件 callTool——非可执行 Skill 必须明确 isError:true + no_execution_backend（不得「成功但零执行」）', async () => {
  const registry = await import('../core/petri-server/mcp/registry.js');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'skills', 'manifest.json'), 'utf8'));
  const skillIds = (manifest.skills || manifest).map?.((s) => s.id ?? s.name ?? s) ?? Object.keys(manifest.skills || manifest);
  assert.ok(Array.isArray(skillIds) && skillIds.length >= 11, `内置 Skill 数 ${JSON.stringify(skillIds).slice(0, 120)}`);
  for (const id of skillIds) {
    const r = await registry.callTool('skill_execute', { id });
    const parsed = JSON.parse(r.content[0].text);
    const notExecutable = parsed.error === 'no_execution_backend' || parsed.reasonCode === 'no_execution_backend';
    if (r.isError !== true || !notExecutable) {
      // 可执行 Skill（有真实产物）才允许 isError:false——逐件明确失败即断言失败
      assert.fail(`Skill ${id} 返回 isError=${r.isError}，payload=${JSON.stringify(parsed).slice(0, 200)}——不得假成功`);
    }
  }
});

test('L2-1 SkillRuntime.hasExecutionBackend：空注入 false；workflowRuntime.run 或 registry.runTool 在场 true', async () => {
  const { createSkillRuntime } = await import('../core/shared-backend/skill-runtime.js');
  const skill = { id: 'x', name: 'x', plugins: { required: [], optional: [] } };
  const bare = createSkillRuntime(skill, {});
  assert.equal(bare.hasExecutionBackend(), false);
  const withWorkflow = createSkillRuntime(skill, { workflowRuntime: { run: async () => ({}) } });
  assert.equal(withWorkflow.hasExecutionBackend(), true);
  const withRunTool = createSkillRuntime(skill, { registry: { runTool: async () => ({}) } });
  assert.equal(withRunTool.hasExecutionBackend(), true);
  // workflowRuntime 只有 execute（现状 workflow-engine 形态）≠ 可执行
  const executeOnly = createSkillRuntime(skill, { workflowRuntime: { execute: async () => ({}) } });
  assert.equal(executeOnly.hasExecutionBackend(), false);
});

test('L2-1 负测：skill 不存在仍 isError:true（原语义保留）', async () => {
  const registry = await import('../core/petri-server/mcp/registry.js');
  const r = await registry.callTool('skill_execute', { id: 'no-such-skill-l2' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Skill not found/);
});

// ---- L2-2 / L-02：产品 MCP 入口 resources 可达 ----
test('L2-2 红转绿：产品入口声明 capabilities.resources 且 listIdeMcpResources 可达（同一 registry 单源）', async () => {
  const mcpServerSrc = fs.readFileSync(path.join(ROOT, 'src', 'mcp-server.js'), 'utf8');
  assert.match(mcpServerSrc, /capabilities:\s*\{[^]*?resources:\s*\{\}/, '产品入口须声明 resources capability');
  assert.match(mcpServerSrc, /ListResourcesRequestSchema/, '须注册 resources/list handler');
  assert.match(mcpServerSrc, /ReadResourceRequestSchema/, '须注册 resources/read handler');
  assert.doesNotMatch(mcpServerSrc, /prompts:\s*\{\}/, '不得恒空声明 prompts capability（prompts/list 恒空=假声明）');
  const registry = await import('../core/petri-server/mcp/registry.js');
  const resources = await registry.listIdeMcpResources();
  assert.ok(Array.isArray(resources) && resources.some((r) => String(r.uri).startsWith('ide://')), 'ide:// 资源从 registry 单源可达');
});

// ---- L2-4 / L-05：agent-tools skill source enum 同源派生（含 pack）----
test('L2-4 红转绿：tool-defs/skill.js source.enum 由 SOURCE_PRIORITY 同源派生（含 pack）', async () => {
  const skillRegistry = await import('../core/shared-backend/skill-registry.js');
  const { TOOL_DEFS } = await import('../core/petri-server/agent-tools/tool-defs.js');
  const def = TOOL_DEFS.find((t) => t.function?.name === 'skill_discover');
  assert.ok(def, 'skill_discover 在册');
  const schema = JSON.stringify(def.function?.parameters || def.inputSchema || {});
  const expected = Object.keys(skillRegistry.SOURCE_PRIORITY || {});
  for (const src of expected) {
    assert.ok(schema.includes(`"${src}"`) || schema.includes(`'${src}'`) || schema.includes(src), `enum 须含 ${src}`);
  }
});
