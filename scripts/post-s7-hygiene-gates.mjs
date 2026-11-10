#!/usr/bin/env node
/**
 * scripts/post-s7-hygiene-gates.mjs — BLOCK-394 批次 A 的三个机械门（纯函数可负测）。
 *
 *  B-06 prompt-injection 装配点盘点：只读枚举 tool_result → LLM messages 的生产装配点，
 *      冻结清单；新增未登记装配点即红（防止静默新增注入通道）。
 *  B-31 lint 抑制分域棘轮：按 测试面 / 生产面 分域统计 eslint-suppressions.json，
 *      每域 + 总数只减不增（搬桶不算清偿）。
 *  B-33 165 个零消费 IPC 通道逐件裁决：按「有 preload 包装 / 有渲染层消费」两条判据
 *      分诊成三桶（可删 / 需接线 / retain-with-reason），逐件留因，无静默消失。
 *
 * 不新建评分器 / 第二真相：三份判据都从既有台账（源码 / eslint-suppressions /
 * surface-matrix）直接读取，输出的是分诊台账而非新 truth 源。
 *
 * 用法：node scripts/post-s7-hygiene-gates.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h9');

// ── B-06 ────────────────────────────────────────────────────────────────
/** 已知生产装配点（2026-11-10 逐行核实）。新增装配点必须先登记在此并写防护说明。 */
export const TOOL_RESULT_ASSEMBLY_POINTS = [
  { file: 'core/petri-server/loop-orchestrator.js', symbol: "messages.push({role:'tool', ...})", guard: 'serializeToolResultForModel' },
  { file: 'core/petri-server/agent-tools/tool-execution.js', symbol: 'serializeToolResultForModel', guard: 'interceptAgentToolCall 统一收口' },
  { file: 'core/petri-server/helpers/prompt-assembly.js', symbol: 'assembleMessages', guard: 'history→Provider messages' },
  { file: 'core/petri-server/helpers/history-assembly.js', symbol: 'assembleServerHistory', guard: '只取 user/assistant，不含 tool' },
  { file: 'core/petri-server/helpers/trajectory-events.js', symbol: 'toTrajectoryEvent / summarizeEvent', guard: 'tool_result→轨迹投影' },
  { file: 'core/petri-server/routes/ai-agent/resume.js', symbol: 'buildProgressDigest', guard: '恢复摘要投影' },
  // 2026-11-10 门当场发现（子代理探查漏项）：裁剪器按 role==='tool' 分层决定哪些工具结果进入上下文，
  // 属注入面而非纯文档提及，逐行核实后登记;
  { file: 'core/petri-server/helpers/message-trimmer.js', symbol: 'scoreMessages / trimMessages', guard: 'TIER_TOOL_RESULT 分层保留 + tool_call 链完整性' },
];

const ASSEMBLY_MARKERS = [/role:\s*['"]tool['"]/, /serializeToolResultForModel\s*\(/, /tool_result/];

export function auditToolResultAssembly(readFile = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')) {
  const registered = new Set(TOOL_RESULT_ASSEMBLY_POINTS.map((p) => p.file));
  const found = [];
  const issues = [];
  const scanRoots = ['core/petri-server/loop-orchestrator.js', 'core/petri-server/agent-runner.js',
    'core/petri-server/helpers', 'core/petri-server/agent-tools', 'core/petri-server/routes/ai-agent',
    'core/petri-server/mcp'];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    let st;
    try { st = fs.statSync(abs); } catch { return; }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        walk(`${rel}/${e.name}`);
      }
      return;
    }
    if (!/\.(js|cjs|mjs)$/.test(rel)) return;
    let text;
    try { text = readFile(rel); } catch { return; }
    const hits = ASSEMBLY_MARKERS.filter((re) => re.test(text));
    // 只有「把结果写进消息」的装配信号才算注入面；单纯事件名 tool_result 需与 role:'tool' 共现。
    const isAssembly = /role:\s*['"]tool['"]/.test(text) || /serializeToolResultForModel\s*\(/.test(text);
    if (hits.length && isAssembly) found.push({ file: rel, markers: hits.map(String) });
  };
  for (const r of scanRoots) walk(r);
  for (const f of found) {
    if (!registered.has(f.file)) issues.push(`${f.file}: 未登记的 tool_result→messages 装配点（prompt-injection 面漏审）`);
  }
  for (const p of TOOL_RESULT_ASSEMBLY_POINTS) {
    if (!fs.existsSync(path.join(ROOT, p.file))) issues.push(`${p.file}: 已登记但文件不存在（清单僵化）`);
  }
  return { ok: issues.length === 0, issues, registered: TOOL_RESULT_ASSEMBLY_POINTS, found };
}

// ── B-31 ───────────────────────────────────────────────────────────────
export function domainOf(file) {
  if (/\.test\.|\/test\/|^test\//.test(file)) return 'test';
  if (/^scripts\/|^frontend\/scripts\//.test(file)) return 'scripts';
  return 'production';
}

export function lintDomains(suppressions) {
  const domains = { production: 0, test: 0, scripts: 0 };
  for (const [file, rules] of Object.entries(suppressions || {})) {
    const d = domainOf(file);
    for (const r of Object.values(rules || {})) domains[d] += Number(r?.count || 0);
  }
  return domains;
}

export function evaluateLintRatchet(suppressions, baseline) {
  const current = lintDomains(suppressions);
  const issues = [];
  const totalCurrent = Object.values(current).reduce((a, b) => a + b, 0);
  const totalBaseline = Object.values(baseline?.domains || {}).reduce((a, b) => a + b, 0);
  for (const d of Object.keys(current)) {
    if (baseline?.domains && typeof baseline.domains[d] === 'number' && current[d] > baseline.domains[d]) {
      issues.push(`${d} 域 ${current[d]} > 基线 ${baseline.domains[d]}（新增违规即红）`);
    }
  }
  if (baseline?.total != null && totalCurrent > baseline.total) {
    issues.push(`总数 ${totalCurrent} > 基线 ${baseline.total}（搬桶不算清偿）`);
  }
  return { ok: issues.length === 0, issues, current, total: totalCurrent };
}

// ── B-33 ───────────────────────────────────────────────────────────────
export function triageUnusedIpc(matrix) {
  const rows = Array.isArray(matrix?.ipcUnused) ? matrix.ipcUnused : [];
  const buckets = { deletable: [], needsWiring: [], retainWithReason: [] };
  // 与 functional-surface-audit.mjs:530 的 MAIN_ONLY 同源（主窗不暴露、独立 preload）。
  const MAIN_ONLY = new Set(['computer-use:pip-open', 'computer-use:pip-close', 'computer-use:pip-frame', 'computer-use:pip-status']);
  for (const row of rows) {
    const channel = String(row.channel || row.name || '');
    if (!channel) continue;
    const inPreload = Boolean(row.inPreload);
    const used = Boolean(row.usedInRenderer);
    const mainOnly = MAIN_ONLY.has(channel);
    const prefix = channel.split(':')[0];
    let bucket;
    let reason;
    if (mainOnly) {
      bucket = 'retainWithReason';
      reason = 'MAIN_ONLY 独立 preload 通道（主窗不暴露，设计如此）；保留，逐件在册不计缺陷';
    } else if (!inPreload && !used) {
      bucket = 'deletable';
      reason = 'preload 无包装且渲染层零消费：死通道候选删除（需独立 IPC 契约切片，本包不动通道）';
    } else if (/^(computer-use|window|tray|app|desktop)$/.test(prefix)) {
      bucket = 'retainWithReason';
      reason = `${prefix} 面主进程自驱 / 平台条件通道：保留并逐件留因，待该面实机腿核对`;
    } else {
      bucket = 'needsWiring';
      reason = `${prefix} 面有 preload 包装但渲染层零消费：接线到真实入口或明确标预留（逐件裁决）`;
    }
    buckets[bucket].push({ channel, domain: prefix, mainOnly, inPreload, usedInRenderer: used, reason });
  }
  const total = Object.values(buckets).reduce((n, arr) => n + arr.length, 0);
  const issues = total !== rows.length ? [`分诊覆盖 ${total} ≠ 原始 ${rows.length}`] : [];
  return { ok: issues.length === 0, issues, total, buckets, note: '本包只做逐件分诊与留因，不删通道、不改 preload（破坏性操作需独立切片与同源绿）。' };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const suppressions = JSON.parse(fs.readFileSync(path.join(ROOT, 'eslint-suppressions.json'), 'utf8'));
  const baselinePath = path.join(OUT, 'lint-domain-baseline.json');
  const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : null;
  const assembly = auditToolResultAssembly();
  const lint = evaluateLintRatchet(suppressions, baseline);
  const matrix = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/functional-audit-2026-11-04/surface-matrix.json'), 'utf8'));
  const ipc = triageUnusedIpc(matrix);
  const ok = assembly.ok && lint.ok && ipc.ok;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'prompt-injection-inventory.json'), JSON.stringify(assembly, null, 2) + '\n');
  fs.writeFileSync(path.join(OUT, 'ipc-unused-triage.json'), JSON.stringify(ipc, null, 2) + '\n');
  if (!baseline) {
    fs.writeFileSync(baselinePath, JSON.stringify({ schemaVersion: 1, domains: lint.current, total: lint.total, generatedAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n');
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify({ assembly, lint, ipc }, null, 2));
  else {
    console.log(`[hygiene] B-06 assembly=${assembly.ok ? 'PASS' : 'FAIL'} (${assembly.registered.length} 登记 / ${assembly.found.length} 发现)`);
    console.log(`[hygiene] B-31 lint=${lint.ok ? 'PASS' : 'FAIL'} ${JSON.stringify(lint.current)} total=${lint.total}`);
    console.log(`[hygiene] B-33 ipc=${ipc.ok ? 'PASS' : 'FAIL'} 逐件 ${ipc.total} 条 → ${JSON.stringify(Object.fromEntries(Object.entries(ipc.buckets).map(([k, v]) => [k, v.length])))}`);
    for (const [k, v] of Object.entries({ assembly, lint, ipc })) for (const i of v.issues) console.log(`  [${k}] ${i}`);
  }
  process.exitCode = ok ? 0 : 1;
}
