import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildReconciliationReport,
  collectManagedMarkdown,
  loadDocumentRegistry,
  validateDocumentRegistry,
} from '../scripts/docs-governance.mjs';

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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-doc-governance-'));
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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-doc-single-active-'));
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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-doc-orphan-review-'));
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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-doc-path-'));
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
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-frontmatter-'));
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
