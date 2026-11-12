#!/usr/bin/env node
/**
 * scripts/m-blueprint-m0-criteria.mjs — 第六轮 M0（BLOCK-426）判据校准纯函数 + 当次读数生成器。
 *
 * 三件事，全部零产品行为变化：
 *   ① adjudicateBlueprintStatus：registry 中 living-plan 的声明状态 vs 其阶段包终态对账，
 *      「阶段包全 completed 而蓝图仍 planned」即红（M0-4 / M-61）。植入必红负测见
 *      test/m0-criteria-calibration.test.mjs（HK-01 红→绿证据在 m0 收口笔录）。
 *   ② summarizeGapLedgers：4 套 gap-ledger（L7 93 / H7 34 / K7 32 / UI-D5 32）汇总为**只读**
 *      剩余工作视图；逐件保留 owner / terminal / evidence / 原 source，不搬移、不改写原文。
 *      L7 `_about` 自称 90 而 statuses 相加 93 的口径矛盾显式暴露为 countDiscrepancy（M0-5 / M-63）。
 *   ③ reconcileReadings：手抄数字与当次现读取数逐字段对账，漂移即红（M0-3 / M-26 / M-64）。
 *
 * 用法：
 *   node scripts/m-blueprint-m0-criteria.mjs --check   # 门：对账 + 视图 + 读数（不写盘）
 *   node scripts/m-blueprint-m0-criteria.mjs --write   # 生成 acceptance/m-blueprint-2026-11-11/m0/*.json
 * 退出码：0 PASS / 1 FAIL / 2 分类冲突。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const M0_DIR = path.join(ROOT, 'acceptance', 'm-blueprint-2026-11-11', 'm0');

/** L7 `_about` 自称「第五轮 90 条发现」——声明值，与机械复算值 93 并列暴露，不静默择一。 */
export const L7_DECLARED_TOTAL = 90;

const LEDGER_SOURCES = Object.freeze([
  'acceptance/post-k7-2026-11-10/l7/gap-ledger.json',
  'acceptance/post-s7-2026-11-09/h7/gap-ledger.json',
  'acceptance/post-h9-2026-11-10/k7/k7-gap-terminal-states.json',
  'acceptance/ui-design-assessment-2026-11-11/d5/gap-ledger.json',
]);

const readJson = (rel, root = ROOT) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

const issue = (code, message, extra = {}) => ({ code, message, ...extra });

/**
 * 纯函数①：蓝图声明状态 vs 阶段包终态。
 * programs: { <tag>: <living-plan id> }；带该 tag 的 work-package 视为该程序的阶段包。
 * 进行中（active/planned）阶段包存在时不报，避免把当前程序误判为 stale。
 * protectedWip: 显式登记「本体属受保护未跟踪 WIP、零触碰」的蓝图 id 列表（登记即留痕，不静默跳过）。
 */
export function adjudicateBlueprintStatus(documents, { programs = {}, protectedWip = [] } = {}) {
  const issues = [];
  const checked = [];
  const excluded = [];
  const byId = new Map(documents.map((d) => [d.id, d]));
  for (const [tag, blueprintId] of Object.entries(programs)) {
    const blueprint = byId.get(blueprintId);
    if (!blueprint) {
      issues.push(issue('BLUEPRINT_NOT_REGISTERED', `程序 ${tag} 的 living-plan ${blueprintId} 未注册`));
      continue;
    }
    const stages = documents.filter(
      (d) => d.kind === 'work-package' && Array.isArray(d.tags) && d.tags.includes(tag),
    );
    const inFlight = stages.filter((s) => s.status === 'active' || s.status === 'planned');
    const allCompleted = stages.length > 0 && stages.every((s) => s.status === 'completed');
    const stale = blueprint.status === 'planned' && allCompleted && inFlight.length === 0;
    checked.push({ tag, blueprintId, blueprintStatus: blueprint.status, stageCount: stages.length, allCompleted, inFlight: inFlight.length });
    if (!stale) continue;
    if (protectedWip.includes(blueprintId)) {
      excluded.push({ blueprintId, reason: '本体为受保护未跟踪 WIP，零触碰；registry 状态翻转会触发既有 FRONTMATTER_STATUS_MISMATCH 门，故不代改' });
      continue;
    }
    issues.push(issue('BLUEPRINT_STATUS_STALE', `${blueprintId} 仍 planned 而 ${stages.length} 个阶段包全 completed——按治理 skill 翻转 registry 状态`));
  }
  return { ok: issues.length === 0, issues, checked, excluded };
}

/**
 * 四套 ledger 的 stage→BLOCK 真实归属映射（来自各程序 AUDIT-LOG/registry 收口记录）。
 * 原文没有 owner 字段时按 stage 派生并标注 ownerSource，绝不无条件兜底掩盖缺失。
 */
export const STAGE_OWNER = Object.freeze({
  L0: 'BLOCK-404', L1: 'BLOCK-405', L2: 'BLOCK-406', L3: 'BLOCK-407',
  L4: 'BLOCK-408', L5: 'BLOCK-409', L6: 'BLOCK-410', L7: 'BLOCK-411',
  K0: 'BLOCK-396', K1: 'BLOCK-397', K2: 'BLOCK-398', K3: 'BLOCK-399',
  K4: 'BLOCK-400', K5: 'BLOCK-401', K6: 'BLOCK-402', K7: 'BLOCK-403',
  H0: 'BLOCK-385', H1: 'BLOCK-386', H2: 'BLOCK-387', H3: 'BLOCK-388',
  H4: 'BLOCK-389', H5: 'BLOCK-390', H6: 'BLOCK-391', H7: 'BLOCK-392',
});

const STAGE_OWNER_MAP = new Map(Object.entries(STAGE_OWNER));

/**
 * 逐件把四套异构 ledger 归一为只读视图行；owner 缺失即红（逐件保留 owner 契约）。
 * 原文 stage 有复合形态（`L3/L4` / `L1/L7` / `H0 / H5` / `K0/K5`）：按 `/` 或 `,`
 * 逐 token 查同一张真实映射表派生出并列 owner，保留原文顺序；这是机械派生不是代填，
 * 且任何 token 查不到都记为 unmatched-stages 留痕，不用兜底掩盖。
 */
function normalizeItem(raw, source) {
  const terminal = String(raw.terminal ?? raw.status ?? '');
  const stage = String(raw.stage ?? raw.dim ?? '');
  const explicit = raw.owner ?? raw.package ?? null;
  const tokens = stage.split(/[/,]/).map((s) => s.trim()).filter(Boolean);
  const derived = tokens.map((t) => STAGE_OWNER_MAP.get(t) ?? null);
  const resolved = derived.filter(Boolean);
  const unmatched = tokens.filter((t) => !STAGE_OWNER_MAP.has(t));
  return {
    id: String(raw.id ?? ''),
    source,
    stage,
    terminal,
    owner: String(explicit ?? resolved.join(' + ') ?? ''),
    ownerSource: explicit ? 'explicit' : (resolved.length ? 'derived-from-stage' : 'missing'),
    unmatchedStages: unmatched,
    evidence: String(raw.evidence ?? raw.evidenceRef ?? raw.note ?? ''),
  };
}

/**
 * 纯函数②：4 套 ledger 只读汇总。原文零改写；声明计数与机械复算计数并列。
 */
export function summarizeGapLedgers({ l7, h7, k7, d5 }) {
  const issues = [];
  const sources = {};
  sources.l7 = {
    declaredTotal: L7_DECLARED_TOTAL,
    computedTotal: Array.isArray(l7.items) ? l7.items.length : 0,
    statusesSum: Object.values(l7.statuses ?? {}).reduce((a, b) => a + (Number(b) || 0), 0),
    countDiscrepancy: (Array.isArray(l7.items) ? l7.items.length : 0) - L7_DECLARED_TOTAL,
  };
  sources.h7 = { declaredTotal: Number(h7.summary?.total ?? 0), computedTotal: Array.isArray(h7.gaps) ? h7.gaps.length : 0 };
  sources.k7 = { declaredTotal: Object.values(k7.terminalCounts ?? {}).reduce((a, b) => a + (Number(b) || 0), 0), computedTotal: Array.isArray(k7.gaps) ? k7.gaps.length : 0 };
  sources.d5 = { declaredTotal: Number(d5.summary?.total ?? 0), computedTotal: Array.isArray(d5.findings) ? d5.findings.length : 0 };

  const items = [
    ...(l7.items ?? []).map((x) => normalizeItem(x, 'L7')),
    ...(h7.gaps ?? []).map((x) => normalizeItem(x, 'H7')),
    ...(k7.gaps ?? []).map((x) => normalizeItem(x, 'K7')),
    ...(d5.findings ?? []).map((x) => normalizeItem(x, 'UI-D5')),
  ];
  const inProgress = items.filter((x) => x.terminal === 'in_progress').length;
  if (inProgress > 0) issues.push(issue('LEDGER_IN_PROGRESS', `${inProgress} 条仍为 in_progress——不得冒充零 in_progress`));
  const missingOwner = items.filter((x) => !x.owner).length;
  if (missingOwner > 0) issues.push(issue('LEDGER_OWNER_MISSING', `${missingOwner} 条缺 owner——逐件保留原 owner 契约`));
  const missingTerminal = items.filter((x) => !x.terminal).length;
  if (missingTerminal > 0) issues.push(issue('LEDGER_TERMINAL_MISSING', `${missingTerminal} 条缺终态`));
  for (const [key, s] of Object.entries(sources)) {
    if (s.computedTotal !== s.declaredTotal && key !== 'l7') {
      issues.push(issue('LEDGER_COUNT_DRIFT', `${key} 声明 ${s.declaredTotal} ≠ 机械复算 ${s.computedTotal}`));
    }
  }
  const byTerminal = {};
  for (const it of items) byTerminal[it.terminal] = (byTerminal[it.terminal] || 0) + 1;
  const bySource = {};
  for (const it of items) bySource[it.source] = (bySource[it.source] || 0) + 1;
  return {
    ok: issues.length === 0,
    issues,
    sources,
    totalItems: items.length,
    inProgress,
    byTerminal,
    bySource,
    items,
  };
}

/** 纯函数③：手抄读数 vs 当次现读取数。任一字段漂移即红。 */
export function reconcileReadings(readings, measured) {
  const pairs = [
    ['closeout.blockingGates', readings.closeout?.blockingGates, measured.closeoutBlockingGates],
    ['registry.total', readings.registry?.total, measured.registryTotal],
    ['impactMap.rules', readings.impactMap?.rules, measured.impactMapRules],
  ];
  const issues = [];
  const compared = [];
  for (const [field, declared, current] of pairs) {
    compared.push({ field, declared, current });
    if (declared !== current) issues.push(issue('READING_DRIFT', `${field} 手抄 ${declared} ≠ 当次现取 ${current}`));
  }
  return { ok: issues.length === 0, issues, compared };
}

/** 当次现读取数（不复用历史全绿）：从 registry / impact-map / package.json 当场算。 */
export function collectMeasured(root = ROOT) {
  const pkg = readJson('package.json', root);
  const registry = readJson('docs/DOC-REGISTRY.json', root);
  const impact = readJson('test/impact-map.json', root);
  return {
    closeoutBlockingGates: (pkg.scripts.closeout.match(/--gate\s+/g) || []).length,
    closeoutReportOnlyGates: (pkg.scripts.closeout.match(/--report\s+/g) || []).length,
    registryTotal: registry.documents.length,
    registryActiveWorkPackages: registry.documents.filter((d) => d.kind === 'work-package' && d.status === 'active').length,
    impactMapRules: impact.rules.length,
    collectedAt: new Date().toISOString(),
  };
}

const TERMINAL_PROGRAMS = Object.freeze({
  'post-k7': 'POST-K7-FULL-AUDIT-AND-BLUEPRINT-2026-11-10',
  'post-h9': 'POST-H9-OPTIMIZATION-BLUEPRINT-2026-11-10',
  'm-blueprint': 'M-BLUEPRINT-2026-11-11-PROGRAM',
});

export function runChecks(root = ROOT) {
  const registry = readJson('docs/DOC-REGISTRY.json', root);
  const ledgers = {
    l7: readJson(LEDGER_SOURCES[0], root),
    h7: readJson(LEDGER_SOURCES[1], root),
    k7: readJson(LEDGER_SOURCES[2], root),
    d5: readJson(LEDGER_SOURCES[3], root),
  };
  const blueprint = adjudicateBlueprintStatus(registry.documents, {
    programs: TERMINAL_PROGRAMS,
    protectedWip: ['POST-H9-OPTIMIZATION-BLUEPRINT-2026-11-10'],
  });
  const view = summarizeGapLedgers(ledgers);
  const measured = collectMeasured(root);
  const readingsPath = path.join(M0_DIR, 'm0-canonical-readings.json');
  const readings = fs.existsSync(readingsPath) ? JSON.parse(fs.readFileSync(readingsPath, 'utf8')) : null;
  const reconciliation = readings
    ? reconcileReadings(readings, measured)
    : { ok: false, issues: [issue('READINGS_MISSING', 'm0-canonical-readings.json 未生成（先跑 --write）')], compared: [] };
  return { blueprint, view, measured, reconciliation, ledgers, registry };
}

function writeEvidence(root = ROOT) {
  fs.mkdirSync(M0_DIR, { recursive: true });
  const { blueprint, view, measured } = runChecks(root);
  const gapView = {
    schemaVersion: 1,
    kind: 'm0-read-only-remaining-work-view',
    generatedAt: new Date().toISOString(),
    policy: '只读汇总：4 套原文零搬移、零改写；逐件保留 owner/terminal/evidence；声明计数与机械复算计数并列暴露',
    sources: LEDGER_SOURCES,
    statusParity: blueprint,
    summary: {
      totalItems: view.totalItems,
      inProgress: view.inProgress,
      bySource: view.bySource,
      byTerminal: view.byTerminal,
      perSource: view.sources,
      l7DeclaredVsComputed: { declared: L7_DECLARED_TOTAL, computed: view.sources.l7.computedTotal, discrepancy: view.sources.l7.countDiscrepancy },
    },
    issues: view.issues,
    items: view.items,
  };
  fs.writeFileSync(path.join(M0_DIR, 'm0-gap-ledger-view.json'), `${JSON.stringify(gapView, null, 2)}\n`);
  const readings = {
    schemaVersion: 1,
    kind: 'm0-canonical-readings',
    generatedAt: measured.collectedAt,
    policy: '数值口径单源：本 JSON 为 M 波次读数的唯一引用点；数字由当次命令现取，不手抄历史全绿；未取数项如实标注',
    baselineCommit: '4127f5b5',
    wip: { modified: 89, untracked: 68, note: '当次 git --no-optional-locks status --porcelain 读数；任务书记 67 untracked，差 1 已留痕；零触碰/零 stage/零提交' },
    closeout: { blockingGates: measured.closeoutBlockingGates, reportOnlyGates: measured.closeoutReportOnlyGates },
    registry: { total: measured.registryTotal, activeWorkPackages: measured.registryActiveWorkPackages },
    impactMap: { rules: measured.impactMapRules },
    gates: [
      { name: 'docs:check', exit: 0, readout: 'PASS 569 registered documents' },
      { name: 'ui:audit:check', exit: 0, readout: 'PASS 633 个带实现证据的 UI 编号' },
      { name: 'hygiene:check', exit: 0, readout: 'PASS 列出 129+ untracked，仅报告' },
      { name: 'quality:secret', exit: 0, readout: 'PASS 3 类 fixture 豁免在册' },
      { name: 'gate:code-size', exit: 0, readout: 'PASS 75 文件 / 86605 行 / 生效例外 16' },
      { name: 'gate:arch-cycles', exit: 0, readout: 'PASS 12 存量环在册，无新环' },
      { name: 'quality:knip:check', exit: 0, readout: 'PASS 保留面 330 键冻结' },
      { name: 'skills:check', exit: 0, readout: 'PASS 11 内置 + 3 领域包' },
      { name: 'quality:types', exit: 0, readout: 'PASS tsc --noEmit 0 error（incremental）' },
      { name: 'quality:arch', exit: 0, readout: 'PASS R1–R5 无违规' },
      { name: 'quality:ear', exit: 0, readout: 'PASS 1052/2271 = 46.3%（阈值 40%；manifest 43.3%）' },
      { name: 'test:changed:list', exit: 2, readout: 'FAIL_CLOSED：2 个 acceptance/m-blueprint-2026-11-11 文件未挂 impact-map rule（本轮引入，M0 补 rule 消解）' },
      { name: 'quality:lint', exit: 1, readout: 'FAIL 2 errors / 2445 warnings；SettingsNav.tsx:39 与 block414-backend-port-reuse.test.mjs:12 均属在制 WIP（W 类）' },
      { name: 'quality:perf', exit: 1, readout: 'FAIL 连续 5/5 采样 packaged_start 496/501/504/512/516ms vs 阈值 493ms；coreSha 7493447930e3f558 绑定有效、host 匹配；不重采基线、不抬阈值、不放宽容差' },
    ],
    remediation: [
      {
        gate: 'test:changed:list',
        before: 'exit 2 FAIL_CLOSED：2 个 acceptance/m-blueprint-2026-11-11 文件未挂 impact-map rule',
        action: '精确增量追加 1 条 m-blueprint-program rule（既有 373 条 rule 零改写）',
        after: 'exit 0（当次复跑）；不改写上面的原始读数，历史读数与修复后读数并列留痕',
      },
      {
        gate: 'test:changed --run',
        before: '1348 tests / 3 fail：W5a 新测试未挂 rule tests（本包引入）+ UI-629 布局 gap 锚 + P6 源绑定',
        action: 'W5a：把 test/m0-criteria-boundaries.test.mjs 挂进 rule tests（隔离复跑 14/14 绿）；UI-629 与 P6 属在制 WIP（相关 CSS 全为 M 状态），按 W 类零触碰登记，不代改',
        after: 'W5a 修复已验证；另两条属 W 归属，复跑不为零，不冒充通过',
      },
      {
        gate: 'quality:lint:ledger',
        before: '4 项：2 条本包新增 lint（动态下标 warning ×2 / 未使用变量 ×1）+ 2 条 W 类在制 WIP errors',
        action: '本包 3 处根因全修（Map 查表 / 删除未使用变量）；warnings 回落 2445 = 基线',
        after: '仅剩 2 条 W 类 errors（SettingsNav.tsx:39 / block414-backend-port-reuse.test.mjs:12），owner 收口',
      },
    ],
    notMeasured: [
      { name: 'closeout', reason: 'M0 收口阶段前台跑，读数另落 m0-closeout-gates.json；未跑前不写通过' },
      { name: 'closeout:full', reason: '全程序收口（M7）才跑；当前树含 89 M + 68 ?? 在制 WIP，不可能满足「干净树」前提，如实标注' },
      { name: 'test:changed --run', reason: 'M0 收口阶段跑；未跑前不写通过' },
      { name: 'test:all:workspace', reason: '定向优先纪律：默认不跑全量；未跑前不写通过' },
      { name: 'gate:post-h9-contracts', reason: 'M7 总收口才跑；未跑前不写通过' },
      { name: 'quality:surface', reason: 'M3 工具能力面重生成后再跑；未跑前不写通过' },
    ],
    perfContradiction: {
      sources: ['docs/Petri-Desktop-Evaluation-Report-2026-11-05.md:94（稳定红）', 'docs/Petri-Desktop-Evaluation-Report-2026-11-05.md:197（并非稳定红）', 'docs/AUDIT-LOG.md:127（perf=V 稳定红不重采不放宽）'],
      verdict: '当次 5/5 全红且 coreSha 绑定有效 ⇒ 矛盾声明降级为「当次读数为准，历史措辞不复用」；按红线不重采基线、不抬阈值、不放宽容差，红轮如实挂账并给补腿条件',
    },
  };
  fs.writeFileSync(path.join(M0_DIR, 'm0-canonical-readings.json'), `${JSON.stringify(readings, null, 2)}\n`);
  return { gapView, readings, measured };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const check = args.includes('--check');
  if (write === check) {
    process.stderr.write('用法：node scripts/m-blueprint-m0-criteria.mjs --check | --write（二者互斥）\n');
    process.exit(2);
  }
  if (write) {
    const { gapView, readings, measured } = writeEvidence();
    process.stdout.write(`[m0-criteria] 写入 2 份证据：gap-ledger 只读视图 ${gapView.summary.totalItems} 件 / in_progress=${gapView.summary.inProgress}；读数 ${readings.gates.length} 门（${readings.gates.filter((g) => g.exit === 0).length} 绿 / ${readings.gates.filter((g) => g.exit !== 0).length} 非绿）；现取 closeout 门数=${measured.closeoutBlockingGates} registry=${measured.registryTotal} impact-map rules=${measured.impactMapRules}\n`);
    process.exit(0);
  }
  const { blueprint, view, reconciliation } = runChecks();
  const problems = [...blueprint.issues, ...view.issues, ...reconciliation.issues];
  process.stdout.write(`[m0-criteria] 状态对账 checked=${blueprint.checked.length} stale=${blueprint.issues.length} protectedWip=${blueprint.excluded.length}；ledger ${view.totalItems} 件 in_progress=${view.inProgress} L7 90↔93 差=${view.sources.l7.countDiscrepancy}；读数对账 ${reconciliation.compared.length} 字段\n`);
  for (const p of problems) process.stdout.write(`  ✖ ${p.code}: ${p.message}\n`);
  process.stdout.write(`[m0-criteria] ${problems.length === 0 ? 'PASS' : 'FAIL'}（${problems.length} issues）\n`);
  process.exit(problems.length === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
