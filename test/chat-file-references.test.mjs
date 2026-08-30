// node --test test/chat-file-references.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'biof3-server');
const req = createRequire(import.meta.url);

const helpers = req(R_SERVER + '/helpers/chat-file-references.js');
const { loadResolveRoute } = req(__dirname + '/chat-file-references-route.cjs');

function buildDbStub(opts) {
  opts = opts || {};
  const project = opts.project || {
    id: 'p_001',
    name: 'Demo',
    workspace_path: opts.workspacePath,
    user_id: opts.userId || 'u_local',
    is_public: 0,
  };
  const jobs = new Map(opts.jobs || []);
  return {
    getProject(id) {
      return id === project.id ? project : null;
    },
    getToolJob(id) {
      return jobs.get(id) || null;
    },
  };
}

function makeWorkspaceTree(root, files) {
  for (const file of files) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (file.endsWith('/')) fs.mkdirSync(full, { recursive: true });
    else fs.writeFileSync(full, '');
  }
}

test('classifyReference accepts internal artifact URIs', () => {
  const a = helpers.classifyReference('biof3://artifact/tj_123/data/差异基因.csv');
  assert.ok(a);
  assert.equal(a.kind, 'artifact');
  assert.equal(a.normalized, 'tj_123/data/差异基因.csv');
  const encoded = helpers.classifyReference(
    'biof3://artifact/tj_123/' + encodeURIComponent('差异 基因.csv'),
  );
  assert.ok(encoded);
  assert.equal(encoded.normalized, 'tj_123/差异 基因.csv');
});

test('classifyReference accepts workspace URIs', () => {
  const ok = helpers.classifyReference('biof3://workspace/p_001/data/sample.csv');
  assert.ok(ok);
  assert.equal(ok.kind, 'workspace');
  assert.equal(ok.normalized, 'p_001/data/sample.csv');
});

test('classifyReference decodes tools file URL to jobId/filename', () => {
  const r = helpers.classifyReference('/api/tools/file/tj_abc/差异基因.csv');
  assert.ok(r);
  assert.equal(r.kind, 'artifact_tools_url');
  assert.equal(r.jobId, 'tj_abc');
  assert.equal(r.normalized, 'tj_abc/差异基因.csv');
});

test('classifyReference classifies bare filenames and project-relative paths', () => {
  const file = helpers.classifyReference('volcano.csv');
  assert.ok(file);
  assert.equal(file.kind, 'bare_filename');
  assert.equal(file.normalized, 'volcano.csv');

  const rel = helpers.classifyReference('data/deg.csv');
  assert.ok(rel);
  assert.equal(rel.kind, 'project_relative_path');
  assert.equal(rel.normalized, 'data/deg.csv');

  const relDot = helpers.classifyReference('./data/deg.csv');
  assert.ok(relDot);
  assert.equal(relDot.kind, 'project_relative_path');
  assert.equal(relDot.normalized, 'data/deg.csv');
});

test('classifyReference rejects dangerous protocols', () => {
  for (const ref of [
    'file:///etc/passwd',
    'FILE:///etc/passwd',
    'javascript:alert(1)',
    'vbscript:msgbox',
    'data:text/html,<script>',
    'ftp://example.com/secret.csv',
  ]) {
    assert.equal(helpers.classifyReference(ref), null, 'expected null for ' + ref);
  }
});

test('classifyReference defers absolute local paths to the route containment gate', () => {
  assert.deepEqual(helpers.classifyReference('/Users/x/Desktop/secret.csv'), {
    kind: 'absolute_path',
    normalized: '/Users/x/Desktop/secret.csv',
  });
  assert.equal(helpers.classifyReference('C:\\Users\\x\\secret.csv'), null);
  assert.equal(helpers.classifyReference('http://localhost/secret.csv'), null);
  assert.equal(helpers.classifyReference('https://example.com/foo.csv'), null);
  assert.equal(helpers.classifyReference('about:blank'), null);
});

test('classifyReference rejects empty / control characters', () => {
  assert.equal(helpers.classifyReference(''), null);
  assert.equal(helpers.classifyReference('   '), null);
  assert.equal(helpers.classifyReference('\u0000bad'), null);
  assert.equal(helpers.classifyReference('"quoted"'), null);
  assert.equal(helpers.classifyReference('back\\slash'), null);
});

test('normalizeReference forwards classification results', () => {
  const a = helpers.normalizeReference('biof3://artifact/tj_123/deg.csv');
  assert.ok(a);
  assert.equal(a.kind, 'artifact');
  const toolsUrl = helpers.normalizeReference('/api/tools/file/tj_abc/deg.csv');
  assert.ok(toolsUrl);
  assert.equal(toolsUrl.kind, 'artifact_tools_url');
  assert.equal(toolsUrl.jobId, 'tj_abc');
  assert.equal(helpers.normalizeReference('file:///etc/passwd'), null);
});

test('toInternalUri encodes Chinese + spaces', () => {
  const artifact = helpers.toInternalUri({
    kind: 'artifact',
    jobId: 'tj_123',
    artifactName: '差异 基因.csv',
  });
  assert.equal(artifact, 'biof3://artifact/tj_123/' + encodeURIComponent('差异 基因.csv'));
  const ws = helpers.toInternalUri({
    kind: 'workspace',
    projectId: 'p_001',
    relativePath: 'data/sample.csv',
  });
  assert.equal(ws, 'biof3://workspace/p_001/data/sample.csv');
});
test('route: internal URI resolves to an artifact', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-fr-'));
  const workspaceRoot = path.join(tmp, 'project');
  const jobId = 'tj_alpha';
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'jobs', jobId, 'output'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'jobs', jobId, 'output', 'deg.csv'), 'a,b\n1,2\n');
  const dbStub = buildDbStub({
    workspacePath: workspaceRoot,
    jobs: [
      [
        jobId,
        {
          id: jobId,
          user_id: 'u_local',
          project_id: 'p_001',
          tool_id: 'volcano-plot',
          result_json: JSON.stringify({
            artifactTruth: { status: 'valid', blocking: false },
            resultDir: path.join(tmp, 'jobs', jobId, 'output'),
            artifacts: [{ name: 'deg.csv', type: 'table' }],
          }),
          params_json: '{}',
          status: 'completed',
        },
      ],
    ],
  });
  const invoke = loadResolveRoute(dbStub);
  const response = await invoke({
    projectId: 'p_001',
    activeJobId: null,
    references: ['biof3://artifact/' + jobId + '/deg.csv'],
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  const entry = response.body.results[0];
  assert.equal(entry.reference, 'biof3://artifact/' + jobId + '/deg.csv');
  assert.equal(entry.resolved.kind, 'artifact');
  assert.equal(entry.resolved.jobId, jobId);
  assert.equal(entry.resolved.name, 'deg.csv');
  assert.equal(entry.resolved.url, '/api/tools/file/' + jobId + '/deg.csv');
});

test('route: tools file URL resolves to artifact', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-fr-'));
  const workspaceRoot = path.join(tmp, 'project');
  const jobId = 'tj_beta';
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'jobs', jobId, 'output'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'jobs', jobId, 'output', 'volcano.csv'), 'a,b');
  const dbStub = buildDbStub({
    workspacePath: workspaceRoot,
    jobs: [
      [
        jobId,
        {
          id: jobId,
          user_id: 'u_local',
          project_id: 'p_001',
          tool_id: 'deseq2',
          result_json: JSON.stringify({
            artifactTruth: { status: 'valid', blocking: false },
            resultDir: path.join(tmp, 'jobs', jobId, 'output'),
            artifacts: [{ name: 'volcano.csv' }],
          }),
        },
      ],
    ],
  });
  const invoke = loadResolveRoute(dbStub);
  const r = await invoke({
    projectId: 'p_001',
    references: ['/api/tools/file/' + jobId + '/volcano.csv'],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.results[0].resolved.name, 'volcano.csv');
  assert.equal(r.body.results[0].resolved.jobId, jobId);
});

test('route: bare filename prefers active artifacts and otherwise requires a unique workspace match', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-fr-'));
  const workspaceRoot = path.join(tmp, 'project');
  makeWorkspaceTree(workspaceRoot, [
    'frontend/src/model-registry.ts',
    'data/duplicate.csv',
    'results/duplicate.csv',
  ]);
  const activeJobId = 'tj_active';
  const otherJobId = 'tj_other';
  for (const id of [activeJobId, otherJobId]) {
    fs.mkdirSync(path.join(tmp, 'jobs', id, 'output'), { recursive: true });
  }
  fs.writeFileSync(path.join(tmp, 'jobs', activeJobId, 'output', 'summary.csv'), '');
  fs.writeFileSync(path.join(tmp, 'jobs', otherJobId, 'output', 'summary.csv'), '');
  fs.writeFileSync(path.join(tmp, 'jobs', otherJobId, 'output', 'other-only.csv'), '');
  const dbStub = buildDbStub({
    workspacePath: workspaceRoot,
    jobs: [
      [
        activeJobId,
        {
          id: activeJobId,
          user_id: 'u_local',
          project_id: 'p_001',
          tool_id: 'deseq2',
          result_json: JSON.stringify({
            artifactTruth: { status: 'valid', blocking: false },
            resultDir: path.join(tmp, 'jobs', activeJobId, 'output'),
            artifacts: [{ name: 'summary.csv' }],
          }),
        },
      ],
      [
        otherJobId,
        {
          id: otherJobId,
          user_id: 'u_local',
          project_id: 'p_001',
          tool_id: 'deseq2',
          result_json: JSON.stringify({
            artifactTruth: { status: 'valid', blocking: false },
            resultDir: path.join(tmp, 'jobs', otherJobId, 'output'),
            artifacts: [{ name: 'summary.csv' }, { name: 'other-only.csv' }],
          }),
        },
      ],
    ],
  });
  const invoke = loadResolveRoute(dbStub);

  const r0 = await invoke({ projectId: 'p_001', references: ['model-registry.ts'] });
  assert.equal(r0.body.results[0].resolved.kind, 'workspace');
  assert.equal(r0.body.results[0].resolved.relativePath, 'frontend/src/model-registry.ts');

  const ambiguous = await invoke({ projectId: 'p_001', references: ['duplicate.csv'] });
  // Multiple matches used to be rejected as ambiguous; now the shallowest
  // path wins so the user gets a usable link instead of a dead reference.
  assert.equal(ambiguous.body.results[0].resolved.kind, 'workspace');
  assert.equal(ambiguous.body.results[0].resolved.relativePath, 'data/duplicate.csv');

  const r1 = await invoke({ projectId: 'p_001', activeJobId, references: ['summary.csv'] });
  assert.equal(r1.body.results[0].resolved.kind, 'artifact');
  assert.equal(r1.body.results[0].resolved.jobId, activeJobId);

  const r2 = await invoke({ projectId: 'p_001', activeJobId, references: ['other-only.csv'] });
  assert.equal(r2.body.results[0].resolved, null);
  assert.equal(r2.body.results[0].reason, 'file_not_found_or_ambiguous');
});

test('route: project relative-absolute path must be inside the workspace root', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-fr-'));
  const workspaceRoot = path.join(tmp, 'project');
  makeWorkspaceTree(workspaceRoot, ['data/sample.csv', 'data/sub/nested.csv']);
  const sibling = path.join(tmp, 'sibling');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'leak.csv'), 'leak');

  const dbStub = buildDbStub({ workspacePath: workspaceRoot });
  const invoke = loadResolveRoute(dbStub);

  const ok = await invoke({ projectId: 'p_001', references: ['data/sample.csv'] });
  assert.equal(ok.body.results[0].resolved.kind, 'workspace');
  assert.equal(ok.body.results[0].resolved.relativePath, 'data/sample.csv');

  const nested = await invoke({ projectId: 'p_001', references: ['data/sub/nested.csv'] });
  assert.equal(nested.body.results[0].resolved.relativePath, 'data/sub/nested.csv');

  const absoluteInside = await invoke({
    projectId: 'p_001',
    references: [path.join(workspaceRoot, 'data', 'sample.csv')],
  });
  if (process.platform === 'win32') {
    // On Windows the absolute reference carries backslashes; classifyReference
    // rejects raw absolute local paths (the renderer must never surface them),
    // so it resolves to null rather than a workspace link.
    assert.equal(absoluteInside.body.results[0].resolved, null);
    assert.equal(absoluteInside.body.results[0].reason, 'dangerous_or_unsupported');
  } else {
    assert.equal(absoluteInside.body.results[0].resolved.kind, 'workspace');
    assert.equal(absoluteInside.body.results[0].resolved.relativePath, 'data/sample.csv');
  }

  const traversal = await invoke({ projectId: 'p_001', references: ['../sibling/leak.csv'] });
  assert.equal(traversal.body.results[0].resolved, null);
  assert.equal(traversal.body.results[0].reason, 'workspace_out_of_root');

  const absolute = await invoke({ projectId: 'p_001', references: [path.join(sibling, 'leak.csv')] });
  assert.equal(absolute.body.results[0].resolved, null);
  if (process.platform === 'win32') {
    // Backslash absolute path is rejected at classification (see above).
    assert.equal(absolute.body.results[0].reason, 'dangerous_or_unsupported');
  } else {
    assert.equal(absolute.body.results[0].reason, 'absolute_path_out_of_workspace');
  }
});

test('route: rejects dangerous protocols and unknown schemes', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-fr-'));
  const dbStub = buildDbStub({ workspacePath: path.join(tmp, 'project') });
  const invoke = loadResolveRoute(dbStub);

  for (const ref of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://localhost/secret.csv',
  ]) {
    const r = await invoke({ projectId: 'p_001', references: [ref] });
    assert.equal(r.body.results[0].resolved, null);
    assert.equal(r.body.results[0].reason, 'dangerous_or_unsupported');
  }

  const outside = await invoke({
    projectId: 'p_001',
    references: ['/Users/x/Desktop/secret.csv'],
  });
  assert.equal(outside.body.results[0].resolved, null);
  assert.equal(outside.body.results[0].reason, 'absolute_path_out_of_workspace');
});

test('route: missing truth (job not found, artifact missing, project mismatch, forbidden)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-fr-'));
  const workspaceRoot = path.join(tmp, 'project');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const dbStub = buildDbStub({
    workspacePath: workspaceRoot,
    jobs: [
      ['tj_known', { id: 'tj_known', user_id: 'u_local', project_id: 'p_001', tool_id: 'volcano-plot', result_json: JSON.stringify({ artifactTruth: { status: 'valid', blocking: false }, resultDir: path.join(tmp, 'jobs', 'tj_known'), artifacts: [{ name: 'known.csv' }] }) }],
    ],
  });
  const invoke = loadResolveRoute(dbStub);

  const r1 = await invoke({ projectId: 'p_001', references: ['biof3://artifact/tj_unknown/deg.csv'] });
  assert.equal(r1.body.results[0].reason, 'job_not_found');

  const r2 = await invoke({ projectId: 'p_001', references: ['biof3://artifact/tj_known/never.csv'] });
  assert.equal(r2.body.results[0].reason, 'artifact_missing');

  const crossProjectStub = buildDbStub({
    workspacePath: workspaceRoot,
    jobs: [['tj_x', { id: 'tj_x', user_id: 'u_local', project_id: 'p_other', tool_id: 'volcano-plot', result_json: JSON.stringify({ artifactTruth: { status: 'valid', blocking: false }, artifacts: [{ name: 'x.csv' }] }) }]],
  });
  const invoke2 = loadResolveRoute(crossProjectStub);
  const r3 = await invoke2({ projectId: 'p_001', references: ['biof3://artifact/tj_x/x.csv'] });
  assert.equal(r3.body.results[0].reason, 'project_mismatch');

  const legacyJobStub = buildDbStub({
    workspacePath: workspaceRoot,
    jobs: [['tj_legacy', {
      id: 'tj_legacy',
      user_id: 'u_local',
      project_id: null,
      tool_id: 'volcano-plot',
      result_json: JSON.stringify({
        artifactTruth: { status: 'valid', blocking: false },
        artifacts: [{ name: 'legacy.csv' }],
      }),
    }]],
  });
  const invokeLegacy = loadResolveRoute(legacyJobStub);
  const legacy = await invokeLegacy({
    projectId: 'p_001',
    references: ['biof3://artifact/tj_legacy/legacy.csv'],
  });
  assert.equal(legacy.body.results[0].resolved, null);
  assert.equal(legacy.body.results[0].reason, 'project_mismatch');

  const r4 = await invoke({ projectId: 'p_does_not_exist', references: ['data/foo.csv'] });
  assert.equal(r4.status, 404);

  const forbiddenStub = buildDbStub({ workspacePath: workspaceRoot, userId: 'someone_else' });
  const invokeForbidden = loadResolveRoute(forbiddenStub);
  const r5 = await invokeForbidden({ projectId: 'p_001', references: ['data/sample.csv'] });
  assert.equal(r5.status, 403);
});

test('route: workspace URI only resolves when projectId matches', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-fr-'));
  const workspaceRoot = path.join(tmp, 'project');
  makeWorkspaceTree(workspaceRoot, ['data/sample.csv']);
  const dbStub = buildDbStub({ workspacePath: workspaceRoot });
  const invoke = loadResolveRoute(dbStub);

  const ok = await invoke({ projectId: 'p_001', references: ['biof3://workspace/p_001/data/sample.csv'] });
  assert.equal(ok.body.results[0].resolved.kind, 'workspace');

  const mismatch = await invoke({ projectId: 'p_001', references: ['biof3://workspace/p_999/data/sample.csv'] });
  assert.equal(mismatch.body.results[0].reason, 'project_mismatch');
});

test('route: workspace URI must stay inside the project root', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-fr-'));
  const workspaceRoot = path.join(tmp, 'project');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const dbStub = buildDbStub({ workspacePath: workspaceRoot });
  const invoke = loadResolveRoute(dbStub);

  const escape = await invoke({ projectId: 'p_001', references: ['biof3://workspace/p_001/../../etc/passwd'] });
  assert.equal(escape.body.results[0].resolved, null);
  assert.equal(escape.body.results[0].reason, 'workspace_out_of_root');
});
