import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

// BLOCK-49 加映清债 —— 统一临时 DB 自举（存量：单跑/全量缺 projects 表）
//（BIOF3_DB_PATH 须在 require db.js 前生效；与 agent-tool-registry.test 同一修法）
{
  const fsx = require('node:fs');
  const osx = require('node:os');
  const pth = require('node:path');
  const urlx = require('node:url');
  const hereDir = pth.dirname(urlx.fileURLToPath(import.meta.url));
  const Database = require(pth.resolve(hereDir, '..', 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
  const tempDbDir = fsx.mkdtempSync(pth.join(osx.tmpdir(), 'biof3-sweep-db-'));
  const boot = new Database(pth.join(tempDbDir, 'biof3.db'));
  const migrationsDir = pth.resolve(hereDir, '..', 'src', 'migrations');
  for (const f of fsx.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fsx.readFileSync(pth.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = pth.join(tempDbDir, 'biof3.db');
  process.on('exit', () => { try { fsx.rmSync(tempDbDir, { recursive: true, force: true }); } catch {} });
}
const routePath = '../core/biof3-server/routes/result-studio';
const route = require(routePath);

test('routes/result-studio facade expose all 10 _test helpers (100% backward compat)', () => {
  const expected = [
    'attachExistingRepositoryWithExplicitConsent',
    'baselineFailureDiagnostic',
    'bindAuthoritativeQuerySelection',
    'buildContextBoundPreviewBudget',
    'findArtifactRecord',
    'openVerifiedRevisionArtifact',
    'publicResultStudioErrorMessage',
    'resolveArtifactPath',
    'resolveInteractionBaselineRevision',
    'verifyArtifactRecordBytes',
  ];
  for (const name of expected) {
    assert.equal(typeof route._test[name], 'function', `route._test.${name} missing or not a function`);
  }
});

test('routes/result-studio facade register function is a callable', () => {
  assert.equal(typeof route, 'function', 'main route export should be a register function');
});

test('_helpers/validate.js exposes userId / isAdminOrInternal / canAccessProject', () => {
  const validate = require('../core/biof3-server/routes/_helpers/validate');
  for (const name of ['userId', 'isAdminOrInternal', 'canAccessProject']) {
    assert.equal(typeof validate[name], 'function', `validate.${name} missing`);
  }
  // 行为校验：none → false，admin → true
  assert.equal(validate.canAccessProject({}, null), false);
  assert.equal(validate.canAccessProject({ isInternal: true }, { id: 'p1' }), true);
  assert.equal(validate.userId({}), null);
  assert.equal(validate.userId({ user: { id: 'u1' } }), 'u1');
});

test('_helpers/repository.js exposes repository helpers', () => {
  const repo = require('../core/biof3-server/routes/_helpers/repository');
  for (const name of [
    'loadJobAndProject',
    'findArtifactRecord',
    'verifyArtifactRecordBytes',
    'parseToolJobResult',
    'persistedToolJobConversation',
    'artifactTruthError',
    'artifactTruthAvailability',
  ]) {
    assert.equal(typeof repo[name], 'function', `repository.${name} missing`);
  }
  // artifactTruthError / artifactTruthAvailability 行为轻校验
  assert.deepEqual(repo.artifactTruthError('rsn', 'msg', 'code'),
    { error: { status: 409, code: 'code', reason: 'rsn', message: 'msg' } });
  // 空 result → 不可用（返回 error 对象，reason 字段是 'job_artifact_truth_unavailable'）
  const unavailable = repo.artifactTruthAvailability({});
  assert.ok(unavailable && unavailable.error && unavailable.error.reason === 'job_artifact_truth_unavailable');
  // valid → null
  assert.equal(repo.artifactTruthAvailability({
    artifactTruth: { status: 'valid', blocking: false },
  }), null);
});

test('_helpers/format.js exposes publicResultStudioErrorMessage / sendArtifactResolutionError', () => {
  const format = require('../core/biof3-server/routes/_helpers/format');
  for (const name of ['publicResultStudioErrorMessage', 'sendArtifactResolutionError', 'artifactTruthError', 'artifactTruthAvailability']) {
    assert.equal(typeof format[name], 'function', `format.${name} missing`);
  }
  // PRIVATE_ERROR_COORDINATE 触发 fallback
  assert.equal(format.publicResultStudioErrorMessage(new Error('/etc/passwd leaked'), 'fallback'), 'fallback');
  assert.equal(format.publicResultStudioErrorMessage(new Error('plain message'), 'fallback'), 'plain message');
});

test('_helpers/context.js exposes buildContextBoundPreviewBudget', () => {
  const ctx = require('../core/biof3-server/routes/_helpers/context');
  assert.equal(typeof ctx.buildContextBoundPreviewBudget, 'function');
  const out = ctx.buildContextBoundPreviewBudget({ activePreviewJobs: 2 });
  assert.ok(out && out.snapshot && out.budget, 'must return { snapshot, budget }');
  assert.equal(out.budget.resourceEstimate.estimateVersion, 1);
});

test('_helpers/storage.js exposes hashing / csv / open snapshot', () => {
  const storage = require('../core/biof3-server/routes/_helpers/storage');
  for (const name of [
    'hashFile',
    'resolveWorkspaceFileForRevision',
    'openVerifiedRevisionArtifact',
    'readTableSample',
    'detectDelimiter',
    'splitCsvLine',
  ]) {
    assert.equal(typeof storage[name], 'function', `storage.${name} missing`);
  }
  // 轻行为：detectDelimiter / splitCsvLine
  assert.equal(storage.detectDelimiter('a\tb\nc\td', 'file.tsv'), '\t');
  assert.equal(storage.detectDelimiter('a,b,c', 'file.csv'), ',');
  assert.deepEqual(storage.splitCsvLine('a,b,c', ','), ['a', 'b', 'c']);
  assert.deepEqual(storage.splitCsvLine('a,"b,c",d', ','), ['a', 'b,c', 'd']);
});

test('_helpers/workflow.js exposes 7 workflow helpers', () => {
  const w = require('../core/biof3-server/routes/_helpers/workflow');
  for (const name of [
    'attachExistingRepositoryWithExplicitConsent',
    'resolveInteractionBaselineRevision',
    'baselineFailureDiagnostic',
    'resolveInteractionDescriptor',
    'backingArtifactName',
    'bindAuthoritativeQuerySelection',
    'resolveArtifactPath',
  ]) {
    assert.equal(typeof w[name], 'function', `workflow.${name} missing`);
  }
  // backingArtifactName 简单路径
  assert.equal(w.backingArtifactName({ mapping: { dataFile: 'foo.csv' } }), 'foo.csv');
  assert.equal(w.backingArtifactName({}), null);
  // baselineFailureDiagnostic 边界
  assert.equal(w.baselineFailureDiagnostic({ code: 'baseline_revision_unavailable' }).code,
    'baseline_revision_unavailable');
});

test('routes/result-studio/index.js facade exposes required surfaces', () => {
  const index = require('../core/biof3-server/routes/result-studio/index');
  assert.equal(typeof index.register, 'function');
  assert.ok(index._submodules, 'must expose _submodules');
  assert.ok(index._helpers, 'must expose _helpers');
  for (const name of ['repository', 'interaction', 'selection', 'context', 'changesets', 'revisions', 'storage', 'workspace', 'preview-budget']) {
    assert.equal(typeof index._submodules[name], 'function', `_submodules.${name} missing`);
  }
  for (const name of ['validate', 'repository', 'format', 'context', 'storage', 'workflow']) {
    assert.equal(typeof index._helpers[name], 'function', `_helpers.${name} missing`);
  }
});

test('routes/result-studio 9 subdomain stubs are all loadable', () => {
  const subs = ['repository', 'interaction', 'selection', 'context', 'changesets', 'revisions', 'storage', 'workspace', 'preview-budget'];
  for (const name of subs) {
    const sub = require(`../core/biof3-server/routes/result-studio/${name}`);
    assert.equal(typeof sub.register, 'function', `${name}.register missing`);
  }
});

test('routes/result-studio facade preserves _test reference identity with helpers', () => {
  // route._test.<helper> === helpers.<helper>（同一函数引用，纯转发）
  const validate = require('../core/biof3-server/routes/_helpers/validate');
  const repository = require('../core/biof3-server/routes/_helpers/repository');
  const format = require('../core/biof3-server/routes/_helpers/format');
  const context = require('../core/biof3-server/routes/_helpers/context');
  const storage = require('../core/biof3-server/routes/_helpers/storage');
  const workflow = require('../core/biof3-server/routes/_helpers/workflow');

  // Indirect 通过 _test 暴露：
  assert.equal(route._test.publicResultStudioErrorMessage, format.publicResultStudioErrorMessage);
  assert.equal(route._test.buildContextBoundPreviewBudget, context.buildContextBoundPreviewBudget);
  assert.equal(route._test.resolveArtifactPath, workflow.resolveArtifactPath);
  assert.equal(route._test.resolveInteractionBaselineRevision, workflow.resolveInteractionBaselineRevision);
  // Underscore 内部 helpers（直接 import 即可）
  void validate; void repository; void storage;
});
