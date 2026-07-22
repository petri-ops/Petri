'use strict';

const fs = require('fs');
const path = require('path');
const { hashFile } = require('./execution-provenance');

const ARTIFACT_MANIFEST_VERSION = 1;

function collectExecutionInputs({ inputDefinitions = [], params = {}, jobDir = null } = {}) {
  const snapshots = [];
  for (const definition of inputDefinitions || []) {
    if (!definition || definition.type !== 'file' || !definition.id) continue;
    const id = String(definition.id);
    const supplied = typeof params[id] === 'string' ? params[id] : null;
    const candidates = [];
    if (supplied) candidates.push(supplied);
    if (jobDir && fs.existsSync(jobDir)) {
      for (const name of fs.readdirSync(jobDir)) {
        if (name === id || name.startsWith(`${id}.`)) candidates.push(path.join(jobDir, name));
      }
    }
    const filePath = candidates.find((candidate) => {
      try { return fs.statSync(candidate).isFile(); } catch { return false; }
    });
    if (!filePath) continue;
    const stat = fs.statSync(filePath);
    snapshots.push({
      id,
      role: definition.role || id,
      relativePath: `inputs/${id}/${path.basename(filePath)}`,
      sha256: hashFile(filePath),
      sizeBytes: stat.size,
      sourceArtifactRef: definition.sourceArtifactRef || null,
    });
  }
  return snapshots;
}

function writeArtifactManifest({ outputDir, result = {}, provenance, plugin = {} } = {}) {
  if (!outputDir || !provenance) throw new Error('artifact_manifest_evidence_required');
  fs.mkdirSync(outputDir, { recursive: true });
  const artifacts = (provenance.artifacts || []).map((artifact) => ({
    id: artifact.id || null,
    filename: artifact.filename,
    type: artifact.type || null,
    sha256: artifact.sha256,
    reproductionTarget: artifact.reproductionTarget || artifact.id || artifact.filename,
  }));
  const manifest = {
    artifactManifestVersion: ARTIFACT_MANIFEST_VERSION,
    status: result.artifactTruth?.status || (result.status === 'failed' ? 'blocked' : 'valid'),
    plugin: {
      id: provenance.plugin?.id || plugin.id || null,
      version: provenance.plugin?.version || plugin.version || null,
      language: provenance.plugin?.language || plugin.language || null,
      manifestFingerprint: provenance.plugin?.manifestFingerprint || null,
    },
    reproducibility: {
      provenanceHash: provenance.provenanceHash,
      scriptSha256: provenance.script?.sha256 || null,
      paramsSha256: provenance.params?.sha256 || null,
      inputSha256: Object.fromEntries((provenance.inputs || []).map((input) => [input.id || input.role || input.relativePath, input.sha256])),
      outputSha256: Object.fromEntries(artifacts.map((artifact) => [artifact.filename, artifact.sha256])),
      runtime: provenance.runtime || null,
      packageConstraints: provenance.plugin?.packageConstraints || {},
    },
    artifacts,
    generatedAt: provenance.completedAt || new Date().toISOString(),
  };
  const manifestPath = path.join(outputDir, 'artifact-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest, manifestPath };
}

module.exports = {
  ARTIFACT_MANIFEST_VERSION,
  collectExecutionInputs,
  writeArtifactManifest,
};
