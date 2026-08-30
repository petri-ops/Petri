'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.BIOF3_RS6_VISUAL_ROOT || '');
if (!process.env.BIOF3_RS6_VISUAL_ROOT || root === path.parse(root).root) {
  throw new Error('BIOF3_RS6_VISUAL_ROOT must be an explicit isolated directory.');
}
fs.mkdirSync(root, { recursive: true });
const workspaceRoot = path.join(root, 'project');
fs.mkdirSync(workspaceRoot, { recursive: true });
process.env.BIOF3_DB_PATH = path.join(root, 'biof3.db');
process.env.BIOF3_LOCAL_DATA_DIR = root;

const db = require('../core/biof3-server/db');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository');
const { bindProjectRepository } = require('../core/shared-backend/git-repository-binding');

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJobArtifact(jobId, fileName, content) {
  const outputDir = path.join(workspaceRoot, 'results', 'jobs', jobId, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const artifactPath = path.join(outputDir, fileName);
  fs.writeFileSync(artifactPath, content);
  return artifactPath;
}

function svg({ color, label, points }) {
  const circles = points.map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="${index % 3 === 0 ? 7 : 5}" fill="${color}" opacity="0.78"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520" viewBox="0 0 800 520">
<rect width="800" height="520" fill="#ffffff"/>
<line x1="70" y1="450" x2="750" y2="450" stroke="#94a3b8"/><line x1="400" y1="55" x2="400" y2="450" stroke="#cbd5e1" stroke-dasharray="5 5"/>
<text x="70" y="36" font-family="sans-serif" font-size="22" fill="#0f172a">${label}</text>
<text x="350" y="495" font-family="sans-serif" font-size="14" fill="#64748b">log2 fold change</text>
${circles}
</svg>\n`;
}

ensureResultStudioSchema(db.db);
const repository = createResultStudioRepository(db.db, { ensureSchema: false });
const project = db.createProject({
  name: 'RS6 视觉验收',
  description: 'isolated Result Studio fixture',
  modality: 'bulk',
  userId: 'local-user',
  workspacePath: workspaceRoot,
});
const sourceJob = db.createToolJob({
  toolId: 'volcano-plot', userId: 'local-user', projectId: project.id,
  name: 'RS6 Volcano baseline', params: { palette: '#64748b' }, status: 'running',
});
const candidateJob = db.createToolJob({
  toolId: 'volcano-plot', userId: 'local-user', projectId: project.id,
  name: 'RS6 Volcano candidate', params: { palette: '#0d9488', labels: 10 }, status: 'running',
});
const sourceSvg = svg({ color: '#64748b', label: 'Volcano plot · baseline', points: [[170,360],[220,300],[285,390],[330,245],[470,270],[520,350],[590,190],[650,330]] });
const candidateSvg = svg({ color: '#0d9488', label: 'Volcano plot · candidate', points: [[160,350],[215,275],[280,385],[325,210],[475,245],[535,330],[600,145],[665,300]] });
const sourceArtifact = writeJobArtifact(sourceJob.id, 'volcano.svg', sourceSvg);
const candidateArtifact = writeJobArtifact(candidateJob.id, 'volcano.svg', candidateSvg);
const sourceScript = 'palette <- "#64748b"\nlabels <- 0\n';
const candidateScript = 'palette <- "#0d9488"\nlabels <- 10\n';
const sourceSnapshotPath = path.join(workspaceRoot, 'results', 'jobs', sourceJob.id, 'run-script.R');
const candidateSnapshotPath = path.join(workspaceRoot, 'results', 'jobs', candidateJob.id, 'run-script.R');
fs.writeFileSync(sourceSnapshotPath, sourceScript);
fs.writeFileSync(candidateSnapshotPath, candidateScript);
const sourceParams = '{\n  "labels": 0,\n  "palette": "#64748b"\n}\n';
const candidateParams = '{\n  "labels": 10,\n  "palette": "#0d9488"\n}\n';
const binding = bindProjectRepository({ workspaceRoot, projectId: project.id });
const adapter = binding.adapter;
const familyId = `af_${hash(`${project.id}\0${sourceJob.id}\0volcano_plot`).slice(0, 32)}`;
const sourceScriptPath = `analysis/scripts/${familyId}/rev_source/volcano_plot.R`;
const sourceParamsPath = `analysis/scripts/${familyId}/rev_source/parameters.json`;
const base = adapter.commitVirtualFiles({
  ref: 'refs/heads/biof3/main', expectedOld: '0'.repeat(40), message: 'RS6 visual baseline',
  files: [{ path: sourceScriptPath, content: sourceScript }, { path: sourceParamsPath, content: sourceParams }],
});
const candidateScriptPath = `analysis/scripts/${familyId}/rev_candidate/volcano_plot.R`;
const candidateParamsPath = `analysis/scripts/${familyId}/rev_candidate/parameters.json`;
const candidate = adapter.commitVirtualFiles({
  parentCommit: base.commit,
  ref: 'refs/heads/biof3/changeset/cs_candidate', expectedOld: '0'.repeat(40), message: 'RS6 visual candidate',
  files: [{ path: candidateScriptPath, content: candidateScript }, { path: candidateParamsPath, content: candidateParams }],
});

const sourceResult = {
  artifactTruth: { status: 'valid', blocking: false, issues: [] },
  tool: { id: 'volcano-plot', language: 'r' },
  artifacts: [{ id: 'volcano_plot', name: 'volcano.svg', filename: 'volcano.svg', type: 'plot', label: '火山图', path: sourceArtifact }],
  executionProvenance: {
    params: { normalized: { palette: '#64748b', labels: 0 } }, inputs: [],
    script: { snapshotPath: sourceSnapshotPath, sha256: hash(sourceScript) },
    artifacts: [{ id: 'volcano_plot', filename: 'volcano.svg', sha256: hash(sourceSvg) }],
  },
};
const candidateResult = {
  artifactTruth: { status: 'valid', blocking: false, issues: [] },
  tool: { id: 'volcano-plot', language: 'r' },
  artifacts: [{ id: 'volcano_plot', name: 'volcano.svg', filename: 'volcano.svg', type: 'plot', label: '火山图', path: candidateArtifact }],
  executionProvenance: {
    params: { normalized: { palette: '#0d9488', labels: 10 } }, inputs: [],
    script: { snapshotPath: candidateSnapshotPath, sha256: hash(candidateScript) },
    artifacts: [{ id: 'volcano_plot', filename: 'volcano.svg', sha256: hash(candidateSvg) }],
  },
};
db.updateToolJob(sourceJob.id, { status: 'completed', resultJson: sourceResult, completedAt: Date.now() });
db.updateToolJob(candidateJob.id, { status: 'completed', resultJson: candidateResult, completedAt: Date.now() });

repository.createChangeSet({
  changeSetId: 'cs_source', projectId: project.id, intentRef: `baseline:${sourceJob.id}:volcano_plot`,
  baseCommit: base.commit, workingBranchRef: 'refs/heads/biof3/source', createdBy: 'agent',
});
repository.transitionChangeSet({ changeSetId: 'cs_source', to: 'running' });
repository.appendRevision({
  revisionId: 'rev_source', projectId: project.id, artifactFamilyId: familyId, artifactId: 'volcano_plot',
  parentRevisionIds: [], sourceCommit: base.commit,
  sourceScriptRef: { relativePath: sourceScriptPath, sha256: hash(sourceScript), entryPoint: 'volcano_plot.R', artifactId: 'volcano_plot', rendererId: 'volcano-plot:volcano_plot', language: 'r', origin: 'project_materialized' },
  inputArtifactRefs: [], parametersRef: sourceParamsPath, parametersHash: hash(sourceParams), toolJobId: sourceJob.id,
  outputPath: path.relative(workspaceRoot, sourceArtifact).split(path.sep).join('/'), outputHash: hash(sourceSvg),
  validationStatus: 'valid', reproducibilityStatus: 'available', changeSetId: 'cs_source',
});
repository.transitionChangeSet({ changeSetId: 'cs_source', to: 'preview_ready', candidateCommit: base.commit, candidateArtifactRefs: ['rev_source'], jobRefs: [sourceJob.id] });
repository.adoptChangeSet({ changeSetId: 'cs_source', candidateCommit: base.commit });

repository.createChangeSet({
  changeSetId: 'cs_candidate', projectId: project.id, conversationId: null, intentRef: 'rei_visual_rs6',
  baseCommit: base.commit, workingBranchRef: 'refs/heads/biof3/changeset/cs_candidate', createdBy: 'agent', parentArtifactRefs: ['rev_source'],
});
repository.transitionChangeSet({ changeSetId: 'cs_candidate', to: 'running' });
repository.appendRevision({
  revisionId: 'rev_candidate', projectId: project.id, artifactFamilyId: familyId, artifactId: 'volcano_plot',
  parentRevisionIds: ['rev_source'], sourceCommit: candidate.commit,
  sourceScriptRef: { relativePath: candidateScriptPath, sha256: hash(candidateScript), entryPoint: 'volcano_plot.R', artifactId: 'volcano_plot', rendererId: 'volcano-plot:volcano_plot', language: 'r', origin: 'project_materialized' },
  inputArtifactRefs: [], parametersRef: candidateParamsPath, parametersHash: hash(candidateParams), toolJobId: candidateJob.id,
  outputPath: path.relative(workspaceRoot, candidateArtifact).split(path.sep).join('/'), outputHash: hash(candidateSvg),
  validationStatus: 'valid', reproducibilityStatus: 'verified', changeSetId: 'cs_candidate',
});
repository.transitionChangeSet({
  changeSetId: 'cs_candidate', to: 'preview_ready', candidateCommit: candidate.commit,
  changedPaths: [
    { relativePath: candidateScriptPath, changeType: 'added', beforeHash: hash(sourceScript), afterHash: hash(candidateScript) },
    { relativePath: candidateParamsPath, changeType: 'added', beforeHash: hash(sourceParams), afterHash: hash(candidateParams) },
  ],
  candidateArtifactRefs: ['rev_candidate'], jobRefs: [candidateJob.id],
  validationSummary: { artifactTruthStatus: 'valid', sourceArtifactPreserved: true },
});

process.stdout.write(JSON.stringify({
  root,
  projectId: project.id,
  sourceJobId: sourceJob.id,
  candidateJobId: candidateJob.id,
  artifactFamilyId: familyId,
  url: `http://127.0.0.1:3000/project/${project.id}?mode=scheduled&job=${sourceJob.id}&artifact=volcano.svg`,
}));
