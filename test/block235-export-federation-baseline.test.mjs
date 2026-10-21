/**
 * BLOCK-235 S2 — export/federation domain-neutral baseline.
 * Pins that general projects and pack-extension artifact types move through
 * conversation export, artifact/delivery manifests and federation grants
 * without requiring a canonical bio profile or a legacy domain permission.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { composeConversationMarkdown } = require(path.join(ROOT, 'core/petri-server/helpers/conversation-export.js'));
const { writeArtifactManifest } = require(path.join(ROOT, 'core/shared-backend/artifact-manifest.js'));
const { createDeliveryManifest } = require(path.join(ROOT, 'core/shared-backend/delivery-manifest.js'));
const grants = require(path.join(ROOT, 'core/shared-backend/federation-grants.js'));

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

test('general project conversation export preserves content and adds no domain fields', () => {
  const markdown = composeConversationMarkdown({
    conversation: {
      id: 'conv_general',
      title: '通用项目会话',
      project_id: 'p_general',
      created_at: '2026-10-21T01:00:00.000Z',
    },
    messages: [
      { role: 'user', content: '帮我整理这份数据', ts: '2026-10-21T01:01:00.000Z' },
      { role: 'assistant', content: '已整理完成。', ts: '2026-10-21T01:02:00.000Z' },
    ],
    exportedAt: '2026-10-21T02:00:00.000Z',
  });
  assert.match(markdown, /项目：p_general/);
  assert.ok(markdown.includes('帮我整理这份数据'));
  assert.ok(markdown.includes('已整理完成。'));
  assert.doesNotMatch(markdown, /modality|single-cell|spatial|petri\.(counts|sample|expression|deg|gene|enrichment)/i);
});

test('artifact manifest carries a pack-extension artifact type without canonical profile lookup', () => {
  const outputDir = tempDir('petri-b235-manifest-');
  const sha = 'd'.repeat(64);
  const { manifest } = writeArtifactManifest({
    outputDir,
    result: { artifactTruth: { status: 'valid' } },
    provenance: {
      provenanceHash: 'a'.repeat(64),
      script: { sha256: 'b'.repeat(64) },
      params: { sha256: 'c'.repeat(64) },
      inputs: [],
      artifacts: [{ id: 'custom_table', filename: 'custom.csv', type: 'custom_table', sha256: sha }],
      plugin: { id: 'fixture-tool', version: '1.0.0', language: 'python' },
      completedAt: '2026-10-21T02:00:00.000Z',
    },
  });
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].type, 'custom_table');
  assert.equal(manifest.artifacts[0].sha256, sha);
  assert.equal(manifest.reproducibility.outputSha256['custom.csv'], sha);
});

test('delivery manifest carries a pack-extension artifact type for a general project', () => {
  const root = tempDir('petri-b235-delivery-');
  const artifactPath = path.join(root, 'custom.csv');
  fs.writeFileSync(artifactPath, 'id,value\nA,1\n');
  const provenanceHash = 'h'.repeat(64);
  const job = {
    id: 'tj_general',
    tool_id: 'fixture-tool',
    status: 'completed',
    created_at: 1,
    completed_at: 2,
    result_json: JSON.stringify({
      artifactTruth: { status: 'valid', blocking: false, validCount: 1 },
      artifacts: [{
        id: 'custom_table',
        type: 'custom_table',
        filename: 'custom.csv',
        path: artifactPath,
        size: 12,
        provenance: { provenanceHash, reproductionTarget: 'custom_table' },
      }],
      executionProvenance: {
        provenanceHash,
        script: { snapshotPath: '/tmp/run.py', sha256: 's'.repeat(64) },
        artifacts: [{ id: 'custom_table', filename: 'custom.csv', sha256: 'e'.repeat(64) }],
      },
    }),
  };
  const taskRecord = {
    task_id: 'task_general',
    version: 1,
    spec_hash: 'f'.repeat(64),
    project_id: 'p_general',
    conversation_id: 'conv_general',
    spec: { method: { category: 'general' }, requestedDeliverables: ['custom_table'], inputs: [] },
  };
  const manifest = createDeliveryManifest({ taskRecord, job, projectRoot: root });
  assert.equal(manifest.status, 'valid');
  assert.equal(manifest.artifacts[0].type, 'custom_table');
  assert.equal(manifest.artifacts[0].relativePath, 'custom.csv');
  assert.equal(manifest.requirementCoverage[0].status, 'satisfied');
});

test('federation grants are project-id based and independent of modality/permissions', () => {
  const dataDir = tempDir('petri-b235-grants-');
  assert.equal(grants.isProjectGranted(dataDir, 'engineer', 'p_general'), false);
  assert.equal(grants.grantProject(dataDir, 'engineer', 'p_general').ok, true);
  assert.equal(grants.isProjectGranted(dataDir, 'engineer', 'p_general'), true);
  assert.deepEqual(grants.grantedProjectsFor(dataDir, 'engineer'), [{ projectId: 'p_general' }]);
  assert.equal(grants.revokeProject(dataDir, 'engineer', 'p_general').ok, true);
  assert.equal(grants.isProjectGranted(dataDir, 'engineer', 'p_general'), false);
});
