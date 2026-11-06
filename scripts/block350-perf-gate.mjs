#!/usr/bin/env node
/**
 * scripts/block350-perf-gate.mjs — quality:perf 门（BLOCK-350）。
 *
 * 判红规则（冻结，禁事后调门）：对基线里每个非 skipped 场景，采 1 个新样本，
 * 样本 > threshold → 该场景红。threshold 取双判据较大者（BLOCK-359）：
 *   - 相对容差：median × (1 + tolerancePct/100)；
 *   - 绝对噪声地板：median + (absoluteSlackMs || 0)——只对低耗时场景声明（如 20ms 量级
 *     分页读，调度噪声 ±2ms 即 ±10%，纯百分比会落在噪声带内 FAIL/PASS/FAIL 抖动）；
 *     未声明 absoluteSlackMs 的场景阈值公式与 BLOCK-350 逐字节一致。
 * 只防数量级退化，不追求绝对值精确；植入慢样本（≥10×）仍必红。
 *
 * 纯函数 comparePerf(current, baseline) 供负测契约直接喂数据（不跑采集）。
 * 采集走 block350-perf-collect.mjs --gate（每场景 1 样本，写临时文件）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'test', 'perf-baseline.json');

/** 纯函数：current/scenario 样本数组 vs baseline/scenario。红=样本 > max(相对容差, 中位+地板)。 */
export function comparePerf(current, baseline) {
  const rows = [];
  for (const [name, base] of Object.entries(baseline.scenarios || {})) {
    if (base.skipped) {
      rows.push({ name, status: 'skipped', detail: base.reason || '' });
      continue;
    }
    const cur = current?.scenarios?.[name];
    const sample = cur && Number.isFinite(cur.sampleMs) ? cur.sampleMs : null;
    if (sample === null) {
      rows.push({ name, status: 'red', detail: '无当次样本（fail-closed：采集失败或场景缺失即红）' });
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
  return { rows, ok: rows.every((r) => r.status !== 'red') };
}

async function main() {
  if (!fs.existsSync(BASELINE)) {
    console.error('[quality:perf] 基线缺失 test/perf-baseline.json——先跑 scripts/block350-perf-collect.mjs');
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  // 采当次样本（每场景 1 个）
  const tmpOut = path.join(ROOT, 'node_modules', '.cache', `block350-gate-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(tmpOut), { recursive: true });
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'block350-perf-collect.mjs'), '--gate', `--out=${tmpOut}`], { stdio: 'inherit', timeout: 300000 });
    const current = JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
    const { rows, ok } = comparePerf(current, baseline);
    for (const r of rows) console.log(`[${r.status}] ${r.name} — ${r.detail}`);
    console.log(`[quality:perf] ${ok ? 'PASS' : 'FAIL'}（${rows.filter((r) => r.status === 'green').length} 绿 / ${rows.filter((r) => r.status === 'red').length} 红 / ${rows.filter((r) => r.status === 'skipped').length} skip）`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    try { fs.rmSync(tmpOut, { force: true }); } catch { /* best-effort */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
