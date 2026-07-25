'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.env.BIOF3_RS9_VISUAL_ROOT || '');
if (!process.env.BIOF3_RS9_VISUAL_ROOT || root === path.parse(root).root) {
  throw new Error('BIOF3_RS9_VISUAL_ROOT must be an explicit isolated directory.');
}
process.env.BIOF3_DB_PATH = path.join(root, 'biof3.db');
process.env.BIOF3_LOCAL_DATA_DIR = root;

const db = require('../core/r-server/db');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const { bindProjectRepository } = require('../core/shared-backend/git-repository-binding');

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const project = db.db.prepare('SELECT * FROM projects ORDER BY created_at LIMIT 1').get();
if (!project) throw new Error('RS9 visual table seed requires an existing seeded project.');
const workspaceRoot = project.workspace_path;
ensureResultStudioSchema(db.db);
const repository = createResultStudioRepository(db.db, { ensureSchema: false });
const adapter = bindProjectRepository({ workspaceRoot, projectId: project.id }).adapter;

function csv(padjLimit) {
  const rows = ['gene_id,symbol,log2FoldChange,padj,selected'];
  for (let index = 1; index <= 50000; index += 1) {
    const padj = ((index % 1000) / 10000).toFixed(4);
    const selected = index <= 27 && Number(padj) <= padjLimit ? 'true' : 'false';
    rows.push(`ENSG${String(index).padStart(11, '0')},GENE${index},${((index % 17) / 3 - 2.5).toFixed(3)},${padj},${selected}`);
  }
  return `${rows.join('\n')}\n`;
}

function writeArtifact(jobId, content) {
  const outputDir = path.join(workspaceRoot, 'results', 'jobs', jobId, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const target = path.join(outputDir, 'deg-large.csv');
  fs.writeFileSync(target, content);
  return target;
}

const sourceJob = db.createToolJob({ toolId: 'deseq2', userId: 'local-user', projectId: project.id, name: 'RS9 large DEG baseline', params: { padj_cutoff: 0.05 }, status: 'running' });
const candidateJob = db.createToolJob({ toolId: 'deseq2', userId: 'local-user', projectId: project.id, name: 'RS9 large DEG candidate', params: { padj_cutoff: 0.01 }, status: 'running' });
const sourceContent = csv(0.05);
const candidateContent = csv(0.01);
const sourceArtifact = writeArtifact(sourceJob.id, sourceContent);
const candidateArtifact = writeArtifact(candidateJob.id, candidateContent);
const sourceScript = 'padj_cutoff <- 0.05\nwrite.csv(result, "deg-large.csv", row.names = FALSE)\n';
const candidateScript = 'padj_cutoff <- 0.01\nwrite.csv(result, "deg-large.csv", row.names = FALSE)\n';
const sourceSnapshot = path.join(workspaceRoot, 'results', 'jobs', sourceJob.id, 'run-script.R');
const candidateSnapshot = path.join(workspaceRoot, 'results', 'jobs', candidateJob.id, 'run-script.R');
fs.writeFileSync(sourceSnapshot, sourceScript);
fs.writeFileSync(candidateSnapshot, candidateScript);
const familyId = `af_${sha(`${project.id}\0${sourceJob.id}\0deg_table`).slice(0, 32)}`;
const sourceScriptPath = `analysis/scripts/${familyId}/rev_large_source/deg_table.R`;
const sourceParamsPath = `analysis/scripts/${familyId}/rev_large_source/parameters.json`;
const previousMain = adapter.revParse('refs/heads/biof3/main');
const sourceCommit = adapter.commitVirtualFiles({
  parentCommit: previousMain,
  ref: 'refs/heads/biof3/main', expectedOld: previousMain,
  message: 'RS9 large table baseline',
  files: [
    { path: sourceScriptPath, content: sourceScript },
    { path: sourceParamsPath, content: '{\n  "padj_cutoff": 0.05\n}\n' },
  ],
}).commit;
const candidateScriptPath = `analysis/scripts/${familyId}/rev_large_candidate/deg_table.R`;
const candidateParamsPath = `analysis/scripts/${familyId}/rev_large_candidate/parameters.json`;
const candidateCommit = adapter.commitVirtualFiles({
  parentCommit: sourceCommit,
  ref: 'refs/heads/biof3/changeset/cs_rs9_large_candidate', expectedOld: '0'.repeat(40),
  message: 'RS9 large table threshold candidate',
  files: [
    { path: candidateScriptPath, content: candidateScript },
    { path: candidateParamsPath, content: '{\n  "padj_cutoff": 0.01\n}\n' },
  ],
}).commit;

function result(jobId, artifactPath, content, scriptPath, script) {
  return {
    artifactTruth: { status: 'valid', blocking: false, issues: [] },
    tool: { id: 'deseq2', language: 'r' },
    artifacts: [{ id: 'deg_table', name: 'deg-large.csv', filename: 'deg-large.csv', type: 'table', label: '差异基因大表', path: artifactPath }],
    executionProvenance: {
      toolJobId: jobId, projectId: project.id,
      params: { normalized: { padj_cutoff: jobId === sourceJob.id ? 0.05 : 0.01 } },
      inputs: [],
      script: { snapshotPath: scriptPath, sha256: sha(script) },
      artifacts: [{ id: 'deg_table', filename: 'deg-large.csv', sha256: sha(content) }],
    },
  };
}
db.updateToolJob(sourceJob.id, { status: 'completed', resultJson: result(sourceJob.id, sourceArtifact, sourceContent, sourceSnapshot, sourceScript), completedAt: Date.now() });
db.updateToolJob(candidateJob.id, { status: 'completed', resultJson: result(candidateJob.id, candidateArtifact, candidateContent, candidateSnapshot, candidateScript), completedAt: Date.now() });

repository.createChangeSet({ changeSetId: 'cs_rs9_large_source', projectId: project.id, baseCommit: sourceCommit, workingBranchRef: 'refs/heads/biof3/main', createdBy: 'agent' });
repository.transitionChangeSet({ changeSetId: 'cs_rs9_large_source', to: 'running' });
repository.appendRevision({
  revisionId: 'rev_large_source', projectId: project.id, artifactFamilyId: familyId, artifactId: 'deg_table',
  sourceCommit, sourceScriptRef: { relativePath: sourceScriptPath, sha256: sha(sourceScript), artifactId: 'deg_table', rendererId: 'deseq2:deg_table', language: 'r', origin: 'project_materialized' },
  parametersRef: sourceParamsPath, parametersHash: sha('{\n  "padj_cutoff": 0.05\n}\n'), toolJobId: sourceJob.id,
  outputPath: path.relative(workspaceRoot, sourceArtifact).split(path.sep).join('/'), outputHash: sha(sourceContent),
  validationStatus: 'valid', reproducibilityStatus: 'verified', changeSetId: 'cs_rs9_large_source',
});
repository.transitionChangeSet({ changeSetId: 'cs_rs9_large_source', to: 'preview_ready', candidateCommit: sourceCommit, candidateArtifactRefs: ['rev_large_source'], jobRefs: [sourceJob.id] });
repository.adoptChangeSet({ changeSetId: 'cs_rs9_large_source', candidateCommit: sourceCommit });

repository.createChangeSet({ changeSetId: 'cs_rs9_large_candidate', projectId: project.id, baseCommit: sourceCommit, workingBranchRef: 'refs/heads/biof3/changeset/cs_rs9_large_candidate', createdBy: 'agent', parentArtifactRefs: ['rev_large_source'] });
repository.transitionChangeSet({ changeSetId: 'cs_rs9_large_candidate', to: 'running' });
repository.appendRevision({
  revisionId: 'rev_large_candidate', projectId: project.id, artifactFamilyId: familyId, artifactId: 'deg_table', parentRevisionIds: ['rev_large_source'],
  sourceCommit: candidateCommit, sourceScriptRef: { relativePath: candidateScriptPath, sha256: sha(candidateScript), artifactId: 'deg_table', rendererId: 'deseq2:deg_table', language: 'r', origin: 'project_materialized' },
  parametersRef: candidateParamsPath, parametersHash: sha('{\n  "padj_cutoff": 0.01\n}\n'), toolJobId: candidateJob.id,
  outputPath: path.relative(workspaceRoot, candidateArtifact).split(path.sep).join('/'), outputHash: sha(candidateContent),
  validationStatus: 'valid', reproducibilityStatus: 'verified', changeSetId: 'cs_rs9_large_candidate',
});
repository.transitionChangeSet({
  changeSetId: 'cs_rs9_large_candidate', to: 'preview_ready', candidateCommit,
  changedPaths: [
    { relativePath: candidateScriptPath, changeType: 'added', beforeHash: sha(sourceScript), afterHash: sha(candidateScript) },
    { relativePath: candidateParamsPath, changeType: 'added', beforeHash: null, afterHash: sha('{\n  "padj_cutoff": 0.01\n}\n') },
  ],
  candidateArtifactRefs: ['rev_large_candidate'], jobRefs: [candidateJob.id],
  validationSummary: { artifactTruthStatus: 'valid', sourceArtifactPreserved: true },
});

process.stdout.write(JSON.stringify({
  projectId: project.id,
  sourceJobId: sourceJob.id,
  candidateJobId: candidateJob.id,
  artifactFamilyId: familyId,
  rows: 50000,
  url: `http://127.0.0.1:3000/project/${project.id}?mode=scheduled&job=${sourceJob.id}&artifact=deg-large.csv`,
}));
