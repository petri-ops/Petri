/**
 * BLOCK-337 — 治理运行时化：引擎/规则包分离（P0）+ 并行互斥契约（P3）+ 自我边界三防线（P7）。
 *
 * 本测只钉「机制」，不钉任何具体项目的纪律条目：
 *   - 同一引擎对四类工作区挂载各自规则包，且**互不泄漏**（软件工程纪律绝不出现在生信项目里）；
 *   - 未识别工作区 = 零规则且不报错（合法默认，放权坡道兜底）；
 *   - 引擎源码零业务词汇（包/QC/PR/closeout 之类只允许出现在包 JSON 里）；
 *   - 并行放行三条判据机械可判（同真相域 / 文件面相交 / 共享基线）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const {
  loadGovernancePacks,
  resolveWorkspaceGovernance,
  rulesByKind,
  renderGovernanceRuntimeSection,
} = require(path.join(ROOT, 'core', 'shared-backend', 'governance', 'workspace-rules.js'));
const { createRuleLedger } = require(path.join(ROOT, 'core', 'shared-backend', 'governance', 'rule-lifecycle.js'));
const { buildSystemPrompt } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'system-prompt.js'));
const {
  pathsOverlap,
  canRunInParallel,
  validateParallelSet,
} = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'parallel-contract.js'));

function tempWorkspace(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block337-ws-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

test('BLOCK-337 P0 规则包可装载且形状合法（引擎只做机制，条目在 JSON 里）', () => {
  const { packs, diagnostics } = loadGovernancePacks();
  assert.ok(packs.length >= 3, `应至少装载 3 个规则包，实际 ${packs.length}`);
  assert.deepEqual(diagnostics, [], `装载诊断应为空：${JSON.stringify(diagnostics)}`);
  const ids = packs.map((pack) => pack.id).sort();
  assert.deepEqual(ids, ['bio-analysis', 'code-light', 'software-governed']);
  for (const pack of packs) {
    assert.ok(pack.rules.length > 0, `${pack.id} 应有规则`);
    for (const rule of pack.rules) {
      assert.ok(['mechanical', 'judgment', 'boundary'].includes(rule.kind), `${pack.id}/${rule.id} kind 非法`);
      assert.ok(typeof rule.statement === 'string' && rule.statement.length > 4, `${pack.id}/${rule.id} 缺 statement`);
    }
  }
});

test('BLOCK-337 P0 四类工作区各挂载正确规则包且互不泄漏', () => {
  const governed = tempWorkspace({ 'docs/DOC-REGISTRY.json': '{}', 'AGENTS.md': '# agents\n', 'README.md': 'x' });
  const bio = tempWorkspace({ 'counts.csv': 'gene,count\n', 'notes.md': 'x' });
  const codeLight = tempWorkspace({ '.git/config': '', 'package.json': '{}' });
  const blank = tempWorkspace({ 'random.txt': 'nothing here' });

  const governedResult = resolveWorkspaceGovernance(governed);
  assert.equal(governedResult.kind, 'software-governed');
  const governedRules = governedResult.rules.map((rule) => rule.id);
  assert.ok(governedRules.includes('closeout-before-completed'));
  assert.ok(!governedRules.includes('source-data-immutable'), '软件纪律不得泄漏进生信包');

  const bioResult = resolveWorkspaceGovernance(bio);
  assert.equal(bioResult.kind, 'bio-analysis');
  const bioRules = bioResult.rules.map((rule) => rule.id);
  assert.ok(bioRules.includes('source-data-immutable'));
  assert.ok(!bioRules.includes('closeout-before-completed'), '生信项目不得看到 Petri 工程纪律');
  assert.ok(!bioRules.includes('single-active-package'));

  const codeResult = resolveWorkspaceGovernance(codeLight);
  assert.equal(codeResult.kind, 'code-light');
  assert.ok(codeResult.rules.map((rule) => rule.id).includes('tests-green-before-done'));
  assert.ok(!codeResult.rules.map((rule) => rule.id).includes('ui-ledger-sync'));

  const blankResult = resolveWorkspaceGovernance(blank);
  assert.equal(blankResult.kind, 'blank');
  assert.deepEqual(blankResult.rules, [], '未识别工作区=零规则（合法默认）');
  assert.deepEqual(blankResult.diagnostics, [], '零规则不是错误');
});

test('BLOCK-337 P0 优先级：受治理仓库同时含数据文件时仍先挂软件包', () => {
  const both = tempWorkspace({ 'docs/DOC-REGISTRY.json': '{}', 'AGENTS.md': 'x', 'counts.csv': 'a,b\n' });
  assert.equal(resolveWorkspaceGovernance(both).kind, 'software-governed');
});

test('BLOCK-337 P0 规则三分类可投影（mechanical / judgment / boundary）', () => {
  const { packs } = loadGovernancePacks();
  const governed = packs.find((pack) => pack.id === 'software-governed');
  assert.ok(rulesByKind(governed.rules, 'mechanical').length >= 3);
  assert.ok(rulesByKind(governed.rules, 'judgment').length >= 1);
  assert.ok(rulesByKind(governed.rules, 'boundary').length >= 1);
});

test('BLOCK-337 P1 规则三分类盘点表与规则包双向不漂移', () => {
  const triage = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance', 'block-337', 'rule-triage.json'), 'utf8'));
  const { packs } = loadGovernancePacks();
  const packRuleIds = new Set(packs.flatMap((pack) => pack.rules.map((rule) => rule.id)));
  const triageIds = new Set(triage.entries.map((entry) => entry.id));

  const mechanical = triage.entries.filter((entry) => entry.category === 'mechanical');
  assert.ok(mechanical.length >= 10, `可机械条目应 ≥10，实际 ${mechanical.length}`);
  for (const entry of mechanical) {
    assert.ok(packRuleIds.has(entry.id), `盘点表 mechanical「${entry.id}」不在任何规则包里（漏运行时化）`);
  }
  for (const pack of packs) {
    for (const rule of pack.rules) {
      assert.ok(triageIds.has(rule.id), `规则「${rule.id}」未进盘点表（新增规则必须同步盘点）`);
    }
  }
  assert.equal(triage.summary.total, triage.entries.length, 'summary 与条目数一致');
  for (const entry of triage.entries) {
    assert.ok(['mechanical', 'judgment', 'boundary'].includes(entry.category), `${entry.id} 分类非法`);
    assert.ok(entry.landedIn, `${entry.id} 未标落点`);
  }
});

test('BLOCK-337 P7① 引擎源码零业务词汇（规则只活在包 JSON 里）', () => {
  const enginePath = path.join(ROOT, 'core', 'shared-backend', 'governance', 'workspace-rules.js');
  const source = fs.readFileSync(enginePath, 'utf8').toLowerCase();
  const forbidden = ['doc-registry', 'agents.md', 'closeout', 'fastq', 'counts.csv', '生信', 'bioconductor'];
  const hits = forbidden.filter((term) => source.includes(term));
  assert.deepEqual(hits, [], `引擎不得内嵌项目专属词汇：${hits.join(', ')}`);
});

test('BLOCK-337 P7② 非法/缺口工作区不抛错（引擎无知是特性不是缺陷）', () => {
  for (const workspacePath of ['', null, undefined, path.join(os.tmpdir(), 'block337-not-exist-xyz')]) {
    const result = resolveWorkspaceGovernance(workspacePath);
    assert.equal(result.kind, 'blank');
    assert.deepEqual(result.rules, []);
  }
});

test('BLOCK-337 P3 并行契约：真相域/文件面/共享基线三条判据', () => {
  const base = { id: 'A', truthDomain: 'a', touchSurface: ['core/alpha/**'], sharedBaselines: ['test/knip-baseline.json'] };

  assert.equal(canRunInParallel(base, { id: 'B', truthDomain: 'b', touchSurface: ['core/beta/**'], sharedBaselines: ['test/lint-baseline.json'] }).ok, true,
    '三条皆不相交应放行');

  const sameDomain = canRunInParallel(base, { id: 'B', truthDomain: 'a', touchSurface: ['x/**'] });
  assert.equal(sameDomain.ok, false);
  assert.equal(sameDomain.conflicts[0].rule, 'same_truth_domain');

  const surface = canRunInParallel(base, { id: 'B', truthDomain: 'b', touchSurface: ['core/alpha/file.js'] });
  assert.equal(surface.ok, false);
  assert.equal(surface.conflicts[0].rule, 'touch_surface_overlap');

  const baseline = canRunInParallel(base, { id: 'B', truthDomain: 'b', sharedBaselines: ['test/knip-baseline.json'] });
  assert.equal(baseline.ok, false);
  assert.equal(baseline.conflicts[0].rule, 'shared_baseline_conflict');

  const missingDomain = canRunInParallel({ id: 'A' }, { id: 'B' });
  assert.equal(missingDomain.ok, false);
  assert.equal(missingDomain.conflicts[0].rule, 'truth_domain_required');
});

test('BLOCK-337 P3 glob 相交判定（保守可判子集）+ 全表两两校验', () => {
  assert.equal(pathsOverlap('core/alpha/**', 'core/alpha/x.js'), true);
  assert.equal(pathsOverlap('core/alpha/**', 'core/alpha-beta/x.js'), false, '前缀边界必须按路径段判断');
  assert.equal(pathsOverlap('core/alpha/x.js', 'core/alpha/x.js'), true);
  assert.equal(pathsOverlap('core/**', 'core/alpha/**'), true);
  assert.equal(pathsOverlap('core/alpha/*.js', 'core/alpha/x.js'), false, '单层通配不投影=不判相交（保守放行）');

  const verdict = validateParallelSet([
    { id: 'A', truthDomain: 'a', touchSurface: ['core/alpha/**'] },
    { id: 'B', truthDomain: 'b', touchSurface: ['core/beta/**'] },
    { id: 'C', truthDomain: 'c', touchSurface: ['core/alpha/inner.js'] },
  ]);
  assert.equal(verdict.ok, false, 'A 与 C 文件面相交，全表必须拦住');
  const bad = verdict.pairs.filter((pair) => !pair.ok).map((pair) => `${pair.a}-${pair.b}`);
  assert.deepEqual(bad, ['A-C']);
});

// ---------------------------------------------------------------------------
// P2 自动装载：治理动态段 + prompt 接线（受治理仓注入，非受治理零变化）
// ---------------------------------------------------------------------------

function governedWorkspaceWithAudit() {
  return tempWorkspace({
    'docs/DOC-REGISTRY.json': '{}',
    'AGENTS.md': '# agents\n',
    'docs/AUDIT-LOG.md': [
      '# 审计广播台',
      '| 🔴 | 2026-11-02 | **测试未决一**：详情甲 | 处置 |',
      '| 🟡 | 2026-11-02 | **登记待办不算开工前置**：详情 | — |',
      '| 🟢 | 2026-11-02 | **测试未决二**：详情乙 | 处置 |',
      '',
    ].join('\n'),
  });
}

test('BLOCK-337 P2 受治理仓：动态段含规则条目与未决审计前置（🟡 不算前置）', () => {
  const workspacePath = governedWorkspaceWithAudit();
  const section = renderGovernanceRuntimeSection({ workspacePath });
  assert.ok(section.includes('工作区治理（自动装载'), '段标题在场');
  assert.ok(section.includes('[必须]') && section.includes('[判断]'), 'mechanical/judgment 条目在场');
  assert.ok(section.includes('[🔴] 测试未决一'), '🔴 前置在场');
  assert.ok(section.includes('[🟢] 测试未决二'), '🟢 前置在场');
  assert.ok(!section.includes('登记待办不算开工前置'), '🟡 不得混入开工前置');
});

test('BLOCK-337 P2 非受治理仓 / blank 工作区 → 空段（零变化保证）', () => {
  const bio = tempWorkspace({ 'counts.csv': 'a,b\n' });
  const blank = tempWorkspace({ 'random.txt': 'x' });
  const bioSection = renderGovernanceRuntimeSection({ workspacePath: bio });
  assert.ok(bioSection.includes('工作区治理（自动装载：生信分析项目'), 'bio 包规则段应在（领域纪律同样自动装载）');
  assert.ok(!bioSection.includes('开工前置'), 'bio 包未声明 auditSource → 不得注入 Petri 审计前置');
  assert.ok(!bioSection.includes('closeout'), 'Petri 工程纪律不得泄漏进生信段');
  assert.equal(renderGovernanceRuntimeSection({ workspacePath: blank }), '', 'blank 必须返回空串');
  assert.equal(renderGovernanceRuntimeSection({ workspacePath: path.join(os.tmpdir(), 'block337-missing') }), '');
});

test('BLOCK-337 P2 prompt 接线：desktop-project + workspacePath 才注入，其余零变化', () => {
  const governed = governedWorkspaceWithAudit();
  const plain = tempWorkspace({ 'random.txt': 'x' });

  const injected = buildSystemPrompt({ page: 'desktop-project', projectId: 'p1', workspacePath: governed });
  assert.ok(injected.includes('工作区治理（自动装载'), '受治理仓应注入治理段');

  const withoutPath = buildSystemPrompt({ page: 'desktop-project', projectId: 'p1' });
  assert.ok(!withoutPath.includes('工作区治理（自动装载'), '无 workspacePath 的调用方零影响');

  const plainRepo = buildSystemPrompt({ page: 'desktop-project', projectId: 'p1', workspacePath: plain });
  assert.ok(!plainRepo.includes('工作区治理（自动装载'), '非受治理仓零变化');
});

// ---------------------------------------------------------------------------
// P7③ 规则候选沉淀与退化：账本 + 误拦率自动降级
// ---------------------------------------------------------------------------

test('BLOCK-337 P7③ 规则生命周期：误拦率超阈自动降级 observe，复盘可复位', () => {
  const ledger = createRuleLedger();

  // 全命中 → enforce
  for (let i = 0; i < 3; i += 1) ledger.recordOutcome({ packId: 'software-governed', ruleId: 'r1', outcome: 'hit' });
  assert.equal(ledger.status('software-governed', 'r1').mode, 'enforce');

  // 三连误拦 → observe（自动降级，等人复盘）
  for (let i = 0; i < 3; i += 1) ledger.recordOutcome({ packId: 'software-governed', ruleId: 'r2', outcome: 'misfire' });
  const r2 = ledger.status('software-governed', 'r2');
  assert.equal(r2.mode, 'observe');
  assert.equal(r2.misfireRate, 1);

  // 混合：1 命中 3 误拦（率 0.75 ≥ 0.5）→ observe
  ledger.recordOutcome({ packId: 'software-governed', ruleId: 'r3', outcome: 'hit' });
  for (let i = 0; i < 3; i += 1) ledger.recordOutcome({ packId: 'software-governed', ruleId: 'r3', outcome: 'misfire' });
  assert.equal(ledger.status('software-governed', 'r3').mode, 'observe');

  // 误拦不足下限 → 仍 enforce（不许两条误拦就打回）
  ledger.recordOutcome({ packId: 'software-governed', ruleId: 'r4', outcome: 'misfire' });
  ledger.recordOutcome({ packId: 'software-governed', ruleId: 'r4', outcome: 'misfire' });
  assert.equal(ledger.status('software-governed', 'r4').mode, 'enforce');

  // 非法输入拒绝；无记录规则默认 enforce；复位清账
  assert.equal(ledger.recordOutcome({ packId: 'p', ruleId: 'r', outcome: 'nonsense' }).ok, false);
  assert.equal(ledger.status('software-governed', 'never-seen').mode, 'enforce');
  ledger.reset('software-governed', 'r2');
  assert.equal(ledger.status('software-governed', 'r2').mode, 'enforce');
  assert.equal(ledger.status('software-governed', 'r2').total, 0);

  // JSON round-trip（账本可持久化到 registry/文件）
  const snapshot = ledger.toJSON();
  const revived = createRuleLedger(snapshot);
  assert.equal(revived.status('software-governed', 'r3').mode, 'observe', '复位/重建后计数语义不丢');
});
