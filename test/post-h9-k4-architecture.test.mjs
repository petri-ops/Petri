/**
 * K4 架构债契约（五类不变量 + 新机械门负测 + U/W5b 边界不冒充已修）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectArchitectureTruth, adjudicateArchitecture, adjudicateSourceScan,
  countSourceScanAsserts, SCAN_CONTRACT_FILES, H10_FILES,
} from '../scripts/lib/post-h9-k4-architecture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const truth = collectArchitectureTruth(ROOT);
const tamper = (patch) => adjudicateArchitecture({ ...truth, ...patch });
const mustRed = (v, prefix) => {
  assert.equal(v.ok, false, `${prefix} 篡改后必须判红`);
  assert.ok(v.issues.some((i) => i.startsWith(prefix)), `应产生 ${prefix} 归因: ${v.issues.join(' / ')}`);
};

test('K4 五类不变量在真实源码下成立，W5b/U 边界如实标注', () => {
  const v = adjudicateArchitecture(truth);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.deepEqual(v.conclusions, {
    'K-20': 'ratchet-frozen',
    'K-19': 'resolution-single-source-assembly-still-split',
    'K-31': 'drift-reported-pending-ruling',
    'K-22/K-18': 'debt-readings-recorded-improvement-allowed',
    'K-21': 'h10-committed-90-remaining',
  });
});

// ---- K-20 源码扫描棘轮门 ----
test('K-20：release-contract 已结构化；3 族扫描契约仍在（不冒充已换行为断言）', () => {
  assert.equal(truth.releaseStructured, true);
  assert.equal(truth.scanContracts[SCAN_CONTRACT_FILES[0]].lineAnchor > 0, true);
  assert.equal(truth.scanContracts[SCAN_CONTRACT_FILES[1]].includes > 0, true);
  assert.equal(truth.scanContracts[SCAN_CONTRACT_FILES[2]].includes > 0, true);
  assert.equal(truth.scanContracts[SCAN_CONTRACT_FILES[3]].includes, 0);
});

test('K-20：门禁在干净树判绿且逐文件与冻结基线一致', () => {
  const v = adjudicateSourceScan(truth.scanContracts, truth.sourceScanBaseline);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.equal(Object.keys(truth.sourceScanBaseline).length, SCAN_CONTRACT_FILES.length);
});

test('负测 新机械门：任一文件新增 includes 断言 → 判红', () => {
  const rel = SCAN_CONTRACT_FILES[1];
  const bumped = { ...truth.scanContracts, [rel]: { ...truth.scanContracts[rel], includes: truth.scanContracts[rel].includes + 1 } };
  const v = adjudicateSourceScan(bumped, truth.sourceScanBaseline);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.includes('新增源码扫描契约即红')));
});

test('负测 新机械门：新增行数锚 / 清空冻结清单 → 判红', () => {
  const rel = SCAN_CONTRACT_FILES[0];
  const bumped = { ...truth.scanContracts, [rel]: { ...truth.scanContracts[rel], lineAnchor: truth.scanContracts[rel].lineAnchor + 1 } };
  assert.equal(adjudicateSourceScan(bumped, truth.sourceScanBaseline).ok, false);
  assert.equal(adjudicateSourceScan(truth.scanContracts, {}).ok, false);
});

test('countSourceScanAsserts 行为：注释里的 includes 不计，真实断言可复算', () => {
  const a = countSourceScanAsserts('// foo.includes(x)\n');
  assert.equal(a.includes, 0);
  const b = countSourceScanAsserts('assert.ok(src.includes("x")); const LINE_ANCHORS = [];');
  assert.equal(b.includes, 1);
  assert.equal(b.lineAnchor, 1);
});

test('负测 K-20：release-contract 校准证据被改写 → 判红', () => {
  mustRed(tamper({ releaseStructured: false }), 'K-20');
});

// ---- K-19 插件源 ----
test('K-19：解析面三处同源于 resolveDefaultPluginSources，装配面仍两处各自拼数组', () => {
  assert.equal(truth.pluginSources.registryCallsResolver, true);
  assert.equal(truth.pluginSources.serverCallsResolver, true);
  assert.equal(truth.pluginSources.singleSourceProvider, true);
  assert.equal(truth.pluginSources.assemblySites.filter((s) => s.ownArray).length, 2);
});

test('负测 K-19：解析面被改回三处独立解析 → 判红', () => {
  mustRed(tamper({ pluginSources: { ...truth.pluginSources, serverCallsResolver: false } }), 'K-19');
});

test('负测 K-19：把装配面冒充已单源 → 判红', () => {
  const sites = truth.pluginSources.assemblySites.map((s) => ({ ...s, ownArray: false }));
  mustRed(tamper({ pluginSources: { ...truth.pluginSources, assemblySites: sites } }), 'K-19');
});

// ---- K-31 版本漂移（只读对账，不改版本） ----
test('K-31：typescript 漂移真实存在且未被 dependency parity 门检出', () => {
  assert.equal(truth.versions.root.typescript, '^5.9.3');
  assert.equal(truth.versions.frontend.typescriptDev, '^5.5.4');
  assert.equal(truth.versions.root.uuid, '^9.0.1');
  assert.equal(truth.versions.core.uuid, '^9.0.1');
  assert.equal(truth.versions.root['better-sqlite3'], '^12.11.1');
  assert.equal(truth.versions.core['better-sqlite3'], '^12.11.1');
  assert.equal(truth.depParityOnlyDependencies, true);
  assert.equal(truth.tsDriftDetectedByGate, false);
});

test('负测 K-31：版本读数被改写 → 判红（防把漂移洗掉）', () => {
  mustRed(tamper({ versions: { ...truth.versions, frontend: { typescriptDev: '^5.9.3' } } }), 'K-31');
});

test('负测 K-31：把漂移写成「门已检出」→ 判红（不得冒充已修）', () => {
  mustRed(tamper({ tsDriftDetectedByGate: true }), 'K-31');
});

// ---- K-22 / K-18 债现状（L0-1：读数型记录 + 只增即红棘轮） ----
test('K-22/K-18：债读数在场（读数型；入册/收窄/拆分为改进方向不再判红——L0-1 解反向门禁）', () => {
  assert.equal(truth.archDebt.cycles, 12);
  assert.equal(truth.archDebt.knipKeys, 330);
  assert.equal(typeof truth.archDebt.sizeFiles, 'number');
  assert.equal(typeof truth.archDebt.loopOrchestratorInManifest, 'boolean');
  assert.equal(truth.archDebt.loopOrchestratorLines, 1579);
  assert.equal(typeof truth.archDebt.knipFullEntryInWorkspace, 'boolean');
  assert.deepEqual(truth.archDebt.dynamicRequirePoints, [true, true, true]);
});

test('负测 K-22：存量环 / knip 保留键 / 动态 require 现状增长或被改写 → 判红（只增即红棘轮）', () => {
  mustRed(tamper({ archDebt: { ...truth.archDebt, cycles: 13 } }), 'K-22');
  mustRed(tamper({ archDebt: { ...truth.archDebt, knipKeys: 331 } }), 'K-22');
  mustRed(tamper({ archDebt: { ...truth.archDebt, dynamicRequirePoints: [true, true, false] } }), 'K-22');
});

test('L0-1 解除负测：入册 / knip entry 收窄 / 环消亡三类「改进」不再判红（原反向门禁已废）', () => {
  // ① 巨型文件入册（L0-7 实际执行：size 台账扩面）
  const registered = tamper({ archDebt: { ...truth.archDebt, loopOrchestratorInManifest: true, sizeFiles: truth.archDebt.sizeFiles + 43 } });
  assert.equal(registered.ok, true, registered.issues.join(' / '));
  // ② knip entry 收窄 + 保留面下降（L5-4 实际执行）
  const narrowed = tamper({ archDebt: { ...truth.archDebt, knipFullEntryInWorkspace: false, knipKeys: 300 } });
  assert.equal(narrowed.ok, true, narrowed.issues.join(' / '));
  // ③ 存量环消亡（L5-6 目标）
  const decayed = tamper({ archDebt: { ...truth.archDebt, cycles: 11 } });
  assert.equal(decayed.ok, true, decayed.issues.join(' / '));
});

// ---- K-21 H10 tracked 校准 ----
test('K-21：H10 8 份证据全部 tracked，120→90 已入仓，12 环归簇≠消亡', () => {
  assert.equal(truth.h10.trackedFiles, 8);
  assert.equal(H10_FILES.length, 8);
  assert.equal(truth.h10.allTracked, true);
  assert.equal(truth.h10.unmappedRemaining, 90);
  assert.deepEqual(truth.h10.decayBatch, { before: 120, assigned: 30, remaining: 90 });
  assert.equal(truth.h10.cycleClusters.totalCycles, 12);
  assert.match(String(truth.h10.cycleClusters.decision), /attributed|known-root/);
});

test('负测 K-21：把 H10 写成未入仓 / 把 90 洗成 0 → 判红', () => {
  mustRed(tamper({ h10: { ...truth.h10, allTracked: false, trackedFiles: 0 } }), 'K-21');
  mustRed(tamper({ h10: { ...truth.h10, unmappedRemaining: 0 } }), 'K-21');
});

test('负测：事实整体缺席 → fail-closed 判红', () => {
  assert.equal(adjudicateArchitecture({}).ok, false);
});
