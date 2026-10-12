import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUDIT_LEDGER_ENTRY_WARN_BYTES,
  AUDIT_LEDGER_FAIL_BYTES,
  buildReconciliationReport,
  checkAuditLedgerHealth,
  collectManagedMarkdown,
  loadDocumentRegistry,
  validateDocumentRegistry,
} from '../scripts/docs-governance.mjs';
import { compactLedgerLines } from '../scripts/audit-log-compact.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('repository document registry is internally consistent and complete', async () => {
  const registry = await loadDocumentRegistry(REPO_ROOT);
  const issues = await validateDocumentRegistry(registry, { rootDir: REPO_ROOT });
  assert.deepEqual(issues, []);

  const managed = await collectManagedMarkdown(REPO_ROOT, registry.coverage);
  const registered = new Set(registry.documents.map((document) => document.path));
  assert.equal(managed.every((documentPath) => registered.has(documentPath)), true);
});

test('validator reports duplicate identities and invalid lifecycle state', async (context) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-doc-governance-'));
  context.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'README.md'), '# Index\n\n[Plan](./plan.md)\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'plan.md'), '# Plan\n', 'utf8');

  const registry = {
    schemaVersion: 1,
    coverage: {
      managedRoots: ['docs'],
      excludedPrefixes: ['docs/archive/'],
      requireRegistration: true,
    },
    documents: [
      {
        id: 'DOC-INDEX',
        path: 'docs/README.md',
        kind: 'governance',
        status: 'reference',
        canonical: false,
        archivePolicy: 'never_archive',
      },
      {
        id: 'PLAN-1',
        path: 'docs/plan.md',
        kind: 'work-package',
        status: 'invalid-state',
        canonical: true,
        truthDomain: 'current-plan',
        entrypoint: 'docs/README.md',
        archivePolicy: 'archive_when_superseded',
      },
      {
        id: 'PLAN-1',
        path: 'docs/plan.md',
        kind: 'work-package',
        status: 'planned',
        canonical: true,
        truthDomain: 'current-plan',
        entrypoint: 'docs/README.md',
        archivePolicy: 'archive_when_superseded',
      },
    ],
  };

  const issues = await validateDocumentRegistry(registry, { rootDir: tempRoot });
  const codes = new Set(issues.map((item) => item.code));
  assert.equal(codes.has('STATUS_INVALID'), true);
  assert.equal(codes.has('DUPLICATE_ID'), true);
  assert.equal(codes.has('DUPLICATE_PATH'), true);
  assert.equal(codes.has('DUPLICATE_TRUTH_DOMAIN'), true);
});

test('validator enforces at most one active work package (document-governance §2.1)', async (context) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-doc-single-active-'));
  context.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'wp-a.md'), '# WP A\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'wp-b.md'), '# WP B\n', 'utf8');

  const documents = [
    { id: 'WP-A', path: 'docs/wp-a.md', kind: 'work-package', status: 'active', canonical: false, archivePolicy: 'archive_when_superseded' },
    { id: 'WP-B', path: 'docs/wp-b.md', kind: 'work-package', status: 'planned', canonical: false, archivePolicy: 'archive_when_superseded' },
  ];
  const coverage = { managedRoots: ['docs'], excludedPrefixes: [], requireRegistration: false };

  const single = await validateDocumentRegistry(
    { schemaVersion: 1, coverage, documents },
    { rootDir: tempRoot },
  );
  assert.equal(single.some((item) => item.code === 'MULTIPLE_ACTIVE_WORK_PACKAGES'), false);

  const bothActive = await validateDocumentRegistry(
    {
      schemaVersion: 1,
      coverage,
      documents: documents.map((document) => (document.id === 'WP-B' ? { ...document, status: 'active' } : document)),
    },
    { rootDir: tempRoot },
  );
  const violation = bothActive.find((item) => item.code === 'MULTIPLE_ACTIVE_WORK_PACKAGES');
  assert.equal(typeof violation?.message, 'string');
  assert.match(violation.message, /WP-A/);
  assert.match(violation.message, /WP-B/);
});

test('validator flags active review artefacts whose owning work package is retired', async (context) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-doc-orphan-review-'));
  context.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'wp-c.md'), '# WP C\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'docs', 'review.md'), '# Review\n', 'utf8');

  const coverage = { managedRoots: ['docs'], excludedPrefixes: [], requireRegistration: false };
  const documents = (reviewStatus) => [
    { id: 'WP-C', path: 'docs/wp-c.md', kind: 'work-package', status: 'completed', canonical: false, archivePolicy: 'archive_when_superseded' },
    {
      id: 'WP-C-P0-REVIEW',
      path: 'docs/review.md',
      kind: 'reference',
      status: reviewStatus,
      phase: 'P0-REVIEW',
      supersedes: ['WP-C'],
      canonical: false,
      archivePolicy: 'archive_when_superseded',
    },
  ];

  const issues = await validateDocumentRegistry(
    { schemaVersion: 1, coverage, documents: documents('active') },
    { rootDir: tempRoot },
  );
  const orphan = issues.find((item) => item.code === 'ORPHAN_ACTIVE_REVIEW');
  assert.equal(typeof orphan?.message, 'string');
  assert.match(orphan.message, /WP-C/);

  const downgraded = await validateDocumentRegistry(
    { schemaVersion: 1, coverage, documents: documents('completed') },
    { rootDir: tempRoot },
  );
  assert.equal(downgraded.some((item) => item.code === 'ORPHAN_ACTIVE_REVIEW'), false);
});

test('validator rejects path traversal even when normalization would return inside the repository', async (context) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-doc-path-'));
  context.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'plan.md'), '# Plan\n', 'utf8');

  const issues = await validateDocumentRegistry({
    schemaVersion: 1,
    coverage: { managedRoots: ['docs'], excludedPrefixes: [], requireRegistration: false },
    documents: [{
      id: 'PLAN-TRAVERSAL',
      path: 'docs/../docs/plan.md',
      kind: 'work-package',
      status: 'planned',
      canonical: false,
      archivePolicy: 'archive_when_superseded',
    }],
  }, { rootDir: tempRoot });

  assert.equal(issues.some((item) => item.code === 'PATH_INVALID'), true);
});

test('reconciliation remains read-only and separates archive from retained candidates', async () => {
  const registry = await loadDocumentRegistry(REPO_ROOT);
  const report = await buildReconciliationReport(registry, { rootDir: REPO_ROOT });

  assert.equal(report.mode, 'read_only_reconciliation');
  assert.equal(report.counts.unregistered, 0);
  assert.equal(report.counts.validationIssues, 0);
  // A clean repository may have no remaining archive candidates after RH0
  // reconciliation; the report must still expose the list explicitly.
  assert.equal(Array.isArray(report.archiveCandidates), true);
  assert.equal(report.retainedCompleted.length > 0, true);
});

// —— HK-04 P1：capability front-matter 增量校验（红绿先行：本节先于实现落盘）——
// 契约锚点：docs/hk04-spec-layer-design.md §2（四键 front-matter + 三条增量校验）。

function buildFrontMatterFixtureRegistry(docBody, docOverrides = {}) {
  return {
    schemaVersion: 1,
    coverage: { managedRoots: ['docs'], excludedPrefixes: [], requireRegistration: false },
    documents: [{
      id: 'PILOT-1',
      path: 'docs/pilot.md',
      kind: 'work-package',
      status: 'completed',
      canonical: false,
      archivePolicy: 'retain_stable_path',
      ...docOverrides,
    }],
    __docBody: docBody,
  };
}

async function writeFrontMatterFixture(context, docBody) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-frontmatter-'));
  context.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'pilot.md'), docBody, 'utf8');
  return tempRoot;
}

test('capability front-matter：四键齐备且 status/capability 与 registry 一致 → 零新增 issue', async (context) => {
  const tempRoot = await writeFrontMatterFixture(context, [
    '---',
    'capability: result-loop',
    'goal: 用户跑一次插件分析，在 Studio 看见可信结果',
    'acceptance:',
    '  - block121-result-loop 20/20',
    'status: completed',
    '---',
    '',
    '# Plan',
  ].join('\n'));

  const issues = await validateDocumentRegistry(
    buildFrontMatterFixtureRegistry(null, { capability: 'result-loop' }),
    { rootDir: tempRoot },
  );
  assert.equal(issues.some((item) => item.code.startsWith('FRONTMATTER_')), false);
});

test('capability front-matter：缺必填键/未知键 → 红', async (context) => {
  const tempRoot = await writeFrontMatterFixture(context, [
    '---',
    'capability: result-loop',
    'status: completed',
    'typoKey: oops',
    '---',
    '',
    '# Plan',
  ].join('\n'));

  const issues = await validateDocumentRegistry(
    buildFrontMatterFixtureRegistry(null, { capability: 'result-loop' }),
    { rootDir: tempRoot },
  );
  const codes = new Set(issues.map((item) => item.code));
  assert.equal(codes.has('FRONTMATTER_INVALID_FORMAT'), true, '缺 goal/acceptance 必须红');
  assert.equal(codes.has('FRONTMATTER_UNKNOWN_KEY'), true, '未知键必须红');
});

test('capability front-matter：status 与 registry 漂移 → 红（第二真相防线）', async (context) => {
  const tempRoot = await writeFrontMatterFixture(context, [
    '---',
    'capability: result-loop',
    'goal: g',
    'acceptance:',
    '  - x 1/1',
    'status: active',
    '---',
    '',
    '# Plan',
  ].join('\n'));

  const issues = await validateDocumentRegistry(
    buildFrontMatterFixtureRegistry(null, { capability: 'result-loop' }),
    { rootDir: tempRoot },
  );
  assert.equal(issues.some((item) => item.code === 'FRONTMATTER_STATUS_MISMATCH'), true);
});

test('capability front-matter：命名与 registry capability 一致性', async (context) => {
  const tempRoot = await writeFrontMatterFixture(context, [
    '---',
    'capability: Bad_Cap',
    'goal: g',
    'acceptance:',
    '  - x 1/1',
    'status: completed',
    '---',
    '',
    '# Plan',
  ].join('\n'));

  const issues = await validateDocumentRegistry(
    buildFrontMatterFixtureRegistry(null, { capability: 'result-loop' }),
    { rootDir: tempRoot },
  );
  const codes = new Set(issues.map((item) => item.code));
  assert.equal(codes.has('FRONTMATTER_CAPABILITY_INVALID'), true, '非 kebab-case 必须红');
  assert.equal(codes.has('FRONTMATTER_CAPABILITY_MISMATCH'), true, '与 registry capability 漂移必须红');
});

test('capability front-matter：无 front-matter 的存量文档零影响（增量采纳判据）', async (context) => {
  const tempRoot = await writeFrontMatterFixture(context, '# Plan\n\n正文无 front-matter。\n');
  const issues = await validateDocumentRegistry(buildFrontMatterFixtureRegistry(null), { rootDir: tempRoot });
  assert.equal(issues.some((item) => item.code.startsWith('FRONTMATTER_')), false);
});

test('capability front-matter：registry 声明 capability 但文档缺 front-matter → 红', async (context) => {
  const tempRoot = await writeFrontMatterFixture(context, '# Plan\n\n存量形态：无 front-matter，但 registry 已声明 capability。\n');
  const issues = await validateDocumentRegistry(
    buildFrontMatterFixtureRegistry(null, { capability: 'result-loop' }),
    { rootDir: tempRoot },
  );
  assert.equal(issues.some((item) => item.code === 'FRONTMATTER_INVALID_FORMAT'), true);
});

// ── BLOCK-170：AUDIT-LOG 自稳（audit-log-compact.mjs v2 搬移不改写 + docs:check 台账健康断言）──

function buildLedgerFixture({ chainEntries = 12, tableRows = 14 } = {}) {
  const lines = [
    '# 审计广播台 (AUDIT-LOG)',
    '',
    '> 本文件只保存需要主 Agent 看见的活跃广播与最近处理记录。',
    '> 入口直链（registry `entrypoint` 指向本台的 canonical 文档）：[block-14-closeout](./block-14-left-panel-qa-fix-closeout.md)',
    '',
  ];
  for (let i = chainEntries; i >= 1; i -= 1) {
    const day = String(i).padStart(2, '0');
    const prefix = i > chainEntries - 2 ? '最后更新：' : '此前 最后更新：';
    lines.push(`${prefix}2026-03-${day}（**条目 ${i}**：内容行。）`);
  }
  lines.push('', '## 当前待处理项', '', '| 状态 | 日期 | 事项 | 处置边界 |', '| --- | --- | --- | --- |', '| 🟡 | 2026-03-12 | 观察项 | 随使用累计 |', '');
  lines.push('## 最近处理记录', '', '| 状态 | 日期 | 事项 | 边界 |', '| --- | --- | --- | --- |');
  for (let i = tableRows; i >= 1; i -= 1) {
    const day = String(i).padStart(2, '0');
    lines.push(`| ✅ 收口 | 2026-02-${day} | **记录 ${i}**：一行摘要。 | PKG-${i} / COMPLETED |`);
  }
  lines.push('', '## 广播规则', '', '- 🔴：阻塞当前验收。', '');
  return lines;
}

test('audit-log-compact：链只留最近 N 条，淘汰行原文剪切且 through 日期=被剪行最新日期', () => {
  const result = compactLedgerLines(buildLedgerFixture({ chainEntries: 12, tableRows: 4 }), { chainKeep: 8 });
  assert.equal(result.chainCutLines.length, 4);
  assert.equal(result.throughDate, '2026-03-04');
  const out = result.outLines.join('\n');
  assert.equal(out.includes('**条目 12**'), true, '最新条目保留');
  assert.equal(out.includes('**条目 5**'), true, '窗口边界内条目保留');
  assert.equal(out.includes('**条目 4**'), false, '窗口外条目剪除');
  assert.equal(result.chainCutLines.join('\n').includes('**条目 4**'), true, '淘汰行原文进归档内容');
  assert.equal(out.includes('入口直链'), true, '头部入口直链行永不剪切');
  assert.equal(out.includes('## 当前待处理项'), true);
  assert.equal(out.includes('## 广播规则'), true);
});

test('audit-log-compact：记录表窗口淘汰含「老包唯一行」（窗口规则覆盖每包一条规则）', () => {
  const result = compactLedgerLines(buildLedgerFixture({ chainEntries: 2, tableRows: 14 }), { rowsKeep: 10 });
  assert.equal(result.rowsCutLines.length, 4);
  const out = result.outLines.join('\n');
  assert.equal(out.includes('PKG-1 / COMPLETED'), false, '最老的唯一包行也被窗口剪除——包状态真相在 roadmap/plan');
  assert.equal(out.includes('PKG-14 / COMPLETED'), true, '窗口内最新行保留');
  assert.equal(out.includes('| --- |'), true, '表结构行保留');
});

test('audit-log-compact：幂等——对已精简结果再跑零淘汰', () => {
  const first = compactLedgerLines(buildLedgerFixture({ chainEntries: 12, tableRows: 14 }));
  const second = compactLedgerLines(first.outLines);
  assert.equal(second.chainCutLines.length, 0);
  assert.equal(second.rowsCutLines.length, 0);
});

test('audit-log-compact：结构不变量缺失时 fail-closed 抛错（人工核查，不静默猜）', () => {
  assert.throws(() => compactLedgerLines(['# 只有标题', '最后更新：2026-03-01（孤儿条目）']));
});

test('docs:check 台账健康：超单读安全阈 → AUDIT_LOG_OVERSIZE 硬红', async (context) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-audit-ledger-'));
  context.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'docs', 'AUDIT-LOG.md'), 'x'.repeat(AUDIT_LEDGER_FAIL_BYTES + 1), 'utf8');
  const { issues } = await checkAuditLedgerHealth(tempRoot);
  assert.equal(issues.some((item) => item.code === 'AUDIT_LOG_OVERSIZE'), true);
});

test('docs:check 台账健康：超保留阈/超长行 → 建议级提示不红；缺失 → AUDIT_LOG_MISSING', async (context) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'petri-audit-ledger-'));
  context.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
  const ledgerPath = path.join(tempRoot, 'docs', 'AUDIT-LOG.md');
  await fs.writeFile(
    ledgerPath,
    `# 审计广播台\n\n最后更新：2026-03-12（正常条目）\n${'超长行。'.repeat(600)}\n`,
    'utf8',
  );
  const healthy = await checkAuditLedgerHealth(tempRoot);
  assert.equal(healthy.issues.length, 0, '阈值内零硬红');
  assert.equal(
    healthy.advisories.some((line) => line.includes('台账行超')),
    true,
    `超 ${AUDIT_LEDGER_ENTRY_WARN_BYTES}B 的行出建议级提示`,
  );

  await fs.rm(ledgerPath);
  const missing = await checkAuditLedgerHealth(tempRoot);
  assert.equal(missing.issues.some((item) => item.code === 'AUDIT_LOG_MISSING'), true);
});
