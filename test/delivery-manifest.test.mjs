import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDeliveryManifest, writeDeliveryManifest } = require('../core/shared-backend/delivery-manifest');
const root = mkdtempSync(join(tmpdir(), 'petri-hrt5-'));
after(() => rmSync(root, { recursive: true, force: true }));

const taskRecord = {
  task_id: 'task_1', version: 1, spec_hash: 'a'.repeat(64), project_id: 'project_1', conversation_id: 'conv_1',
  spec: { method: { category: 'bulk RNA-seq' }, requestedDeliverables: ['deg_table', 'plot'], inputs: [{ role: 'counts', relativePath: 'data/counts.csv', sha256: 'b'.repeat(64), sizeBytes: 100 }] },
};

function jobWith(truthStatus = 'valid', options = {}) {
  const tablePath = join(root, 'results/jobs/tj_1/output/deg.csv');
  const plotPath = join(root, 'results/jobs/tj_1/output/volcano.png');
  mkdirSync(join(root, 'results/jobs/tj_1/output'), { recursive: true });
  writeFileSync(tablePath, 'gene,log2FC\nA,1\n');
  writeFileSync(plotPath, 'png');
  const provenanceHash = 'c'.repeat(64);
  const result = {
    artifactTruth: { status: truthStatus, blocking: truthStatus === 'blocked', validCount: truthStatus === 'blocked' ? 0 : 2 },
    artifactDiagnostics: options.diagnostics || [],
    artifacts: options.noArtifacts ? [] : [
      { id: 'deg_table', type: 'table', filename: 'deg.csv', path: tablePath, size: 20, provenance: { provenanceHash, reproductionTarget: 'deg_table', replayVerified: options.verified === true } },
      { id: 'volcano_plot', type: 'plot', filename: 'volcano.png', path: plotPath, size: 3, provenance: options.missingProvenance ? null : { provenanceHash, reproductionTarget: 'volcano_plot' } },
    ],
    executionProvenance: { provenanceHash, script: { snapshotPath: join(root, 'results/jobs/tj_1/run-script.R'), sha256: 'd'.repeat(64) }, artifacts: [{ id: 'deg_table', filename: 'deg.csv', sha256: 'e'.repeat(64) }, { id: 'volcano_plot', filename: 'volcano.png', sha256: 'f'.repeat(64) }] },
  };
  return { id: 'tj_1', tool_id: 'deseq2', status: options.jobStatus || 'completed', result_json: JSON.stringify(result), created_at: 1, completed_at: 2, error: options.error || null };
}

test('HRT-5 creates a valid layered DeliveryManifest from verified artifact facts', () => {
  const manifest = createDeliveryManifest({ taskRecord, job: jobWith('valid'), projectRoot: root, findings: { statisticalFacts: ['FDR 来自结果表'], limitations: ['需要独立队列验证'] } });
  assert.equal(manifest.status, 'valid');
  assert.equal(manifest.artifacts.length, 2);
  assert.equal(manifest.artifacts[0].reproducibility.status, 'available');
  assert.equal(manifest.findings.statisticalFacts.length, 1);
  assert.match(manifest.manifestHash, /^[a-f0-9]{64}$/);
  const outputPath = join(root, 'results/jobs/tj_1/output/delivery-manifest.json');
  const written = writeDeliveryManifest({ manifest, outputPath, projectRoot: root });
  assert.equal(written.relativePath, 'results/jobs/tj_1/output/delivery-manifest.json');
  assert.equal(existsSync(outputPath), true);
});

test('HRT-5 maps degraded truth or missing reproducibility to degraded delivery', () => {
  const degraded = createDeliveryManifest({ taskRecord, job: jobWith('degraded', { missingProvenance: true }), projectRoot: root });
  assert.equal(degraded.status, 'degraded');
  assert.ok(degraded.artifacts.some((item) => item.reproducibility.status === 'unavailable'));
  assert.ok(degraded.summary.cautions.length > 0);
});

test('HRT-5 never presents blocked truth or failed Job as successful delivery', () => {
  const blocked = createDeliveryManifest({ taskRecord, job: jobWith('blocked', { jobStatus: 'failed', noArtifacts: true, error: 'required artifact missing' }), projectRoot: root });
  assert.equal(blocked.status, 'blocked');
  assert.ok(blocked.unresolved.some((item) => item.code === 'delivery_blocked'));
  assert.throws(() => writeDeliveryManifest({ manifest: blocked, outputPath: join(tmpdir(), 'outside.json'), projectRoot: root }), /outside_project/);
});
