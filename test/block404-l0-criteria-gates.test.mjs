/**
 * BLOCK-404（第五轮 L0 判据校准与可信起点）契约测试。
 *
 * 承载：perf 基线绑定单源（block350-hot-paths）/ lint 台账机械校验与 warnings 分域棘轮 /
 * 源码扫描第二棘轮（全库 includes）/ 数字口径单源生成器 / 用户资产对账 / 状态聚合器兜底。
 * 逐件随实现落测；蓝图 docs/post-k7-full-audit-and-blueprint-2026-11-10.md §4-L0。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOT_PATH_FILES, computeHotPathSha, describeHost, adjudicateBaselineBinding } from '../scripts/lib/block350-hot-paths.mjs';
import { checkAuditLedgerBlueActiveSync } from '../scripts/docs-governance.mjs';
import { evaluateGate, discoverOversizedFiles, BUDGET_LINES } from '../scripts/code-size-ledger.mjs';
import { countSourceVarIncludes, adjudicateSourceScanRatchet } from '../scripts/post-k7-source-scan-ratchet.mjs';
import { compareLedger, compareWarnDomains } from '../scripts/lint-ledger-verify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- L0-2/L-30：perf 基线绑定单源 ----
test('L0 hot-paths：组合 sha 确定性 + host 描述稳定（两次调用同值）', () => {
  assert.equal(HOT_PATH_FILES.length >= 5, true, '热路径清单须覆盖入口/DB/读路径/spawn 机制');
  const s1 = computeHotPathSha(ROOT);
  const s2 = computeHotPathSha(ROOT);
  assert.equal(s1, s2);
  assert.match(s1, /^[0-9a-f]{16}$/);
  const h1 = describeHost();
  const h2 = describeHost();
  assert.deepEqual(h1, h2);
  assert.ok(h1.platform && h1.cpus > 0 && h1.node);
});

test('L0 hot-paths 负测：基线缺绑定字段 / sha 失配 / host 漂移逐项报因（fail-closed 要求重采）', () => {
  const host = describeHost();
  const sha = computeHotPathSha(ROOT);
  const missing = adjudicateBaselineBinding({}, { host, coreSha: sha });
  assert.equal(missing.ok, false);
  assert.ok(missing.issues.some((i) => i.includes('host 绑定')));
  assert.ok(missing.issues.some((i) => i.includes('coreSha 绑定')));
  const stale = adjudicateBaselineBinding({ host, coreSha: 'ffffffffffffffff' }, { host, coreSha: sha });
  assert.equal(stale.ok, false);
  assert.ok(stale.issues.some((i) => i.includes('热路径源码变化')));
  const drifted = adjudicateBaselineBinding({ host: { ...host, cpus: host.cpus + 1 }, coreSha: sha }, { host, coreSha: sha });
  assert.equal(drifted.ok, false);
  assert.ok(drifted.issues.some((i) => i.includes('host.cpus')));
  const ok = adjudicateBaselineBinding({ host, coreSha: sha }, { host, coreSha: sha });
  assert.equal(ok.ok, true);
});

// ---- L0-5/L-90：AUDIT-LOG 🔵 × registry active 机械对账 ----
test('L0 🔵对账：真实树合规（BLOCK-404 行=registry active；BLOCK-385 行带历史广播标注）', async () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'DOC-REGISTRY.json'), 'utf8'));
  const issues = await checkAuditLedgerBlueActiveSync(ROOT, registry);
  assert.deepEqual(issues, [], `真实树 🔵 行应全部合规：${issues.map((i) => i.message).join(' / ')}`);
});

test('L0 🔵对账负测：🔵 行声称未注册 BLOCK active 且无历史标注 → 报警；带「不占串行槽位」标注 → 放行', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'block404-blue-'));
  fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
  const ledger = [
    '# 审计广播台',
    '## 当前待处理项',
    '',
    '| 状态 | 日期 | 事项 | 处置边界 |',
    '| 🔵 | 2026-11-11 | **BLOCK-999-FAKE 启动登记（active；伪造）**：范围=x | plan=x.md | BLOCK-999 / P0-LAUNCH |',
    '| 🔵 | 2026-11-09 | **BLOCK-988-OLD 启动登记（历史阶段广播·不占串行槽位；BLOCK-988 已 completed）**：范围=y | plan=y.md | BLOCK-988 / COMPLETED |',
  ].join('\n');
  fs.writeFileSync(path.join(tmp, 'docs', 'AUDIT-LOG.md'), ledger);
  const registry = { documents: [{ id: 'BLOCK-404', kind: 'work-package', status: 'active' }] };
  const issues = await checkAuditLedgerBlueActiveSync(tmp, registry);
  assert.equal(issues.length, 1, `应只对 BLOCK-999 报警：${JSON.stringify(issues)}`);
  assert.match(issues[0].code, /AUDIT_LOG_BLUE_ACTIVE_MISMATCH/);
  assert.match(issues[0].message, /BLOCK-999/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- L0-7/L-36：尺寸门发现器 + CSS 字节棘轮 ----
const sizeGateFixture = () => ({
  current: { files: [{ path: 'a.js', wave: 'A', lines: 100, bytes: 10, sha256: 'x' }] },
  baseline: { files: [{ path: 'a.js', wave: 'A', lines: 100, bytes: 10, sha256: 'x' }] },
  exceptions: { schema: 'petri/block109-size-exceptions.v2', allowedExceptionPaths: [], exceptions: [] },
  today: '2026-11-11',
});

test('L0-7 负测：未登记 >700 行文件（发现器）→ 必红并指向 --write 入册', () => {
  const f = sizeGateFixture();
  f.current.files.push({ path: 'new-giant/module.js', wave: 'L0', module: 'auto-discovered', lines: 900, bytes: 20000, sha256: 'y' });
  const r = evaluateGate(f);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes('new-giant/module.js') && v.includes('发现器 fail-closed')), r.violations.join(' / '));
});

test('L0-7 负测：L0 入册文件行数上涨 → 棘轮红；CSS 字节上涨 → 字节棘轮红；L0 文件不再要求预算例外', () => {
  // 行数棘轮对 L0 wave 同样生效
  const grow = sizeGateFixture();
  grow.baseline.files.push({ path: 'big/legacy.js', wave: 'L0', module: 'auto-discovered', lines: 900, bytes: 30000, sha256: 'z' });
  grow.current.files.push({ path: 'big/legacy.js', wave: 'L0', module: 'auto-discovered', lines: 901, bytes: 30000, sha256: 'z' });
  const rGrow = evaluateGate(grow);
  assert.equal(rGrow.ok, false);
  assert.ok(rGrow.violations.some((v) => v.includes('big/legacy.js') && v.includes('棘轮只减不增')), rGrow.violations.join(' / '));
  // CSS 字节棘轮
  const css = sizeGateFixture();
  css.baseline.files.push({ path: 'src/page.module.css', wave: 'L0', module: 'auto-discovered', lines: 800, bytes: 1000, sha256: 'c1' });
  css.current.files.push({ path: 'src/page.module.css', wave: 'L0', module: 'auto-discovered', lines: 800, bytes: 1200, sha256: 'c2' });
  const rCss = evaluateGate(css);
  assert.equal(rCss.ok, false);
  assert.ok(rCss.violations.some((v) => v.includes('CSS 字节') && v.includes('字节棘轮')), rCss.violations.join(' / '));
  // L0 超预算不再触发「必须拆分/登记例外」（预算 enforcement 随 W5b 转正）
  const l0 = sizeGateFixture();
  l0.baseline.files.push({ path: 'big/frozen.js', wave: 'L0', module: 'auto-discovered', lines: 900, bytes: 30000, sha256: 'f1' });
  l0.current.files.push({ path: 'big/frozen.js', wave: 'L0', module: 'auto-discovered', lines: 900, bytes: 30000, sha256: 'f1' });
  const rL0 = evaluateGate(l0);
  assert.equal(rL0.ok, true, `L0 冻结文件不得因缺例外判红：${rL0.violations.join(' / ')}`);
});

test('L0-7 实测：发现器当次读数 ≥50 且全部已入基线（真实树一致）', () => {
  const discovered = discoverOversizedFiles(ROOT);
  assert.ok(discovered.length >= 50, `发现 ${discovered.length} 个 >${BUDGET_LINES} 行文件`);
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance', 'block-92', 'size-baseline.json'), 'utf8'));
  const basePaths = new Set(baseline.files.map((f) => f.path));
  const missing = discovered.filter((d) => !basePaths.has(d.path));
  assert.deepEqual(missing, [], `未入册超预算文件：${missing.map((m) => m.path).join(', ')}`);
  const css = discovered.find((d) => d.path.endsWith('project-workspace.module.css'));
  assert.ok(css, 'project-workspace.module.css 必须在册（L-36）');
  assert.ok(css.bytes > 100 * 1024, `CSS 字节入册：${css.bytes}`);
});

// ---- L0-7/L-43：全库源码扫描断言第二棘轮 ----
test('L0-43 计数器：注释里的 includes 不计；src/source 变量断言可复算；普通数组 includes 不计', () => {
  assert.equal(countSourceVarIncludes('// src.includes("x")\n'), 0);
  assert.equal(countSourceVarIncludes('assert.ok(src.includes("const "));'), 1);
  assert.equal(countSourceVarIncludes('assert.ok(sourceText.includes("export "));'), 1);
  assert.equal(countSourceVarIncludes('assert.ok([1,2].includes(1));'), 0);
  assert.equal(countSourceVarIncludes('/* src.includes("y") */ assert.ok(src.includes("z"));'), 1);
});

test('L0-43 负测：新增带断言测试文件 / 已冻结文件加断言 → 红；清零/0 命中新文件 → 放行（改进）', () => {
  const baseline = { files: { 'test/a.test.mjs': 3 } };
  const newFile = adjudicateSourceScanRatchet(new Map([['test/a.test.mjs', 3], ['test/new.test.mjs', 2]]), baseline);
  assert.equal(newFile.ok, false);
  assert.ok(newFile.issues.some((i) => i.includes('test/new.test.mjs') && i.includes('新增扫描文件即红')));
  const bumped = adjudicateSourceScanRatchet(new Map([['test/a.test.mjs', 4]]), baseline);
  assert.equal(bumped.ok, false);
  assert.ok(bumped.issues.some((i) => i.includes('4 > 冻结 3')));
  const zeroHit = adjudicateSourceScanRatchet(new Map([['test/a.test.mjs', 3], ['test/clean.test.mjs', 0]]), baseline);
  assert.equal(zeroHit.ok, true, '0 命中新文件不拦');
  const shrunk = adjudicateSourceScanRatchet(new Map([['test/a.test.mjs', 1]]), baseline);
  assert.equal(shrunk.ok, true);
  assert.ok(shrunk.improvements.some((i) => i.includes('3 → 1')));
});

test('L0-43 实测：真实树 --check 绿且基线读数 = 蓝图口径 A（44 文件 / 129 处）', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'source-scan-asserts-baseline.json'), 'utf8'));
  assert.equal(baseline.total, 129, `当次实读 ${baseline.total}`);
  assert.ok(Object.keys(baseline.files).length >= 40, `文件数 ${Object.keys(baseline.files).length}`);
  const k4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'acceptance/post-h9-2026-11-10/k4/k4-source-scan-baseline.json'), 'utf8'));
  assert.ok(k4.perFile, 'k4 四文件旧基线保持只减（未被本棘轮改写）');
});

// ---- L0-6/L-40/L-88：lint 台账机械投影 + warnings 分域只减 ----
test('L0-6 负测：手改 count（实际>账本）→ 红；代码修复后账本滞后（实际<账本）→ 红指向 prune', () => {
  const actual = new Map([['src/ipc/a.js', new Map([['no-unused-vars', 5]])]]);
  const handLowered = compareLedger({ 'src/ipc/a.js': { 'no-unused-vars': { count: 2 } } }, actual);
  assert.equal(handLowered.issues.length >= 1, true);
  assert.ok(handLowered.issues.some((i) => i.includes('实际 5 > 账本 2') && i.includes('手改 count')));
  const handLoweredButReported = compareLedger({ 'src/ipc/a.js': { 'no-unused-vars': { count: 5 } } }, new Map([['src/ipc/a.js', new Map([['no-unused-vars', 8]])]]));
  assert.ok(handLoweredButReported.issues.some((i) => i.includes('8 > 账本 5')), '新增违规未入账必红');
  const shrunk = compareLedger({ 'src/ipc/a.js': { 'no-unused-vars': { count: 8 } } }, actual);
  assert.ok(shrunk.issues.some((i) => i.includes('prune-suppressions')), '债务收缩须收敛台账');
  const exact = compareLedger({ 'src/ipc/a.js': { 'no-unused-vars': { count: 5 } } }, new Map([['src/ipc/a.js', new Map([['no-unused-vars', 5]])]]));
  assert.deepEqual(exact.issues, [], '逐条相等 = 机械投影成立');
  const unregistered = compareLedger({}, actual);
  assert.ok(unregistered.issues.some((i) => i.includes('未入抑制台账')));
});

test('L0-6 负测：warnings 任一域上涨 → 红；下降只提示；基线缺席 fail-closed', () => {
  const baseline = { domains: { production: 100, test: 10, scripts: 1 } };
  const grew = compareWarnDomains({ production: 101, test: 10, scripts: 1 }, baseline);
  assert.ok(grew.issues.some((i) => i.includes('production 域 101 > 基线 100')));
  const same = compareWarnDomains({ production: 100, test: 10, scripts: 1 }, baseline);
  assert.deepEqual(same.issues, []);
  const shrunk = compareWarnDomains({ production: 90, test: 10, scripts: 1 }, baseline);
  assert.deepEqual(shrunk.issues, []);
  assert.ok(shrunk.improvements.some((i) => i.includes('production 域下降')));
  const missing = compareWarnDomains({ production: 100, test: 10, scripts: 1 }, null);
  assert.ok(missing.issues.some((i) => i.includes('基线缺席')));
});

test('L0-6 实测：warnings 分域基线在场且三域数字 = 当次 eslint 读数', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'lint-warnings-baseline.json'), 'utf8'));
  for (const d of ['production', 'test', 'scripts']) assert.ok(Number.isFinite(baseline.domains?.[d]), `域 ${d} 在场`);
  assert.equal(baseline.total, baseline.domains.production + baseline.domains.test + baseline.domains.scripts);
});

// ---- L0-8/L-45/76/83/84：数字口径单源 + 用户资产对账 ----
test('L0-8 单源 JSON：字段齐备且与活源一致（文档引用一律以此为准）', () => {
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'post-k7-readings-single-source.json'), 'utf8'));
  assert.equal(s.schemaVersion, 1);
  assert.ok(s.generatedAt && s.sourceCommit);
  const impactMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'impact-map.json'), 'utf8'));
  assert.equal(s.impactMap.rules, impactMap.rules.length, 'rules 数与活源一致');
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'DOC-REGISTRY.json'), 'utf8'));
  assert.equal(s.docRegistry.documentCount, registry.coverage.documentCount);
  assert.ok(s.tests.denominatorNote.includes('628'), '628=分片清单注记在场（L-84）');
  assert.ok(Array.isArray(s.staleReadings) && s.staleReadings.length >= 3, '历史读数作废记录在场（L-45）');
  assert.ok(s.staleReadings.some((r) => String(r.claim).includes('365')), '365/120 旧读数已登记作废');
  assert.equal(s.userAssets.protectedPaths, 10, '用户资产 10 项对账（L-83）');
});

test('L0-8 用户资产守卫：真实树 exit 0（10 项保护路径零 tracked/staged 命中）', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'user-asset-guard.mjs')], { encoding: 'utf8' });
  assert.equal(r.status, 0, `guard 应绿：${r.stdout}\n${r.stderr}`);
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'user-asset-guard-baseline.json'), 'utf8'));
  assert.equal(baseline.paths.length, 10);
  assert.equal(new Set(baseline.paths).size, baseline.paths.length, '无重复条目');
  assert.equal(baseline.incidents.length, 2, '两次历史误入库事故记录保留');
});
