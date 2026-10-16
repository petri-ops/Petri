#!/usr/bin/env node
/**
 * scripts/evals-admission.mjs — BLOCK-191 formal-admission 门（晋升清单台账 + 双齐违规 + 显式审计源码门）。
 * 用法：npm run evals:admission [-- --json]
 * 退出码：0=全部用例达准入且基线写仅显式审计；1=存在违规（防退化即红）。零 provider / 零人眼。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveAdmissionManifest, evalAdmission } from './lib/evals-admission.mjs';
import { listSuites, collectSuiteTasks } from './lib/evals-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suitesDir = path.join(root, 'evals', 'suites');

const rows = [];
for (const suite of listSuites(suitesDir)) {
  for (const t of collectSuiteTasks(suitesDir, suite)) {
    const m = deriveAdmissionManifest(t, suite);
    const a = evalAdmission(m);
    rows.push({ suite, tier: m.tier, id: m.id, fixture: m.fixtureCount, declared: m.fixtureDeclaredNotNeeded, admitted: a.admitted, missing: a.missing });
  }
}

// 显式审计源码门：任何写 evals/baselines/ 或 evals/snapshots/ 的 writeFileSync，其前文必须含显式审计 flag。
const AUDIT_FLAGS = ['--update', '--update-snapshot', 'update'];
function auditGateViolations() {
  const out = [];
  for (const f of ['scripts/evals-gate.mjs', 'scripts/evals-run.mjs']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const re = /writeFileSync\(\s*(baselinePath|snapshotPath|path\.join\([^)]*snapshots[^)]*\))/g;
    let mm;
    while ((mm = re.exec(src))) {
      const before = src.slice(Math.max(0, mm.index - 500), mm.index);
      if (!AUDIT_FLAGS.some((k) => before.includes(k))) out.push(`${f}: 基线/快照写入未被显式审计 flag 守卫`);
    }
  }
  return out;
}

const gateViolations = auditGateViolations();
const admissions = rows.filter((r) => !r.admitted);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: rows.length, admitted: rows.length - admissions.length, rows, gateViolations }, null, 2));
} else {
  console.log(`formal-admission 台账：用例 ${rows.length} · 达准入 ${rows.length - admissions.length} · 未齐 ${admissions.length} · 审计门违规 ${gateViolations.length}`);
  for (const r of rows) console.log(` ${r.admitted ? '✔' : '✖'} [${r.suite}/${r.tier}] ${r.id} fixture=${r.fixture}${r.declared ? '(声明免)' : ''}${r.admitted ? '' : ` 缺=${r.missing.join(',')}`}`);
  for (const v of gateViolations) console.log(` ✖ 审计门：${v}`);
}
process.exitCode = admissions.length === 0 && gateViolations.length === 0 ? 0 : 1;
