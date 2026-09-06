import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
const { createResultChangeSetTools } = require('../core/biof3-server/agent-tools/result-edit-tools');

test('Result Edit executeJob forwards the trusted tool context conversation', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'biof3-execution-conversation-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const scriptContent = 'print(1)\n';
  const scriptPath = join(root, 'run-script.R');
  mkdirSync(root, { recursive: true });
  writeFileSync(scriptPath, scriptContent);
  const scriptSha256 = createHash('sha256').update(scriptContent).digest('hex');
  const sourceCommit = 'a'.repeat(40);
  const project = { id: 'p_execution', user_id: 'u_execution', workspace_path: root };
  const job = {
    id: 'tj_execution_source',
    project_id: project.id,
    tool_id: 'volcano-plot',
    status: 'completed',
    result: {
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'volcano_plot', name: 'plot.png' }],
      executionProvenance: {
        executionProvenanceVersion: 1,
        toolJobId: 'tj_execution_source',
        projectId: project.id,
        script: { snapshotPath: scriptPath, sha256: scriptSha256 },
        inputs: [],
        artifacts: [{ id: 'volcano_plot', filename: 'plot.png', sha256: 'b'.repeat(64) }],
        params: { normalized: { palette: 'red' } },
      },
    },
  };
  const revision = {
    revisionId: 'rev_execution_source',
    projectId: project.id,
    artifactId: 'volcano_plot',
    toolJobId: job.id,
    sourceCommit,
    sourceScriptRef: {
      relativePath: 'analysis/scripts/plot.R',
      sha256: scriptSha256,
      artifactId: 'volcano_plot',
      rendererId: 'volcano-plot:volcano_plot',
      language: 'r',
      origin: 'project_materialized',
    },
    parametersRef: 'analysis/scripts/parameters.json',
    parametersHash: createHash('sha256').update('{}').digest('hex'),
    outputHash: 'b'.repeat(64),
    changeSetId: 'cs_execution',
  };
  const repository = {
    saveRepositoryBinding: () => {},
    getRevision: () => revision,
    getChangeSet: () => ({ changeSetId: 'cs_execution', projectId: project.id, candidateCommit: sourceCommit }),
    listRevisionsByChangeSet: () => [],
  };
  const binding = {
    status: 'ready',
    mode: 'managed',
    workspaceRoot: root,
    managedPaths: ['analysis/scripts'],
    reason: null,
    inspection: { runtime: { versionRaw: 'git version test' } },
    adapter: {
      gitDir: join(root, '.biof3/git'),
      workTree: root,
      revParse: (ref) => ref === `${sourceCommit}^{commit}` ? sourceCommit : null,
      showFile: ({ filePath }) => filePath.endsWith('plot.R') ? scriptContent : '{}',
    },
  };
  let receivedOptions = null;
  const tools = createResultChangeSetTools({
    db: {
      db: {},
      getProject: () => project,
      getToolJob: () => job,
      getUserById: () => ({ role: 'user' }),
    },
    getPlugin: () => ({ id: 'volcano-plot', language: 'r' }),
    createResultStudioRepository: () => repository,
    bindProjectRepository: () => binding,
    callTool: async (toolId, params, options) => {
      receivedOptions = { toolId, params, options };
      return { isError: false, content: [{ type: 'text', text: '{}' }], toolJobId: 'tj_execution_candidate' };
    },
    createResultChangeSet: async (input, dependencies) => {
      await dependencies.executeJob({
        toolId: 'volcano-plot',
        params: { palette: 'blue' },
        materializedScriptPath: scriptPath,
        materializedScriptSha256: scriptSha256,
        changeSetId: 'cs_execution',
      });
      return { ok: true, changeSet: { changeSetId: 'cs_execution', status: 'preview_ready' }, input };
    },
  });

  const result = await tools.create(
    { intent: { artifactRef: { revisionId: revision.revisionId } } },
    { projectId: project.id, userId: project.user_id, conversationId: 'conversation-execution' },
  );
  assert.equal(result.ok, true);
  assert.equal(receivedOptions.options.conversationId, 'conversation-execution');
  assert.equal(receivedOptions.options.projectId, project.id);
});
