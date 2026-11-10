/**
 * post-H9 全程序基座契约（红绿先行 + 逐件负测）：
 *   ① 证据元数据四字段 + 五类不冒充；
 *   ② 32 条缺口终态台账：不静默消失、计数机械汇总、边界项不冒通过；
 *   ③ 九组数字口径采集：字段名真实、坏源判红；
 *   ④ 治理工具 selftest：幂等 / 证据先行 / 白名单 / 锚点损坏 fail-closed；
 *   ⑤ K-05 lint∩hygiene 联动门：植入临时产物必红、空豁免必红。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_META, EVIDENCE_CLASSES, evidenceMeta, validateEvidence,
} from '../scripts/lib/post-h9-evidence.mjs';
import {
  LEDGER_REL, TERMINALS, GAP_DEFS, validateLedger, emptyLedger,
  recomputeCounts, setTerminal,
} from '../scripts/lib/post-h9-gap-ledger.mjs';
import { READING_IDS, validateReadings, collectReadings } from '../scripts/lib/post-h9-k0-readings.mjs';
import { evaluateOverlap, isTempArtifact, isLintScannable, isProtected } from '../scripts/lib/post-h9-k0-lint-hygiene.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA = String(evidenceMeta(ROOT).sourceCommit || '');

function goodEvidence() {
  return {
    ...evidenceMeta(ROOT), command: 'node --test test/post-h9-evidence-and-ledger.test.mjs',
    evidenceClass: 'mechanical-gate', verdict: 'measured', humanEyeEquivalent: false, stack: 'none',
  };
}

// ---------- ① 证据元数据 ----------
test('证据四字段 + 五类声明齐备且 sourceCommit 为 40 位 sha', () => {
  const e = goodEvidence();
  assert.deepEqual(validateEvidence(e), { ok: true, missing: [], violations: [] });
  for (const k of REQUIRED_META) assert.ok(e[k] !== undefined && e[k] !== null && e[k] !== '');
  assert.match(SHA, /^[0-9a-f]{40}$/);
});

for (const field of ['sourceCommit', 'platform', 'command', 'generatedAt', 'evidenceClass', 'verdict', 'humanEyeEquivalent', 'stack']) {
  test(`负测：证据缺 ${field} 必红`, () => {
    const e = goodEvidence();
    delete e[field];
    const v = validateEvidence(e);
    assert.equal(v.ok, false);
    assert.ok(v.missing.includes(field));
  });
}

test('负测：sourceCommit 非完整 sha 必红', () => {
  assert.equal(validateEvidence({ ...goodEvidence(), sourceCommit: 'a33a53cc' }).ok, false);
});

test('负测：evidenceClass 不在封闭词表必红', () => {
  assert.equal(validateEvidence({ ...goodEvidence(), evidenceClass: 'vibes' }).ok, false);
  assert.equal(EVIDENCE_CLASSES.length, 6);
});

test('负测：机械门/行为测试声明 humanEyeEquivalent=true（冒充人眼）必红', () => {
  assert.equal(validateEvidence({ ...goodEvidence(), humanEyeEquivalent: true }).ok, false);
  assert.equal(validateEvidence({ ...goodEvidence(), evidenceClass: 'behavior-test', humanEyeEquivalent: true }).ok, false);
  assert.equal(validateEvidence({ ...goodEvidence(), evidenceClass: 'human-eye', humanEyeEquivalent: true }).ok, true);
});

test('负测：决策材料写 PASS/verified/completed 冒充通过必红', () => {
  for (const verdict of ['PASS', 'verified', 'completed']) {
    assert.equal(validateEvidence({ ...goodEvidence(), evidenceClass: 'decision-material', verdict }).ok, false, verdict);
  }
  assert.equal(validateEvidence({ ...goodEvidence(), evidenceClass: 'decision-material', verdict: 'pending-ruling' }).ok, true);
});

// ---------- ② 32 条缺口终态台账 ----------
const ledger = JSON.parse(fs.readFileSync(path.join(ROOT, LEDGER_REL), 'utf8'));
// 负测一律用「全 in_progress」的干净基线，与各 K 阶段台账推进解耦，保证可复跑。
const cleanLedger = () => emptyLedger();

test('32 条逐件在册，计数机械汇总，优先级 P0 10 / P1 13 / P2 9', () => {
  const v = validateLedger(ledger, { root: ROOT });
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.equal(ledger.gaps.length, 32);
  assert.equal(GAP_DEFS.length, 32);
  assert.equal(new Set(ledger.gaps.map((g) => g.id)).size, 32);
  assert.deepEqual(v.computed, ledger.terminalCounts);
});

test('负测：删掉任意一条即判「静默消失」', () => {
  const bad = cleanLedger();
  bad.gaps = bad.gaps.filter((g) => g.id !== 'K-17');
  assert.ok(validateLedger(bad, { root: ROOT }).issues.some((i) => i.includes('静默消失')));
});

test('负测：重复 id 必红', () => {
  const bad = cleanLedger();
  bad.gaps.push(structuredClone(bad.gaps[0]));
  assert.ok(validateLedger(bad, { root: ROOT }).issues.some((i) => i.includes('重复 id')));
});

test('负测：非法终态必红', () => {
  const bad = setTerminal(cleanLedger(), 'K-01', { terminal: 'looks-good' });
  assert.ok(validateLedger(bad, { root: ROOT }).issues.some((i) => i.includes('终态非法')));
  assert.equal(TERMINALS.length, 8);
});

test('负测：写 done 但无 evidenceRef 必红', () => {
  const bad = setTerminal(cleanLedger(), 'K-02', { terminal: 'done' });
  assert.ok(validateLedger(bad, { root: ROOT }).issues.some((i) => i.includes('无 evidenceRef')));
});

test('负测：证据引用指向不存在文件必红', () => {
  const bad = setTerminal(cleanLedger(), 'K-03', { terminal: 'done', evidenceRef: 'acceptance/伪造证据.json' });
  assert.ok(validateLedger(bad, { root: ROOT }).issues.some((i) => i.includes('引用文件不存在')));
});

test('负测：U/E/V 边界项缺决策材料/测试路线/补腿条件必红', () => {
  const a = setTerminal(cleanLedger(), 'K-29', { terminal: 'pending_user_ruling' });
  assert.ok(validateLedger(a, { root: ROOT }).issues.some((i) => i.includes('决策材料指针')));
  const b = setTerminal(cleanLedger(), 'K-15', { terminal: 'pending_human_eye' });
  assert.ok(validateLedger(b, { root: ROOT }).issues.some((i) => i.includes('测试路线指针')));
  const c = setTerminal(cleanLedger(), 'K-30', { terminal: 'external-blocked' });
  assert.ok(validateLedger(c, { root: ROOT }).issues.some((i) => i.includes('补腿条件')));
});

test('负测：边界项 note 冒充 verified/completed/passed 必红', () => {
  const bad = setTerminal(cleanLedger(), 'K-30', {
    terminal: 'external-blocked', closureCondition: '凭据到位', note: 'verified via other means',
  });
  assert.ok(validateLedger(bad, { root: ROOT }).issues.some((i) => i.includes('冒充')));
});

test('负测：terminalCounts 手写但与 gaps 不符必红', () => {
  const bad = cleanLedger();
  bad.terminalCounts = { in_progress: 31, done: 1 };
  assert.ok(validateLedger(bad, { root: ROOT }).issues.some((i) => i.includes('机械汇总')));
});

test('负测：requireAllClosed 对含 in_progress 的台账必红（用干净基线，与各阶段推进解耦）', () => {
  // 不依赖当前台账状态：K7 总收口后 32 条已全部定终态，直接用真实台账会让负测失效。
  const dirty = emptyLedger(); // 32 条全 in_progress
  const v = validateLedger(dirty, { root: ROOT, requireAllClosed: true });
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.includes('in_progress')));
  const clean = structuredClone(ledger); // 当前零 in_progress
  const v2 = validateLedger(clean, { root: ROOT, requireAllClosed: true });
  assert.equal(v2.ok, true, `总收口后应放行: ${v2.issues.join(' / ')}`);
});

test('emptyLedger/setTerminal 机械性：改动后计数自动重算', () => {
  const l = emptyLedger();
  assert.equal(l.terminalCounts.in_progress, 32);
  setTerminal(l, 'K-01', { terminal: 'done' });
  assert.equal(l.terminalCounts.in_progress, 31);
  assert.equal(l.terminalCounts.done, 1);
  assert.equal(validateLedger(l, { root: ROOT }).ok, false, 'done 无 evidenceRef 应红');
  assert.equal(recomputeCounts(l).terminalCounts.done, 1);
});

// ---------- ③ 九组读数 ----------
test('九组读数从权威源机械复算且无 null 子字段', () => {
  const readings = collectReadings(ROOT);
  const v = validateReadings(readings, SHA);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.equal(READING_IDS.length, 9);
  assert.equal(Object.keys(readings).length, 9);
  assert.equal(readings.reasonCodeCount.value.codes, 42);
  // 门数不得写死：新增专项门（如 K7 评审抓真的 gate:post-h9-contracts）会让
  // 19 → 20，手写数字会随治理演进而假红。改为机械断言「固定 5 + --gate 数」。
  const closeoutScript = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.closeout;
  const gateCount = (closeoutScript.match(/--gate\s+/g) || []).length;
  assert.equal(readings.closeoutGateCount.value.blockingGates, 5 + gateCount);
  assert.equal(readings.closeoutGateCount.value.extraGates, gateCount);
  assert.ok(closeoutScript.includes('gate:post-h9-contracts'), '全量契约门必须挂进 closeout 链');
  assert.equal(readings.rafFrameTime.value.p50Ms, 8.4);
  assert.equal(readings.rafFrameTime.value.p95Ms, 10.3);
});

test('负测：读数缺组 / 缺 source / 缺 command / 全 null 必红', () => {
  const r = collectReadings(ROOT);
  assert.equal(validateReadings({ ...r, rafFrameTime: undefined }, SHA).ok, false);
  const noSource = structuredClone(r);
  delete noSource.perfBaseline.source;
  assert.equal(validateReadings(noSource, SHA).ok, false);
  const noCommand = structuredClone(r);
  delete noCommand.earRatio.command;
  assert.equal(validateReadings(noCommand, SHA).ok, false);
  const nulls = structuredClone(r);
  nulls.uiLedgerCounts.value.sections = null;
  assert.equal(validateReadings(nulls, SHA).ok, false);
  assert.equal(validateReadings(r, 'short').ok, false);
});

test('K-07 治理对账：README 第三轮蓝图 status 与 registry 一致（防回弹）', () => {
  const r = collectReadings(ROOT);
  assert.equal(r.blueprintStatusParity.value.postS7Registry, 'completed');
  assert.equal(r.blueprintStatusParity.value.postS7ReadmeActive, false);
  assert.equal(r.blueprintStatusParity.value.conflict, false);
  assert.equal(r.blueprintStatusParity.value.postH9Registry, 'planned', '第四轮蓝图 planned living-plan 不占串行槽位');
  assert.equal(r.blueprintStatusParity.value.postH9ReadmePlanned, true);
});

// ---------- ④ 治理工具 selftest ----------
test('治理回写工具 selftest 12 项全绿', () => {
  const out = execFileSync(process.execPath, ['scripts/post-h9-governance.mjs', 'selftest'], { cwd: ROOT, encoding: 'utf8' });
  const parsed = JSON.parse(out.slice(out.indexOf('{')));
  assert.equal(parsed.passed, true);
  assert.equal(Object.values(parsed.results).filter(Boolean).length, 12);
});

// ---------- ⑤ lint∩hygiene 联动门 ----------
test('联动门在干净树无 overlap；受保护资产精确豁免（L0-8/L-83：9→10 项对账补第四轮蓝图原件）', () => {
  const protectedList = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/user-asset-guard-baseline.json'), 'utf8')).paths;
  assert.equal(protectedList.length, 10);
  assert.ok(protectedList.includes('docs/post-h9-optimization-blueprint-2026-11-10.md'), '第四轮蓝图原件已在保护清单');
  assert.equal(evaluateOverlap({ untracked: ['assets/logo.png', 'tmp-review/demo.svg'], protectedList }).ok, true);
  assert.equal(isProtected('assets/logo.png', protectedList), true);
  assert.equal(isProtected('docs/pelican-bicycle.html', protectedList), true);
  assert.equal(isProtected('docs/post-h9-optimization-blueprint-2026-11-10.md', protectedList), true);
  assert.equal(isProtected('scripts/tmp-evil.mjs', protectedList), false);
});

test('负测：植入临时 .mjs 进入 lint 扫描面必红', () => {
  const protectedList = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/user-asset-guard-baseline.json'), 'utf8')).paths;
  const v = evaluateOverlap({ untracked: ['tmp-b22-complete.mjs', 'tmp-h9-probe.mjs', 'scripts/tmp-evil.cjs'], protectedList });
  assert.equal(v.ok, false);
  assert.equal(v.verdict, 'lint-hygiene-overlap');
  assert.ok(v.offenders.length >= 2, JSON.stringify(v.offenders));
});

test('负测：清空豁免清单形成假绿 → fail-closed', () => {
  assert.equal(evaluateOverlap({ untracked: ['tmp-x.mjs'], protectedList: [] }).ok, false);
  assert.equal(evaluateOverlap({ untracked: null, protectedList: ['assets/'] }).ok, false);
});

test('负测：临时产物判定不许把普通源码名误判，也不许漏判', () => {
  assert.equal(isTempArtifact('src/main.js'), false);
  assert.equal(isTempArtifact('tmp-review/demo.svg'), true);
  assert.equal(isTempArtifact('tmp-b22-complete.mjs'), true);
  assert.equal(isLintScannable('tmp-b22-complete.mjs'), true);
  assert.equal(isLintScannable('tmp-review/demo.svg'), false);
});
