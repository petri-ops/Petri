'use strict';

const os = require('os');
const { execFileSync } = require('child_process');

const VM_STAT_PATH = '/usr/bin/vm_stat';
const DEFAULT_PAGE_SIZE = 4096;

function finiteNonNegative(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function parseVmStatAvailableMemory(output) {
  if (typeof output !== 'string' || output.trim() === '') return null;

  const pageSizeMatch = output.match(/page size of\s+(\d+)\s+bytes/i);
  const pageSize = finiteNonNegative(pageSizeMatch?.[1], DEFAULT_PAGE_SIZE);
  if (pageSize <= 0) return null;

  const pages = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(Pages free|Pages inactive|Pages speculative)\s*:\s*([\d,]+)\.?\s*$/i);
    if (!match) continue;
    pages.set(match[1].toLowerCase(), finiteNonNegative(match[2].replaceAll(',', ''), 0));
  }

  const required = ['pages free', 'pages inactive', 'pages speculative'];
  if (!required.every((key) => pages.has(key))) return null;
  return required.reduce((total, key) => total + pages.get(key), 0) * pageSize;
}

function probeAvailableMemoryBytes({
  platform = process.platform,
  fallbackBytes = os.freemem(),
  execFileSyncImpl = execFileSync,
} = {}) {
  const fallback = finiteNonNegative(fallbackBytes, 0);
  if (platform !== 'darwin') return fallback;

  try {
    const output = execFileSyncImpl(VM_STAT_PATH, [], {
      encoding: 'utf8',
      timeout: 2_000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return finiteNonNegative(parseVmStatAvailableMemory(output), fallback);
  } catch {
    return fallback;
  }
}

module.exports = {
  VM_STAT_PATH,
  parseVmStatAvailableMemory,
  probeAvailableMemoryBytes,
};
