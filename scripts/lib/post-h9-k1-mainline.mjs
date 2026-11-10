#!/usr/bin/env node
/**
 * K1 兑现度事实采集与裁决（纯函数 + 只读扫描，供行为断言与篡改负测）。
 *
 * 核实四件事，全部以真实源码/运行时为准，不以蓝图自述为准：
 *   ① MCP 执行链是否经过 LLM（决定「计量盲区」是否成立）；
 *   ② ai_usage 是否单表 token 计量（决定写零 token 行是否污染）；
 *   ③ goals 三定义是否已在 TOOL_DEFS（决定是否需要重复接线）；
 *   ④ viewer 能力位是否已接线（决定「全 false」是否仍成立）。
 *
 * 裁决器 adjudicateMainline() 不读写外部状态，负测可直接注入篡改对象。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

export const GOAL_TOOLS = Object.freeze(['create_goal', 'get_goal', 'update_goal']);

/** 只读采集：源码静态事实 + Node 侧可 require 的运行时事实。 */
export function collectMainlineTruth(root = ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const mcpShell = read('src/mcp-server.js');
  const registrySrc = read('core/petri-server/mcp/registry.js');
  const aiUsageSrc = read('core/petri-server/helpers/ai-usage.js');
  const permissionsSrc = read('core/petri-server/helpers/permissions.js');
  const ideContractsSrc = read('core/petri-server/mcp/ide-tools/contracts.js');
  const viewerSrc = read('frontend/src/components/result-studio/viewerRegistry.ts');

  // ① MCP 目录内所有 .js 的 require 图是否含 LLM 链路
  const mcpDir = path.join(root, 'core/petri-server/mcp');
  const mcpFiles = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) mcpFiles.push(path.relative(root, p));
    }
  };
  walk(mcpDir);
  const llmTokens = /llm-providers|model-gateway|llm-client|callModelTask|ai-usage-helper|recordAiUsage/;
  const llmHits = mcpFiles.filter((f) => llmTokens.test(read(f)));

  // ② ai_usage 单表 + token 语义
  const singleTable = /CREATE TABLE IF NOT EXISTS ai_usage/.test(aiUsageSrc) &&
    (aiUsageSrc.match(/CREATE TABLE IF NOT EXISTS ai_usage/g) || []).length === 1;
  const tokenSemantics = /prompt_tokens|completion_tokens|cost_cny/.test(aiUsageSrc);
  const conversationFiltered = /conversation_id\s*=\s*\?|conversationId/.test(aiUsageSrc);

  // ③ goals 三定义是否已在运行时 TOOL_DEFS（真实 require，不靠 src.includes）
  const { TOOL_DEFS } = require(path.join(root, 'core/petri-server/agent-tools/tool-defs.js'));
  const runtimeToolNames = new Set(TOOL_DEFS.map((t) => t.function.name));
  const goalsInToolDefs = GOAL_TOOLS.filter((n) => runtimeToolNames.has(n));
  const goalsFacadeDirect = /require\('\.\/tool-defs\/goals'\)|require\("\.\/tool-defs\/goals"\)/.test(read('core/petri-server/agent-tools/tool-defs.js'));
  const goalsOrchestrationSpread = /\.\.\.require\('\.\/goals'\)/.test(read('core/petri-server/agent-tools/tool-defs/agent-orchestration.js'));

  // ④ viewer 能力位：从 TS 源码解析 12 档 profile 的 true 计数
  const profileBlock = viewerSrc.slice(viewerSrc.indexOf('const VIEWER_PROFILES'), viewerSrc.indexOf('/**', viewerSrc.indexOf('const VIEWER_PROFILES')));
  const trueBits = (profileBlock.match(/can(Select|Compare|Export): true/g) || []).length;
  const profileRows = (profileBlock.match(/^\s{2}[a-z0-9'-]+: \{ canSelect:/gm) || []).length;
  const viewerExports = /export function viewerProfileCanExport/.test(viewerSrc) && /export function viewerProfileCanSelect/.test(viewerSrc);

  // ⑤ 权限档位现状
  // 注释跨行：`tools_only ... parsed but not yet\n * enforced`，需允许中间空白与注释星号
  const toolsOnlyParsedNotEnforced = /tools_only[\s\S]{0,220}?parsed but not yet[\s\S]{0,80}?enforced/.test(permissionsSrc);
  const accessModeReopen = /accessMode[\s\S]{0,200}reopen/.test(ideContractsSrc);
  const confirmPolicySingleAxis = /confirmPolicy/.test(ideContractsSrc);

  // ⑥ stdio 壳无用户上下文
  const shellNoUserContext = !/userId|conversationId|ai_usage/.test(mcpShell) && /callTool\(name, args\)|callTool\(params\.name/.test(mcpShell);

  return {
    llmHits, mcpFileCount: mcpFiles.length,
    singleTable, tokenSemantics, conversationFiltered,
    goalsInToolDefs, goalsFacadeDirect, goalsOrchestrationSpread,
    viewerTrueBits: trueBits, viewerProfileRows: profileRows, viewerExports,
    toolsOnlyParsedNotEnforced, accessModeReopen, confirmPolicySingleAxis,
    shellNoUserContext,
    registryDecisionComment: /桌面版不写库|无用户上下文/.test(registrySrc),
  };
}

/**
 * 裁决：K-08 不得接线（证据校准）、K-10 声明过时、K-09 待裁决。
 * 任一事实被篡改/回潮即判红（负测注入）。
 */
export function adjudicateMainline(t) {
  const issues = [];
  const conclusions = {};

  // K-08：链上零 LLM ⇒ 接线是污染，且既有裁决不得撤销
  const k8Start = issues.length;
  if (!Array.isArray(t.llmHits) || t.llmHits.length !== 0) issues.push('K-08: MCP require 图出现 LLM/计量链路，零 token 前提被推翻');
  if (!(t.singleTable && t.tokenSemantics)) issues.push('K-08: ai_usage 不再是单表 token 计量，污染判定失效');
  if (!(t.conversationFiltered && t.shellNoUserContext)) issues.push('K-08: conversation 过滤或 stdio 无用户态事实被改写');
  if (t.registryDecisionComment !== true) issues.push('K-08: registry.js:333 既有产品裁决注释被移除（不得擅自撤销）');
  conclusions['K-08'] = issues.length === k8Start ? 'retain-with-reason' : 'drift';

  // K-10 goals：三定义已在运行时 TOOL_DEFS（间接 spread 合法）
  const goalsStart = issues.length;
  if (!(Array.isArray(t.goalsInToolDefs) && t.goalsInToolDefs.length === 3)) issues.push('K-10: goals 三定义未全部进入 TOOL_DEFS');
  if (t.goalsFacadeDirect !== false) issues.push('K-10: facade 被改成直接 require goals（与域内 spread 契约冲突）');
  if (t.goalsOrchestrationSpread !== true) issues.push('K-10: agent-orchestration.js 的 goals spread 被移除');
  conclusions['K-10-goals'] = issues.length === goalsStart ? 'already-delivered' : 'drift';

  // K-10 viewer：能力位已接线（非全 false）
  const viewerStart = issues.length;
  if (!(t.viewerTrueBits >= 8 && t.viewerProfileRows === 12)) issues.push('K-10: viewer 能力位接线被回退或档案数变化');
  if (t.viewerExports !== true) issues.push('K-10: viewer 能力位消费面导出被移除');
  conclusions['K-10-viewer'] = issues.length === viewerStart ? 'already-delivered' : 'drift';

  // K-09：现状未强制，属 U 类待裁决
  const k9Start = issues.length;
  if (!(t.toolsOnlyParsedNotEnforced && t.accessModeReopen && t.confirmPolicySingleAxis)) issues.push('K-09: 权限档位现状被改动，材料失效需重做');
  conclusions['K-09'] = issues.length === k9Start ? 'pending_user_ruling' : 'drift';

  return {
    ok: issues.length === 0,
    issues,
    conclusions,
    verdict: issues.length === 0 ? 'mainline-truth-verified-no-default-semantics-changed' : 'mainline-drift',
  };
}

function main() {
  const truth = collectMainlineTruth();
  const verdict = adjudicateMainline(truth);
  console.log(JSON.stringify({ truth, verdict }, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`[post-h9:k1] fail-closed: ${e.message}`); process.exitCode = 1; }
}
