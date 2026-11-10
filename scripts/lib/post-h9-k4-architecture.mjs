#!/usr/bin/env node
/**
 * K4 架构债事实采集与裁决（纯函数 + 只读扫描，供篡改负测）。
 *
 * 核实五类：源码扫描契约计数、插件源单点、三树版本、环/键/巨型文件、H10 tracked。
 * 裁决器不读写外部状态，负测可直接注入篡改对象。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SCAN_CONTRACT_FILES = Object.freeze([
  'test/loop-orchestrator-subdomains.test.mjs',
  'test/block199-config-drift.test.mjs',
  'test/nso-w5b-second-truth.test.mjs',
  'test/release-contract.test.mjs',
]);
export const H10_FILES = Object.freeze([
  'cascade-scan.json', 'cdp-event-projection.json', 'cold-start-x5.json',
  'color-baseline.json', 'cycle-clusters.json', 'debt-adjudication.json',
  'deferred-triage.json', 'unmapped-decay-batch2.json',
]);

/** 单个测试文件里的「源码扫描式」断言计数：includes / match(源码串) / 行数锚。 */
export function countSourceScanAsserts(text) {
  const stripped = String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  return {
    includes: (stripped.match(/\.includes\(/g) || []).length,
    srcMatch: (stripped.match(/assert\.match\([^,]*[Ss]rc|new RegExp\([^\n]*\.test\(/g) || []).length,
    lineAnchor: (stripped.match(/LINE_ANCHORS|lines\s*<=\s*anchor|lines\s*>=\s*anchor/g) || []).length,
  };
}

export function collectArchitectureTruth(root = ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const json = (rel) => JSON.parse(read(rel));

  // ① 源码扫描契约
  const scanContracts = {};
  for (const rel of SCAN_CONTRACT_FILES) scanContracts[rel] = countSourceScanAsserts(read(rel));
  const releaseStructured = /findToolDeclarations|manifest\.json/.test(read('test/release-contract.test.mjs')) &&
    !/src\.includes\(/.test(read('test/release-contract.test.mjs'));

  // ② 插件源单点
  const registry = read('core/petri-server/mcp/registry.js');
  const server = read('core/petri-server/server.js');
  const pluginLoader = read('core/petri-server/plugin-loader.js');
  const pluginSources = {
    registryCallsResolver: /resolveDefaultPluginSources\(\)/.test(registry),
    serverCallsResolver: /resolveDefaultPluginSources\(\)/.test(server),
    singleSourceProvider: /function resolveDefaultPluginSources|resolveDefaultPluginSources\s*=/.test(pluginLoader),
    assemblySites: [
      { file: 'core/petri-server/mcp/registry.js', ownArray: /loadFromSourcesArray\(computePluginSources\(\)\)/.test(registry) },
      { file: 'core/petri-server/server.js', ownArray: /loadFromSourcesArray\(\[/.test(server) },
    ],
  };

  // ③ 三树版本
  const rootPkg = json('package.json');
  const frontPkg = json('frontend/package.json');
  const corePkg = json('core/petri-server/package.json');
  const versions = {
    root: {
      typescript: (rootPkg.dependencies || {}).typescript || null,
      uuid: (rootPkg.dependencies || {}).uuid || null,
      'better-sqlite3': (rootPkg.dependencies || {})['better-sqlite3'] || null,
    },
    core: {
      uuid: (corePkg.dependencies || {}).uuid || null,
      'better-sqlite3': (corePkg.dependencies || {})['better-sqlite3'] || null,
    },
    frontend: {
      typescriptDev: (frontPkg.devDependencies || {}).typescript || null,
    },
  };
  const depParityOnlyDependencies = /pkg\.dependencies \|\| \{\}/.test(read('scripts/post-s7-dependency-parity-gate.mjs'));
  const tsDriftDetectedByGate = false; // devDependencies 不在该门比较范围（实测）

  // ④ 环/键/巨型文件
  const cycles = json('acceptance/block-109/arch-cycles-baseline.json');
  const knip = json('test/knip-baseline.json');
  const sizeBaseline = json('acceptance/block-92/size-baseline.json');
  const bigAnchor = json('acceptance/post-s7-2026-11-10/h9/big-file-anchor.json');
  const codeSizeSrc = read('scripts/code-size-ledger.mjs');
  const archDebt = {
    cycles: (cycles.cycles || []).length,
    knipKeys: (knip.keys || []).length,
    sizeFiles: (sizeBaseline.files || []).length,
    loopOrchestratorInManifest: /loop-orchestrator\.js/.test(codeSizeSrc),
    loopOrchestratorLines: (() => {
      const f = (bigAnchor.files || []).find((x) => x.path && x.path.includes('loop-orchestrator'));
      return f ? f.lines : null;
    })(),
    knipFullEntryInWorkspace: /core\/\*\*\/\*\.js/.test(read('knip.json')),
    dynamicRequirePoints: [
      /require\(handlerPath\)/.test(read('core/petri-server/agent-tools/plugin-loader.js')),
      /require\(registryPath\)/.test(read('core/petri-server/agent-tools/learning.js')),
      /require\(path\.join\(SHARED_BACKEND/.test(registry),
    ],
  };

  // ⑤ H10 tracked（真实 git 索引查询，不用文档自述）
  const tracked = execFileSync('git', ['ls-files', 'acceptance/post-s7-2026-11-10/h10/'], { cwd: root, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  const h10 = {
    trackedFiles: tracked.length,
    expectedFiles: H10_FILES.length,
    allTracked: H10_FILES.every((f) => tracked.includes(`acceptance/post-s7-2026-11-10/h10/${f}`)),
    unmappedRemaining: (json('test/impact-map-coverage-baseline.json').unmappedTests || []).length,
    decayBatch: (() => { const d = json('acceptance/post-s7-2026-11-10/h10/unmapped-decay-batch2.json'); return { before: d.before, assigned: d.assigned, remaining: d.remaining }; })(),
    cycleClusters: (() => { const d = json('acceptance/post-s7-2026-11-10/h10/cycle-clusters.json'); return { totalCycles: d.totalCycles, decision: d.decision }; })(),
  };

  const sourceScanBaselineFile = json('acceptance/post-h9-2026-11-10/k4/k4-source-scan-baseline.json');
  return {
    scanContracts, releaseStructured, pluginSources, versions,
    depParityOnlyDependencies, tsDriftDetectedByGate,
    archDebt, h10,
    sourceScanBaseline: sourceScanBaselineFile.perFile || sourceScanBaselineFile,
  };
}

/** 源码扫描契约只减不增棘轮：新增扫描式断言即红。 */
export function adjudicateSourceScan(current, baseline) {
  const issues = [];
  for (const rel of SCAN_CONTRACT_FILES) {
    const cur = current[rel];
    const base = baseline[rel];
    if (!cur || !base) { issues.push(`${rel} 缺读数或冻结基线`); continue; }
    for (const key of ['includes', 'srcMatch', 'lineAnchor']) {
      if (cur[key] > base[key]) issues.push(`${rel} ${key} ${cur[key]} > 冻结 ${base[key]}（新增源码扫描契约即红）`);
    }
  }
  return { ok: issues.length === 0, issues, verdict: issues.length === 0 ? 'source-scan-non-increasing' : 'source-scan-increased' };
}

/** 总裁决：五类不变量 + 边界项不得冒充已修。 */
export function adjudicateArchitecture(input) {
  const issues = [];
  const conclusions = {};
  const t = {
    scanContracts: {}, pluginSources: { assemblySites: [] }, versions: {},
    archDebt: { dynamicRequirePoints: [] }, h10: {}, sourceScanBaseline: {},
    ...(input && typeof input === 'object' ? input : {}),
  };
  t.scanContracts = t.scanContracts || {};
  t.pluginSources = t.pluginSources || { assemblySites: [] };
  t.versions = t.versions || {};
  t.archDebt = t.archDebt || { dynamicRequirePoints: [] };
  t.h10 = t.h10 || {};

  // K-20：棘轮 + release 结构化校准
  let n = issues.length;
  const scan = adjudicateSourceScan(t.scanContracts, t.sourceScanBaseline);
  for (const i of scan.issues) issues.push(`K-20: ${i}`);
  if (t.releaseStructured !== true) issues.push('K-20: release-contract 应已换成结构化声明解析（B-20），校准证据失效');
  conclusions['K-20'] = issues.length === n ? 'ratchet-frozen' : 'drift';

  // K-19：解析面单源，装配面两处如实登记
  n = issues.length;
  if (!(t.pluginSources.registryCallsResolver && t.pluginSources.serverCallsResolver && t.pluginSources.singleSourceProvider)) {
    issues.push('K-19: 插件源解析面单点被回退');
  }
  const ownArrays = (t.pluginSources.assemblySites || []).filter((s) => s.ownArray).length;
  if (ownArrays !== 2) issues.push('K-19: 装配面两处各自拼数组的现状被改写（不得冒充已单源）');
  conclusions['K-19'] = issues.length === n ? 'resolution-single-source-assembly-still-split' : 'drift';

  // K-31：typescript 漂移只读检出，不判红、不改版本
  n = issues.length;
  const v = t.versions;
  if (!(v.root && v.root.typescript === '^5.9.3' && v.frontend && v.frontend.typescriptDev === '^5.5.4')) {
    issues.push('K-31: 三树版本读数被改写（对账依据失效）');
  }
  if (!(v.root && v.root.uuid === '^9.0.1' && v.core && v.core.uuid === '^9.0.1')) issues.push('K-31: uuid 已同版的事实被改写');
  if (t.depParityOnlyDependencies !== true) issues.push('K-31: 依赖对账门范围被改写');
  if (t.tsDriftDetectedByGate !== false) issues.push('K-31: typescript 漂移检出状态被改写');
  conclusions['K-31'] = issues.length === n ? 'drift-reported-pending-ruling' : 'drift';

  // K-22 / K-18：环与键与巨型文件现状。
  // L0-1（蓝图 L-37/L-44）：原「入册/固定行数/全量 entry 即判红」反向门禁已废——
  // 改为读数型记录 + 只增即红棘轮：存量环/保留键**增长**才判红，
  // 入册（size 台账扩面）、knip entry 收窄、环消亡、W5b 拆分降行数均属改进方向，
  // 由各自真实棘轮（arch-cycles-gate / knip-ratchet / code-size-ledger / big-file-anchor）守护。
  n = issues.length;
  const a = t.archDebt;
  if (!(typeof a.cycles === 'number' && a.cycles <= 12)) issues.push('K-22: 存量环只增不退被破坏（新增环即红；消亡走 arch-cycles-gate --write 下调）');
  if (!(typeof a.knipKeys === 'number' && a.knipKeys <= 330)) issues.push('K-22: knip 保留面只增不退被破坏（新增保留键即红；收窄走 knip-ratchet --update 下调）');
  if (!(Array.isArray(a.dynamicRequirePoints) && a.dynamicRequirePoints.every(Boolean))) issues.push('K-22: 三处动态 require 现状被改写');
  conclusions['K-22/K-18'] = issues.length === n ? 'debt-readings-recorded-improvement-allowed' : 'drift';

  // K-21：H10 已入仓校准
  n = issues.length;
  if (!(t.h10.allTracked && t.h10.trackedFiles === 8)) issues.push('K-21: H10 证据 tracked 状态被改写');
  if (!(t.h10.unmappedRemaining === 90 && t.h10.decayBatch && t.h10.decayBatch.before === 120 && t.h10.decayBatch.remaining === 90)) {
    issues.push('K-21: 120→90 未映射消亡读数被改写');
  }
  if (!(t.h10.cycleClusters && t.h10.cycleClusters.totalCycles === 12)) issues.push('K-21: 12 环归因证据被改写');
  conclusions['K-21'] = issues.length === n ? 'h10-committed-90-remaining' : 'drift';

  return {
    ok: issues.length === 0, issues, conclusions,
    verdict: issues.length === 0 ? 'architecture-invariants-verified-w5b-deferred' : 'architecture-drift',
  };
}

function main() {
  const truth = collectArchitectureTruth();
  const verdict = adjudicateArchitecture(truth);
  console.log(JSON.stringify({ verdict, scanContracts: truth.scanContracts, versions: truth.versions, h10: truth.h10 }, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`[post-h9:k4] fail-closed: ${e.message}`); process.exitCode = 1; }
}
