/**
 * K1 通用 agent 主线兑现度契约（红绿先行 + 篡改负测 + 真实行为断言）。
 *
 * 单一真相源 = scripts/lib/post-h9-k1-mainline.mjs。
 * 行为断言：真实 import MCP registry 并调用 callTool('ide_file_exists')，
 * 验证在 ai-usage-helper 注入 spy 的情况下依旧零计量（链上零 LLM），
 * 且工具结果不受注入影响——不是只看源码字符串的假契约。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  collectMainlineTruth, adjudicateMainline, GOAL_TOOLS,
} from '../scripts/lib/post-h9-k1-mainline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const truth = collectMainlineTruth(ROOT);
const tamper = (patch) => adjudicateMainline({ ...truth, ...patch });
const mustRed = (v, prefix) => {
  assert.equal(v.ok, false, `${prefix} 篡改后必须判红`);
  assert.ok(v.issues.some((i) => i.startsWith(prefix)), `应产生 ${prefix} 归因: ${v.issues.join(' / ')}`);
};

test('K1 四条结论在真实源码下成立，默认语义零改动', () => {
  const v = adjudicateMainline(truth);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.equal(v.verdict, 'mainline-truth-verified-no-default-semantics-changed');
  assert.deepEqual(v.conclusions, {
    'K-08': 'retain-with-reason',
    'K-10-goals': 'already-delivered',
    'K-10-viewer': 'already-delivered',
    'K-09': 'pending_user_ruling',
  });
});

test('K-08：MCP 目录 24 个 .js 文件的 require 图零 LLM/计量命中', () => {
  assert.ok(truth.mcpFileCount >= 20);
  assert.deepEqual(truth.llmHits, []);
  assert.equal(truth.shellNoUserContext, true);
  assert.equal(truth.registryDecisionComment, true);
});

test('K-08：ai_usage 是单表 token 计量，写零 token 行会污染（禁止接线）', () => {
  assert.equal(truth.singleTable, true);
  assert.equal(truth.tokenSemantics, true);
  assert.equal(truth.conversationFiltered, true);
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/ai-usage.js'), 'utf8');
  assert.match(src, /conversation_id 为空的行不计入项目口径|conversation_id.*不计入/);
});

test('K-10：goals 三定义在运行时 TOOL_DEFS 中（真实 require，非源码扫描）', () => {
  const { TOOL_DEFS } = require(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs.js'));
  const names = new Set(TOOL_DEFS.map((t) => t.function.name));
  for (const n of GOAL_TOOLS) assert.ok(names.has(n), `${n} 不在 TOOL_DEFS`);
  assert.deepEqual(truth.goalsInToolDefs, [...GOAL_TOOLS]);
  assert.equal(truth.goalsFacadeDirect, false);
  assert.equal(truth.goalsOrchestrationSpread, true);
});

test('K-10：viewer 12 档能力位已接线（10 个 true 位），非「全 false」', () => {
  assert.equal(truth.viewerProfileRows, 12);
  assert.ok(truth.viewerTrueBits >= 8);
  assert.equal(truth.viewerExports, true);
});

test('K-09：tools_only 未强制、IDE accessMode 留 reopen（U 类现状）', () => {
  assert.equal(truth.toolsOnlyParsedNotEnforced, true);
  assert.equal(truth.accessModeReopen, true);
  assert.equal(truth.confirmPolicySingleAxis, true);
});

// ---- 真实行为断言：注入计量 spy 后 MCP 工具调用仍零计量且结果不变 ----
test('行为：ai-usage-helper 注入 spy 后 callTool(ide_file_exists) 不触发计量，工具结果正确', async () => {
  const helper = require(path.join(ROOT, 'core/shared-backend/ai-usage-helper.js'));
  const calls = [];
  helper.configure({ recordAiUsage: (args) => { calls.push(args); } });
  try {
    const registry = await import(pathToFileURL(path.join(ROOT, 'core/petri-server/mcp/registry.js')).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-h9-k1-'));
    const res = await registry.callTool('ide_file_exists', { path: tmp });
    fs.rmSync(tmp, { recursive: true, force: true });
    assert.equal(res.isError, false, JSON.stringify(res));
    assert.equal(JSON.parse(res.content[0].text).exists, true);
    assert.equal(calls.length, 0, 'MCP 链零 LLM 调用 ⇒ 不应产生任何 ai_usage 计量');
  } finally {
    helper.configure({ recordAiUsage: () => {} });
  }
});

test('行为：ai-usage-helper 未注入时 no-op 不抛错（既有裁决语义保持）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/shared-backend/ai-usage-helper.js'), 'utf8');
  assert.match(src, /未注入：no-op/);
  assert.match(src, /if \(_recordAiUsage\) return _recordAiUsage\(args\)/);
});

// ---- 篡改负测：任一事实回潮/被改写必须判红 ----
test('负测 K-08：MCP require 图混入 llm-providers → 判红', () => {
  mustRed(tamper({ llmHits: ['core/petri-server/mcp/registry.js'] }), 'K-08');
});

test('负测 K-08：ai_usage 被拆成第二张表 → 判红', () => {
  mustRed(tamper({ singleTable: false }), 'K-08');
});

test('负测 K-08：删掉 registry.js:333 既有裁决注释 → 判红（禁止擅自撤销裁决）', () => {
  mustRed(tamper({ registryDecisionComment: false }), 'K-08');
});

test('负测 K-08：stdio 壳被塞入 userId/conversationId 但未同步熔断链 → 判红', () => {
  mustRed(tamper({ shellNoUserContext: false }), 'K-08');
});

test('负测 K-10：goals 从 TOOL_DEFS 掉一个 → 判红（防回退）', () => {
  mustRed(tamper({ goalsInToolDefs: ['create_goal', 'get_goal'] }), 'K-10');
});

test('负测 K-10：删掉 agent-orchestration 的 goals spread → 判红', () => {
  mustRed(tamper({ goalsOrchestrationSpread: false }), 'K-10');
});

test('负测 K-10：viewer 能力位被整体回退成全 false → 判红', () => {
  mustRed(tamper({ viewerTrueBits: 0 }), 'K-10');
});

test('负测 K-10：viewer 消费面导出被删 → 判红', () => {
  mustRed(tamper({ viewerExports: false }), 'K-10');
});

test('负测 K-09：tools_only 被改成已强制但无裁决记录 → 判红', () => {
  mustRed(tamper({ toolsOnlyParsedNotEnforced: false }), 'K-09');
});

test('负测：事实整体缺席 → fail-closed 判红而非静默通过', () => {
  const v = adjudicateMainline({});
  assert.equal(v.ok, false);
  assert.ok(v.issues.length >= 4);
});
