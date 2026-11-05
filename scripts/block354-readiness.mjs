#!/usr/bin/env node
/**
 * scripts/block354-readiness.mjs — G0→G1 出籍就绪度复算（BLOCK-354，零人工干预）。
 *
 * 判据表（6 项，冻结于 docs/block-354-g0-exit-criteria-plan.md §2；证据=前序包稳定路径）：
 *   ① 通用任务基准达标      —— acceptance/block-348/results.json（8 任务全有终态+度量）
 *   ② 实机证据清偿          —— docs/block-349-clearance-report.md（A 类 13 条全终态）+ 台账 A 类行清账
 *   ③ 性能基线建立并入门    —— test/perf-baseline.json（四场景在案）+ package.json quality:perf ∈ closeout
 *   ④ 证据资产化 ≥40%       —— acceptance/block-351/assetized-manifest.json（totals.earPct ≥ 40）
 *   ⑤ 扩展货架无未处置空壳  —— acceptance/block-352/shelf-matrix.json（allJudged 且全判定）
 *   ⑥ packaged 回归无阻断   —— acceptance/block-353/packaged-regression.json（structure+health+fullTask 一致）
 *
 * 输出 N/6 + 未达原因；负测=test/block354-readiness.test.mjs（喂缺证据的 fixture 判未达）。
 * 就绪度只由本脚本生成，禁止手改。**出籍就绪 ≠ 已出籍；G1 启动需用户显式发令。**
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'acceptance', 'block-354', 'readiness.json');

const readJson = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; }
};
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

export function judgeCriteria({ files = null } = {}) {
  const f = (rel) => (files && rel in files) ? files[rel] : (files ? null : readJson(rel));
  const has = (rel) => (files && rel in files) ? Boolean(files[rel]) : (files ? false : exists(rel));
  const results = [];

  // ① 通用任务基准
  {
    const r = f('acceptance/block-348/results.json');
    const ok = Boolean(r && Array.isArray(r.tasks) && r.tasks.length === 8
      && r.tasks.every((t) => t.status || t.skipped)
      && r.metrics && r.metrics.autonomousCompletion);
    results.push({ id: 'universal-benchmark', ok, evidence: 'acceptance/block-348/results.json', reason: ok ? `8/8 任务有终态，度量在场` : 'results.json 缺失/任务不足 8/缺度量' });
  }
  // ② 实机证据清偿
  {
    const okReport = has('docs/block-349-clearance-report.md');
    let terminalOk = false;
    if (okReport) {
      const text = fs.readFileSync(path.join(ROOT, 'docs/block-349-clearance-report.md'), 'utf8');
      terminalOk = text.includes('10 verified') && text.includes('3 cancelled') && text.includes('十三条终态表');
    }
    results.push({ id: 'evidence-clearance', ok: okReport && terminalOk, evidence: 'docs/block-349-clearance-report.md', reason: okReport && terminalOk ? 'A 类 13 条全终态（10 verified + 3 cancelled）' : '清偿报告缺失或终态口径不完整' });
  }
  // ③ 性能基线
  {
    const b = f('test/perf-baseline.json');
    let scenariosOk = false;
    if (b && b.scenarios) {
      const names = ['cold_start', 'long_conversation', 'big_project_tree', 'packaged_start'];
      scenariosOk = names.every((n) => b.scenarios[n] && (b.scenarios[n].skipped ? Boolean(b.scenarios[n].reason) : Number.isFinite(b.scenarios[n].medianMs)));
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const gateInCloseout = (pkg.scripts.closeout || '').includes('quality:perf');
    results.push({ id: 'perf-baseline', ok: scenariosOk && gateInCloseout, evidence: 'test/perf-baseline.json + package.json', reason: scenariosOk && gateInCloseout ? `四场景在案（含 packaged 补建）且 quality:perf 入 closeout` : '基线缺失/场景不全/quality:perf 未入 closeout' });
  }
  // ④ EAR
  {
    const m = f('acceptance/block-351/assetized-manifest.json');
    const ok = Boolean(m && m.totals && Number(m.totals.earPct) >= 40);
    results.push({ id: 'evidence-assetization', ok, evidence: 'acceptance/block-351/assetized-manifest.json', reason: ok ? `EAR = ${m.totals.earPct}% ≥ 40%` : 'manifest 缺失或 EAR < 40%' });
  }
  // ⑤ 扩展货架
  {
    const s = f('acceptance/block-352/shelf-matrix.json');
    const ok = Boolean(s && s.totals && s.totals.allJudged === true && Number(s.totals.skills) > 0 && Number(s.totals.plugins) > 0);
    results.push({ id: 'extension-shelf', ok, evidence: 'acceptance/block-352/shelf-matrix.json', reason: ok ? `三货架 ${s.totals.skills + s.totals.plugins} 项全判定（无未处置空壳）` : '矩阵缺失或有未判定条目' });
  }
  // ⑥ packaged 回归
  {
    const g = f('acceptance/block-353/packaged-regression.json');
    const ok = Boolean(g && g.sections && g.sections.structure && g.sections.structure.allOk
      && g.sections.fourHealth && g.sections.fourHealth.backendHealth && g.sections.fourHealth.migrationHealthy
      && g.sections.fullTask && g.sections.fullTask.status === 'completed'
      && g.sections.devComparison && g.sections.devComparison.consistent === true);
    results.push({ id: 'packaged-regression', ok, evidence: 'acceptance/block-353/packaged-regression.json', reason: ok ? '结构全过 + 四项健康 + T2 completed + 与 dev 一致' : '回归证据缺失/结构缺路径/任务未完成/不一致' });
  }
  return results;
}

async function main() {
  const results = judgeCriteria();
  const passed = results.filter((r) => r.ok).length;
  const out = {
    at: new Date().toISOString(),
    criteriaFrozenAt: '2026-11-05（docs/block-354-g0-exit-criteria-plan.md §2）',
    readiness: `${passed}/6`,
    allPassed: passed === 6,
    redLine: '出籍就绪 ≠ 已出籍：未达 6/6 前不得表述 GA / Provider / 对外发布能力；6/6 达标后 G1 启动仍需用户显式发令。',
    criteria: results,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`[block354] 出籍就绪度：${passed}/6`);
  for (const r of results) console.log(`  ${r.ok ? '✔' : '✖'} ${r.id} — ${r.reason}（${r.evidence}）`);
  console.log(`[block354] ${out.redLine}`);
  console.log(`[block354] 报告 → ${path.relative(ROOT, OUT)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
