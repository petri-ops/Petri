import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  classifyReference,
  normalizeReference,
  toInternalUri,
  hasUsableArtifactTruth,
  isRealPathInsideRoot,
} = require('../core/biof3-server/helpers/chat-file-references.js');
const {
  renderFileReferenceHints,
} = require('../core/biof3-server/helpers/system-prompt.js');

test('decodes internal artifact and workspace paths segment by segment', () => {
  assert.deepEqual(
    normalizeReference('biof3://artifact/job-1/%E5%B7%AE%E5%BC%82%20%E5%9F%BA%E5%9B%A0.csv'),
    {
      reference: 'biof3://artifact/job-1/%E5%B7%AE%E5%BC%82%20%E5%9F%BA%E5%9B%A0.csv',
      kind: 'artifact',
      normalized: 'job-1/差异 基因.csv',
    },
  );
  assert.equal(
    normalizeReference('biof3://workspace/proj-1/data/%E6%A0%B7%E6%9C%AC%20A.csv')?.normalized,
    'proj-1/data/样本 A.csv',
  );
});

test('normalizes tools file URLs and preserves the job id', () => {
  assert.deepEqual(
    normalizeReference('/api/tools/file/job-1/report%20final.html'),
    {
      reference: '/api/tools/file/job-1/report%20final.html',
      kind: 'artifact_tools_url',
      normalized: 'job-1/report final.html',
      jobId: 'job-1',
    },
  );
});

test('rejects malformed encoding and dangerous protocols without throwing', () => {
  assert.equal(normalizeReference('biof3://artifact/job-1/bad%ZZ.csv'), null);
  assert.equal(normalizeReference('javascript:alert(1)'), null);
  assert.equal(normalizeReference('file:///etc/passwd'), null);
  assert.equal(normalizeReference('data:text/html,boom'), null);
});

test('classifies traversal and absolute paths for the route containment gate', () => {
  assert.deepEqual(classifyReference('../outside/secret.csv'), {
    kind: 'project_relative_path',
    normalized: '../outside/secret.csv',
  });
  assert.deepEqual(classifyReference('/Users/demo/project/data/sample.csv'), {
    kind: 'absolute_path',
    normalized: '/Users/demo/project/data/sample.csv',
  });
});

test('encodes internal URIs without exposing local paths', () => {
  assert.equal(
    toInternalUri({ kind: 'artifact', jobId: 'job 1', artifactName: '差异 基因.csv' }),
    'biof3://artifact/job%201/%E5%B7%AE%E5%BC%82%20%E5%9F%BA%E5%9B%A0.csv',
  );
  assert.equal(
    toInternalUri({ kind: 'workspace', projectId: 'proj 1', relativePath: 'data/样本 A.csv' }),
    'biof3://workspace/proj%201/data/%E6%A0%B7%E6%9C%AC%20A.csv',
  );
});

test('artifact truth and root containment gates reject unverified targets', () => {
  assert.equal(hasUsableArtifactTruth({ artifactTruth: { status: 'valid', validCount: 1 } }), true);
  assert.equal(hasUsableArtifactTruth({ artifactTruth: { status: 'degraded', blocking: false } }), true);
  assert.equal(hasUsableArtifactTruth({ artifactTruth: { status: 'blocked', blocking: true } }), false);
  assert.equal(hasUsableArtifactTruth({ artifacts: [{ name: 'declared-only.csv' }] }), false);
  assert.equal(isRealPathInsideRoot('/tmp/project', '/tmp/project/data/file.csv'), true);
  assert.equal(isRealPathInsideRoot('/tmp/project', '/tmp/project-other/file.csv'), false);
  assert.equal(isRealPathInsideRoot('/tmp/project', '/tmp/project'), false);
});

test('agent prompt mirrors the internal URI contract without changing action cards', () => {
  const hints = renderFileReferenceHints({
    activeJobId: 'job-1',
    activeJobHarnessSummary: { entries: [{ relativePath: 'output/report.html' }] },
  });
  assert.match(hints, /CHAT_FILE_REF_URI_v1/);
  assert.match(hints, /biof3:\/\/artifact\/job-1\/report\.html/);
  assert.match(hints, /biof3:\/\/workspace\/<projectId>\/<relativePath>/);
  assert.match(hints, /不要写真机绝对路径/);
  assert.match(hints, /Action Card/);
});
