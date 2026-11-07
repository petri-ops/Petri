/**
 * nso-s2-delivery-manifest.test.mjs — BLOCK-377（S2 / G-10）交付清单字节自证契约。
 *
 * 契约：
 *  1. sha256 字节重算：产物在盘时 computedSha256=实际字节哈希，declared 并存可对账。
 *  2. 完整性漂移：declared ≠ computed → status=degraded + artifact_integrity_drift 登记（不静默）。
 *  3. manifest 链：二次写同路径 → prevManifestHash=上一份 manifestHash（可独立复算）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createDeliveryManifest,
  writeDeliveryManifest,
} = require('../core/shared-backend/delivery-manifest.js');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function buildTaskAndJob({ artifactPath, declaredSha }) {
  const taskRecord = {
    task_id: 't1', version: 1, spec_hash: 'spec', project_id: 'p1', conversation_id: 'c1',
    spec: { method: 'analysis', requestedDeliverables: ['a1'], inputs: [] },
  };
  const job = {
    id: 'j1', tool_id: 'volcano-plot', status: 'completed', created_at: '2026-11-07T00:00:00Z', completed_at: '2026-11-07T00:01:00Z',
    result_json: JSON.stringify({
      artifactTruth: { status: 'valid', blocking: false },
      artifacts: [{ id: 'a1', type: 'file', filename: 'out.png', path: artifactPath, provenance: { provenanceHash: 'p'.repeat(64), replayVerified: true } }],
      executionProvenance: {
        artifacts: [{ id: 'a1', sha256: declaredSha }],
        script: { snapshotPath: '/tmp/run-script.R', sha256: 's'.repeat(64) },
      },
    }),
  };
  return { taskRecord, job };
}

test('S2-G10 sha256 字节重算：在盘产物 computedSha256=字节哈希且 source=computed_bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's2-manifest-'));
  try {
    const bytes = Buffer.from('PNG-BYTES-HERE');
    const abs = path.join(dir, 'out.png');
    fs.writeFileSync(abs, bytes);
    const { taskRecord, job } = buildTaskAndJob({ artifactPath: abs, declaredSha: sha(bytes) });
    const m = createDeliveryManifest({ taskRecord, job, projectRoot: dir });
    const art = m.artifacts[0];
    assert.equal(art.computedSha256, sha(bytes));
    assert.equal(art.sha256Source, 'computed_bytes');
    assert.equal(art.declaredSha256, sha(bytes));
    assert.equal(m.status, 'valid');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S2-G10 完整性漂移：declared≠computed → degraded + artifact_integrity_drift', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's2-manifest-'));
  try {
    const abs = path.join(dir, 'out.png');
    fs.writeFileSync(abs, Buffer.from('ACTUAL-BYTES'));
    const { taskRecord, job } = buildTaskAndJob({ artifactPath: abs, declaredSha: sha(Buffer.from('TAMPERED-DECLARATION')) });
    const m = createDeliveryManifest({ taskRecord, job, projectRoot: dir });
    assert.equal(m.status, 'degraded', '声明与字节不一致必须降级（不静默采信）');
    const drift = m.unresolved.find((u) => u.code === 'artifact_integrity_drift');
    assert.ok(drift, 'drift 必须入 unresolved');
    assert.equal(drift.computed, sha(Buffer.from('ACTUAL-BYTES')));
    assert.match(m.summary.cautions.join('\n'), /产物字节与执行声明不一致/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('S2-G10 manifest 链：二次写同路径 prevManifestHash=上一份 manifestHash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's2-manifest-'));
  try {
    const abs = path.join(dir, 'out.png');
    fs.writeFileSync(abs, Buffer.from('STABLE'));
    const out = path.join(dir, 'delivery-manifest.json');
    const { taskRecord, job } = buildTaskAndJob({ artifactPath: abs, declaredSha: sha(Buffer.from('STABLE')) });
    const m1 = createDeliveryManifest({ taskRecord, job, projectRoot: dir });
    const w1 = writeDeliveryManifest({ manifest: m1, outputPath: out, projectRoot: dir });
    assert.equal(w1.prevManifestHash, null);
    const m2 = createDeliveryManifest({ taskRecord, job: { ...job, completed_at: '2026-11-07T00:02:00Z' }, projectRoot: dir });
    const w2 = writeDeliveryManifest({ manifest: m2, outputPath: out, projectRoot: dir });
    assert.equal(w2.prevManifestHash, w1.manifestHash, '链哈希衔接');
    const onDisk = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(onDisk.prevManifestHash, w1.manifestHash);
    assert.equal(onDisk.manifestHash, w2.manifestHash);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
