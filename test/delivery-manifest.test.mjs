import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import crypto from 'node:crypto';
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
  const tableBody = 'gene,log2FC\nA,1\n';
  const plotBody = 'png';
  writeFileSync(tablePath, tableBody);
  writeFileSync(plotPath, plotBody);
  // POST-S7 H0：BLOCK-377 起 manifest 会按产物字节重算 sha256，声明值与实际字节不一致即
  // 判 integrity drift → status=degraded。此前夹具声明的是假摘要（'e'*64 / 'f'*64），
  // 该文件自 BLOCK-165 后未更新，于是「valid」用例长期红。夹具改为声明真实字节摘要
  // （drift 行为本身由下方 artifact_integrity_drift 负测守护）。
  const declared = options.declareWrongSha
    ? { deg_table: 'e'.repeat(64), volcano_plot: 'f'.repeat(64) }
    : {
      deg_table: crypto.createHash('sha256').update(tableBody).digest('hex'),
      volcano_plot: crypto.createHash('sha256').update(plotBody).digest('hex'),
    };
  const provenanceHash = 'c'.repeat(64);
  const result = {
    artifactTruth: { status: truthStatus, blocking: truthStatus === 'blocked', validCount: truthStatus === 'blocked' ? 0 : 2 },
    artifactDiagnostics: options.diagnostics || [],
    artifacts: options.noArtifacts ? [] : [
      { id: 'deg_table', type: 'table', filename: 'deg.csv', path: tablePath, size: 20, provenance: { provenanceHash, reproductionTarget: 'deg_table', replayVerified: options.verified === true } },
      { id: 'volcano_plot', type: 'plot', filename: 'volcano.png', path: plotPath, size: 3, provenance: options.missingProvenance ? null : { provenanceHash, reproductionTarget: 'volcano_plot' } },
    ],
    executionProvenance: { provenanceHash, script: { snapshotPath: join(root, 'results/jobs/tj_1/run-script.R'), sha256: 'd'.repeat(64) }, artifacts: [{ id: 'deg_table', filename: 'deg.csv', sha256: declared.deg_table }, { id: 'volcano_plot', filename: 'volcano.png', sha256: declared.volcano_plot }] },
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

test('HRT-5 产物字节与执行声明不一致 → degraded + artifact_integrity_drift（BLOCK-377 字节自证负测）', () => {
  const manifest = createDeliveryManifest({ taskRecord, job: jobWith('valid', { declareWrongSha: true }), projectRoot: root });
  assert.equal(manifest.status, 'degraded');
  assert.ok(manifest.unresolved.some((item) => item.code === 'artifact_integrity_drift'));
  assert.equal(manifest.artifacts[0].sha256Source, 'computed_bytes', '不一致时保留重算值，不静默采信声明');
  assert.equal(manifest.artifacts[0].declaredSha256, 'e'.repeat(64));
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

// POST-S7 H1/B-06——上一份 manifest 损坏不得静默新起一条链。
// 旧行为：空 catch 令 prev=null，调用方看不出断链；新行为：chainStatus=broken + reasonCode。
test('HRT-5 前序 manifest 损坏 → chainStatus=broken，不静默新起', () => {
  const manifest = createDeliveryManifest({ taskRecord, job: jobWith('valid'), projectRoot: root });
  const outputPath = join(root, 'results/jobs/tj_1/output/delivery-manifest-broken.json');
  const first = writeDeliveryManifest({ manifest, outputPath, projectRoot: root });
  assert.equal(first.chainStatus, 'started');
  assert.equal(first.prevManifestHash, null);

  writeFileSync(outputPath, '{ not json');
  const second = writeDeliveryManifest({ manifest: createDeliveryManifest({ taskRecord, job: jobWith('valid'), projectRoot: root }), outputPath, projectRoot: root });
  assert.equal(second.chainStatus, 'broken');
  assert.equal(second.reasonCode, 'manifest_chain_broken');
  assert.equal(second.prevManifestHash, null);
});

test('HRT-5 前序 manifest 完好 → chainStatus=linked 且 prevManifestHash 接上', () => {
  const outputPath = join(root, 'results/jobs/tj_1/output/delivery-manifest-linked.json');
  const first = writeDeliveryManifest({ manifest: createDeliveryManifest({ taskRecord, job: jobWith('valid'), projectRoot: root }), outputPath, projectRoot: root });
  const second = writeDeliveryManifest({ manifest: createDeliveryManifest({ taskRecord, job: jobWith('valid'), projectRoot: root }), outputPath, projectRoot: root });
  assert.equal(second.chainStatus, 'linked');
  assert.equal(second.prevManifestHash, first.manifestHash);
  assert.equal(second.reasonCode, undefined);
});
