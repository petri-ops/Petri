#!/usr/bin/env node
/**
 * post-H9 32 条缺口终态台账 —— 单一真相源（blueprint §3 逐件定终态）。
 *
 * 终态词表（封闭，禁止静默消失）：
 *   done               有当前证据闭合
 *   done-partial       可机械验证子集已交付，末步挂起（必须写 closureCondition + evidenceRef）
 *   retain-with-reason 核实后判定「保留现状」（必须写 reason + evidenceRef）
 *   external-blocked   V 类：凭据 / 出网 / 平台客观拿不到（必须写 closureCondition）
 *   pending_human_eye  E 类：人眼观感 / 读屏待签字（必须写 routeRef，不得代答）
 *   pending_user_ruling U 类：需用户裁决（必须写 decisionRef，不得改默认语义）
 *   deferred           结构性重构需独立切片（必须写 closureCondition + sliceRef）
 *   in_progress        阶段未收口（K7 总收口时必须为 0）
 *
 * 红线：任何 `done` 必须有 evidenceRef 指向真实存在的文件；
 * 任何 U/E/V/W 边界项不得写成 done/verified/completed。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LEDGER_REL = 'acceptance/post-h9-2026-11-10/gap-terminal-ledger.json';

export const TERMINALS = Object.freeze([
  'done', 'done-partial', 'retain-with-reason', 'external-blocked',
  'pending_human_eye', 'pending_user_ruling', 'deferred', 'in_progress',
]);
export const BOUNDARY_TERMINALS = Object.freeze([
  'external-blocked', 'pending_human_eye', 'pending_user_ruling', 'deferred',
]);

// [id, priority, blocker, stage, anchor] —— 逐字来自 blueprint §3 表格
export const GAP_DEFS = Object.freeze([
  ['K-01', 'P0', 'A+L', 'K0', 'ai-conversations.js:71 / h8/dom-budget-live.json:438-508'],
  ['K-02', 'P0', 'A', 'K0', 'h9/cv-ab.json:9,13,25,34-36'],
  ['K-03', 'P0', 'A+L', 'K0/K5', 'h8/startup-five-stage.json:10 / post-s7-startup-five-stage.mjs:17'],
  ['K-04', 'P0', 'A', 'K0', '§1.5 九组数字冲突'],
  ['K-05', 'P0', 'W', 'K0', '当次 ui:audit:check / quality:lint'],
  ['K-06', 'P0', 'W', 'K0', 'git status 10 M + 20 untracked / h10/'],
  ['K-07', 'P0', 'A', 'K0', 'README.md:1 vs DOC-REGISTRY.json'],
  ['K-08', 'P0', 'A', 'K1', 'ai-usage-helper.js:6,25-30 / mcp/registry.js:333'],
  ['K-09', 'P1', 'A+U', 'K1', 'permissions.js:21-23 / mcp/ide-tools/contracts.js:11'],
  ['K-10', 'P1', 'A', 'K1', 'tool-defs/goals.js / viewerRegistry.ts:58-62,69-86'],
  ['K-11', 'P1', 'A', 'K2', 'ai-conversations.js:127,145,150,178,244-251'],
  ['K-12', 'P1', 'A', 'K2', 'agent-task-store.js:596-607 等 ≥15 生产点'],
  ['K-13', 'P1', 'A', 'K2', 'routes/ai-agent/events.js:130-156 / mobile-gateway/agent-ws.js'],
  ['K-14', 'P1', 'A+L', 'K3', 'helpers/trajectory-events.js → frontend/src'],
  ['K-15', 'P1', 'E+L', 'K3', 'h7-human-eye-route.md / debt 35'],
  ['K-16', 'P1', 'A+L', 'K3', 'CenterPanel.tsx:203-213 / project-workspace.module.css:1546,2836'],
  ['K-17', 'P1', 'A', 'K3', '4 族颜色字面量 / App.tsx:158,162'],
  ['K-18', 'P1', 'A', 'K4', '五个巨型文件 / loop-orchestrator.js 1579'],
  ['K-19', 'P1', 'A', 'K4', 'mcp/registry.js:357-384 等三处 / tool-metadata.js'],
  ['K-20', 'P1', 'A', 'K4', 'release-contract.test.mjs:97 等 4 族'],
  ['K-21', 'P2', 'A+W', 'K4', 'test/impact-map.json 365 规则 / 120 未映射'],
  ['K-22', 'P2', 'A', 'K4', 'knip.json:38 / 动态 require 三处'],
  ['K-23', 'P2', 'A+L', 'K5', 'block95-a2-frame-live.cjs:84 / post-s7-dom-budget-live.cjs'],
  ['K-24', 'P2', 'A', 'K5', '三矩阵生成器 / quality:surface 启发式'],
  ['K-25', 'P2', 'A', 'K5', 'h9/ipc-unused-triage.json 165 通道'],
  ['K-26', 'P2', 'A', 'K5', 'quality:ear 43.2% / manifest 43.3%'],
  ['K-27', 'P0', 'A', 'K6', 'computer-use-pip.js:67-72 / electron-security-assertions.test.mjs:25-28'],
  ['K-28', 'P1', 'A', 'K6', 'W2 蓝图 :157-158 / _ipc-trust.js:29-37,88'],
  ['K-29', 'P0', 'U', 'K6', 'execution-admission.js:112-120 / db/connection.js:24-25'],
  ['K-30', 'P2', 'V+E', 'K7', 'task-suite-round1.json 0/8 / 8 项 humanEyePending'],
  ['K-31', 'P2', 'A', 'K4', '三套 lock / typescript 双版本 / uuid 三树'],
  ['K-32', 'P2', 'A', 'K5', 'docs/README.md / acceptance 元数据 / docs:roll-index --check'],
]);

export function initialGap(id, priority, blocker, stage, anchor) {
  return {
    id, priority, blocker, stage, anchor,
    terminal: 'in_progress',
    evidenceRef: null,
    decisionRef: null,
    routeRef: null,
    sliceRef: null,
    closureCondition: null,
    reason: null,
    note: '待对应 K 阶段逐件定终态',
  };
}

export function emptyLedger(meta = {}) {
  return {
    schemaVersion: 1,
    program: 'post-h9-2026-11-10',
    blueprint: 'docs/post-h9-optimization-blueprint-2026-11-10.md',
    generatedAt: new Date().toISOString(),
    ...meta,
    terminalCounts: { in_progress: 32 },
    gaps: GAP_DEFS.map(([id, p, b, s, a]) => initialGap(id, p, b, s, a)),
  };
}

/** 机械校核：返回 {ok, issues}，不抛错（负测可直接构造坏输入）。 */
export function validateLedger(ledger, { root = ROOT, requireAllClosed = false } = {}) {
  const issues = [];
  if (!ledger || !Array.isArray(ledger.gaps)) return { ok: false, issues: ['gaps 非数组'] };
  const ids = ledger.gaps.map((g) => g.id);
  const expected = GAP_DEFS.map((d) => d[0]);
  if (ledger.gaps.length !== 32) issues.push(`gaps 数量 ${ledger.gaps.length} != 32`);
  if (new Set(ids).size !== ids.length) issues.push('存在重复 id');
  for (const id of expected) if (!ids.includes(id)) issues.push(`静默消失: ${id} 缺席`);
  for (const id of ids) if (!expected.includes(id)) issues.push(`未知 id: ${id}`);

  const priorityCounts = {};
  for (const g of ledger.gaps) {
    priorityCounts[g.priority] = (priorityCounts[g.priority] || 0) + 1;
    if (!TERMINALS.includes(g.terminal)) issues.push(`${g.id} 终态非法: ${g.terminal}`);
    if (!['A', 'A+L', 'A+U', 'A+W', 'W', 'U', 'E+L', 'V+E'].includes(g.blocker)) issues.push(`${g.id} blocker 非法: ${g.blocker}`);
    if (g.terminal === 'done' && !g.evidenceRef) issues.push(`${g.id} 写 done 但无 evidenceRef`);
    if (g.terminal === 'done-partial' && (!g.evidenceRef || !g.closureCondition)) issues.push(`${g.id} done-partial 缺 evidenceRef/closureCondition`);
    if (g.terminal === 'retain-with-reason' && (!g.reason || !g.evidenceRef)) issues.push(`${g.id} retain 缺 reason/evidenceRef`);
    if (g.terminal === 'external-blocked' && !g.closureCondition) issues.push(`${g.id} external-blocked 缺补腿条件`);
    if (g.terminal === 'pending_human_eye' && !g.routeRef) issues.push(`${g.id} 人眼项缺测试路线指针`);
    if (g.terminal === 'pending_user_ruling' && !g.decisionRef) issues.push(`${g.id} 裁决项缺决策材料指针`);
    if (g.terminal === 'deferred' && (!g.closureCondition || !g.sliceRef)) issues.push(`${g.id} deferred 缺补腿条件/切片指针`);
    if (BOUNDARY_TERMINALS.includes(g.terminal) && /verified|completed|passed/i.test(String(g.note))) issues.push(`${g.id} 边界项 note 冒充 verified/completed/passed`);
    for (const ref of [g.evidenceRef, g.decisionRef, g.routeRef, g.sliceRef]) {
      if (ref && !fs.existsSync(path.resolve(root, ref))) issues.push(`${g.id} 引用文件不存在: ${ref}`);
    }
  }
  if (priorityCounts.P0 !== 10 || priorityCounts.P1 !== 13 || priorityCounts.P2 !== 9) {
    issues.push(`优先级计数错: ${JSON.stringify(priorityCounts)}（应 P0 10 / P1 13 / P2 9）`);
  }
  const computed = {};
  for (const g of ledger.gaps) computed[g.terminal] = (computed[g.terminal] || 0) + 1;
  if (JSON.stringify(computed) !== JSON.stringify(ledger.terminalCounts)) {
    issues.push(`terminalCounts 必须由 gaps 机械汇总: ${JSON.stringify(computed)} != ${JSON.stringify(ledger.terminalCounts)}`);
  }
  if (requireAllClosed && computed.in_progress) issues.push(`总收口仍有 ${computed.in_progress} 条 in_progress`);
  return { ok: issues.length === 0, issues, computed };
}

export function recomputeCounts(ledger) {
  const counts = {};
  for (const g of ledger.gaps) counts[g.terminal] = (counts[g.terminal] || 0) + 1;
  ledger.terminalCounts = counts;
  return ledger;
}

export function setTerminal(ledger, id, patch) {
  const g = ledger.gaps.find((x) => x.id === id);
  if (!g) throw new Error(`[post-h9:ledger] 未知缺口 ${id}`);
  Object.assign(g, patch);
  return recomputeCounts(ledger);
}

function main(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const abs = path.resolve(ROOT, LEDGER_REL);
  if (argv.includes('--init')) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(emptyLedger(), null, 2)}\n`);
    console.log(`[post-h9:ledger] 已初始化 ${LEDGER_REL}（32 条 in_progress）`);
    return;
  }
  if (argv.includes('--set')) {
    const id = arg('--id');
    const patch = JSON.parse(arg('--patch', '{}'));
    const ledger = JSON.parse(fs.readFileSync(abs, 'utf8'));
    setTerminal(ledger, id, patch);
    ledger.generatedAt = new Date().toISOString();
    fs.writeFileSync(abs, `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(`[post-h9:ledger] ${id} → ${patch.terminal}`);
    return;
  }
  const ledger = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const check = validateLedger(ledger, { requireAllClosed: argv.includes('--require-all-closed') });
  console.log(JSON.stringify(check, null, 2));
  if (!check.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
