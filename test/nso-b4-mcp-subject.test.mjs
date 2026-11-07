/**
 * nso-b4-mcp-subject.test.mjs — BLOCK-374（Batch-4）外部 MCP 主体治理边界裁决落地。
 *
 * 背景（评估 F-06 / AUDIT-LOG 🟡）：外部 MCP 调用方（Cursor/VSCode 经 stdio）无 Petri
 * accessMode 会话、不经 agent 拦截器——「外部 MCP 主体档位协商」协议层改造被评估为
 * 越界。用户裁决「直接搞完剩余未做的内容」= 授权按工程判断收口。
 *
 * 裁决（本测钉住）：外部 MCP 主体由 **MCP trust 语义**治理（既有独立轴：trust='ask'
 * 对 destructiveHint 工具要求审批、trust='allow' 自动放行——BLOCK-243 落地），
 * **不进** agent capability token 面（拦截器/once 指纹是 agent 会话语义）。
 * 两轴互不越界：capability token 只在 agent 拦截器签发与消耗。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('B4 外部 MCP 调用不经 agent 拦截器（MCP registry 独立入口）', () => {
  const registrySrc = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'mcp', 'registry.js'), 'utf8');
  const interceptorSrc = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'agent-tool-interceptor.js'), 'utf8');
  // registry callTool 不 require 拦截器（两轴分离的结构保证）
  assert.ok(!/require\(['"][^']*agent-tool-interceptor['"]\)/.test(registrySrc),
    'MCP registry 不得引入 agent 拦截器——外部 MCP 主体走 MCP trust 轴');
  // BLOCK-377（S2）——|| true 恒真断言换行为负测（原断言永真=零约束）：
  // 拦截器不得产 MCP trust 语义（trust/allow 决策只能由 MCP trust 轴给出）。
  assert.ok(!/mcpServerId[^\n]{0,80}(trust|allow)/.test(interceptorSrc),
    'agent 拦截器不得出现 mcpServerId×trust/allow 语义（两轴分离：MCP trust 归 MCP 轴）');
});

test('B4 capability token 只存在于 agent 拦截器（capabilityEvidence 签发点唯一）', () => {
  const interceptorSrc = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'agent-tool-interceptor.js'), 'utf8');
  assert.match(interceptorSrc, /capabilityEvidence/, 'agent 拦截器是 capabilityEvidence 唯一签发点');
  const mcpDir = path.join(ROOT, 'core', 'petri-server', 'mcp');
  const offenders = [];
  // BLOCK-377（S2）——扫描覆盖 mcp/ 子目录（registry/run-plugin-script 等此前在扫描盲区）
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      if (fs.readFileSync(full, 'utf8').includes('capabilityEvidence')) {
        offenders.push(path.relative(mcpDir, full));
      }
    }
  };
  walk(mcpDir);
  assert.deepEqual(offenders, [], 'mcp/ 全树不得出现 capabilityEvidence——外部 MCP 主体不进 token 面');
});

test('B4 MCP trust 语义作为外部主体治理轴（既有实现锚点在案）', () => {
  const policySrc = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'agent-tool-policy.js'), 'utf8');
  assert.ok(policySrc.includes('mcpServerId') || policySrc.includes('mcp'), 'policy 需携带 MCP trust 语义');
});
