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
  assert.equal(report.archiveCandidates.length > 0, true);
  assert.equal(report.retainedCompleted.length > 0, true);
});
