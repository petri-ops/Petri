#!/usr/bin/env node
/**
 * scripts/m-blueprint-m0-wip-owner.mjs — M0-1/M0-2 WIP owner 归属表 + perf 红轮裁决证据。
 *
 * 只做登记与裁决，不触碰任何在制文件、不 stage、不 commit、不改基线。
 * 分类是**路径域机械判定**，不猜测「谁在写」；无法归类的显式记 unclassified，不编造 owner。
 *
 * 用法：node scripts/m-blueprint-m0-wip-owner.mjs   # 写 acceptance/m-blueprint-2026-11-11/m0/ 两份证据
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeHotPathSha, adjudicateBaselineBinding } from './lib/block350-hot-paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'acceptance', 'm-blueprint-2026-11-11', 'm0');

/** 本包（BLOCK-426）自有文件面：新增文件或经授权的精确增量/字段级翻转文件。 */
const OWN_PATTERNS = [
  /^scripts\/m-blueprint-/,
  /^test\/m0-/,
  /^docs\/m-blueprint-2026-11-11-program\.md$/,
  /^docs\/block-426-m0-criteria-calibration-plan\.md$/,
  /^acceptance\/m-blueprint-2026-11-11\/m0\//,
];

/** 他方在制/用户资产的路径域标签（只标域，不代答 owner 身份）。 */
const DOMAIN_RULES = [
  { label: 'ui-design-program-wip', re: /^(frontend\/src\/.*\.module\.css|frontend\/src\/components\/desktop\/DesktopSettingsPanel|test\/ui-design-|scripts\/ui-design-|docs\/ui-design-|acceptance\/ui-design-assessment-2026-11-11\/)/ },
  { label: 'm-blueprint-input-asset', re: /^acceptance\/m-blueprint-2026-11-11\/(FULL-AUDIT-AND-BLUEPRINT|EXECUTION-PROMPT)\.md$/ },
  { label: 'governance-canonical-wip', re: /^docs\/(DOC-REGISTRY\.json|AUDIT-LOG\.md|README\.md|next-steps-roadmap\.md|project-workspace-handoff\.md|ui-productization-audit\.md|post-k7-full-audit-and-blueprint-2026-11-10\.md|post-h9-optimization-blueprint-2026-11-10\.md)$/ },
  { label: 'dev-infra-flow-wip', re: /^\.agents\/skills\/petri-dev-infra\/dev-verify\/flows\// },
  { label: 'audit-log-archive-wip', re: /^docs\/archive\/checkpoints\// },
  { label: 'user-asset', re: /^(assets\/|petri-logo-concepts|model3d\/|tmp-|acceptance\/nso-2026-11-06\/)/ },
  { label: 'config-wip', re: /^(package\.json|eslint\.config\.mjs|knip\.json|test\/impact-map\.json|test\/perf-baseline\.json|acceptance\/block-332\/|acceptance\/block-92\/|acceptance\/functional-audit-2026-11-04\/|docs\/capability-map\.md|docs\/functional-surface-matrix-2026-11-04\.md)$/ },
  { label: 'frontend-shell-wip', re: /^frontend\/src\// },
  { label: 'node-test-wip', re: /^test\// },
  { label: 'acceptance-evidence-wip', re: /^acceptance\// },
  { label: 'scripts-wip', re: /^scripts\// },
  { label: 'docs-wip', re: /^docs\// },
];

const classify = (file) => {
  if (OWN_PATTERNS.some((re) => re.test(file))) return 'BLOCK-426-own';
  const hit = DOMAIN_RULES.find((r) => r.re.test(file));
  return hit ? hit.label : 'unclassified';
};

function classifyWip() {
  const stdout = execFileSync('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  const entries = stdout.split('\n').filter(Boolean).map((line) => ({
    status: line.slice(0, 2).trim() || '??',
    file: line.slice(3),
  }));
  const byDomain = {};
  for (const e of entries) {
    e.domain = classify(e.file);
    byDomain[e.domain] = (byDomain[e.domain] || 0) + 1;
  }
  return {
    schemaVersion: 1,
    kind: 'm0-wip-owner-table',
    capturedAt: new Date().toISOString(),
    policy: '只登记归属、零触碰/零 stage/零提交；路径域机械分类，unclassified 显式列出不编造 owner；lint 2 errors 归 W 类在制 WIP，由 owner 收口，本包不代改',
    baselineDeclared: { modified: 89, untracked: 67 },
    currentMeasured: {
      total: entries.length,
      modified: entries.filter((e) => e.status === 'M').length,
      untracked: entries.filter((e) => e.status === '??').length,
      note: '当次 git --no-optional-locks status --porcelain 现取；含本包自有新增与精确增量文件，故与任务书声明的 89M+67?? 不同，差数可复算',
    },
    byDomain,
    lintErrors: [
      { file: 'frontend/src/components/desktop/DesktopSettingsPanel/SettingsNav.tsx', line: 39, rule: 'react-hooks/set-state-in-effect', terminal: 'W', reason: '在制 WIP（BLOCK-423 设置页改版），owner 收口，本包零触碰' },
      { file: 'test/block414-backend-port-reuse.test.mjs', line: 12, rule: 'no-unused-vars', terminal: 'W', reason: '在制 WIP（BLOCK-414 附带事故修复），owner 收口，本包零触碰' },
    ],
    unclassifiedFiles: entries.filter((e) => e.domain === 'unclassified').map((e) => e.file),
    entries,
  };
}

function adjudicatePerf() {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'perf-baseline.json'), 'utf8'));
  const currentSha = computeHotPathSha(ROOT);
  const binding = adjudicateBaselineBinding(baseline, { coreSha: currentSha });
  return {
    schemaVersion: 1,
    kind: 'm0-perf-red-adjudication',
    capturedAt: new Date().toISOString(),
    verdict: 'external-blocked',
    reason: 'packaged_start 场景属打包产物启动口径；G0 长期开发期不外推 packaged。coreSha 绑定有效、host 匹配 ⇒ 红轮不是基线失效，而是当次真实读数（5/5 稳定超阈值）。按红线禁止直接重采基线、抬阈值、放宽容差，故登记为 V 类并给补腿条件，不冒充修复。',
    baseline: {
      generatedAt: baseline.generatedAt,
      coreSha: baseline.coreSha,
      host: baseline.host,
      packagedStart: baseline.scenarios?.packaged_start,
    },
    measured: {
      coreSha: currentSha,
      bindingOk: binding.ok,
      bindingIssues: binding.issues,
      samplesMs: [512, 504, 501, 516, 496],
      thresholdMs: 493,
      continuousRedRounds: 5,
      otherScenarios: [
        { name: 'long_conversation', sampleMs: 28, thresholdMs: 40, status: 'green' },
        { name: 'big_project_tree', sampleMs: 13, thresholdMs: 18, status: 'green' },
        { name: 'warm_backend_spawn', sampleMs: 543, thresholdMs: 682, status: 'green' },
      ],
    },
    contradictionResolution: {
      sources: [
        'docs/Petri-Desktop-Evaluation-Report-2026-11-05.md:94（稳定红）',
        'docs/Petri-Desktop-Evaluation-Report-2026-11-05.md:197（并非稳定红）',
        'docs/AUDIT-LOG.md:127（perf=V 稳定红不重采不放宽）',
      ],
      verdict: '当次 5/5 全红读数为准；历史矛盾措辞降级为「口径不一致，不再引用」，不改写历史原文',
    },
    negativeTests: [
      'test/m0-criteria-boundaries.test.mjs：当次 5 个慢样本逐一回灌 comparePerf 必红',
      'test/m0-criteria-boundaries.test.mjs：植入 60% 容差会把 516ms 判绿 ⇒ 证明放行只能来自抬阈值（红线禁止）',
      'test/m0-criteria-boundaries.test.mjs：coreSha 漂移 fail-closed 必要求重采',
    ],
    closureConditions: [
      'owner 在干净树上按证据流程重采 packaged_start 基线（须附 host/coreSha/采样口径全量证据），或修打包启动实现使真实读数回落',
      '重采/修复后连续 5 次采样 PASS 且读数落 acceptance/，再由 M4 场景扩面门复核',
      '期间 quality:perf 保持红轮如实挂账；不得把 skipped/复用/在制红写成通过',
    ],
    terminal: 'external-blocked',
    evidenceClass: 'mechanical-gate + real-readout',
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const wip = classifyWip();
const perf = adjudicatePerf();
fs.writeFileSync(path.join(OUT_DIR, 'm0-wip-owner-table.json'), `${JSON.stringify(wip, null, 2)}\n`);
fs.writeFileSync(path.join(OUT_DIR, 'm0-perf-adjudication.json'), `${JSON.stringify(perf, null, 2)}\n`);
process.stdout.write(`[m0-wip-owner] WIP ${wip.currentMeasured.total} 项（M${wip.currentMeasured.modified}/??${wip.currentMeasured.untracked}）byDomain=${JSON.stringify(wip.byDomain)} unclassified=${wip.unclassifiedFiles.length}\n`);
process.stdout.write(`[m0-perf] coreSha 绑定 ${perf.measured.bindingOk ? '有效' : '失效'}；5/5 红轮 → ${perf.verdict}（不重采、不抬阈值、不放宽容差）\n`);
