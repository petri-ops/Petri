#!/usr/bin/env node
/**
 * scripts/block350-perf-gate.mjs — quality:perf 门（BLOCK-350；L0-2 判据重立）。
 *
 * 判红规则：对基线里每个非 skipped 场景，采 3 轮取**中位**（不再 min-of-2 藏慢轮），
 * 中位样本 > threshold → 该场景红。threshold 取双判据较大者（BLOCK-359）：
 *   - 相对容差：median × (1 + tolerancePct/100)——warm_backend_spawn/packaged_start 已收紧
 *     （25%/30%，锚定当次重采基线）；
 *   - 绝对噪声地板：median + (absoluteSlackMs || 0)——只对低耗时场景声明。
 * 基线绑定（L-30）：host 与 HOT_PATH_FILES 组合 sha 失配 → exit 2 要求重采（不再换机型/
 * 改热路径后基线照用）。skipped（L-28）：**默认判红**——缺样本不得即绿；PETRI_ALLOW_SKIP=1
 * 才放行并记 coverageGaps。真冷启动五段腿单列（coldStartTrueLeg 指针，脚本缺失即 exit 2）。
 *
 * 纯函数 comparePerf(current, baseline, {allowSkip}) 供负测契约直接喂数据（不跑采集）。
 * 采集走 block350-perf-collect.mjs --gate（每场景 3 轮中位，写临时文件）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { adjudicateBaselineBinding, computeHotPathSha } from './lib/block350-hot-paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'test', 'perf-baseline.json');

/** 纯函数：current/scenario 样本 vs baseline/scenario。红=中位样本 > max(相对容差, 中位+地板) 或缺样本/skipped（默认）。 */
export function comparePerf(current, baseline, { allowSkip = false } = {}) {
  const rows = [];
  const coverageGaps = [];
  for (const [name, base] of Object.entries(baseline.scenarios || {})) {
    if (base.skipped) {
      // L0-2（L-28）：skipped 默认判红（缺样本不得即绿）；显式 PETRI_ALLOW_SKIP=1 放行并计覆盖缺口。
      if (allowSkip) {
        coverageGaps.push({ name, reason: base.reason || '' });
        rows.push({ name, status: 'skipped-allowed', detail: `场景未采样（PETRI_ALLOW_SKIP=1 放行，计覆盖缺口）：${base.reason || ''}` });
      } else {
        rows.push({ name, status: 'red', detail: `场景 skipped（L-28：缺样本默认判红，不得冒充覆盖）：${base.reason || ''}` });
      }
      continue;
    }
    const cur = current?.scenarios?.[name];
    const sample = cur && Number.isFinite(cur.sampleMs) ? cur.sampleMs : null;
    if (sample === null) {
      rows.push({
        name,
        status: 'red',
        detail: cur?.skipped
          ? '当次采集 skipped（L-28：缺样本默认判红）——确认产物在位，或显式 PETRI_ALLOW_SKIP=1 并留痕'
          : '无当次样本（fail-closed：采集失败或场景缺失即红）',
      });
      continue;
    }
    const relativeThreshold = Math.ceil(base.medianMs * (1 + base.tolerancePct / 100));
    // BLOCK-359 双判据：低耗时场景声明 absoluteSlackMs（绝对噪声地板）防纯百分比落进噪声带；
    // 未声明（||0）时地板=中位本身，阈值恒等于相对容差（旧行为）。
    const absoluteFloor = base.medianMs + (Number.isFinite(base.absoluteSlackMs) ? base.absoluteSlackMs : 0);
    const threshold = Math.max(relativeThreshold, Math.ceil(absoluteFloor));
    rows.push({
      name,
      status: sample > threshold ? 'red' : 'green',
      detail: `sample=${sample}ms vs median=${base.medianMs}ms × (1+${base.tolerancePct}%) → ${relativeThreshold}ms，地板 ${Math.ceil(absoluteFloor)}ms → 阈值 ${threshold}ms`,
    });
  }
  return { rows, ok: rows.every((r) => r.status !== 'red'), coverageGaps };
}

async function main() {
  if (!fs.existsSync(BASELINE)) {
    console.error('[quality:perf] 基线缺失 test/perf-baseline.json——先跑 scripts/block350-perf-collect.mjs');
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  // L0-2（L-30）：基线绑定校验——host / 热路径组合 sha 失配即 exit 2 要求重采（fail-closed）。
  const binding = adjudicateBaselineBinding(baseline, { coreSha: computeHotPathSha(ROOT) });
  if (!binding.ok) {
    console.error('[quality:perf] 基线绑定失效——');
    for (const i of binding.issues) console.error(`  ✖ ${i}`);
    process.exit(2);
  }
  // L0-2（L-27）：真冷启动五段腿指针在场性校验（声明了腿就必须有脚本可跑）。
  if (baseline.coldStartTrueLeg?.script && !fs.existsSync(path.join(ROOT, baseline.coldStartTrueLeg.script))) {
    console.error('[quality:perf] coldStartTrueLeg 脚本缺失——真冷启动腿声明失效（fail-closed）');
    process.exit(2);
  }
  // BLOCK-380（S5 / G-19）——连续采样判据：默认连续 N 次 PASS 才出 PASS（棘轮防
  // 「单次抖动假绿」）；PETRI_PERF_SAMPLES=1 保留旧单次语义（本地快速迭代用）。
  const samples = Math.max(1, Number(process.env.PETRI_PERF_SAMPLES) || 5);
  const allowSkip = process.env.PETRI_ALLOW_SKIP === '1';
  if (allowSkip) console.log('[quality:perf] PETRI_ALLOW_SKIP=1：skipped 场景放行并计覆盖缺口（L-28 显式豁免，须留痕）');
  const allRows = [];
  const allGaps = [];
  let allOk = true;
  for (let i = 1; i <= samples; i += 1) {
    const tmpOut = path.join(ROOT, 'node_modules', '.cache', `block350-gate-${Date.now()}-${i}.json`);
    fs.mkdirSync(path.dirname(tmpOut), { recursive: true });
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'block350-perf-collect.mjs'), '--gate', `--out=${tmpOut}`], { stdio: samples > 1 ? 'pipe' : 'inherit', timeout: 300000 });
      const current = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
      const { rows, ok, coverageGaps } = comparePerf(current, baseline, { allowSkip });
      allRows.push({ sample: i, rows, ok });
      allGaps.push(...coverageGaps);
      if (!ok) allOk = false;
      if (samples > 1) {
        const red = rows.filter((r) => r.status === 'red').length;
        console.log(`[quality:perf] 采样 ${i}/${samples}: ${red === 0 ? '全绿' : red + ' 红'}`);
        if (red > 0) for (const r of rows.filter((r) => r.status === 'red')) console.log(`  [${r.status}] ${r.name} — ${r.detail}`);
      } else {
        for (const r of rows) console.log(`[${r.status}] ${r.name} — ${r.detail}`);
      }
    } finally {
      try { fs.rmSync(tmpOut, { force: true }); } catch { /* best-effort */ }
    }
  }
  if (samples > 1) {
    // 汇总口径：以最差一轮为准（任一轮红=红）
    const worst = allRows.reduce((acc, s) => (s.ok ? acc : s), allRows[0]);
    const rows = worst ? worst.rows : [];
    for (const r of rows) console.log(`[${r.status}] ${r.name} — ${r.detail}`);
    console.log(`[quality:perf] ${allOk ? 'PASS' : 'FAIL'}（连续 ${samples} 次采样，${allOk ? '全部通过' : '存在红轮'}）`);
  } else {
    const rows = allRows[0] ? allRows[0].rows : [];
    console.log(`[quality:perf] ${allOk ? 'PASS' : 'FAIL'}（${rows.filter((r) => r.status === 'green').length} 绿 / ${rows.filter((r) => r.status === 'red').length} 红 / ${rows.filter((r) => r.status === 'skipped-allowed').length} skip-allowed）`);
  }
  if (allGaps.length) console.log(`[quality:perf] 覆盖缺口 ${allGaps.length} 项：${[...new Set(allGaps.map((g) => g.name))].join(', ')}（skipped-allowed 已放行，未覆盖如实记录）`);
  // POST-S7 H5/B-22——perf 证据机器可读（opt-in：PETRI_PERF_EVIDENCE=<path>）。
  // 默认不写盘：每次 closeout 都写会在干净树上制造无意义 diff；需要落证据时显式给路径，
  // 产出带 sourceCommit / platform / command / generatedAt 的 JSON（五类证据不得互相冒充）。
  if (process.env.PETRI_PERF_EVIDENCE) {
    let sourceCommit = null;
    try {
      sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    } catch { /* 非 git 环境如实留空 */ }
    const evidence = {
      schemaVersion: 1,
      kind: 'post-s7-h5-perf-evidence',
      sourceCommit,
      platform: process.platform + '-' + process.arch,
      command: 'PETRI_PERF_EVIDENCE=<path> npm run quality:perf',
      generatedAt: new Date().toISOString(),
      samples,
      samplesGreen: allRows.filter((row) => row.ok).length,
      verdict: allOk ? 'pass' : 'fail',
      coverageGaps: allGaps,
      baselineBinding: { host: baseline.host, coreSha: baseline.coreSha, coldStartTrueLeg: baseline.coldStartTrueLeg?.script || null },
      rows: allRows,
      note: '连续采样口径：任一轮红即整体红（最差轮为准）。毫秒读数不等于用户观感，DOM 节点数与帧率需 CDP 腿（H5 挂起项）。',
    };
    const target = path.resolve(process.env.PETRI_PERF_EVIDENCE);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(evidence, null, 2));
    console.log(`[quality:perf] evidence -> ${target}`);
  }
  process.exitCode = allOk ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
