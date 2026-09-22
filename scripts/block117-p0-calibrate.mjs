#!/usr/bin/env node
/**
 * BLOCK-117 P1 — 本地 Laya 供给接点级校准裁决 harness（plan docs/block-117-laya-supply-validation-plan.md §1.1 P1）。
 *
 * 机制：不改三个原 harness 的语料/组装器/门限判据，仅通过两个通道重定向——
 *  1. BIOF3_DECISION_CONFIG_PATH → 沙箱配置（供给指向本地 laya_decide serve，零 API 费用零外发）；
 *  2. CALIBRATION_EVIDENCE_OUT/FILE/MODEL → 证据落 acceptance/block-117/（原 Jev 证据文件零风险）。
 * 裁决语义：沿用各接点原 P0 门限（gate.passed）——达标=可采纳（附建议 θ），
 * 不达标=不可采纳（附最优 θ 曲线摘要）；不放松任何门限、不硬凑 θ。
 *
 * 用法：
 *   node scripts/block117-p0-calibrate.mjs --dry   # 只验前置（语料在位 + 本地 serve 可达），零决策调用
 *   node scripts/block117-p0-calibrate.mjs         # 三接点全量校准（需本地 serve 运行）
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const { writeEvidence } = require(path.join(root, 'scripts', 'lib', 'calibration-common.mjs'));

const EVIDENCE_DIR = path.join(root, 'acceptance', 'block-117');
const SANDBOX_CONFIG = path.join(EVIDENCE_DIR, 'fixtures', 'decision-config-laya-sandbox.json');

// 接点 → 原 harness + 语料（镜像各原 harness 的 CORPUS_FILE，用于 --dry 前置校验）
const POINTS = [
  { point: 'intent-route', script: 'block112-p0-calibrate.mjs', corpus: 'acceptance/block-112/corpus-intent-routing.json' },
  { point: 'tool-route', script: 'block113-p0-calibrate.mjs', corpus: 'acceptance/block-113/corpus-tool-routing.json' },
  { point: 'marker-celltype', script: 'block111-p0-calibrate.mjs', corpus: 'acceptance/block-111/corpus-marker-celltype.json' },
];

async function serveReachable() {
  try {
    const health = await fetch('http://127.0.0.1:8765/health', { signal: AbortSignal.timeout(3000) });
    return health.ok;
  } catch {
    return false;
  }
}

async function main() {
  const dry = process.argv.includes('--dry');
  const problems = [];
  for (const { point, corpus } of POINTS) {
    if (!fs.existsSync(path.join(root, corpus))) problems.push(`${point} 语料缺失：${corpus}`);
  }
  if (!fs.existsSync(SANDBOX_CONFIG)) problems.push(`沙箱配置缺失：${SANDBOX_CONFIG}`);
  if (!(await serveReachable())) problems.push('本地 Laya 供给不可达（http://127.0.0.1:8765/health）——先启动 laya_decide serve');

  if (problems.length) {
    console.error('[block117] 前置不满足：\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.log('[block117] 前置 OK：三接点语料在位 + 本地供给可达 + 沙箱配置在位');
  if (dry) {
    console.log('[block117] --dry：不执行决策调用');
    return;
  }

  const perPoint = [];
  for (const { point, script } of POINTS) {
    const outFile = `calibration-${point}-laya.json`;
    console.log(`\n[block117] ▶ ${point}（经 ${script}，供给=本地 Laya）`);
    const run = spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
      env: {
        ...process.env,
        BIOF3_DECISION_CONFIG_PATH: SANDBOX_CONFIG,
        CALIBRATION_EVIDENCE_OUT: EVIDENCE_DIR,
        CALIBRATION_EVIDENCE_FILE: outFile,
        CALIBRATION_EVIDENCE_MODEL: 'laya-typed-decisions (local supply)',
      },
    });
    const tail = (run.stdout || '').trim().split('\n').slice(-4).join('\n');
    if (tail) console.log(tail);
    const evidencePath = path.join(EVIDENCE_DIR, outFile);
    if (!fs.existsSync(evidencePath)) {
      perPoint.push({
        point, verdict: 'error',
        detail: `harness 未产出证据（exit=${run.status}，stderr 尾部：${(run.stderr || '').trim().split('\n').slice(-3).join(' | ').slice(0, 300)}）`,
      });
      continue;
    }
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    perPoint.push({
      point,
      verdict: evidence.gate && evidence.gate.passed ? 'adoptable' : 'not_adoptable',
      recommendedThreshold: evidence.result && evidence.result.recommendedThreshold != null
        ? evidence.result.recommendedThreshold : null,
      gateCriterion: evidence.gate && evidence.gate.criterion,
      evidenceFile: `acceptance/block-117/${outFile}`,
      model: evidence.model,
    });
  }

  const adoptable = perPoint.filter((p) => p.verdict === 'adoptable');
  const summary = {
    kind: 'block117-laya-supply-calibration',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    model: 'laya-typed-decisions (local supply, convaiinnovations/laya via laya_decide serve /v1/systemone)',
    wrapper: 'core/biof3-server/helpers/decision-api.js（客户端零改动，D-B provider 可替换性）',
    supplySandbox: 'fixtures/decision-config-laya-sandbox.json（BIOF3_DECISION_CONFIG_PATH 通道；零 API 费用零外发）',
    verdictRule: '沿用各接点原 P0 门限判据，不因换模型放松；不可采纳即如实落证据',
    perPoint,
    summaryLine: `三接点裁决：可采纳 ${adoptable.length}/${POINTS.length}${adoptable.length ? '（' + adoptable.map((p) => p.point + (p.recommendedThreshold != null ? '@θ=' + p.recommendedThreshold : '')).join('、') + '）' : ''}`,
  };
  const out = writeEvidence(EVIDENCE_DIR, 'calibration-laya-summary.json', summary);
  console.log(`\n[block117] ${summary.summaryLine}`);
  console.log(`[block117] 裁决汇总已写入 ${path.relative(root, out)}`);
  // 有接点 error 视为运行事故退出非零；纯 not_adoptable 是合法裁决，退出 0
  if (perPoint.some((p) => p.verdict === 'error')) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
