import assert from 'node:assert/strict';
import test from 'node:test';
import snapshot from '../core/shared-backend/runtime-resource-snapshot.js';

test('runtime resource snapshot has TTL and separates resource state from scientific uncertainty', () => {
  const value = snapshot.createRuntimeResourceSnapshot({
    disk: { availableBytes: 20 * 1024 ** 3, totalBytes: 100 * 1024 ** 3, usePercent: 80 },
    runtime: { r: true, python: false },
    activeJobs: 2,
    estimatedMemoryBytes: 1,
    totalMemoryBytes: 16 * 1024 ** 3,
    availableMemoryBytes: 8 * 1024 ** 3,
    observedAt: '2026-07-22T00:00:00.000Z',
  });
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.state, 'ready');
  assert.equal(value.runtime.r, true);
  assert.equal(value.activeJobs, 2);
  assert.equal(snapshot.isResourceSnapshotFresh(value, Date.parse('2026-07-22T00:00:10.000Z')), true);
  assert.equal(snapshot.isResourceSnapshotFresh(value, Date.parse('2026-07-22T00:01:00.000Z')), false);
});

test('resource state becomes warning or unavailable without changing task truth', () => {
  assert.equal(snapshot.classifyResourceState({ availableMemoryBytes: 10 * 1024 ** 3, diskAvailableBytes: 20 * 1024 ** 3, estimatedMemoryBytes: 8 * 1024 ** 3 }), 'warning');
  assert.equal(snapshot.classifyResourceState({ availableMemoryBytes: 10 * 1024 ** 3, diskAvailableBytes: 20 * 1024 ** 3, estimatedMemoryBytes: 11 * 1024 ** 3 }), 'unavailable');
  assert.equal(snapshot.classifyResourceState({ diskAvailableBytes: 100 * 1024 ** 2 }), 'unavailable');
  assert.equal(snapshot.classifyResourceState({ availableMemoryBytes: 256 * 1024 ** 2, diskAvailableBytes: 20 * 1024 ** 3 }), 'unavailable');
  assert.equal(snapshot.classifyResourceState({ availableMemoryBytes: 1024 ** 3, diskAvailableBytes: 20 * 1024 ** 3 }), 'warning');
  assert.equal(snapshot.classifyResourceState({ availableMemoryBytes: 10 * 1024 ** 3, diskAvailableBytes: null }), 'unavailable');
  const unknown = snapshot.createRuntimeResourceSnapshot({
    disk: { availableBytes: null, totalBytes: null },
    totalMemoryBytes: null,
    availableMemoryBytes: null,
  });
  assert.equal(unknown.state, 'unavailable');
  assert.equal(unknown.memory.availableBytes, null);
  assert.equal(unknown.disk.availableBytes, null);
});
