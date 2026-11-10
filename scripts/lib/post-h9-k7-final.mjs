#!/usr/bin/env node
/**
 * K7 总收口事实采集与裁决（纯函数 + 只读）。
 *
 * 单一真相源：acceptance/post-h9-2026-11-10/gap-terminal-ledger.json（32 条终态）
 * 与各阶段 closeout-gates.json（门禁读数）。本模块不新建第二台账。
 *
 * 十一维六列复评：前五列逐字沿用蓝图 §0.3（不回溯调参），第六列「终验」由
 * 本程序当次提交与读数逐条归因；无证据的维度保持平或按有证据的机械增量记。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROGRAM_DIR = 'acceptance/post-h9-2026-11-10';

/** 前五列逐字来自蓝图 §0.3；第六列本程序终验，差值归因到提交/读数。 */
export const REVIEW_TABLE = Object.freeze([
  { dim: '功能完整性', atEval: 4.2, nso: 4.3, s7: 4.4, h7: 4.4, h9: 4.4, final: 4.4, target: 4.7,
    attribution: '平。16 域 facade / 168 通道 / MCP 单入口未动；K1 实证 goals 已汇编、viewer 能力位已接线（蓝图缺口声明校准，非新增能力）；K2 additive hasMore/nextCursor 信封不改变默认 100 上限；8 任务套件当次 ETIMEDOUT 未完成，不给分' },
  { dim: '性能表现', atEval: 3.5, nso: 3.8, s7: 3.8, h7: 3.9, h9: 3.9, final: 3.9, target: 4.5,
    attribution: '平。K0 作废三条失真判据并重立（12 负测）、K5 perf 显式证据 5/5 与 DOM 阈值纯函数门；但 K2 会话真分页、K5 DOM/帧率判据入门禁、T7 自然长任务均属 L/V 未闭合，证据增量不足以升分' },
  { dim: '代码质量', atEval: 3.3, nso: 3.6, s7: 3.7, h7: 3.9, h9: 4.0, final: 4.1, target: 4.5,
    attribution: '+0.1。K0 lint∩hygiene 联动门 / K3 内联样式债棘轮门 / K4 源码扫描契约只减不增棘轮门 / K5 严格证据元数据门 / K6 PiP 四项基线红绿先行，共 5 个新机械门各带负测；K3 lint 红门删死导入根修（3db14806）零放宽基线' },
  { dim: '可维护性', atEval: 3.2, nso: 3.5, s7: 3.6, h7: 3.7, h9: 3.7, final: 3.7, target: 4.4,
    attribution: '平。K2 具名上限常量收编 10 文件 15 行（纯重构，拆前拆后各 18/18）、K4 插件源解析面单源防回退；但五巨型文件未拆、装配面仍两处拼数组、3 族源码扫描契约未换行为断言，按 W5b 逐刀纪律挂起，不升分' },
  { dim: '可扩展性', atEval: 4.2, nso: 4.5, s7: 4.5, h7: 4.5, h9: 4.5, final: 4.5, target: 4.8,
    attribution: '平。16 域 facade / listTools+callTool 单入口 / 168 通道注册制零改动；K1 未新增零消费声明位、K6 未建第二 IPC 包装器，三矩阵同源改造仍挂 W5b' },
  { dim: '安全性', atEval: 3.4, nso: 4.0, s7: 4.2, h7: 4.3, h9: 4.3, final: 4.4, target: 4.6,
    attribution: '+0.1。K6 补上最后一个未覆盖创建点：PiP sandbox/webSecurity 显式达标并纳入 WINDOW_FILES（红 1→绿 3/3），4 个 BrowserWindow 创建点四项基线全覆盖 + 漏配/漏登记负测；ADMISSION/FK 维持既有裁决未变' },
  { dim: '用户界面与交互体验', atEval: 3.7, nso: 3.7, s7: 3.8, h7: 4.0, h9: 4.1, final: 4.1, target: 4.6,
    attribution: '平。K3 四事件反向契约 22/22、布局单源防回退、debt 35 机械分诊；但暗色对比/读屏/长内容三态人眼未签字（签名区全空）、颜色值未 token 化、focus trap 未做，不冒 verified' },
  { dim: '错误处理与边界情况', atEval: 3.1, nso: 3.5, s7: 3.7, h7: 3.9, h9: 3.9, final: 4.0, target: 4.6,
    attribution: '+0.1。K0 判据作废重立的 fail-closed 裁决器、K1 MCP 计量误判校准（不污染账本）、K5 证据元数据五类不冒充门、K6 四个创建点安全断言；但 8 处生产空 catch 未清零、四事件 Toast 历史未接、64MB 单入口未收编，升幅受未闭合项限制' },
  { dim: '测试覆盖', atEval: 3.7, nso: 4.1, s7: 4.2, h7: 4.3, h9: 4.4, final: 4.5, target: 4.7,
    attribution: '+0.1。K0–K6 新增契约测试 45+29+15+3(HTTP)+22+19+22+14=169 项（含 100+ 条篡改负测），每阶段定向 test:changed 全绿、K0 干净树 closeout:full ×3 19 门全绿；但 test:all:sharded 全量三段本程序未跑（如实标注），升幅受限' },
  { dim: '文档完善度', atEval: 4.3, nso: 4.5, s7: 4.6, h7: 4.7, h9: 4.7, final: 4.7, target: 4.8,
    attribution: '平。八阶段独立 plan + 5 份 U/E/V/L 决策材料全部登记 registry/README，每阶段六件套同批回写；AUDIT-LOG 仍 >50KB 建议阈（audit:compact 自稳）、docs:reconcile 136 归档候选本轮零归档，不升分' },
  { dim: '依赖与架构合理性', atEval: 3.7, nso: 3.9, s7: 4.0, h7: 4.0, h9: 4.0, final: 4.0, target: 4.6,
    attribution: '平。全程零新增依赖、三套 lock 未动、typescript 双版本漂移只读检出（U 类待裁决）、12 环/330 键/五巨型文件基线零放宽；W5b 结构性重构仍挂起，不升分' },
]);

export const WIP_ASSETS = Object.freeze([
  'acceptance/nso-2026-11-06/wave-0/full-test-shards/summary-1793978091259.json',
  'assets/', 'docs/pelican-bicycle.html', 'docs/post-h9-optimization-blueprint-2026-11-10.md',
  'model3d/enclosure-120x80x30-wall3p0.scene3d.json', 'petri-logo-concepts.miora',
  'petri-logo-concepts_assets/', 'scripts/backfill-artifact-chain.mjs',
  'tmp-block342-live/', 'tmp-review/',
]);

export function collectFinalTruth(root = ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const json = (rel) => JSON.parse(read(rel));
  const ledger = json(`${PROGRAM_DIR}/gap-terminal-ledger.json`);

  // 各阶段门禁读数
  const gates = {};
  for (const k of ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6']) {
    const p = `${PROGRAM_DIR}/${k}/${k}-closeout-gates.json`;
    if (fs.existsSync(path.join(root, p))) {
      const g = json(p);
      gates[k] = { verdict: g.verdict, blockingPass: g.blockingPass ?? null, testChanged: g.testChanged ?? null };
    }
  }

  // 本程序提交链（用于差值归因）
  const commits = execFileSync('git', ['log', '--oneline', '--since=2026-11-10T12:00:00Z', '--grep=block-39'], { cwd: root, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean).slice(0, 40);

  // 工作区现状
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const trackedChanges = status.filter((l) => !l.startsWith('??'));
  const untracked = status.filter((l) => l.startsWith('??')).map((l) => l.slice(3));

  return {
    ledger,
    terminalCounts: ledger.terminalCounts,
    gaps: ledger.gaps,
    gates,
    review: REVIEW_TABLE,
    stageHistory: ledger.stageHistory || [],
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    commits,
    workspace: { trackedChanges, untracked, protectedAssets: WIP_ASSETS },
    // 逐行判定：只有「确认人/日期」冒号后同行有填写、或复选框从 ☐ 变 ☑ 才算签字；
    // 「结论：verified ☐」是模板文字不计；不能用 \s*\S（会跨行误命中）。
    humanEyeRouteSigned: (() => {
      const lines = read('docs/post-s7-h7-human-eye-route.md').split('\n');
      return lines.some((l) => /^(确认人|日期)：[^\s]/.test(l.trim())) || lines.some((l) => /[☑✅]/.test(l));
    })(),
    taskSuite: json(`${PROGRAM_DIR}/k7/task-suite-attempt.json`),
  };
}

/** 32 条逐件终态覆盖 + 复评六列完整性 + 边界项不冒 verified。 */
export function adjudicateFinal(input) {
  const issues = [];
  const t = { ledger: { gaps: [], terminalCounts: {} }, review: [], gates: {}, taskSuite: {}, ...(input && typeof input === 'object' ? input : {}) };
  const gaps = Array.isArray(t.ledger.gaps) ? t.ledger.gaps : [];

  if (gaps.length !== 32) issues.push(`缺口数 ${gaps.length} != 32（静默消失）`);
  if (new Set(gaps.map((g) => g.id)).size !== gaps.length) issues.push('缺口 id 重复');
  const inProgress = gaps.filter((g) => g.terminal === 'in_progress');
  if (inProgress.length) issues.push(`总收口残留 in_progress: ${inProgress.map((g) => g.id).join(',')}`);
  const computed = {};
  for (const g of gaps) computed[g.terminal] = (computed[g.terminal] || 0) + 1;
  if (JSON.stringify(computed) !== JSON.stringify(t.ledger.terminalCounts)) issues.push('terminalCounts 与 gaps 不一致');

  if (!Array.isArray(t.review) || t.review.length !== 11) issues.push('十一维复评行数 != 11');
  for (const r of t.review || []) {
    for (const k of ['atEval', 'nso', 's7', 'h7', 'h9', 'final', 'target']) {
      if (!Number.isFinite(r[k])) issues.push(`${r.dim} 缺列 ${k}`);
    }
    if (r.final < r.h9) issues.push(`${r.dim} 终验分 < H9 复核（不回溯调参）`);
    if (!r.attribution || !r.attribution.trim()) issues.push(`${r.dim} 缺差值归因`);
  }

  if (Object.keys(t.gates || {}).length < 7) issues.push('七阶段门禁证据不齐');
  for (const [k, g] of Object.entries(t.gates || {})) {
    if (g.verdict !== 'passed') issues.push(`${k} closeout 证据 verdict != passed`);
  }

  const ts = t.taskSuite || {};
  if (ts.tasksClaimed8of8 === true) issues.push('真实任务被冒充 8/8');
  if (t.humanEyeRouteSigned === true) issues.push('人眼路线出现签字记录，需人工复核（Agent 不代答）');

  const up = (t.review || []).filter((r) => r.final > r.h9).length;
  const flat = (t.review || []).length - up;
  const qualified = (t.review || []).filter((r) => r.final >= 4.4).length;
  return {
    ok: issues.length === 0, issues,
    terminalCounts: computed,
    reviewSummary: { up, flat, down: 0, qualifiedAt44: qualified, total: 11 },
    verdict: issues.length === 0 ? 'post-h9-program-final-closeout-verified-with-open-boundaries' : 'final-drift',
  };
}

function main() {
  const truth = collectFinalTruth();
  const verdict = adjudicateFinal(truth);
  console.log(JSON.stringify({ verdict, review: REVIEW_TABLE.map((r) => ({ dim: r.dim, h9: r.h9, final: r.final, delta: +(r.final - r.h9).toFixed(1) })) }, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`[post-h9:k7] fail-closed: ${e.message}`); process.exitCode = 1; }
}
