import test from 'node:test';
import assert from 'node:assert/strict';
import probe from '../core/shared-backend/runtime-resource-probe.js';

const VM_STAT_SAMPLE = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10.
Pages active:                             999.
Pages inactive:                           20.
Pages speculative:                        5.
Pages wired down:                         50.
`;

test('parseVmStatAvailableMemory counts reclaimable macOS pages', () => {
  assert.equal(probe.parseVmStatAvailableMemory(VM_STAT_SAMPLE), 35 * 16384);
});

test('parseVmStatAvailableMemory rejects incomplete observations', () => {
  assert.equal(probe.parseVmStatAvailableMemory('Pages free: 10.\n'), null);
  assert.equal(probe.parseVmStatAvailableMemory(''), null);
});

test('probeAvailableMemoryBytes uses vm_stat on macOS', () => {
  let invocation = null;
  const available = probe.probeAvailableMemoryBytes({
    platform: 'darwin',
    fallbackBytes: 123,
    execFileSyncImpl(command, args, options) {
      invocation = { command, args, options };
      return VM_STAT_SAMPLE;
    },
  });
  assert.equal(available, 35 * 16384);
  assert.equal(invocation.command, '/usr/bin/vm_stat');
  assert.deepEqual(invocation.args, []);
  assert.equal(invocation.options.encoding, 'utf8');
});

test('probeAvailableMemoryBytes falls back safely', () => {
  const throws = () => { throw new Error('probe unavailable'); };
  assert.equal(probe.probeAvailableMemoryBytes({ platform: 'darwin', fallbackBytes: 456, execFileSyncImpl: throws }), 456);
  assert.equal(probe.probeAvailableMemoryBytes({ platform: 'linux', fallbackBytes: 789, execFileSyncImpl: throws }), 789);
});
